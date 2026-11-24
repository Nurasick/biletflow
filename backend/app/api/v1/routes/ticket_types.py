from collections.abc import Sequence

from fastapi import APIRouter, HTTPException, status

from app.api.deps import (
    CurrentOrganizer,
    CurrentUser,
    DbSession,
    EventAccess,
    OptionalUser,
    require_event_access,
)
from app.models.event import Event
from app.models.organizer import OrganizerProfile
from app.models.ticket_type import TicketType
from app.schemas.ticket_type import (
    TicketTypeCreate,
    TicketTypePublic,
    TicketTypeRead,
    TicketTypeUpdate,
)
from app.services import event as event_service
from app.services import ticket_type as ticket_type_service

router = APIRouter(tags=["ticket-types"])

EVENT_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
EVENT_CANCELLED = HTTPException(
    status.HTTP_409_CONFLICT, "Ticket types of a cancelled event cannot change"
)


def _owned_event(db: DbSession, organizer: OrganizerProfile, event_id: int) -> Event:
    # Someone else's event answers 404, not 403, as in routes/events.py.
    event = event_service.get_owned_event(db, organizer, event_id)
    if event is None:
        raise EVENT_NOT_FOUND
    return event


@router.get("/events/{slug}/ticket-types", response_model=list[TicketTypePublic])
def list_public_ticket_types(
    slug: str, db: DbSession, user: OptionalUser, access: EventAccess
) -> Sequence[TicketType]:
    # get_event_by_slug already hides drafts, and with them their ticket types.
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise EVENT_NOT_FOUND
    require_event_access(db, event, user, access)
    return ticket_type_service.list_public(db, event)


@router.post(
    "/organizer/events/{event_id}/ticket-types",
    response_model=TicketTypeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_ticket_type(
    event_id: int,
    data: TicketTypeCreate,
    organizer: CurrentOrganizer,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    event = _owned_event(db, organizer, event_id)
    try:
        tt = ticket_type_service.create_ticket_type(db, event, data, actor=user)
    except ticket_type_service.EventClosedForChanges as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Ticket types of a {exc.status.value} event cannot change",
        ) from None
    return ticket_type_service.serialize_for_organizer(db, tt)


@router.get("/organizer/events/{event_id}/ticket-types", response_model=list[TicketTypeRead])
def list_my_ticket_types(event_id: int, organizer: CurrentOrganizer, db: DbSession) -> list[dict]:
    event = _owned_event(db, organizer, event_id)
    types = ticket_type_service.list_for_organizer(db, event)
    metrics = ticket_type_service.ticket_metrics_by_type(db, event.id)
    return [ticket_type_service.serialize_for_organizer(db, t, metrics) for t in types]


@router.patch(
    "/organizer/events/{event_id}/ticket-types/{ticket_type_id}",
    response_model=TicketTypeRead,
)
def update_ticket_type(
    event_id: int,
    ticket_type_id: int,
    data: TicketTypeUpdate,
    organizer: CurrentOrganizer,
    user: CurrentUser,
    db: DbSession,
) -> dict:
    event = _owned_event(db, organizer, event_id)
    ticket_type = ticket_type_service.get_event_ticket_type(db, event, ticket_type_id)
    if ticket_type is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket type not found")
    try:
        updated = ticket_type_service.update_ticket_type(db, event, ticket_type, data, user)
    except ticket_type_service.EventClosedForChanges as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Ticket types of a {exc.status.value} event cannot change",
        ) from None
    except ticket_type_service.QuantityBelowCommitted as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"quantity_total cannot be below the {exc.committed} tickets already sold or held",
        ) from None
    except ticket_type_service.InvalidSalesWindow:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "sales_end_at must be after sales_start_at"
        ) from None
    except ticket_type_service.ConcurrentInventoryChange:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Tickets were sold while saving; reload and try again"
        ) from None
    return ticket_type_service.serialize_for_organizer(db, updated)
