from collections.abc import Sequence

from fastapi import APIRouter, HTTPException, Response, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, OwnedEvent
from app.core.config import settings
from app.models.event_image import EventImage
from app.schemas.event import EventImageRead
from app.services import event_image as image_service
from app.services import storage

router = APIRouter(tags=["events"])
media_router = APIRouter(prefix=f"{settings.MEDIA_URL_PATH}/{storage.S3_PREFIX.rstrip('/')}")


class ImageUpload(BaseModel):
    # A data URL, the form the web editor already holds images in. Bounded a
    # little above MAX_IMAGE_BYTES in base64 so a huge body fails validation
    # before anything is decoded.
    data_url: str = Field(max_length=(settings.MAX_IMAGE_BYTES * 4) // 3 + 64)
    alt_text: str | None = Field(default=None, max_length=300)


class ImageUpdate(BaseModel):
    alt_text: str | None = Field(default=None, max_length=300)


class ImageReorder(BaseModel):
    image_ids: list[int] = Field(min_length=1, max_length=settings.MAX_EVENT_IMAGES)


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
        return image_service.add_image(db, event, data.data_url, alt_text=data.alt_text)
    except storage.InvalidImage as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.reason) from None
    except storage.StorageUnavailable:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Image storage unavailable"
        ) from None
    except image_service.TooManyImages:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"An event can have at most {settings.MAX_EVENT_IMAGES} images",
        ) from None
    except image_service.EventClosedForChanges as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A {exc.status.value} event cannot change"
        ) from None


@router.put("/organizer/events/{event_id}/images/order", response_model=list[EventImageRead])
def reorder_images(event: OwnedEvent, data: ImageReorder, db: DbSession) -> Sequence[EventImage]:
    """Reorder gallery images; position 0 becomes the cover image."""
    try:
        return image_service.reorder_images(db, event, data.image_ids)
    except image_service.EventClosedForChanges as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A {exc.status.value} event cannot change"
        ) from None
    except ValueError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from None


@router.patch("/organizer/events/{event_id}/images/{image_id}", response_model=EventImageRead)
def update_image(event: OwnedEvent, image_id: int, data: ImageUpdate, db: DbSession) -> EventImage:
    try:
        image = image_service.update_image_alt(db, event, image_id, data.alt_text)
    except image_service.EventClosedForChanges as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A {exc.status.value} event cannot change"
        ) from None
    if image is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return image


@router.delete(
    "/organizer/events/{event_id}/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_image(event: OwnedEvent, image_id: int, db: DbSession) -> Response:
    try:
        removed = image_service.delete_image(db, event, image_id)
    except image_service.EventClosedForChanges as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A {exc.status.value} event cannot change"
        ) from None
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@media_router.get("/{path:path}", include_in_schema=False)
def serve_s3_image(path: str, db: DbSession) -> RedirectResponse:
    key = storage.S3_PREFIX + path
    if db.scalar(select(EventImage.id).where(EventImage.storage_key == key)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    try:
        url = storage.s3_read_url(key)
    except storage.StorageUnavailable:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Image storage unavailable"
        ) from None
    return RedirectResponse(url, headers={"Cache-Control": "no-store"})
