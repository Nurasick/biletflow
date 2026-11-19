from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.check_in import AttendanceRead


class OrganizerOrderRow(BaseModel):
    order_number: str
    status: str
    contact_name: str
    contact_email: str
    total_minor: int
    currency: str
    ticket_count: int
    created_at: datetime
    confirmed_at: datetime | None


class AttendeeRow(BaseModel):
    public_code: str
    ticket_status: str
    ticket_type_name: str
    order_number: str
    full_name: str
    email: str | None
    phone: str | None


class TicketTypeSales(BaseModel):
    ticket_type_id: int
    name: str
    price_minor: int
    quantity_total: int
    quantity_sold: int
    quantity_reserved: int
    revenue_minor: int


class EventSummary(BaseModel):
    currency: str
    is_simulated: bool
    capacity: int
    tickets_sold: int
    tickets_reserved: int
    tickets_remaining: int
    percent_sold: float
    gross_minor: int
    refunds_minor: int
    fees_minor: int
    net_minor: int
    estimated_payout_minor: int
    tickets_refunded: int
    attendance: AttendanceRead
    by_ticket_type: list[TicketTypeSales]


class SalesPoint(BaseModel):
    # The event's local calendar day, YYYY-MM-DD.
    date: str
    tickets: int
    revenue_minor: int


class TicketTypeAnalytics(TicketTypeSales):
    # Sold inside the selected date range (quantity_sold is the count now).
    tickets_in_range: int
    # This type's share of the refunds in the date range. A refund is of a
    # whole order, split across its lines by what each line was paid, so the
    # rows add up to the event's refunds_minor.
    refunds_minor: int


class CampaignAnalytics(BaseModel):
    id: int
    name: str
    code: str
    is_active: bool
    redemptions: int
    orders: int
    tickets_sold: int
    gross_minor: int
    discount_minor: int
    refunds_minor: int
    net_minor: int


class EventAnalytics(BaseModel):
    """GET /organizer/events/{id}/analytics (§4.15). KZT minor units throughout."""

    currency: str
    is_simulated: bool
    capacity: int
    tickets_sold: int
    tickets_remaining: int
    percent_sold: float
    gross_minor: int
    discounts_minor: int
    refunds_minor: int
    net_minor: int
    sales_over_time: list[SalesPoint]
    by_ticket_type: list[TicketTypeAnalytics]
    campaigns: list[CampaignAnalytics]
    attendance: AttendanceRead
    # Which filters each part honours: "inventory", "money", "sales_over_time",
    # "by_ticket_type", "campaigns" and "attendance", each mapped to the
    # subset of ["date_range", "ticket_type"] that applies. Campaigns are
    # lifetime totals and inventory is the count now, whatever the filters.
    filter_scope: dict[str, list[str]]


class TimelineEntry(BaseModel):
    """§4.16: "a timestamp, acting user, action type, affected entity, and
    short description"."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    actor_user_id: int | None
    # Who did it, by name; None for the system (sweeper, payment callbacks).
    actor_name: str | None = None
    action: str
    entity_type: str
    entity_id: int
    summary: str
    payload: dict | None


class RefundRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
