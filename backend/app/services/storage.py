"""File storage for uploaded images. Local disk now; S3-compatible later (§9).

Only this module knows where bytes live. Callers hand it bytes and get back a
storage key and a public URL, so swapping the backend means rewriting the three
functions below and nothing else.
"""

import base64
import binascii
import re
import secrets
from pathlib import Path

from app.core.config import settings

# Recognised by content, never by the name or the declared type: a file called
# photo.png that is really HTML must not be served back as an image.
_SIGNATURES = {
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda b: len(b) >= 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP",
}
_EXTENSIONS = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
_DATA_URL = re.compile(r"^data:(image/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$")


class InvalidImage(Exception):
    """Not a JPEG, PNG or WebP, too large, or not decodable. `reason` says which."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def decode_data_url(data_url: str) -> tuple[bytes, str]:
    """`data:image/png;base64,...` -> (bytes, content type), checked both ways.

    The web form already holds images as data URLs (eventSchema.ts), so the API
    takes them as they are rather than asking the client to re-encode.
    """
    match = _DATA_URL.match(data_url)
    if match is None:
        raise InvalidImage("expected a base64 data URL of a JPEG, PNG or WebP image")
    declared, payload = match.groups()
    # Reject before decoding: base64 inflates by 4/3, so this bounds memory.
    if len(payload) > (settings.MAX_IMAGE_BYTES * 4) // 3 + 4:
        raise InvalidImage(f"images are limited to {settings.MAX_IMAGE_BYTES // (1024 * 1024)} MB")
    try:
        content = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        raise InvalidImage("the image data is not valid base64") from None
    if not content or len(content) > settings.MAX_IMAGE_BYTES:
        raise InvalidImage(f"images are limited to {settings.MAX_IMAGE_BYTES // (1024 * 1024)} MB")
    if not _SIGNATURES[declared](content):
        raise InvalidImage("the file content does not match its declared image type")
    return content, declared


def save(prefix: str, content: bytes, content_type: str) -> tuple[str, str]:
    """Store `content` under a fresh random name. Returns (storage_key, public_url)."""
    key = f"{prefix}/{secrets.token_hex(16)}.{_EXTENSIONS[content_type]}"
    path = _path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    return key, url_for(key)


def delete(key: str) -> None:
    # Missing is fine: the row is the record, the file is best effort.
    _path(key).unlink(missing_ok=True)


def url_for(key: str) -> str:
    return f"{settings.PUBLIC_API_URL.rstrip('/')}{settings.MEDIA_URL_PATH}/{key}"


def media_root() -> Path:
    return Path(settings.MEDIA_ROOT).resolve()


def _path(key: str) -> Path:
    root = media_root()
    path = (root / key).resolve()
    # Keys are generated here, never taken from a client, but a key that
    # escaped the media root would be a path traversal, so refuse it outright.
    if root not in path.parents:
        raise ValueError(f"storage key escapes the media root: {key!r}")
    return path
