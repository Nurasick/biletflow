"""Per-event sellable seat inventory (§4.3.1, §8 Bonus).

A seat's availability and ticket-type pricing belong to the event, not the
physical chair. The UNIQUE(event_id, seat_id) constraint plus partial unique
indexes on active holds and live tickets make double-holding or double-selling
a seat impossible at the database layer.
"""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class EventSeatStatus(StrEnum):
    AVAILABLE = "available"
    HELD = "held"
    SOLD = "sold"
    UNAVAILABLE = "unavailable"


class EventSeat(Base):
    __tablename__ = "event_seats"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("events.id", ondelete="CASCADE"), index=True
    )
    seat_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("seats.id"), index=True)
    # NULL only when status = 'unavailable' (blocked/obstructed seats).
    ticket_type_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("ticket_types.id"), index=True
    )
    status: Mapped[EventSeatStatus] = mapped_column(
        string_enum(EventSeatStatus, 20),
        default=EventSeatStatus.AVAILABLE,
        server_default=EventSeatStatus.AVAILABLE.value,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        UniqueConstraint("event_id", "seat_id", name="uq_event_seats_event_id_seat_id"),
        CheckConstraint(f"status IN ({check_list(EventSeatStatus)})", name="status"),
        CheckConstraint(
            "status = 'unavailable' OR ticket_type_id IS NOT NULL",
            name="sellable_has_type",
        ),
        Index("ix_event_seats_event_id_status", "event_id", "status"),
    )
