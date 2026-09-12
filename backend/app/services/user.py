from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import get_password_hash, verify_hashed_password
from app.models.user import User
from app.schemas.user import UserCreate

# Verifying against a throwaway hash costs the same as verifying against a real
# one, so a login attempt for an unknown email takes as long as one for a known
# email. Without it the response time alone tells a stranger which addresses
# have accounts.
_DUMMY_HASH = get_password_hash("not-a-real-password")


class EmailAlreadyRegistered(Exception):
    """The email of a new account is already taken."""


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.lower()))


def create_user(db: Session, data: UserCreate) -> User:
    user = User(
        email=data.email,
        hashed_password=get_password_hash(data.password),
        first_name=data.first_name,
        last_name=data.last_name,
        phone=data.phone,
        locale=data.locale,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # The unique index is the authority, not a prior SELECT: two requests
        # for the same address can both pass a check and only one can commit.
        db.rollback()
        raise EmailAlreadyRegistered from None
    db.refresh(user)
    return user


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(db, email)
    if user is None:
        verify_hashed_password(password, _DUMMY_HASH)
        return None
    if not verify_hashed_password(password, user.hashed_password):
        return None
    return user
