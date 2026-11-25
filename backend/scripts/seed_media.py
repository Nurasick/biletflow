"""Event pictures for seed_demo.py.

Photos live in seed_assets/events/<slug>/, one file per image, named by its
position (0 is the cover): 0.webp, 1.png, ... An event with no folder gets a
generated abstract poster instead, so the seed never depends on the assets.
"""

import io
from pathlib import Path

from PIL import Image, ImageDraw
from sqlalchemy.orm import Session

from app.models.event import Event, EventCategory
from app.models.event_image import EventImage
from app.services import storage

ASSETS = Path(__file__).resolve().parent / "seed_assets" / "events"
IMAGE_TYPES = {".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg"}

Colours = tuple[tuple[int, int, int], tuple[int, int, int]]

# Poster colours for events that have no photo.
PALETTES: dict[EventCategory, Colours] = {
    EventCategory.CONCERT: ((217, 67, 31), (16, 24, 40)),
    EventCategory.CONFERENCE: ((32, 138, 239), (16, 24, 40)),
    EventCategory.SPORT: ((2, 122, 72), (245, 245, 240)),
    EventCategory.THEATER: ((127, 86, 217), (253, 176, 34)),
    EventCategory.OTHER: ((102, 112, 133), (208, 213, 221)),
}


def poster(colour_a: tuple[int, int, int], colour_b: tuple[int, int, int], seed: int) -> bytes:
    """A 600x900 abstract poster: a two-colour gradient with a few circles.
    No text, so it needs no font and never spells a title wrong."""
    width, height = 600, 900
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / height
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(int(a + (b - a) * t) for a, b in zip(colour_a, colour_b, strict=True)),
        )
    for i in range(5):
        radius = 60 + ((seed * 37 + i * 53) % 140)
        cx = (seed * 97 + i * 151) % width
        cy = (seed * 61 + i * 211) % height
        shade = tuple(min(255, c + 28) for c in (colour_a if i % 2 else colour_b))
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=shade, width=6)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def photos(slug: str) -> list[tuple[bytes, str]]:
    """The event's photos from seed_assets, in display order."""
    folder = ASSETS / slug
    if not folder.is_dir():
        return []
    files = sorted(
        (path for path in folder.iterdir() if path.suffix in IMAGE_TYPES),
        key=lambda path: int(path.stem),
    )
    return [(path.read_bytes(), IMAGE_TYPES[path.suffix]) for path in files]


def attach_images(db: Session, event: Event, colours: Colours | None = None) -> None:
    """Store the event's photos (or a generated poster) and set the cover.
    The event must already be flushed, so it has an id for the storage key."""
    palette = colours or PALETTES[EventCategory(event.category)]
    images = photos(event.slug) or [(poster(*palette, seed=event.id), "image/png")]
    for position, (content, content_type) in enumerate(images):
        key, url = storage.save(f"events/{event.id}", content, content_type)
        db.add(
            EventImage(
                event_id=event.id,
                storage_key=key,
                url=url,
                content_type=content_type,
                size_bytes=len(content),
                position=position,
            )
        )
        if position == 0:
            event.cover_image_url = url
