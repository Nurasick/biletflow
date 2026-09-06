from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserBase(BaseModel):
    email: EmailStr

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        return v.lower()


class UserCreate(UserBase):
    first_name: str = Field(max_length=100)
    last_name: str = Field(max_length=100)
    password: str = Field(min_length=8, max_length=50)
    phone: str | None = Field(default=None, max_length=32)
    locale: Literal["kk", "ru", "en"]


class UserRead(UserBase):
    id: int
    status: Literal["active", "suspended"]
    is_email_verified: bool
    first_name: str
    last_name: str
    locale: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=32)
    locale: Literal["kk", "ru", "en"] | None = Field(default=None)
