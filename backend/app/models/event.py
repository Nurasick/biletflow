from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class EventStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    UNLISTED = "unlisted"
    CANCELLED = "cancelled"


class EventVisibility(StrEnum):
    PUBLIC = "public"
    UNLISTED = "unlisted"
    PRIVATE = "private"


class EventCategory(StrEnum):
    CONCERT = "concert"
    CONFERENCE = "conference"
    SPORT = "sport"
    THEATER = "theater"
    OTHER = "other"


_STATUS_LIST = ", ".join(f"'{s.value}'" for s in EventStatus)
_VISIBILITY_LIST = ", ".join(f"'{s.value}'" for v in EventVisibility)
_CATEGORY_LIST = ", ".join(f"'{c.value}'" for c in EventCategory)


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)

    # main info
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text())
    category: Mapped[EventCategory] = mapped_column(
        String(50), server_default=EventCategory.OTHER
    )
    image_url: Mapped[str | None] = mapped_column(String(512))

    # place
    venue_name: Mapped[str] = mapped_column(String(255))
    venue_address: Mapped[str | None] = mapped_column(String(255))

    # dates
    start_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    end_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # sales and capacity
    capacity: Mapped[int] = mapped_column(Integer, server_default="0")
    registartion_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    registartion_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # status and visibility
    status: Mapped(EventStatus) = mapped_column(
        String(20), server_default=EventStatus.DRAFT
    )
    visibility: Mapped[EventVisibility] = mapped_column(
        String(20), server_default=EventVisibility.PUBLIC
    )

    # foreign keys and dates
    organizer_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("organizers.id"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    # PostgreSQL database-level constraint checks
    __table_args__ = (
        CheckConstraint(f"status IN ({_STATUS_LIST})", name="check_event_status"),
        CheckConstraint(
            f"visibility IN ({_VISIBILITY_LIST})", name="check_event_visibility"
        ),
        CheckConstraint(
            f"category IN ({_CATEGORY_LIST})", name="check_event_category"
        ),
    )