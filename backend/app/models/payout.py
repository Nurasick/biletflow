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
    Index,
    String,
    Text,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class PayoutStatus(StrEnum):
    PENDING = "pending"
    PROCESSING = "processing"
    PAID = "paid"
    FAILED = "failed"


class Payout(Base):
    """Simulated organizer payout settlement record (§4.10, §4.12)."""

    __tablename__ = "payouts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    organizer_profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizer_profiles.id"), index=True
    )
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), index=True)
    payout_account_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("payout_accounts.id")
    )
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(CHAR(3), default="KZT", server_default="KZT")
    status: Mapped[PayoutStatus] = mapped_column(
        string_enum(PayoutStatus, 20),
        default=PayoutStatus.PENDING,
        server_default=PayoutStatus.PENDING.value,
    )
    is_simulated: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    reference: Mapped[str | None] = mapped_column(String(128))
    failure_reason: Mapped[str | None] = mapped_column(Text)
    initiated_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(f"status IN ({check_list(PayoutStatus)})", name="status"),
        CheckConstraint("amount_minor > 0", name="amount_positive"),
        Index("ix_payouts_event_id_status", "event_id", "status"),
    )
