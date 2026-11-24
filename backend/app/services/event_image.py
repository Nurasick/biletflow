from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.event import Event, EventStatus
from app.models.event_image import EventImage
from app.services import storage


class TooManyImages(Exception):
    """The event already has MAX_EVENT_IMAGES images."""


class EventClosedForChanges(Exception):
    """Cancelled and suspended events are frozen, images included."""

    def __init__(self, status: EventStatus = EventStatus.CANCELLED):
        super().__init__(status)
        self.status = status


def _ensure_editable(event: Event) -> None:
    if event.status in (EventStatus.CANCELLED, EventStatus.SUSPENDED):
        raise EventClosedForChanges(event.status)


def list_images(db: Session, event_id: int) -> Sequence[EventImage]:
    return db.scalars(
        select(EventImage)
        .where(EventImage.event_id == event_id)
        .order_by(EventImage.position, EventImage.id)
    ).all()


def add_image(db: Session, event: Event, data_url: str, alt_text: str | None = None) -> EventImage:
    """Validate, store, and append an image. The first one becomes the cover.

    Serialize image edits for this event so limits and cover updates stay consistent.
    """
    db.refresh(event, with_for_update=True)
    _ensure_editable(event)
    count = db.scalar(select(func.count()).where(EventImage.event_id == event.id))
    if count >= settings.MAX_EVENT_IMAGES:
        raise TooManyImages
    content, content_type = storage.decode_data_url(data_url)
    key, url = storage.save(f"events/{event.id}", content, content_type)
    image = EventImage(
        event_id=event.id,
        storage_key=key,
        url=url,
        content_type=content_type,
        size_bytes=len(content),
        position=count,
        alt_text=alt_text,
    )
    db.add(image)
    try:
        db.flush()
        _sync_cover(db, event)
        db.commit()
    except Exception:
        # The row did not land, so the file must not stay behind as an orphan.
        db.rollback()
        storage.delete(key)
        raise
    db.refresh(image)
    return image


def delete_image(db: Session, event: Event, image_id: int) -> bool:
    db.refresh(event, with_for_update=True)
    _ensure_editable(event)
    image = db.scalar(
        select(EventImage).where(EventImage.id == image_id, EventImage.event_id == event.id)
    )
    if image is None:
        return False
    key = image.storage_key
    db.delete(image)
    db.flush()
    # Close the gap so positions stay 0..n-1 and position 0 is always the cover.
    for position, remaining in enumerate(list_images(db, event.id)):
        remaining.position = position
    _sync_cover(db, event)
    db.commit()
    storage.delete(key)
    return True


def update_image_alt(
    db: Session, event: Event, image_id: int, alt_text: str | None
) -> EventImage | None:
    db.refresh(event, with_for_update=True)
    _ensure_editable(event)
    image = db.scalar(
        select(EventImage).where(EventImage.id == image_id, EventImage.event_id == event.id)
    )
    if image is None:
        return None
    image.alt_text = alt_text
    db.commit()
    db.refresh(image)
    return image


def reorder_images(db: Session, event: Event, image_ids: list[int]) -> Sequence[EventImage]:
    db.refresh(event, with_for_update=True)
    _ensure_editable(event)
    existing = list(list_images(db, event.id))
    by_id = {img.id: img for img in existing}
    if set(image_ids) != set(by_id) or len(image_ids) != len(by_id):
        raise ValueError("image_ids must list every image of this event exactly once")
    for position, image_id in enumerate(image_ids):
        by_id[image_id].position = position
    db.flush()
    _sync_cover(db, event)
    db.commit()
    return list_images(db, event.id)


def _sync_cover(db: Session, event: Event) -> None:
    first = db.scalar(
        select(EventImage.url)
        .where(EventImage.event_id == event.id)
        .order_by(EventImage.position, EventImage.id)
    )
    event.cover_image_url = first
