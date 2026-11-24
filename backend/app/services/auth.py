from datetime import datetime, timedelta

from jwt import InvalidTokenError
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.clock import as_utc, utcnow
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_url_token,
)
from app.models.token import UserSession
from app.models.user import User


def resolve_token_user(db: Session, token: str, expected_type: str) -> User | None:
    """Return the user a token belongs to, or None if the token cannot be trusted.

    Every failure collapses to None deliberately. The caller answers all of them
    with one generic 401, so a probe cannot tell an expired token from a forged
    one, or a refresh token used as an access token from a deleted account.
    """
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return None
    if payload.get("type") != expected_type:
        return None
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None
    user = db.get(User, user_id)
    if user is None:
        return None
    # A bumped token_version (e.g. after password reset) invalidates every prior JWT.
    user_version = getattr(user, "token_version", 0) or 0
    if payload.get("tv", 0) != user_version:
        return None
    return user


def token_csrf_claim(token: str) -> str | None:
    """The CSRF value bound into a refresh token, or None if it carries none.

    Keeping the expected value inside the token itself makes the check
    stateless and ties it to one specific refresh token: a value issued with an
    older token will not match a newer one.
    """
    try:
        return decode_token(token).get("csrf")
    except InvalidTokenError:
        return None


def issue_tokens(user: User, csrf: str | None = None) -> tuple[str, str]:
    """A fresh (access, refresh) pair. `csrf` binds the refresh half, for cookies."""
    tv = getattr(user, "token_version", 0) or 0
    return (
        create_access_token(user.id, token_version=tv),
        create_refresh_token(user.id, csrf=csrf, token_version=tv),
    )


def issue_session(
    db: Session, user: User, csrf: str | None = None, now: datetime | None = None
) -> tuple[str, str]:
    """Issue a token pair and record the hashed refresh token server-side. Does not commit."""
    now = now or utcnow()
    access, refresh = issue_tokens(user, csrf=csrf)
    db.add(
        UserSession(
            user_id=user.id,
            refresh_token_hash=hash_url_token(refresh),
            expires_at=now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        )
    )
    return access, refresh


def find_active_session(
    db: Session, raw_refresh_token: str, user_id: int, now: datetime | None = None
) -> UserSession | None:
    """Return the active (unrevoked, unexpired) session matching this refresh token."""
    now = now or utcnow()
    session = db.scalar(
        select(UserSession).where(
            UserSession.refresh_token_hash == hash_url_token(raw_refresh_token),
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
    )
    if session is None or as_utc(session.expires_at) <= now:
        return None
    return session


def consume_session(db: Session, session_id: int, now: datetime | None = None) -> bool:
    """Atomically revoke one session during rotation. Returns False if already spent."""
    now = now or utcnow()
    updated = db.execute(
        update(UserSession)
        .where(UserSession.id == session_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    )
    return updated.rowcount == 1


def revoke_refresh_token(
    db: Session,
    raw_refresh_token: str,
    *,
    user_id: int | None = None,
    now: datetime | None = None,
) -> int:
    """Revoke one specific refresh token by its hash. Does not commit."""
    now = now or utcnow()
    stmt = (
        update(UserSession)
        .where(
            UserSession.refresh_token_hash == hash_url_token(raw_refresh_token),
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    )
    if user_id is not None:
        stmt = stmt.where(UserSession.user_id == user_id)
    return db.execute(stmt).rowcount


def revoke_all_user_sessions(
    db: Session,
    user: User,
    *,
    bump_token_version: bool = False,
    now: datetime | None = None,
) -> int:
    """Revoke every active refresh session for `user`. Does not commit."""
    now = now or utcnow()
    count = db.execute(
        update(UserSession)
        .where(UserSession.user_id == user.id, UserSession.revoked_at.is_(None))
        .values(revoked_at=now)
        .execution_options(synchronize_session=False)
    ).rowcount
    if bump_token_version:
        user.token_version = (getattr(user, "token_version", 0) or 0) + 1
    return count
