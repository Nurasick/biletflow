from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.organizer import OrganizerProfile
from app.models.ticket import Ticket, TicketStatus
from app.schemas.ticket import TicketCreate, TicketUpdate


class TicketCodeAlreadyExists(Exception):
    """Another ticket already uses this ticket_code."""


class TicketNotEditable(Exception):
    """The ticket is sold or cancelled and can no longer be edited."""


def create_ticket(db: Session, event: Event, data: TicketCreate) -> Ticket:
    ticket = Ticket(**data.model_dump(), status=TicketStatus.AVAILABLE)
    db.add(ticket)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise TicketCodeAlreadyExists from None
    db.refresh(ticket)
    return ticket


def update_ticket(db: Session, ticket: Ticket, data: TicketUpdate) -> Ticket:
    if ticket.status in (TicketStatus.SOLD, TicketStatus.CANCELLED):
        raise TicketNotEditable
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ticket, field, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise
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
