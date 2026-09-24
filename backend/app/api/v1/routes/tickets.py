from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession
from app.models.organizer import OrganizerProfile
from app.models.ticket import Ticket
from app.schemas.ticket import TicketCreate, TicketRead, TicketUpdate
from app.services import event as event_service
from app.services import ticket as ticket_service

router = APIRouter(tags=["tickets"])

MAX_PAGE_SIZE = 100


def get_current_organizer(user: CurrentUser, db: DbSession) -> OrganizerProfile:
    profile = event_service.get_organizer_profile(db, user)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "An organizer profile is required")
    return profile


CurrentOrganizer = Annotated[OrganizerProfile, Depends(get_current_organizer)]


@router.get("/events/{event_id}/tickets", response_model=list[TicketRead])
def list_event_tickets(
    event_id: int,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=MAX_PAGE_SIZE)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Sequence[Ticket]:
    return ticket_service.list_available_tickets(db, event_id=event_id, limit=limit, offset=offset)


@router.get("/tickets/{ticket_code}", response_model=TicketRead)
def read_ticket(ticket_code: str, db: DbSession) -> Ticket:
    ticket = ticket_service.get_ticket_by_code(db, ticket_code)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    return ticket


@router.post(
    "/organizer/events/{event_id}/tickets",
    response_model=TicketRead,
    status_code=status.HTTP_201_CREATED,
)
def create_ticket(
    event_id: int,
    data: TicketCreate,
    organizer: CurrentOrganizer,
    db: DbSession,
) -> Ticket:
    event = event_service.get_owned_event(db, organizer, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    try:
        return ticket_service.create_ticket(db, event, data)
    except ticket_service.TicketCodeAlreadyExists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Ticket code is already in use") from None


@router.patch("/organizer/tickets/{ticket_id}", response_model=TicketRead)
def update_ticket(
    ticket_id: int,
    data: TicketUpdate,
    organizer: CurrentOrganizer,
    db: DbSession,
) -> Ticket:
    ticket = ticket_service.get_owned_ticket(db, organizer, ticket_id)
    if ticket is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found")
    try:
        return ticket_service.update_ticket(db, ticket, data)
    except ticket_service.TicketNotEditable:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "A sold or cancelled ticket cannot be edited"
        ) from None
