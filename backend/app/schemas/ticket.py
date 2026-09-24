from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TicketStatusType = Literal["available", "reserved", "sold", "cancelled"]


class TicketCreate(BaseModel):
    """What is sent when issuing/creating a ticket for an event."""

    event_id: int = Field(gt=0)
    ticket_code: str = Field(min_length=3, max_length=100)
    seat_number: str | None = Field(default=None, max_length=50)
    price: Decimal = Field(ge=0, decimal_places=2)


class TicketUpdate(BaseModel):
    """Partial update for a ticket."""

    seat_number: str | None = Field(default=None, max_length=50)
    price: Decimal | None = Field(default=None, ge=0, decimal_places=2)
    status: TicketStatusType | None = None


class TicketRead(BaseModel):
    id: int
    event_id: int
    order_id: int | None

    ticket_code: str
    seat_number: str | None
    price: Decimal
    status: TicketStatusType

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
