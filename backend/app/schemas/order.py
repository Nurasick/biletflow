from datetime import datetime
from decimal import Decimal
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.ticket import TicketRead

OrderStatusType = Literal["pending", "paid", "cancelled", "expired"]


class OrderCreate(BaseModel):
    """Payload to initiate a ticket order reservation."""

    ticket_ids: list[int] = Field(min_length=1)

    @model_validator(mode="after")
    def check_unique_tickets(self) -> Self:
        if len(self.ticket_ids) != len(set(self.ticket_ids)):
            raise ValueError("ticket_ids must not contain duplicate values")
        return self


class OrderRead(BaseModel):
    id: int
    user_id: int

    total_amount: Decimal
    status: OrderStatusType

    expires_at: datetime | None
    paid_at: datetime | None
    cancelled_at: datetime | None

    created_at: datetime
    updated_at: datetime

    tickets: list[TicketRead] = []

    model_config = ConfigDict(from_attributes=True)
