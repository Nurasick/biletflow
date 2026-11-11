from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    Text,
    false,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enum_column import check_list, string_enum


class CaseAudience(StrEnum):
    # An attendee writes to the event's organizer; an organizer writes to the
    # platform. The two never mix (06-support.md, "Two kinds of conversation").
    ATTENDEE = "attendee"
    ORGANIZER = "organizer"


class CaseCategory(StrEnum):
    # §4.13 verbatim. A UI dropdown as much as a constraint: no ninth value
    # without changing the spec.
    TICKET_DELIVERY = "ticket_delivery"
    PAYMENT = "payment"
    REFUND = "refund"
    SEATING = "seating"
    EVENT_INFO = "event_info"
    CHECK_IN = "check_in"
    ACCOUNT = "account"
    TECHNICAL = "technical"


class CaseStatus(StrEnum):
    # §4.13 verbatim. `resolved` is not terminal: a requester reply reopens it.
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    WAITING_FOR_CUSTOMER = "waiting_for_customer"
    RESOLVED = "resolved"


class MessageSender(StrEnum):
    # Which side of the conversation wrote it. Not derivable from
    # author_user_id: a guest requester has no user either, and without this a
    # guest's message would read as a system notice.
    REQUESTER = "requester"
    STAFF = "staff"
    SYSTEM = "system"


class SupportCase(Base):
    __tablename__ = "support_cases"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # Human-quotable, e.g. SC-261029-7KQ2MX. Never used in a FK.
    case_number: Mapped[str] = mapped_column(String(32), unique=True)
    audience: Mapped[CaseAudience] = mapped_column(string_enum(CaseAudience, 20))

    # NULL for a guest, who reaches the case through a signed link instead.
    opened_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id"), index=True
    )
    # Always set: it is the reply address for guests and members alike.
    contact_email: Mapped[str] = mapped_column(String(320))

    # §4.13 "relevant event, order, and ticket context when available". Three
    # real FKs, each nullable, because context arrives at different depths.
    event_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("events.id"))
    order_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("orders.id"))
    ticket_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("tickets.id"))

    category: Mapped[CaseCategory] = mapped_column(string_enum(CaseCategory, 30))
    status: Mapped[CaseStatus] = mapped_column(
        string_enum(CaseStatus, 30), server_default=CaseStatus.OPEN.value
    )
    assigned_to_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint(f"audience IN ({check_list(CaseAudience)})", name="audience"),
        CheckConstraint(f"category IN ({check_list(CaseCategory)})", name="category"),
        CheckConstraint(f"status IN ({check_list(CaseStatus)})", name="status"),
        # The staff queue. Postgres walks a btree backwards, so this serves the
        # queue's `updated_at DESC` without a DESC column.
        Index("ix_support_cases_audience_status_updated_at", "audience", "status", "updated_at"),
        # An organizer's cases for one event.
        Index("ix_support_cases_event_id_status", "event_id", "status"),
    )


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    support_case_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("support_cases.id"))
    sender: Mapped[MessageSender] = mapped_column(string_enum(MessageSender, 20))
    # NULL for a system message, and for a guest requester.
    author_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    # Staff-only. Kept out of the requester's thread by the query and by a
    # serializer that has no such field, never by a flag on one serializer.
    is_internal_note: Mapped[bool] = mapped_column(Boolean, server_default=false())
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint(f"sender IN ({check_list(MessageSender)})", name="sender"),
        CheckConstraint(
            "(sender <> 'staff' OR author_user_id IS NOT NULL)"
            " AND (sender <> 'system' OR author_user_id IS NULL)",
            name="author_matches_sender",
        ),
        # Only staff write notes, so a requester can never hide their own text.
        CheckConstraint("sender = 'staff' OR NOT is_internal_note", name="notes_are_staff_only"),
        # The thread, in order.
        Index("ix_support_messages_support_case_id_created_at", "support_case_id", "created_at"),
    )
