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
    """Cancelled events are frozen, images included."""


def list_images(db: Session, event_id: int) -> Sequence[EventImage]:
    return db.scalars(
        select(EventImage)
        .where(EventImage.event_id == event_id)
        .order_by(EventImage.position, EventImage.id)
    ).all()


def add_image(db: Session, event: Event, data_url: str) -> EventImage:
    """Validate, store, and append an image. The first one becomes the cover.

    Raises storage.InvalidImage, TooManyImages or EventClosedForChanges.
    """
    if event.status == EventStatus.CANCELLED:
        raise EventClosedForChanges
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


def _sync_cover(db: Session, event: Event) -> None:
    first = db.scalar(
        select(EventImage.url)
        .where(EventImage.event_id == event.id)
        .order_by(EventImage.position, EventImage.id)
    )
    event.cover_image_url = first
