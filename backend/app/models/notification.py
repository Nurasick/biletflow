from datetime import datetime
from enum import StrEnum

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Identity, Index, String
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.audit import PAYLOAD
from app.models.enum_column import check_list, string_enum


class Channel(StrEnum):
    EMAIL = "email"
    IN_APP = "in_app"


class DeliveryStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class Notification(Base):
    """The outbox for §4.10's triggers (docs/data-model/07-platform.md).

    A row is written in the same transaction as the thing it announces, and a
    background loop sends it. So checkout never waits on SMTP (§7), and a
    failed send is a retryable row rather than a lost message.

    Only the template key and its variables are stored, not rendered text:
    the email renderer and the web client each turn them into words.
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # NULL for guests, who still get email.
    user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    email: Mapped[str] = mapped_column(String(320))
    channel: Mapped[Channel] = mapped_column(string_enum(Channel, 20))
    template_key: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(PAYLOAD)
    status: Mapped[DeliveryStatus] = mapped_column(
        string_enum(DeliveryStatus, 20), server_default=DeliveryStatus.PENDING.value
    )
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # In-app only: when the user opened their feed and saw it.
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=sa_func.now()
    )

    __table_args__ = (
        CheckConstraint(f"channel IN ({check_list(Channel)})", name="channel"),
        CheckConstraint(f"status IN ({check_list(DeliveryStatus)})", name="status"),
        # The sender picks up pending rows; the feed reads one user's rows.
        Index("ix_notifications_status_created_at", "status", "created_at"),
        Index("ix_notifications_user_id_channel_created_at", "user_id", "channel", "created_at"),
    )
