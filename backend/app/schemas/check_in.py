from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

OutcomeType = Literal["valid", "invalid", "wrong_event", "cancelled", "refunded", "already_used"]


class ScanRequest(BaseModel):
    # The raw text the camera read. Bounded so a junk QR cannot send megabytes.
    qr: str = Field(min_length=1, max_length=512)
    device_info: str | None = Field(default=None, max_length=200)


class DeviceInfo(BaseModel):
    device_info: str | None = Field(default=None, max_length=200)


class ScannedTicket(BaseModel):
    public_code: str
    status: str
    attendee_name: str
    ticket_type_name: str


class ScanResponse(BaseModel):
    """One of six outcomes (§4.8's five plus wrong_event). `ticket` is present
    whenever the code resolved to a real ticket, so the operator sees whose it is
    even on a rejection."""

    outcome: OutcomeType
    ticket: ScannedTicket | None


class AttendanceRead(BaseModel):
    registered: int
    checked_in: int
    absent: int
    checked_in_percent: float


class StaffEventRead(BaseModel):
    id: int
    slug: str
    title: str
    venue_name: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    status: str
    # Organizer of the event, or assigned staff: the app may show it.
    role: Literal["organizer", "event_admin"]
