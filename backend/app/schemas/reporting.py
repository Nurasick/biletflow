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


class TimelineEntry(BaseModel):
    """§4.16: "a timestamp, acting user, action type, affected entity, and
    short description"."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    actor_user_id: int | None
    action: str
    entity_type: str
    entity_id: int
    summary: str
    payload: dict | None


class RefundRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
