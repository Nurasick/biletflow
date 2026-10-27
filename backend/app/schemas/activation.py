from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ChecklistRead(BaseModel):
    """§4.5 "The organizer shall see an activation checklist": §3.2's five steps."""

    paid_ticket_type: bool
    organizer_verified: bool
    fee_paid: bool
    payout_account_active: bool
    terms_accepted: bool


class ActivationRead(BaseModel):
    status: Literal["pending", "active", "suspended"]
    activation_fee_minor: int
    currency: str
    # Always true in the MVP; present so the UI never shows the fee as a real
    # charge (§4.6 "never presented as real financial transactions").
    is_simulated: bool
    terms_accepted_at: datetime | None
    activated_at: datetime | None
    suspended_at: datetime | None
    suspension_reason: str | None
    checklist: ChecklistRead


class SimulatedPayment(BaseModel):
    """The outcome to simulate. Lets the demo show the decline path (§4.10)."""

    outcome: Literal["succeed", "fail"] = "succeed"
