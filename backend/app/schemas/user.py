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

    # Same credentials as LoginRequest's example, so /docs can register and
    # then log in without editing either body.
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "email": "organizer@example.com",
                    "password": "correct-horse-battery",
                    "first_name": "Aigerim",
                    "last_name": "Sultanova",
                    "phone": "+77011234567",
                    "locale": "ru",
                }
            ]
        }
    )


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
