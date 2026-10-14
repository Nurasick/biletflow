from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class TicketStatus(StrEnum):
    # Exactly the four §4.7 names. Don't invent a fifth.
    VALID = "valid"
    CHECKED_IN = "checked_in"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"


class Ticket(Base):
    """Issued only when its order is confirmed (§4.6), never before.

    Rows here are not inventory. Availability lives in the counters on
    ticket_types; a ticket exists only once someone has paid for it.
    """

    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Printed on paper tickets, e.g. BF-3K9P-22XM. Tamper resistance comes
    # from the HMAC over qr_nonce (docs/data-model/qr-codes.md), not from this
    # being unguessable.
    public_code: Mapped[str] = mapped_column(String(32), unique=True)
    # Reachable through orders, but duplicated on purpose: every door scan
    # asks "is this ticket for the admin's event?" and that must be one
    # indexed lookup, not a join. Safe because a ticket never changes event.
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"))
    order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("orders.id"), index=True)
    order_item_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("order_items.id"), index=True)
    ticket_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("ticket_types.id"))
    # One attendee, one ticket.
    attendee_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("attendees.id"), unique=True)

    status: Mapped[TicketStatus] = mapped_column(
        string_enum(TicketStatus, 20), server_default=TicketStatus.VALID.value
    )
    qr_nonce: Mapped[str] = mapped_column(String(64))

    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(f"status IN ({check_list(TicketStatus)})", name="status"),
        # The check-in screen and every §4.15 attendance count filter on this pair.
        Index("ix_tickets_event_id_status", "event_id", "status"),
    )
