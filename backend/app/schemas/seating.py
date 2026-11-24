from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class VenueSectionSummary(BaseModel):
    id: int
    name: str
    display_order: int
    seat_count: int
    price_categories: list[str]


class VenueSummaryRead(BaseModel):
    id: int
    slug: str
    name: str
    city: str
    address: str
    total_seats: int
    accessible_seats: int
    price_categories: list[str]
    sections: list[VenueSectionSummary]


class SeatMapSeatRead(BaseModel):
    event_seat_id: int
    seat_id: int
    section_name: str
    row_label: str
    seat_number: str
    status: Literal["available", "held", "sold", "unavailable"]
    is_accessible: bool
    price_category: str
    ticket_type_id: int | None
    ticket_type_name: str | None
    price_minor: int | None
    currency: str | None
    hold_expires_at: datetime | None = None
    seat_label: str
    accessible_label: str


class SeatMapRowRead(BaseModel):
    row_id: int
    name: str
    display_order: int
    seats: list[SeatMapSeatRead]


class SeatMapSectionRead(BaseModel):
    section_id: int
    name: str
    display_order: int
    rows: list[SeatMapRowRead]


class SeatMapCounts(BaseModel):
    total: int
    sellable: int
    available: int
    held: int
    sold: int
    unavailable: int


class EventSeatMapRead(BaseModel):
    event_id: int
    seating_mode: str
    venue_id: int | None
    venue_name: str
    venue_city: str | None
    venue_address: str
    counts: SeatMapCounts
    sections: list[SeatMapSectionRead]


class EventSeatingConfigureRequest(BaseModel):
    venue_id: int
    # Maps venue seat price_category (e.g. "VIP", "Premium", "Standard") -> TicketType.id
    category_ticket_type_map: dict[str, int] = Field(min_length=1)
    # Physical seat IDs (from seats.id) to mark unavailable (broken/obstructed/held back)
    unavailable_seat_ids: list[int] = Field(default_factory=list)


class EventSeatStatusUpdate(BaseModel):
    status: Literal["available", "unavailable"]
    ticket_type_id: int | None = None
