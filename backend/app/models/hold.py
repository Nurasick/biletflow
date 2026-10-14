from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Integer, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class Hold(Base):
    """A claim on ticket-type inventory that expires by itself.

    There is no status column. A hold is active while `released_at IS NULL AND
    expires_at > now()`; whether a released hold was converted or abandoned is
    read from its order. See docs/data-model/03-ordering.md#holds.

    `event_seat_id` from the contract is deliberately absent: its target table
    arrives with the seating slice (08), and adding a nullable column then is
    an additive change.
    """

    __tablename__ = "holds"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # NULL until checkout begins and an order exists to own the hold.
    order_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("orders.id"), index=True)
    ticket_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("ticket_types.id"), index=True
    )
    quantity: Mapped[int] = mapped_column(Integer)
    # Indexed: the expiry sweeper scans on it.
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint("quantity > 0", name="quantity_positive"),)
