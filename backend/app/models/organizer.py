from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    String,
    Text,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class VerificationStatus(StrEnum):
    UNVERIFIED = "unverified"
    PENDING = "pending"
    VERIFIED = "verified"
    REJECTED = "rejected"


_VERIFICATION_STATUS = ", ".join(f"'{v.value}'" for v in VerificationStatus)


class OrganizerProfile(Base):
    __tablename__ = "organizer_profiles"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="CASCADE"), unique=True
    )

    display_name: Mapped[str] = mapped_column(String(200))
    contact_email: Mapped[str] = mapped_column(String(320))
    contact_phone: Mapped[str | None] = mapped_column(String(32))
    description: Mapped[str | None] = mapped_column(Text)
    verification_status: Mapped[VerificationStatus] = mapped_column(
        String(20), server_default=VerificationStatus.UNVERIFIED
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            f"verification_status IN ({_VERIFICATION_STATUS})", name="verification_status"
        ),
    )


class AccountStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    REJECTED = "rejected"


_ACCOUNT_STATUSES = ", ".join(f"'{s.value}'" for s in AccountStatus)


class PayoutAccount(Base):
    __tablename__ = "payout_accounts"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    organizer_profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizer_profiles.id"), index=True
    )
    provider: Mapped[str] = mapped_column(String)
    external_account_ref: Mapped[str] = mapped_column(String)

    status: Mapped[AccountStatus] = mapped_column(String(20), server_default=AccountStatus.PENDING)
    is_simulated: Mapped[bool] = mapped_column(Boolean, server_default=true())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (CheckConstraint(f"status IN ({_ACCOUNT_STATUSES})", name="status"),)
