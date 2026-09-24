from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.organizer import OrganizerProfile
from app.models.user import User, UserStatus
from app.services.auth import resolve_token_user
from app.services.event import get_organizer_profile

# HTTPBearer, not OAuth2PasswordBearer. Both read the same `Authorization:
# Bearer <jwt>` header, so clients are unaffected either way. The difference is
# what they tell /docs: the OAuth2 password flow advertises a tokenUrl and asks
# Swagger to fetch a token by POSTing a form to /auth/login, which accepts JSON
# and answers that form with a 422. Its Authorize dialog offers no field for an
# existing token, so it could never authorise a request. HTTPBearer's dialog
# takes the token itself.
bearer_scheme = HTTPBearer(bearerFormat="JWT")

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def bearer_mode(x_auth_mode: Annotated[str | None, Header()] = None) -> bool:
    """True when the caller wants tokens in the response body instead of cookies.

    The default is cookies, so a browser client that forgets to say anything
    fails safe. The Expo client, which has no cookie jar worth depending on,
    opts out explicitly with `X-Auth-Mode: bearer`.
    """
    return (x_auth_mode or "").lower() == "bearer"


BearerMode = Annotated[bool, Depends(bearer_mode)]
DbSession = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[HTTPAuthorizationCredentials, Depends(bearer_scheme)]


def get_current_user(credentials: TokenDep, db: DbSession) -> User:
    user = resolve_token_user(db, credentials.credentials, "access")
    if user is None:
        raise CREDENTIALS_EXCEPTION
    return user


def get_current_active_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_active_user)]


def get_current_organizer(user: CurrentUser, db: DbSession) -> OrganizerProfile:
    profile = get_organizer_profile(db, user)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "An organizer profile is required")
    return profile


CurrentOrganizer = Annotated[OrganizerProfile, Depends(get_current_organizer)]
