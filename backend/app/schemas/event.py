from datetime import datetime
from typing import Annotated, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    model_validator,
)

EventStatusType = Literal["draft", "published", "cancelled", "suspended"]
EventVisibilityType = Literal["public", "unlisted", "private"]
SeatingModeType = Literal["general_admission", "assigned"]
EventCategoryType = Literal["concert", "conference", "sport", "theater", "other"]

SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


def _iana_timezone(value: str) -> str:
    # A fixed offset like "+05:00" is rejected on purpose: see the timezone
    # column in app/models/event.py.
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"{value!r} is not an IANA timezone name") from None
    return value


IanaTimezone = Annotated[str, Field(max_length=64), AfterValidator(_iana_timezone)]
Slug = Annotated[str, Field(min_length=3, max_length=200, pattern=SLUG_PATTERN)]


def _check_windows(
    starts_at: datetime | None,
    ends_at: datetime | None,
    opens_at: datetime | None,
    closes_at: datetime | None,
) -> None:
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise ValueError("ends_at must be after starts_at")
    if opens_at is not None and closes_at is not None and closes_at <= opens_at:
        raise ValueError("registration_closes_at must be after registration_opens_at")


class EventCreate(BaseModel):
    """What an organizer sends to create a draft.

    No organizer id and no status: the owner comes from the access token, and
    every event starts as a draft. Status changes go through dedicated actions.
    """

    slug: Slug
    title: str = Field(min_length=1, max_length=300)
    description: str | None = None
    category: EventCategoryType | None = None
    cover_image_url: str | None = Field(default=None, max_length=512)

    visibility: EventVisibilityType = "public"
    seating_mode: SeatingModeType = "general_admission"

    venue_name: str = Field(min_length=1, max_length=300)
    venue_address: str = Field(min_length=1)

    starts_at: AwareDatetime
    ends_at: AwareDatetime
    timezone: IanaTimezone

    capacity: int | None = Field(default=None, gt=0)
    registration_opens_at: AwareDatetime | None = None
    registration_closes_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def check_windows(self) -> Self:
        _check_windows(
            self.starts_at,
            self.ends_at,
            self.registration_opens_at,
            self.registration_closes_at,
        )
        return self


class EventUpdate(BaseModel):
    """A partial update. Omitted fields are left alone.

    The window checks here only see the fields in the request; the service
    re-checks them against the stored values after merging.
    """

    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = None
    category: EventCategoryType | None = None
    cover_image_url: str | None = Field(default=None, max_length=512)

    visibility: EventVisibilityType | None = None
    seating_mode: SeatingModeType | None = None

    venue_name: str | None = Field(default=None, min_length=1, max_length=300)
    venue_address: str | None = Field(default=None, min_length=1)

    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    timezone: IanaTimezone | None = None

    capacity: int | None = Field(default=None, gt=0)
    registration_opens_at: AwareDatetime | None = None
    registration_closes_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def check_windows(self) -> Self:
        _check_windows(
            self.starts_at,
            self.ends_at,
            self.registration_opens_at,
            self.registration_closes_at,
        )
        return self

    @model_validator(mode="after")
    def check_not_null(self) -> Self:
        # `None` above means "not sent". A client that sends an explicit null
        # for a NOT NULL column would otherwise reach the database and fail
        # there, and the service would report it as a date-window error.
        for field in self.model_fields_set & _NOT_NULL_ON_UPDATE:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


_NOT_NULL_ON_UPDATE = frozenset(
    {
        "title",
        "visibility",
        "seating_mode",
        "venue_name",
        "venue_address",
        "starts_at",
        "ends_at",
        "timezone",
    }
)


class EventRead(BaseModel):
    id: int
    slug: str
    organizer_profile_id: int

    title: str
    description: str | None
    category: EventCategoryType | None
    cover_image_url: str | None

    status: EventStatusType
    visibility: EventVisibilityType
    seating_mode: SeatingModeType

    venue_name: str
    venue_address: str

    starts_at: datetime
    ends_at: datetime
    timezone: str

    capacity: int | None
    registration_opens_at: datetime | None
    registration_closes_at: datetime | None

    published_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
