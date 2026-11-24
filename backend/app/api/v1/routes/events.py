from collections.abc import Sequence
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import (
    CurrentOrganizer,
    CurrentUser,
    DbSession,
    EventAccess,
    OptionalUser,
    OwnedEvent,
    VerifiedUser,
    require_event_access,
)
from app.models.event import Event
from app.models.organizer import OrganizerProfile
from app.schemas.event import (
    CancelRequest,
    EventCategoryType,
    EventCreate,
    EventDetail,
    EventInviteLinkRead,
    EventPhaseType,
    EventPreview,
    EventRead,
    EventUnlockRequest,
    EventUnlockResponse,
    EventUpdate,
)
from app.schemas.seating import (
    EventSeatingConfigureRequest,
    EventSeatMapRead,
    EventSeatStatusUpdate,
    VenueSummaryRead,
)
from app.services import activation as activation_service
from app.services import calendar as calendar_service
from app.services import event as event_service
from app.services import event_image as image_service
from app.services import event_lifecycle as lifecycle
from app.services import platform as platform_service
from app.services import seating as seating_service

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
    q: Annotated[
        str | None, Query(max_length=100, description="Title, venue or city contains")
    ] = None,
    category: EventCategoryType | None = None,
    city: Annotated[str | None, Query(max_length=120)] = None,
    price_type: Literal["free", "paid"] | None = None,
    sort: Literal["soonest", "newest", "title"] = "soonest",
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
        city=city,
        price_type=price_type,
        sort=sort,
        starts_after=starts_after,
        starts_before=starts_before,
    )


@router.get("/events/{slug}", response_model=EventDetail)
def read_event(
    slug: str,
    db: DbSession,
    user: OptionalUser,
    access: EventAccess,
) -> dict:
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    require_event_access(db, event, user, access)
    organizer_name = db.scalar(
        select(OrganizerProfile.display_name).where(
            OrganizerProfile.id == event.organizer_profile_id
        )
    )
    return EventRead.model_validate(event).model_dump() | {
        "organizer_name": organizer_name,
        "images": image_service.list_images(db, event.id),
        "paid_sales_active": activation_service.is_active(db, event.id),
        "processing_fee_bps": platform_service.get_int(db, "processing_fee_bps"),
        "calendar_links": calendar_service.provider_links(event),
    }


@router.post("/events/{slug}/unlock", response_model=EventUnlockResponse)
def unlock_event(slug: str, data: EventUnlockRequest, db: DbSession) -> dict:
    """Exchange a private event's access code or invite token for a reusable access token."""
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    token = event_service.unlock_private_event(
        event, access_code=data.access_code, invite_token=data.invite_token
    )
    if token is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid access code or invite token")
    return {"event_slug": event.slug, "access_token": token}


@router.get("/venues", response_model=list[VenueSummaryRead])
def list_venues(db: DbSession) -> list[dict]:
    """Predefined venue layouts available for assigned-seating events (§4.3.1, §8)."""
    return seating_service.list_venues(db)


@router.get("/events/{slug}/seats", response_model=EventSeatMapRead)
def read_event_seats(slug: str, db: DbSession, user: OptionalUser, access: EventAccess) -> dict:
    """Live seat map for an assigned-seating event (§4.3.1)."""
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    require_event_access(db, event, user, access)
    return seating_service.get_event_seat_map(db, event)


# --- organizer ---------------------------------------------------------------


@router.post("/events", response_model=EventRead, status_code=status.HTTP_201_CREATED)
def create_event(
    data: EventCreate, organizer: CurrentOrganizer, user: CurrentUser, db: DbSession
) -> Event:
    try:
        return event_service.create_event(db, organizer, data, actor=user)
    except event_service.SlugAlreadyTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "Slug is already taken") from None


@router.get("/organizer/events", response_model=list[EventRead])
def list_my_events(
    organizer: CurrentOrganizer,
    db: DbSession,
    phase: EventPhaseType | None = None,
) -> Sequence[Event]:
    return event_service.list_organizer_events(db, organizer, phase=phase)


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
    except event_service.CapacityBelowCommitted as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"capacity cannot be below the {exc.committed} tickets already sold or held",
        ) from None
    except event_service.InvalidEventWindow as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.reason) from None


@router.post("/organizer/events/{event_id}/invite-link", response_model=EventInviteLinkRead)
def create_invite_link(event: OwnedEvent, user: CurrentUser, db: DbSession) -> dict:
    """Generate a signed invite link for accessing a private event (§4.2)."""
    token, url = event_service.create_invite_link(db, event, user)
    return {"invite_token": token, "invite_url": url}


@router.get("/organizer/events/{event_id}/seats", response_model=EventSeatMapRead)
def read_organizer_event_seats(event: OwnedEvent, db: DbSession) -> dict:
    """Organizer view of the event's configured seat map (works on drafts too)."""
    return seating_service.get_event_seat_map(db, event)


@router.put("/organizer/events/{event_id}/seating", response_model=EventSeatMapRead)
def configure_event_seating(
    event: OwnedEvent,
    data: EventSeatingConfigureRequest,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    """Pick a predefined venue layout and map seat price categories to TicketTypes."""
    try:
        return seating_service.configure_event_seating(
            db,
            event,
            venue_id=data.venue_id,
            category_ticket_type_map=data.category_ticket_type_map,
            unavailable_seat_ids=data.unavailable_seat_ids,
            actor=user,
        )
    except seating_service.VenueNotFound:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Venue not found") from None
    except seating_service.SeatingError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None


@router.patch("/organizer/events/{event_id}/seats/{event_seat_id}", response_model=EventSeatMapRead)
def update_event_seat(
    event: OwnedEvent,
    event_seat_id: int,
    data: EventSeatStatusUpdate,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    """Toggle an individual seat between `available` and `unavailable`."""
    from app.models.seat import EventSeatStatus

    try:
        return seating_service.update_event_seat(
            db,
            event,
            event_seat_id,
            status=EventSeatStatus(data.status),
            ticket_type_id=data.ticket_type_id,
            actor=user,
        )
    except seating_service.EventSeatNotFound:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event seat not found") from None
    except seating_service.SeatingError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None


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
def publish_event(event: OwnedEvent, user: VerifiedUser, db: DbSession) -> Event:
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
