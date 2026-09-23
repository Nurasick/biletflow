from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class EventStatus(StrEnum):
    DRAFT = "draft"
    PUBLISHED = "published"
    CANCELLED = "cancelled"
    SUSPENDED = "suspended"


class EventVisibility(StrEnum):
    PUBLIC = "public"
    UNLISTED = "unlisted"
    PRIVATE = "private"


class SeatingMode(StrEnum):
    GENERAL_ADMISSION = "general_admission"
    ASSIGNED = "assigned"


class EventCategory(StrEnum):
    CONCERT = "concert"
    CONFERENCE = "conference"
    SPORT = "sport"
    THEATER = "theater"
    OTHER = "other"


def _check_list(enum: type[StrEnum]) -> str:
    return ", ".join(f"'{member.value}'" for member in enum)


def _string_enum(enum: type[StrEnum], length: int) -> SQLEnum:
    # Same shape as USER_STATUS in app/models/user.py, which explains each
    # argument: VARCHAR storage, values rather than names, and the CHECK
    # written by hand in __table_args__ so autogenerate can see it.
    return SQLEnum(
        enum,
        native_enum=False,
        length=length,
        create_constraint=False,
        values_callable=lambda e: [member.value for member in e],
    )


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    slug: Mapped[str] = mapped_column(String(200), unique=True)
    organizer_profile_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("organizer_profiles.id"), index=True
    )

    title: Mapped[str] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[EventCategory | None] = mapped_column(_string_enum(EventCategory, 64))
    cover_image_url: Mapped[str | None] = mapped_column(String(512))

    status: Mapped[EventStatus] = mapped_column(
        _string_enum(EventStatus, 20), server_default=EventStatus.DRAFT.value
    )
    visibility: Mapped[EventVisibility] = mapped_column(
        _string_enum(EventVisibility, 20), server_default=EventVisibility.PUBLIC.value
    )
    seating_mode: Mapped[SeatingMode] = mapped_column(
        _string_enum(SeatingMode, 20), server_default=SeatingMode.GENERAL_ADMISSION.value
    )

    venue_name: Mapped[str] = mapped_column(String(300))
    venue_address: Mapped[str] = mapped_column(Text)

    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # An IANA name such as 'Asia/Almaty', never an offset: the .ics export
    # (§4.11) has to say what wall-clock time the organizer meant.
    timezone: Mapped[str] = mapped_column(String(64))

    # NULL means no overall cap; the per-ticket-type quantities still apply.
    capacity: Mapped[int | None] = mapped_column(Integer)
    registration_opens_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    registration_closes_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(f"status IN ({_check_list(EventStatus)})", name="status"),
        CheckConstraint(f"visibility IN ({_check_list(EventVisibility)})", name="visibility"),
        CheckConstraint(f"seating_mode IN ({_check_list(SeatingMode)})", name="seating_mode"),
        CheckConstraint(f"category IN ({_check_list(EventCategory)})", name="category"),
        CheckConstraint("ends_at > starts_at", name="ends_after_starts"),
        CheckConstraint("capacity IS NULL OR capacity > 0", name="capacity_positive"),
        CheckConstraint(
            "registration_opens_at IS NULL OR registration_closes_at IS NULL"
            " OR registration_closes_at > registration_opens_at",
            name="registration_window_order",
        ),
        # The public discovery query filters on exactly these three.
        Index("ix_events_status_visibility_starts_at", "status", "visibility", "starts_at"),
    )
