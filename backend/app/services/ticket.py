from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.organizer import OrganizerProfile
from app.models.ticket import Ticket, TicketStatus
from app.schemas.ticket import TicketCreate, TicketUpdate


class TicketCodeAlreadyExists(Exception):
    """Another ticket already uses this ticket_code."""


class TicketNotEditable(Exception):
    """The ticket is reserved, sold or cancelled and can no longer be edited."""


def create_ticket(db: Session, event: Event, data: TicketCreate) -> Ticket:
    # event_id comes from the owned event, never from the request body.
    ticket = Ticket(**data.model_dump(), event_id=event.id, status=TicketStatus.AVAILABLE)
    db.add(ticket)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise TicketCodeAlreadyExists from None
    db.refresh(ticket)
    return ticket


def update_ticket(db: Session, ticket: Ticket, data: TicketUpdate) -> Ticket:
    # A reserved ticket is already priced into a pending order, so changing it
    # would make the order total wrong.
    if ticket.status != TicketStatus.AVAILABLE:
        raise TicketNotEditable
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ticket, field, value)
    db.commit()
    db.refresh(ticket)
    return ticket


def get_ticket_by_code(db: Session, ticket_code: str) -> Ticket | None:
    return db.scalar(select(Ticket).where(Ticket.ticket_code == ticket_code))


def get_owned_ticket(db: Session, organizer: OrganizerProfile, ticket_id: int) -> Ticket | None:
    return db.scalar(
        select(Ticket)
        .join(Event, Ticket.event_id == Event.id)
        .where(Ticket.id == ticket_id, Event.organizer_profile_id == organizer.id)
    )


def get_visible_event(db: Session, event_id: int) -> Event | None:
    """An event whose tickets attendees may see: anything but a draft."""
    return db.scalar(select(Event).where(Event.id == event_id, Event.status != EventStatus.DRAFT))


def list_available_tickets(
    db: Session, *, event_id: int, limit: int, offset: int
) -> Sequence[Ticket]:
    return db.scalars(
        select(Ticket)
        .where(Ticket.event_id == event_id, Ticket.status == TicketStatus.AVAILABLE)
        .order_by(Ticket.id)
        .limit(limit)
        .offset(offset)
    ).all()
