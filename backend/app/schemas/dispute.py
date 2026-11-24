from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.dispute import DisputeStatus

DisputeStatusName = Literal[
    "open", "under_review", "resolved_organizer", "resolved_attendee", "closed"
]


class DisputeCreate(BaseModel):
    order_number: str = Field(min_length=1, max_length=32)
    payment_id: int | None = None
    reason: str = Field(min_length=1, max_length=2000)
    amount_minor: int | None = Field(default=None, gt=0)
    evidence_notes: str | None = Field(default=None, max_length=4000)


class DisputeUpdate(BaseModel):
    status: DisputeStatusName | None = None
    evidence_notes: str | None = Field(default=None, max_length=4000)
    resolution_notes: str | None = Field(default=None, max_length=4000)

    @model_validator(mode="after")
    def check_has_field(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("provide at least one field to update")
        if "status" in self.model_fields_set and self.status is None:
            raise ValueError("status cannot be null")
        return self


class DisputeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    order_id: int
    order_number: str
    event_id: int
    event_title: str
    payment_id: int | None
    status: DisputeStatus
    reason: str
    amount_minor: int
    currency: str
    evidence_notes: str | None
    resolution_notes: str | None
    opened_by_user_id: int | None
    resolved_by_user_id: int | None
    resolved_at: datetime | None
    created_at: datetime
    updated_at: datetime
