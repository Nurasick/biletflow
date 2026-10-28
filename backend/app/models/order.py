from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CHAR,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class OrderStatus(StrEnum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"
    EXPIRED = "expired"


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Human-quotable (§4.13), e.g. BF-241130-0042. Never used in a FK.
    order_number: Mapped[str] = mapped_column(String(32), unique=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"))
    # NULL for guest checkout. Every "my orders" lookup therefore has two
    # paths, owner and signed link, and both need authorization tests.
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"), index=True)

    contact_email: Mapped[str] = mapped_column(String(320))
    contact_name: Mapped[str] = mapped_column(String(200))
    contact_phone: Mapped[str | None] = mapped_column(String(32))

    status: Mapped[OrderStatus] = mapped_column(
        string_enum(OrderStatus, 20), server_default=OrderStatus.PENDING.value
    )

    # Server-computed, never accepted from the client. No CHECK ties total to
    # the other three yet: whether the fee is added to the attendee's total or
    # deducted from the organizer's payout is open question #3.
    subtotal_minor: Mapped[int] = mapped_column(BigInteger)
    discount_minor: Mapped[int] = mapped_column(BigInteger, server_default="0")
    fee_minor: Mapped[int] = mapped_column(BigInteger, server_default="0")
    total_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="KZT")

    # `campaign_id` (§4.14) is added with the campaigns slice (05).

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(f"status IN ({check_list(OrderStatus)})", name="status"),
        CheckConstraint(
            "subtotal_minor >= 0 AND discount_minor >= 0 AND fee_minor >= 0 AND total_minor >= 0",
            name="amounts_non_negative",
        ),
        CheckConstraint("discount_minor <= subtotal_minor", name="discount_within_subtotal"),
        # The organizer's attendee list and the §4.15 sales-over-time chart.
        Index("ix_orders_event_id_status_created_at", "event_id", "status", "created_at"),
    )


class OrderItem(Base):
    """One line per ticket type purchased."""

    __tablename__ = "order_items"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("orders.id"), index=True)
    ticket_type_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("ticket_types.id"))
    quantity: Mapped[int] = mapped_column(Integer)
    # A snapshot of ticket_types.price_minor at checkout, not a cache of it.
    # If receipts joined back to ticket_types, an organizer's price edit would
    # silently rewrite every past order.
    unit_price_minor: Mapped[int] = mapped_column(BigInteger)
    discount_minor: Mapped[int] = mapped_column(BigInteger, server_default="0")
    subtotal_minor: Mapped[int] = mapped_column(BigInteger)

    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint(
            "unit_price_minor >= 0 AND discount_minor >= 0 AND subtotal_minor >= 0",
            name="amounts_non_negative",
        ),
    )
