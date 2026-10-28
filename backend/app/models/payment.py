from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CHAR,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class PaymentPurpose(StrEnum):
    TICKET_ORDER = "ticket_order"
    ACTIVATION_FEE = "activation_fee"


class PaymentStatus(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    REFUNDED = "refunded"


class RefundStatus(StrEnum):
    PENDING = "pending"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class Payment(Base):
    """A charge for a ticket order or an event activation fee.

    Free orders have no row here at all: a fake zero payment would pollute the
    §4.15 revenue figures. No card details are ever stored (§7), only the
    provider's own reference.
    """

    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    purpose: Mapped[PaymentPurpose] = mapped_column(string_enum(PaymentPurpose, 20))
    order_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("orders.id"), index=True)
    event_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("events.id"), index=True)

    provider: Mapped[str] = mapped_column(String(64))
    provider_ref: Mapped[str | None] = mapped_column(String(255))
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="KZT")
    status: Mapped[PaymentStatus] = mapped_column(
        string_enum(PaymentStatus, 20), server_default=PaymentStatus.PENDING.value
    )
    # §4.6: demonstration payments must never be presented as real. No server
    # default, so every code path that creates a payment has to say which it is.
    is_simulated: Mapped[bool] = mapped_column(Boolean)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    # UNIQUE so a double-submitted checkout or a webhook delivered twice fails
    # at the database instead of charging or issuing tickets twice.
    idempotency_key: Mapped[str | None] = mapped_column(String(64), unique=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(f"purpose IN ({check_list(PaymentPurpose)})", name="purpose"),
        CheckConstraint(f"status IN ({check_list(PaymentStatus)})", name="status"),
        CheckConstraint("amount_minor > 0", name="amount_positive"),
        # Exactly one of order_id / event_id, and the one `purpose` says.
        CheckConstraint(
            "(purpose = 'ticket_order' AND order_id IS NOT NULL AND event_id IS NULL)"
            " OR (purpose = 'activation_fee' AND event_id IS NOT NULL AND order_id IS NULL)",
            name="purpose_target",
        ),
    )


class Refund(Base):
    """Its own row, not a payment status, because §4.9 allows partial refunds:
    several refunds can reference one payment."""

    __tablename__ = "refunds"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    payment_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("payments.id"), index=True)
    order_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("orders.id"), index=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="KZT")
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[RefundStatus] = mapped_column(
        string_enum(RefundStatus, 20), server_default=RefundStatus.PENDING.value
    )
    initiated_by_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    provider_ref: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(f"status IN ({check_list(RefundStatus)})", name="status"),
        CheckConstraint("amount_minor > 0", name="amount_positive"),
    )
