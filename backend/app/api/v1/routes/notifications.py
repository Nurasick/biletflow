"""The in-app notification feed (§4.10, §4.13 "in-app or email notifications").

The client polls; there are no sockets (§9). Each item is a template key and
its variables, and the client renders the words, which is what lets the feed
follow the interface language.
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict

from app.api.deps import CurrentUser, DbSession
from app.services import notify

router = APIRouter(tags=["notifications"])


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    template_key: str
    payload: dict
    read_at: datetime | None
    created_at: datetime


class NotificationFeed(BaseModel):
    unread: int
    items: list[NotificationRead]


@router.get("/users/me/notifications", response_model=NotificationFeed)
def my_notifications(user: CurrentUser, db: DbSession) -> dict:
    return {"unread": notify.unread_count(db, user), "items": notify.feed(db, user)}


@router.post("/users/me/notifications/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(user: CurrentUser, db: DbSession) -> None:
    """Mark everything read: the user opened the feed and saw it."""
    notify.mark_all_read(db, user)


@router.post(
    "/users/me/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT
)
def mark_one_read(notification_id: int, user: CurrentUser, db: DbSession) -> None:
    """Mark a single in-app notification as read (§4.10)."""
    if not notify.mark_one_read(db, user, notification_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
