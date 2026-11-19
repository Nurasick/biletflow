"""Copy existing event photos to S3 and update their database references."""

import argparse
import sys
from base64 import b64encode
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlsplit

from botocore.exceptions import ClientError
from sqlalchemy import or_, select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import app.db.base  # noqa: E402, F401 - register ORM models
from app.core.config import settings  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.event import Event  # noqa: E402
from app.models.event_image import EventImage  # noqa: E402
from app.services import storage  # noqa: E402


def lock_events(db, photo_filter):
    return db.scalars(
        select(Event)
        .where(
            or_(
                Event.id.in_(select(EventImage.event_id).where(photo_filter)),
                Event.cover_image_url.contains(f"{settings.MEDIA_URL_PATH}/events/"),
            )
        )
        .order_by(Event.id)
        .with_for_update()
    ).all()


def photo_path(image: EventImage, key: str) -> Path:
    path = storage.local_path(key)
    if (
        not key.startswith(f"events/{image.event_id}/")
        or path.relative_to(storage.media_root()).as_posix() != key
    ):
        raise ValueError(f"Unexpected local path for event photo {image.id}: {key}")
    return path


def verify_copy(client, image: EventImage, key: str, digest: bytes) -> None:
    photo = client.get_object(Bucket=settings.AWS_S3_BUCKET, Key=key)
    with photo["Body"] as body:
        if (
            photo["ContentType"] != image.content_type
            or photo["ContentLength"] != image.size_bytes
            or sha256(body.read()).digest() != digest
        ):
            raise ValueError(f"S3 object does not match local event photo {image.id}: {key}")


def migrate(client) -> None:
    local = ~EventImage.storage_key.startswith(storage.S3_PREFIX)
    with SessionLocal.begin() as db:
        events = lock_events(db, local)
        images = db.scalars(select(EventImage).where(local).order_by(EventImage.id)).all()
        cover_urls = {}

        for image in images:
            key = image.storage_key
            content = photo_path(image, key).read_bytes()
            if len(content) != image.size_bytes:
                raise ValueError(f"Local event photo {image.id} size differs from its database row")
            digest = sha256(content).digest()
            try:
                client.put_object(
                    Bucket=settings.AWS_S3_BUCKET,
                    Key=key,
                    Body=content,
                    ContentType=image.content_type,
                    ChecksumSHA256=b64encode(digest).decode("ascii"),
                    IfNoneMatch="*",
                )
            except ClientError as exc:
                if exc.response["ResponseMetadata"]["HTTPStatusCode"] != 412:
                    raise
                # A previous run may have uploaded this key before committing the database.
            verify_copy(client, image, key, digest)
            image.storage_key = storage.S3_PREFIX + key
            new_url = storage.url_for(image.storage_key)
            cover_urls[f"{settings.MEDIA_URL_PATH}/{key}"] = new_url
            image.url = new_url

        covers = 0
        for event in events:
            if event.cover_image_url and (
                url := cover_urls.get(urlsplit(event.cover_image_url).path)
            ):
                event.cover_image_url = url
                covers += 1

    print(f"Migrated and verified {len(images)} S3 event photos. Updated {covers} cover URLs.")


def delete_local(client) -> None:
    cloud = EventImage.storage_key.startswith(storage.S3_PREFIX)
    with SessionLocal.begin() as db:
        events = lock_events(db, cloud)
        if db.scalar(select(EventImage.id).where(~cloud).limit(1)) is not None:
            raise ValueError("Some event photos still use local storage. Run the migration first.")
        covers = {urlsplit(event.cover_image_url).path for event in events if event.cover_image_url}
        paths = []
        for image in db.scalars(select(EventImage).where(cloud).order_by(EventImage.id)):
            key = image.storage_key.removeprefix(storage.S3_PREFIX)
            path = photo_path(image, key)
            if not path.exists():
                continue
            if f"{settings.MEDIA_URL_PATH}/{key}" in covers or image.url != storage.url_for(
                image.storage_key
            ):
                raise ValueError(
                    f"Database still has an unexpected reference for event photo {image.id}"
                )
            content = path.read_bytes()
            if len(content) != image.size_bytes:
                raise ValueError(f"Local event photo {image.id} size differs from its database row")
            verify_copy(client, image, key, sha256(content).digest())
            paths.append(path)

        # Verify every candidate before removing any local file.
        for path in paths:
            path.unlink()

    print(f"Deleted {len(paths)} local event photos after re-verifying their S3 copies.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delete-local", action="store_true", help="remove verified local copies")
    args = parser.parse_args()
    if not settings.AWS_S3_BUCKET or not settings.AWS_REGION:
        parser.error("AWS_S3_BUCKET and AWS_REGION must be configured")
    client = storage._s3_client(settings.AWS_REGION)
    if args.delete_local:
        delete_local(client)
    else:
        migrate(client)


if __name__ == "__main__":
    main()
