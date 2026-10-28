from collections.abc import Sequence
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentOrganizer, CurrentUser, DbSession, OwnedEvent
from app.models.event import Event
from app.models.organizer import OrganizerProfile
from app.schemas.event import (
    CancelRequest,
    EventCategoryType,
    EventCreate,
    EventDetail,
    EventPreview,
    EventRead,
    EventUpdate,
)
from app.services import activation as activation_service
from app.services import event as event_service
from app.services import event_image as image_service
from app.services import event_lifecycle as lifecycle

router = APIRouter(tags=["events"])

MAX_PAGE_SIZE = 100


def _conflict(exc: lifecycle.IllegalEventTransition) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, exc.reason)


# --- public ----------------------------------------------------------------


@router.get("/events", response_model=list[EventRead])
def list_events(
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str | None, Query(max_length=100, description="Title or venue contains")] = None,
    category: EventCategoryType | None = None,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
) -> Sequence[Event]:
    """Published, public events that have not ended, soonest first."""
    return event_service.list_public_events(
        db,
        limit=limit,
        offset=offset,
        q=q,
        category=category,
        starts_after=starts_after,
        starts_before=starts_before,
    )


@router.get("/events/{slug}", response_model=EventDetail)
def read_event(slug: str, db: DbSession) -> dict:
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    organizer_name = db.scalar(
        select(OrganizerProfile.display_name).where(
            OrganizerProfile.id == event.organizer_profile_id
        )
    )
    return EventRead.model_validate(event).model_dump() | {
        "organizer_name": organizer_name,
        "images": image_service.list_images(db, event.id),
        "paid_sales_active": activation_service.is_active(db, event.id),
    }


# --- organizer ---------------------------------------------------------------


@router.post("/events", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(data: EventCreate, organizer: CurrentOrganizer, db: DbSession) -> Event:
    try:
        return event_service.create_event(db, organizer, data)
    except event_service.SlugAlreadyTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Slug is already taken") from None


@router.get("/organizer/events", response_model=list[EventRead])
def list_my_events(organizer: CurrentOrganizer, db: DbSession) -> Sequence[Event]:
    return event_service.list_organizer_events(db, organizer)


@router.get("/organizer/events/{event_id}", response_model=EventRead)
def read_my_event(event: OwnedEvent) -> Event:
    return event


@router.patch("/organizer/events/{event_id}", response_model=EventRead)
def update_event(event: OwnedEvent, data: EventUpdate, user: CurrentUser, db: DbSession) -> Event:
    try:
        return event_service.update_event(db, event, data, user)
    except event_service.EventNotEditable as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A {exc.status} event cannot be edited"
        ) from None
    except event_service.InvalidEventWindow as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.reason) from None


@router.get("/organizer/events/{event_id}/preview", response_model=EventPreview)
def preview_event(event: OwnedEvent, db: DbSession) -> dict:
    """The event as attendees will see it, plus what still blocks publishing
    and which actions are allowed next (§4.2 "Preview an event")."""
    requirements = lifecycle.publish_requirements(db, event)
    return {
        "event": event,
        "images": image_service.list_images(db, event.id),
        "publish_requirements": [{"code": r.code, "met": r.met} for r in requirements],
        "allowed_actions": lifecycle.allowed_actions(db, event, requirements),
    }


@router.post("/organizer/events/{event_id}/publish", response_model=EventRead)
def publish_event(event: OwnedEvent, user: CurrentUser, db: DbSession) -> Event:
    try:
        return lifecycle.publish(db, event, user)
    except lifecycle.IllegalEventTransition as exc:
        raise _conflict(exc) from None


@router.post("/organizer/events/{event_id}/unpublish", response_model=EventRead)
def unpublish_event(event: OwnedEvent, user: CurrentUser, db: DbSession) -> Event:
    try:
        return lifecycle.unpublish(db, event, user)
    except lifecycle.IllegalEventTransition as exc:
        raise _conflict(exc) from None


@router.post("/organizer/events/{event_id}/cancel", response_model=EventRead)
def cancel_event(
    event: OwnedEvent, user: CurrentUser, db: DbSession, data: CancelRequest | None = None
) -> Event:
    """Cancel the event. Pending orders are released, free registrations
    cancelled and paid orders refunded in full, all in one transaction."""
    try:
        return lifecycle.cancel(db, event, user, data.reason if data else None)
    except lifecycle.IllegalEventTransition as exc:
        raise _conflict(exc) from None


@router.post(
    "/organizer/events/{event_id}/duplicate",
    response_model=EventRead,
    status_code=status.HTTP_201_CREATED,
)
def duplicate_event(
    event: OwnedEvent, organizer: CurrentOrganizer, user: CurrentUser, db: DbSession
) -> Event:
    """A new draft copying configuration and ticket types, never orders or
    attendees (§4.16, UC12)."""
    return lifecycle.duplicate(db, event, organizer, user)
