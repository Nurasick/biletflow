from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.ticket_type import TicketType
from app.schemas.ticket_type import TicketTypeCreate, TicketTypeUpdate


class EventClosedForChanges(Exception):
    """The event is cancelled, so its ticket types are frozen."""


class QuantityBelowCommitted(Exception):
    """quantity_total would drop below the tickets already sold or held."""

    def __init__(self, committed: int):
        super().__init__(committed)
        self.committed = committed


class InvalidSalesWindow(Exception):
    """sales_end_at would not be after sales_start_at."""


class ConcurrentInventoryChange(Exception):
    """A sale landed between our check and our commit; the client should retry."""


def create_ticket_type(db: Session, event: Event, data: TicketTypeCreate) -> TicketType:
    _ensure_open(event)
    ticket_type = TicketType(**data.model_dump(), event_id=event.id)
    db.add(ticket_type)
    db.commit()
    db.refresh(ticket_type)
    return ticket_type


def update_ticket_type(
    db: Session, event: Event, ticket_type: TicketType, data: TicketTypeUpdate
) -> TicketType:
    _ensure_open(event)
    changes = data.model_dump(exclude_unset=True)

    # The schema only sees the fields in the request. Whatever it did not see
    # comes from the stored row, so both checks run on the merged result.
    committed = ticket_type.quantity_sold + ticket_type.quantity_reserved
    if changes.get("quantity_total", ticket_type.quantity_total) < committed:
        raise QuantityBelowCommitted(committed)
    starts = changes.get("sales_start_at", ticket_type.sales_start_at)
    ends = changes.get("sales_end_at", ticket_type.sales_end_at)
    if starts is not None and ends is not None and _as_utc(ends) <= _as_utc(starts):
        raise InvalidSalesWindow

    for field, value in changes.items():
        setattr(ticket_type, field, value)
    try:
        db.commit()
    except IntegrityError:
        # The checks above read counters that a checkout may have moved since.
        # The CHECK constraints on the table are the authority either way.
        db.rollback()
        raise ConcurrentInventoryChange from None
    db.refresh(ticket_type)
    return ticket_type


def get_event_ticket_type(db: Session, event: Event, ticket_type_id: int) -> TicketType | None:
    # Scoped by event as well as id: without it, an organizer could edit
    # another event's ticket type through a URL for their own event.
    return db.scalar(
        select(TicketType).where(TicketType.id == ticket_type_id, TicketType.event_id == event.id)
    )


def list_for_organizer(db: Session, event: Event) -> Sequence[TicketType]:
    return db.scalars(
        select(TicketType)
        .where(TicketType.event_id == event.id)
        .order_by(TicketType.position, TicketType.id)
    ).all()


def list_public(db: Session, event: Event) -> Sequence[TicketType]:
    return db.scalars(
        select(TicketType)
        .where(TicketType.event_id == event.id, TicketType.is_hidden.is_(False))
        .order_by(TicketType.position, TicketType.id)
    ).all()


def _ensure_open(event: Event) -> None:
    if event.status == EventStatus.CANCELLED:
        raise EventClosedForChanges


def _as_utc(value: datetime) -> datetime:
    # Postgres hands back aware datetimes. SQLite, which backs the tests,
    # drops the offset, and every value the tests store is UTC.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
