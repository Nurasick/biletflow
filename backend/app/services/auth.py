from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.core.security import create_access_token, create_refresh_token, decode_token
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
    return db.get(User, user_id)


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
    return create_access_token(user.id), create_refresh_token(user.id, csrf=csrf)
