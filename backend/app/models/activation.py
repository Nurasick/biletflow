from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    CHAR,
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class ActivationStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    SUSPENDED = "suspended"


class EventActivation(Base):
    """Whether one event may take money (§3.2, §4.5). At most one row per event.

    Per event, not per organizer: "Activation shall apply only to the selected
    event." A separate table rather than nine mostly-NULL columns on events,
    because free events (the default, §3.1) would never fill them.
    See docs/data-model/02-events.md#event_activations.
    """

    __tablename__ = "event_activations"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), unique=True)
    status: Mapped[ActivationStatus] = mapped_column(
        string_enum(ActivationStatus, 20), server_default=ActivationStatus.PENDING.value
    )
    # Copied from settings when the row is created, so changing the platform
    # fee later does not rewrite what this organizer was quoted.
    activation_fee_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(CHAR(3), server_default="KZT")
    # The succeeded fee payment. Set only once it has succeeded.
    payment_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("payments.id"))
    terms_accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    suspended_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    suspension_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(f"status IN ({check_list(ActivationStatus)})", name="status"),
        CheckConstraint("activation_fee_minor >= 0", name="fee_non_negative"),
    )
