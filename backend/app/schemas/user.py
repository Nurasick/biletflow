from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

# Required and trimmed, with the web form's limit: "  " is not a name (audit #24).
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Locale = Literal["kk", "ru", "en"]


class UserBase(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower()


class UserCreate(UserBase):
    first_name: Name
    last_name: Name
    password: str = Field(min_length=8, max_length=50)
    phone: str | None = Field(default=None, max_length=32)
    locale: Locale


class UserRead(UserBase):
    id: int
    status: Literal["active", "suspended"]
    is_email_verified: bool
    first_name: str
    last_name: str
    locale: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MeRead(UserRead):
    """GET /users/me: the account plus what it may do, so a client derives
    roles from the real session instead of a local fixture (audit #9).
    Event admin is per event, so it is not here: see GET /staff/events."""

    phone: str | None
    is_platform_admin: bool
    is_organizer: bool


class UserUpdate(BaseModel):
    """PATCH /users/me. Omitted fields are left alone; email and password
    have their own flows."""

    first_name: Name | None = None
    last_name: Name | None = None
    phone: str | None = Field(default=None, max_length=32)
    locale: Locale | None = None
