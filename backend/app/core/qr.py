"""Signed QR payloads for admission tickets (docs/data-model/qr-codes.md).

    BF1.adm.BF-3K9P-22XM.42.<nonce>.<signature>
     │   │        │       │    │         └─ HMAC-SHA256, first 16 bytes, base64url
     │   │        │       │    └─ tickets.qr_nonce: rotate it to void one QR
     │   │        │       └─ events.id: wrong-event scans fail before any query
     │   │        └─ tickets.public_code
     │   └─ typ: "adm" for admission. The scanner accepts nothing else (§11).
     └─ key version: rotate SECRET_KEY by adding BF2 without voiding printed tickets

Tamper resistance comes from the signature, not from secrecy (§4.7): change
any field and the HMAC no longer matches. Nothing personal is in the payload,
because QR codes get photographed and posted.

Not a JWT on purpose: the JSON header and claims would roughly triple the
length, and a longer payload means a denser QR that scans worse from paper.
"""

import base64
import hashlib
import hmac
from dataclasses import dataclass
from typing import Literal

from app.core.config import settings

VERSION = "BF1"
ADMISSION = "adm"
CAMPAIGN = "cmp"

Typ = Literal["adm", "cmp"]


@dataclass(frozen=True)
class Claims:
    typ: str
    public_code: str
    event_id: int
    nonce: str


def _key() -> bytes:
    # Derived rather than SECRET_KEY itself, so a QR signature can never be
    # confused with, or replayed as, any other signature the app makes.
    return hashlib.sha256(f"{settings.SECRET_KEY}|qr|{VERSION}".encode()).digest()


def _signature(body: str) -> str:
    digest = hmac.new(_key(), body.encode(), hashlib.sha256).digest()[:16]
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def sign(typ: Typ, public_code: str, event_id: int, nonce: str) -> str:
    body = f"{VERSION}.{typ}.{public_code}.{event_id}.{nonce}"
    return f"{body}.{_signature(body)}"


def verify(text: str) -> Claims | None:
    """The claims if the signature is genuine, else None. Does not check typ:
    the scanner does that as its own step, so the order in qr-codes.md stays
    visible in one place."""
    parts = text.strip().split(".")
    if len(parts) != 6 or parts[0] != VERSION:
        return None
    body, supplied = ".".join(parts[:5]), parts[5]
    # compare_digest: a plain == leaks, through timing, how many leading
    # characters of a forged signature were right.
    if not hmac.compare_digest(_signature(body), supplied):
        return None
    _, typ, public_code, event_id, nonce = parts[:5]
    try:
        return Claims(typ, public_code, int(event_id), nonce)
    except ValueError:
        return None
