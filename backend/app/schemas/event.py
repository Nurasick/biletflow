from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EventStatusType = Literal["draft", "published", "unlisted", "cancelled"]
EventVisibilityType = Literal["public", "unlisted", "private"]
EventCategoryType = Literal["concert", "conference", "sport", "theater", "other"]


class EventBase(BaseModel):
    title: str = Field(max_length=255)
    description: str | None = Field(default=None)
    category: EventCategoryType = Field(default="other")
    image_url: str | None = Field(default=None, max_length=512)

    venue_name: str = Field(max_length=255)
    venue_address: str | None = Field(default=None, max_length=255)

    start_time: datetime
    end_time: datetime | None = Field(default=None)

    capacity: int = Field(default=0, ge=0)
    registration_start: datetime | None = Field(default=None)
    registration_end: datetime | None = Field(default=None)

    status: EventStatusType = Field(default="draft")
    visibility: EventVisibilityType = Field(default="public")


class EventCreate(EventBase):
    organizer_id: int


class EventRead(EventBase):
    id: int
    organizer_id: int
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    description: str | None = Field(default=None)
    category: EventCategoryType | None = Field(default=None)
    image_url: str | None = Field(default=None, max_length=512)
    venue_name: str | None = Field(default=None, max_length=255)
    venue_address: str | None = Field(default=None, max_length=255)
    start_time: datetime | None = Field(default=None)
    end_time: datetime | None = Field(default=None)
    capacity: int | None = Field(default=None, ge=0)
    registration_start: datetime | None = Field(default=None)
    registration_end: datetime | None = Field(default=None)
    status: EventStatusType | None = Field(default=None)
    visibility: EventVisibilityType | None = Field(default=None)
