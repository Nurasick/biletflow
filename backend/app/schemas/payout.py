from datetime import datetime
from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.payout import PayoutStatus

PayoutStatusName = Literal["pending", "processing", "paid", "failed"]


class PayoutCreate(BaseModel):
    event_id: int
    amount_minor: int | None = Field(default=None, gt=0)
    reference: str | None = Field(default=None, max_length=128)


class PayoutUpdate(BaseModel):
    status: PayoutStatusName
    reference: str | None = Field(default=None, max_length=128)
    failure_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def check_failure_reason(self) -> Self:
        if self.status == "failed" and not (self.failure_reason and self.failure_reason.strip()):
            self.failure_reason = "Simulated payout transfer failed"
        return self


class PayoutRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    organizer_profile_id: int
    event_id: int
    event_title: str
    payout_account_id: int | None
    amount_minor: int
    currency: str
    status: PayoutStatus
    is_simulated: bool
    reference: str | None
    failure_reason: str | None
    initiated_by_user_id: int | None
    paid_at: datetime | None
    created_at: datetime
    updated_at: datetime
