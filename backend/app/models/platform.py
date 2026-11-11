from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, String, Text
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class PlatformSetting(Base):
    """A value a Platform Admin can change without a deploy (§4.12 "Configure
    activation fees and platform settings"). One row per key.

    Integers only, because every setting so far is an amount or a percentage.
    The environment still supplies the default; a row here overrides it.
    """

    __tablename__ = "platform_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[int] = mapped_column(BigInteger)
    updated_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sa_func.now(), onupdate=sa_func.now()
    )


class ReportStatus(StrEnum):
    OPEN = "open"
    DISMISSED = "dismissed"
    ACTIONED = "actioned"


class EventReport(Base):
    """Someone flagging an event for a Platform Admin to look at (§4.12
    "Review reported events")."""

    __tablename__ = "event_reports"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"), index=True)
    # NULL when a guest reports; reporting must not require an account.
    reporter_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(32))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ReportStatus] = mapped_column(
        string_enum(ReportStatus, 20), server_default=ReportStatus.OPEN.value
    )
    resolved_by_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sa_func.now()
    )

    __table_args__ = (
        CheckConstraint(f"status IN ({check_list(ReportStatus)})", name="status"),
        CheckConstraint(
            "reason IN ('fraud','misleading','illegal','duplicate','other')", name="reason"
        ),
    )
