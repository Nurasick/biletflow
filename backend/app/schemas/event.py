import re
from datetime import datetime
from typing import Annotated, Literal, Self
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    computed_field,
    model_validator,
)

from app.core.clock import as_utc, utcnow

EventStatusType = Literal["draft", "published", "cancelled", "suspended"]
EventVisibilityType = Literal["public", "unlisted", "private"]
SeatingModeType = Literal["general_admission", "assigned"]
EventCategoryType = Literal["concert", "conference", "sport", "theater", "other"]
EventPhaseType = Literal["draft", "upcoming", "active", "completed", "cancelled", "suspended"]

SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


# "UTC" or a canonical Area/Location name. The same pattern the web form uses
# (eventDateTime.ts isEventTimeZone), so the two accept the same set: legacy
# aliases such as "GMT", "EST" or "Japan" exist in tzdata but are refused by
# both (audit finding #25).
CANONICAL_ZONE = re.compile(r"^[A-Za-z_]+(?:/[A-Za-z0-9_+-]+)+$")

# Shared with the web form (eventSchema.ts) so a value one accepts the other
# accepts too (audit finding #24).
MAX_DESCRIPTION = 10_000
MAX_ADDRESS = 2_000
MAX_REFUND_POLICY = 2_000


def _iana_timezone(value: str) -> str:
    # A fixed offset like "+05:00" is rejected on purpose: see the timezone
    # column in app/models/event.py.
    if value != "UTC" and not CANONICAL_ZONE.match(value):
        raise ValueError(f"{value!r} is not a canonical IANA timezone name")
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValueError(f"{value!r} is not an IANA timezone name") from None
    return value


Trimmed = StringConstraints(strip_whitespace=True)
IanaTimezone = Annotated[str, Field(max_length=64), AfterValidator(_iana_timezone)]
Slug = Annotated[str, Field(min_length=3, max_length=200, pattern=SLUG_PATTERN)]
Title = Annotated[str, Trimmed, Field(min_length=1, max_length=300)]
VenueName = Annotated[str, Trimmed, Field(min_length=1, max_length=300)]
VenueAddress = Annotated[str, Trimmed, Field(min_length=1, max_length=MAX_ADDRESS)]
Description = Annotated[str, Trimmed, Field(max_length=MAX_DESCRIPTION)]
RefundPolicy = Annotated[str, Trimmed, Field(max_length=MAX_REFUND_POLICY)]


def check_windows(
    starts_at: datetime | None,
    ends_at: datetime | None,
    opens_at: datetime | None,
    closes_at: datetime | None,
) -> None:
    """One registration-window rule for every layer (audit finding #16).

    Registration may open and close any time up to the start of the event,
    never after it: the web form enforces the same. Used by the schemas on the
    request alone and by the service on the request merged with the stored row.
    """
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise ValueError("ends_at must be after starts_at")
    if opens_at is not None and closes_at is not None and closes_at <= opens_at:
        raise ValueError("registration_closes_at must be after registration_opens_at")
    if starts_at is not None:
        for name, moment in (
            ("registration_opens_at", opens_at),
            ("registration_closes_at", closes_at),
        ):
            if moment is not None and moment > starts_at:
                raise ValueError(f"{name} cannot be after the event starts")


class EventCreate(BaseModel):
    """What an organizer sends to create a draft.

    No organizer id and no status: the owner comes from the access token, and
    every event starts as a draft. Status changes go through dedicated actions.
    `slug` is optional: left out, one is made from the title.

    description and category stay optional here although the web form
    requires them: a draft saved through the API may be incomplete. The
    length limits are the same as the form's.
    """

    slug: Slug | None = None
    title: Title
    description: Description | None = None
    category: EventCategoryType | None = None
    cover_image_url: str | None = Field(default=None, max_length=512)
    refund_policy: RefundPolicy | None = None

    visibility: EventVisibilityType = "public"
    seating_mode: SeatingModeType = "general_admission"

    venue_name: VenueName
    venue_address: VenueAddress

    starts_at: AwareDatetime
    ends_at: AwareDatetime
    timezone: IanaTimezone

    capacity: int | None = Field(default=None, gt=0, le=2_147_483_647)
    registration_opens_at: AwareDatetime | None = None
    registration_closes_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def check_windows(self) -> Self:
        check_windows(
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

    title: Title | None = None
    description: Description | None = None
    category: EventCategoryType | None = None
    cover_image_url: str | None = Field(default=None, max_length=512)
    refund_policy: RefundPolicy | None = None

    visibility: EventVisibilityType | None = None
    seating_mode: SeatingModeType | None = None

    venue_name: VenueName | None = None
    venue_address: VenueAddress | None = None

    starts_at: AwareDatetime | None = None
    ends_at: AwareDatetime | None = None
    timezone: IanaTimezone | None = None

    capacity: int | None = Field(default=None, gt=0, le=2_147_483_647)
    registration_opens_at: AwareDatetime | None = None
    registration_closes_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def check_windows(self) -> Self:
        check_windows(
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

    refund_policy: str | None

    published_at: datetime | None
    cancelled_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def phase(self) -> EventPhaseType:
        """§4.16's Upcoming / Active / Completed, derived from the clock and
        never stored (state-machines.md §1.1). Non-published events report
        their status instead."""
        if self.status != "published":
            return self.status
        now = utcnow()
        if now < as_utc(self.starts_at):
            return "upcoming"
        return "active" if now <= as_utc(self.ends_at) else "completed"


class EventImageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    position: int


class EventDetail(EventRead):
    """GET /events/{slug}: what an attendee's event page needs in one request."""

    organizer_name: str
    images: list[EventImageRead]
    # False while the paid types of this event cannot be bought yet (§4.5), so
    # the page can say so instead of letting checkout fail.
    paid_sales_active: bool


class Requirement(BaseModel):
    code: Literal["title", "venue", "schedule", "future_start", "visible_ticket_type"]
    met: bool


class EventPreview(BaseModel):
    """GET /organizer/events/{id}/preview: the page the organizer checks
    before publishing (§4.2 "Preview an event before publication")."""

    event: EventRead
    images: list[EventImageRead]
    publish_requirements: list[Requirement]
    allowed_actions: list[Literal["publish", "unpublish", "cancel"]]


class CancelRequest(BaseModel):
    reason: Annotated[str, Trimmed, Field(max_length=500)] | None = None


class SuspendRequest(BaseModel):
    reason: Annotated[str, Trimmed, Field(min_length=1, max_length=500)]
