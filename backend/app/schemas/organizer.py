import re
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

# The two sandbox providers the web form offers. No real provider exists in
# the MVP (§8 excludes real payouts), so anything else is refused.
PayoutProvider = Literal["sandbox_bank", "sandbox_wallet"]

# An opaque demo reference, never an account number: no bank details are
# stored anywhere (01-identity.md#no-bank-details-are-ever-stored).
PAYOUT_REFERENCE = r"^demo_[A-Za-z0-9_-]{3,64}$"


def _phone(value: str | None) -> str | None:
    # Same rule as the web form's profileSchema: digits, spaces, (), - and an
    # optional leading +, with 7 to 15 digits in total.
    if value is None or value == "":
        return None
    if not re.fullmatch(r"\+?[0-9 ()-]+", value):
        raise ValueError("phone may contain only digits, spaces, (), - and a leading +")
    if not 7 <= len(re.sub(r"\D", "", value)) <= 15:
        raise ValueError("phone must have 7 to 15 digits")
    return value


Trimmed = StringConstraints(strip_whitespace=True)
Phone = Annotated[Annotated[str, Trimmed, Field(max_length=32)] | None, AfterValidator(_phone)]


class OrganizerProfileWrite(BaseModel):
    """PUT /organizer/profile: the whole profile, created on first save."""

    display_name: Annotated[str, Trimmed, Field(min_length=1, max_length=200)]
    contact_email: EmailStr
    contact_phone: Phone = None
    description: Annotated[str, Trimmed, Field(max_length=2000)] | None = None
    payout_provider: PayoutProvider | None = None
    # Validated by payout_pair below rather than a field pattern, so that ""
    # (what an empty form field sends) can first be turned into None.
    payout_reference: Annotated[str, Trimmed, Field(max_length=70)] | None = None

    @field_validator("contact_email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower()

    @field_validator("description", "payout_reference", mode="after")
    @classmethod
    def empty_is_none(cls, v: str | None) -> str | None:
        return v or None

    @model_validator(mode="after")
    def payout_pair(self) -> Self:
        if (self.payout_provider is None) != (self.payout_reference is None):
            raise ValueError("payout_provider and payout_reference are set together or not at all")
        if self.payout_reference is not None and not re.fullmatch(
            PAYOUT_REFERENCE, self.payout_reference
        ):
            raise ValueError("payout_reference must look like demo_xxx (a sandbox reference)")
        return self


class PayoutAccountRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    provider: str
    external_account_ref: str
    status: str
    is_simulated: bool


class OrganizerProfileRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    display_name: str
    contact_email: str
    contact_phone: str | None
    description: str | None
    verification_status: str
    payout_account: PayoutAccountRead | None
    created_at: datetime
    updated_at: datetime


class StaffAssign(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower()


class StaffRead(BaseModel):
    user_id: int
    email: str
    first_name: str
    last_name: str
    role: str
    created_at: datetime
