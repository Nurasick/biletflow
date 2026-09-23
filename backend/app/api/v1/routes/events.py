from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.event import Event
from app.models.organizer import OrganizerProfile
from app.schemas.event import EventCreate, EventRead, EventUpdate
from app.services import event as event_service

router = APIRouter(tags=["events"])

MAX_PAGE_SIZE = 100


def get_current_organizer(user: CurrentUser, db: DbSession) -> OrganizerProfile:
    profile = event_service.get_organizer_profile(db, user)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "An organizer profile is required")
    return profile


CurrentOrganizer = Annotated[OrganizerProfile, Depends(get_current_organizer)]


@router.get("/events", response_model=list[EventRead])
def list_events(
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Sequence[Event]:
    return event_service.list_public_events(db, limit=limit, offset=offset)


@router.get("/events/{slug}", response_model=EventRead)
def read_event(slug: str, db: DbSession) -> Event:
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    return event


@router.post("/events", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(data: EventCreate, organizer: CurrentOrganizer, db: DbSession) -> Event:
    try:
        return event_service.create_event(db, organizer, data)
    except event_service.SlugAlreadyTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Slug is already taken") from None


@router.get("/organizer/events", response_model=list[EventRead])
def list_my_events(organizer: CurrentOrganizer, db: DbSession) -> Sequence[Event]:
    return event_service.list_organizer_events(db, organizer)


@router.patch("/organizer/events/{event_id}", response_model=EventRead)
def update_event(
    event_id: int, data: EventUpdate, organizer: CurrentOrganizer, db: DbSession
) -> Event:
    # Someone else's event answers 404, not 403, so ids cannot be probed.
    event = event_service.get_owned_event(db, organizer, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    try:
        return event_service.update_event(db, event, data)
    except event_service.EventNotEditable:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A cancelled event cannot be edited"
        ) from None
    except event_service.InvalidEventWindow:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "ends_at must be after starts_at, and registration must close after it opens",
        ) from None
