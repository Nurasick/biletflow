from collections.abc import Sequence

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from app.api.deps import DbSession, OwnedEvent
from app.core.config import settings
from app.models.event_image import EventImage
from app.schemas.event import EventImageRead
from app.services import event_image as image_service
from app.services import storage

router = APIRouter(tags=["events"])


class ImageUpload(BaseModel):
    # A data URL, the form the web editor already holds images in. Bounded a
    # little above MAX_IMAGE_BYTES in base64 so a huge body fails validation
    # before anything is decoded.
    data_url: str = Field(max_length=(settings.MAX_IMAGE_BYTES * 4) // 3 + 64)


@router.get("/organizer/events/{event_id}/images", response_model=list[EventImageRead])
def list_images(event: OwnedEvent, db: DbSession) -> Sequence[EventImage]:
    return image_service.list_images(db, event.id)


@router.post(
    "/organizer/events/{event_id}/images",
    response_model=EventImageRead,
    status_code=status.HTTP_201_CREATED,
)
def upload_image(event: OwnedEvent, data: ImageUpload, db: DbSession) -> EventImage:
    """Add a JPEG, PNG or WebP (up to 2 MB, up to 5 per event). The first image
    is the cover. The type is checked from the file's bytes, not its name."""
    try:
        return image_service.add_image(db, event, data.data_url)
    except storage.InvalidImage as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.reason) from None
    except image_service.TooManyImages:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An event can have at most {settings.MAX_EVENT_IMAGES} images",
        ) from None
    except image_service.EventClosedForChanges:
        raise HTTPException(status.HTTP_409_CONFLICT, "A cancelled event cannot change") from None


@router.delete(
    "/organizer/events/{event_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_image(event: OwnedEvent, image_id: int, db: DbSession) -> Response:
    if not image_service.delete_image(db, event, image_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
