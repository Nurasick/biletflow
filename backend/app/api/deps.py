from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.event import Event
from app.models.organizer import OrganizerProfile
from app.models.user import User, UserStatus
from app.services import check_in as check_in_service
from app.services import event as event_service
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

optional_bearer_scheme = HTTPBearer(bearerFormat="JWT", auto_error=False)


def get_optional_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(optional_bearer_scheme)],
    db: DbSession,
) -> User | None:
    """The signed-in user, or None for a guest. Guests may buy (03-ordering.md).

    A token that is present but invalid is still a 401, not a silent guest:
    otherwise an expired session would quietly create an ownerless order the
    user then cannot find under "my orders".
    """
    if credentials is None:
        return None
    user = get_current_user(credentials, db)
    return get_current_active_user(user)


OptionalUser = Annotated[User | None, Depends(get_optional_user)]


def get_current_organizer(user: CurrentUser, db: DbSession) -> OrganizerProfile:
    profile = get_organizer_profile(db, user)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "An organizer profile is required")
    return profile


CurrentOrganizer = Annotated[OrganizerProfile, Depends(get_current_organizer)]

EVENT_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")


def get_owned_event(event_id: int, organizer: CurrentOrganizer, db: DbSession) -> Event:
    """The event in the path, if the caller organizes it.

    Someone else's event answers 404, not 403, so event ids cannot be probed.
    One dependency for every /organizer/events/{event_id}/... route, so no
    route can forget the ownership check.
    """
    event = event_service.get_owned_event(db, organizer, event_id)
    if event is None:
        raise EVENT_NOT_FOUND
    return event


OwnedEvent = Annotated[Event, Depends(get_owned_event)]


def get_current_admin(user: CurrentUser) -> User:
    """A Platform Admin (§1.3). The one role that is a flag on users, because it
    is the one role not scoped to an event (data-model README, roles)."""
    if not user.is_platform_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Platform admins only")
    return user


CurrentAdmin = Annotated[User, Depends(get_current_admin)]


def get_staff_event(event_id: int, user: CurrentUser, db: DbSession) -> Event:
    """The event in the path, if the caller may check people in at it (§4.8).

    404 for an event that does not exist, 403 for one that does but is not
    assigned: an event admin already knows which events exist, since their
    app lists them, and a clear "not assigned" saves a confused call.
    """
    event = db.get(Event, event_id)
    if event is None:
        raise EVENT_NOT_FOUND
    owner_id = db.scalar(
        select(OrganizerProfile.user_id).where(OrganizerProfile.id == event.organizer_profile_id)
    )
    if not check_in_service.can_staff(db, event, user, owner_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You are not assigned to this event")
    return event


StaffEvent = Annotated[Event, Depends(get_staff_event)]
