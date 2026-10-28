from datetime import datetime
from typing import Self

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models.order import OrderStatus
from app.models.ticket import TicketStatus

# A sanity bound on one request, separate from each type's max_per_order.
MAX_TICKETS_PER_ORDER = 20


class AttendeeIn(BaseModel):
    full_name: str = Field(min_length=1, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)


class OrderLineIn(BaseModel):
    ticket_type_id: int
    # One entry per ticket: the quantity IS the number of attendees, so the
    # two can never disagree.
    attendees: list[AttendeeIn] = Field(min_length=1)


class CheckoutRequest(BaseModel):
    contact_name: str = Field(min_length=1, max_length=200)
    contact_email: EmailStr
    contact_phone: str | None = Field(default=None, max_length=32)
    items: list[OrderLineIn] = Field(min_length=1)

    @model_validator(mode="after")
    def check_items(self) -> Self:
        ids = [item.ticket_type_id for item in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("each ticket type may appear only once; list all its attendees there")
        if sum(len(item.attendees) for item in self.items) > MAX_TICKETS_PER_ORDER:
            raise ValueError(f"at most {MAX_TICKETS_PER_ORDER} tickets per order")
        return self


class OrderItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticket_type_id: int
    quantity: int
    unit_price_minor: int
    subtotal_minor: int


class TicketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    public_code: str
    ticket_type_id: int
    ticket_type_name: str
    status: TicketStatus
    attendee_name: str
    # The signed admission payload (app/core/qr.py) for the client to draw as
    # a QR code. Built by the server: a client that could build payloads could
    # build tickets (qr-codes.md, For the frontend).
    qr_payload: str


class OrderEvent(BaseModel):
    """Enough of the event to render an order without a second request."""

    model_config = ConfigDict(from_attributes=True)

    slug: str
    title: str
    venue_name: str
    venue_address: str
    starts_at: datetime
    ends_at: datetime
    timezone: str
    status: str


class OrderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    order_number: str
    event_id: int
    event: OrderEvent
    status: OrderStatus
    contact_name: str
    contact_email: str
    subtotal_minor: int
    discount_minor: int
    fee_minor: int
    total_minor: int
    currency: str
    expires_at: datetime | None
    confirmed_at: datetime | None
    created_at: datetime
    items: list[OrderItemRead]
    # Empty until the order is confirmed: tickets do not exist before that.
    tickets: list[TicketRead]


class CheckoutResponse(OrderRead):
    # The signed link token. Shown once, here; a guest has no other way back
    # to this order until it is emailed (notifications slice).
    access_token: str
