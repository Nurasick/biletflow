"""Single-use links for password reset and email verification (§4.1).

The raw token goes out in the email; only its SHA-256 is stored
(01-identity.md#why-a-hash-and-not-the-token), so a database leak hands
nobody a working reset link.

Emails are written to the transactional `notifications` outbox in the same
transaction as the `UserToken` row, so an SMTP outage never causes a 500
after commit.
"""

from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.security import generate_url_token, get_password_hash, hash_url_token
from app.models.token import TokenPurpose, UserToken
from app.models.user import User
from app.services import auth as auth_service
from app.services import notify
from app.services import user as user_service


class InvalidToken(Exception):
    """Unknown, already used, or expired. One error for all three, on purpose."""


def request_password_reset(db: Session, email: str, now: datetime | None = None) -> None:
    """Queue a reset link if the account exists. Silent either way.

    The route answers 202 whether or not the email has an account, so this
    endpoint cannot be used to find out who is registered.
    """
    user = user_service.get_user_by_email(db, email)
    if user is None:
        return
    raw = _issue(
        db,
        user,
        TokenPurpose.PASSWORD_RESET,
        timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
        now,
    )
    link = f"{settings.PUBLIC_WEB_URL.rstrip('/')}/reset-password?token={raw}"
    notify.notify(
        db,
        "auth.password_reset",
        {"link": link, "expire_minutes": settings.PASSWORD_RESET_EXPIRE_MINUTES},
        email=user.email,
        user_id=user.id,
        in_app=False,
    )
    db.commit()


def reset_password(db: Session, raw_token: str, new_password: str, now=None) -> User:
    now = now or utcnow()
    user = _consume(db, raw_token, TokenPurpose.PASSWORD_RESET, now)
    user.hashed_password = get_password_hash(new_password)
    # A completed reset proves the user reads this inbox.
    user.is_email_verified = True
    # Revoke every active refresh session and invalidate existing access JWTs.
    auth_service.revoke_all_user_sessions(db, user, bump_token_version=True, now=now)
    db.commit()
    return user


def send_verification(db: Session, user: User, now: datetime | None = None) -> None:
    raw = _issue(
        db,
        user,
        TokenPurpose.EMAIL_VERIFICATION,
        timedelta(hours=settings.EMAIL_VERIFICATION_EXPIRE_HOURS),
        now,
    )
    link = f"{settings.PUBLIC_WEB_URL.rstrip('/')}/verify-email?token={raw}"
    notify.notify(
        db,
        "auth.email_verification",
        {"link": link, "expire_hours": settings.EMAIL_VERIFICATION_EXPIRE_HOURS},
        email=user.email,
        user_id=user.id,
        in_app=False,
    )
    db.commit()


def verify_email(db: Session, raw_token: str, now: datetime | None = None) -> User:
    user = _consume(db, raw_token, TokenPurpose.EMAIL_VERIFICATION, now)
    user.is_email_verified = True
    db.commit()
    return user


def _issue(db: Session, user: User, purpose: TokenPurpose, ttl: timedelta, now) -> str:
    now = now or utcnow()
    # A new link retires the old ones, so only the latest email works.
    db.execute(
        update(UserToken)
        .where(
            UserToken.user_id == user.id,
            UserToken.purpose == purpose,
            UserToken.used_at.is_(None),
        )
        .values(used_at=now)
        .execution_options(synchronize_session=False)
    )
    raw = generate_url_token()
    db.add(
        UserToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=hash_url_token(raw),
            expires_at=now + ttl,
        )
    )
    db.flush()
    return raw


def _consume(db: Session, raw_token: str, purpose: TokenPurpose, now) -> User:
    now = now or utcnow()
    token_hash = hash_url_token(raw_token)
    # Conditional UPDATE, so two clicks on the same link cannot both succeed.
    user_id = db.execute(
        update(UserToken)
        .where(
            UserToken.token_hash == token_hash,
            UserToken.purpose == purpose,
            UserToken.used_at.is_(None),
            UserToken.expires_at > now,
        )
        .values(used_at=now)
        .returning(UserToken.user_id)
        .execution_options(synchronize_session=False)
    ).scalar()
    if user_id is None:
        db.rollback()
        raise InvalidToken
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        raise InvalidToken
    return user
