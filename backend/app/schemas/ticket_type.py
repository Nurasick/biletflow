from datetime import datetime
from typing import Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    computed_field,
    model_validator,
)


def _check_sales_windows(
    starts_at: datetime | None,
    ends_at: datetime | None,
) -> None:
    if starts_at is not None and ends_at is not None and ends_at <= starts_at:
        raise ValueError("sales_end_at must be after sales_start_at")


class TicketTypeCreate(BaseModel):
    name: str = Field(max_length=200, min_length=1)
    description: str | None = None
    price_minor: int = Field(default=0, ge=0)
    currency: Literal["KZT"] = Field(default="KZT")
    quantity_total: int = Field(ge=1)
    sales_start_at: AwareDatetime | None = None
    sales_end_at: AwareDatetime | None = None
    max_per_order: int | None = Field(default=None, gt=0)
    is_hidden: bool = Field(default=False)
    position: int = Field(default=0)

    @model_validator(mode="after")
    def check_window(self) -> Self:
        _check_sales_windows(
            self.sales_start_at,
            self.sales_end_at,
        )
        return self


class TicketTypeUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200, min_length=1)
    description: str | None = None
    price_minor: int | None = Field(default=None, ge=0)
    currency: Literal["KZT"] | None = Field(default=None)
    quantity_total: int | None = Field(default=None, ge=1)
    sales_start_at: AwareDatetime | None = None
    sales_end_at: AwareDatetime | None = None
    max_per_order: int | None = Field(default=None, gt=0)
    is_hidden: bool | None = Field(default=None)
    position: int | None = Field(default=None)

    @model_validator(mode="after")
    def check_window(self) -> Self:
        _check_sales_windows(
            self.sales_start_at,
            self.sales_end_at,
        )
        return self

    @model_validator(mode="after")
    def check_not_none(self) -> Self:
        fields = {"name", "price_minor", "quantity_total", "is_hidden", "position", "currency"}
        for field in self.model_fields_set:
            if field in fields and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class TicketTypeRead(BaseModel):
    id: int
    event_id: int
    name: str
    description: str | None
    price_minor: int
    currency: str
    quantity_total: int
    quantity_sold: int
    quantity_reserved: int
    sales_start_at: datetime | None
    sales_end_at: datetime | None
    max_per_order: int | None
    is_hidden: bool
    position: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TicketTypePublic(BaseModel):
    id: int
    name: str
    description: str | None
    quantity_total: int = Field(exclude=True)
    quantity_sold: int = Field(exclude=True)
    quantity_reserved: int = Field(exclude=True)
    price_minor: int
    currency: str
    sales_start_at: datetime | None
    sales_end_at: datetime | None
    max_per_order: int | None

    @computed_field
    def available(self) -> int:
        return self.quantity_total - self.quantity_sold - self.quantity_reserved

    model_config = ConfigDict(from_attributes=True)
