from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

TicketStatusType = Literal["available", "reserved", "sold", "cancelled"]

# Matches Numeric(10, 2) on tickets.price, so an oversized price is a 422 here
# instead of a database error on Postgres.
Price = Annotated[Decimal, Field(ge=0, max_digits=10, decimal_places=2)]


class TicketCreate(BaseModel):
    """What an organizer sends to issue a ticket.

    No event id: the event comes from the URL, after its ownership is checked.
    """

    ticket_code: str = Field(min_length=3, max_length=100)
    seat_number: str | None = Field(default=None, max_length=50)
    price: Price


class TicketUpdate(BaseModel):
    """Partial update for an available ticket.

    Reserved and sold are set by orders only. The organizer may withdraw a
    ticket from sale by cancelling it, which cannot be undone.
    """

    seat_number: str | None = Field(default=None, max_length=50)
    price: Price | None = None
    status: Literal["cancelled"] | None = None

    @model_validator(mode="after")
    def check_not_null(self) -> Self:
        # `None` above means "not sent". An explicit null for a NOT NULL
        # column would otherwise reach the database and fail there.
        for field in self.model_fields_set & {"price", "status"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


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
