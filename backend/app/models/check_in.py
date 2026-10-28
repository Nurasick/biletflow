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


class CheckInAction(StrEnum):
    CHECK_IN = "check_in"
    REVERSE = "reverse"


class CheckInRecord(Base):
    """How a ticket got to its current status. Append-only (§4.8, §4.16).

    tickets.status is the truth about now; this table is the history. A
    reversal is a second row with action='reverse', never a deletion, so who
    undid it and when survives. Rejected scans are not written here: they
    would turn every attendance count into a filtered query
    (docs/data-model/04-checkin.md#should-rejected-scans-be-recorded).
    """

    __tablename__ = "check_in_records"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    ticket_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("tickets.id"), index=True)
    # Reachable through the ticket, duplicated for the same reason as
    # tickets.event_id: live counts and the timeline are one indexed lookup.
    event_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("events.id"))
    action: Mapped[CheckInAction] = mapped_column(string_enum(CheckInAction, 20))
    performed_by_user_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("users.id"))
    device_info: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(f"action IN ({check_list(CheckInAction)})", name="action"),
        Index("ix_check_in_records_event_id_created_at", "event_id", "created_at"),
    )
