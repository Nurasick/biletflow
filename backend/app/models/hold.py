from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class Hold(Base):
    """A claim on ticket-type inventory (and optionally a specific EventSeat) that expires.

    There is no status column. A hold is active while `released_at IS NULL AND
    expires_at > now()`; whether a released hold was converted or abandoned is
    read from its order. See docs/data-model/03-ordering.md#holds.
    """

    __tablename__ = "holds"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # NULL until checkout begins and an order exists to own the hold.
    order_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("orders.id"), index=True)
    ticket_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ticket_types.id"), index=True
    )
    event_seat_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("event_seats.id"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer)
    # Indexed: the expiry sweeper scans on it.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("event_seat_id IS NULL OR quantity = 1", name="seat_quantity_one"),
        Index(
            "uq_holds_active_event_seat",
            "event_seat_id",
            unique=True,
            postgresql_where=text("event_seat_id IS NOT NULL AND released_at IS NULL"),
            sqlite_where=text("event_seat_id IS NOT NULL AND released_at IS NULL"),
        ),
    )
