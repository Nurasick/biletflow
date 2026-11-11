from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

DiscountTypeName = Literal["percent", "fixed"]
# Letters, digits, dash and underscore: something a person can read off a
# poster and type on a phone. Stored upper-case, matched case-insensitively.
Code = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_-]+$"
    ),
]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


def _check(discount_type: str | None, value: int | None, starts, ends) -> None:
    if discount_type == "percent" and value is not None and not 1 <= value <= 100:
        raise ValueError("a percent discount must be between 1 and 100")
    if discount_type == "fixed" and value is not None and value < 1:
        raise ValueError("a fixed discount must be at least 1 tiyn")
    if starts is not None and ends is not None and ends <= starts:
        raise ValueError("ends_at must be after starts_at")


class CampaignCreate(BaseModel):
    name: Name
    # Omit to have the server generate one.
    code: Code | None = None
    discount_type: DiscountTypeName
    # percent: 1..100. fixed: KZT minor units (tiyn), like every money field.
    discount_value: int = Field(ge=1)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_redemptions: int | None = Field(default=None, ge=1)
    # Empty = every ticket type of the event, including ones added later.
    ticket_type_ids: list[int] = Field(default_factory=list, max_length=50)

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "name": "Student week",
                    "code": "STUDENT20",
                    "discount_type": "percent",
                    "discount_value": 20,
                    "max_redemptions": 100,
                    "ticket_type_ids": [],
                }
            ]
        }
    )

    @model_validator(mode="after")
    def check(self) -> Self:
        _check(self.discount_type, self.discount_value, self.starts_at, self.ends_at)
        return self


class CampaignUpdate(BaseModel):
    """PATCH: only the fields sent are changed. `is_active: false` disables the
    code (§4.14) without deleting the campaign or its history."""

    name: Name | None = None
    code: Code | None = None
    discount_type: DiscountTypeName | None = None
    discount_value: int | None = Field(default=None, ge=1)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    max_redemptions: int | None = Field(default=None, ge=1)
    is_active: bool | None = None
    ticket_type_ids: list[int] | None = Field(default=None, max_length=50)

    @model_validator(mode="after")
    def check(self) -> Self:
        for field in ("name", "code", "discount_type", "discount_value", "is_active"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        _check(self.discount_type, self.discount_value, self.starts_at, self.ends_at)
        return self


class CampaignStats(BaseModel):
    """§4.14 "exact redemptions, orders, tickets sold, gross revenue, discount
    amount, and net revenue". Every amount is KZT minor units."""

    redemptions: int
    orders: int
    tickets_sold: int
    gross_minor: int
    discount_minor: int
    refunds_minor: int
    net_minor: int


class CampaignRead(BaseModel):
    id: int
    event_id: int
    name: str
    code: str
    discount_type: DiscountTypeName
    discount_value: int
    starts_at: datetime | None
    ends_at: datetime | None
    max_redemptions: int | None
    redemption_count: int
    is_active: bool
    created_at: datetime
    # Empty = all ticket types.
    ticket_type_ids: list[int]
    # The link the Campaign QR encodes. The organizer can also share it as is.
    link: str
    stats: CampaignStats


class BasketLine(BaseModel):
    ticket_type_id: int
    quantity: int = Field(ge=1, le=20)


class PromoQuoteRequest(BaseModel):
    """Exactly one of `code` (typed) or `token` (from a Campaign QR link).
    `items` may be empty: the page applies a scanned code before the attendee
    has chosen anything."""

    code: str | None = Field(default=None, max_length=64)
    token: str | None = Field(default=None, max_length=64)
    items: list[BasketLine] = Field(default_factory=list, max_length=20)


class PromoQuote(BaseModel):
    """What the attendee is shown before paying (§4.14): the code, the
    discount and the new total. Computed by the server, and computed again at
    checkout; nothing here is trusted back."""

    code: str
    name: str
    discount_type: DiscountTypeName
    discount_value: int
    # Empty = all ticket types.
    ticket_type_ids: list[int]
    subtotal_minor: int
    discount_minor: int
    total_minor: int
