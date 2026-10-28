"""Human-facing identifiers: order numbers and ticket codes.

Both are random, not sequential: a sequence would tell anyone holding one
order number how many orders exist and let them guess their neighbours'.
"""

import secrets
from collections.abc import Callable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.order import Order
from app.models.ticket import Ticket

# Crockford base32: no I, L, O or U, so a code read aloud over the phone or
# copied off paper cannot confuse 1/I/L or 0/O.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

# Ten tries is generous: at 32^8 (about 10^12) codes, even a million tickets
# make one collision roughly a 1-in-a-million event per draw.
MAX_ATTEMPTS = 10


class CodeSpaceExhausted(Exception):
    """MAX_ATTEMPTS random draws all collided, which means something is wrong."""


def _random(length: int) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def _unique(make: Callable[[], str], taken: Callable[[str], bool]) -> str:
    # The SELECT makes a collision a retry instead of an error. Two requests
    # drawing the same fresh code in the same instant is still possible in
    # principle; the UNIQUE constraint turns that into a failed request, not
    # a duplicate, and at these odds it is not worth a savepoint loop.
    for _ in range(MAX_ATTEMPTS):
        code = make()
        if not taken(code):
            return code
    raise CodeSpaceExhausted


def new_order_number(db: Session, now: datetime) -> str:
    """BF-241130-7KQ2MX: the date helps support staff, the tail is random."""
    return _unique(
        lambda: f"BF-{now:%y%m%d}-{_random(6)}",
        lambda code: db.scalar(select(Order.id).where(Order.order_number == code)) is not None,
    )


def new_public_code(db: Session, reserved: set[str]) -> str:
    """BF-3K9P-22XM, printed on the ticket.

    `reserved` holds codes drawn earlier in the same transaction and not yet
    flushed, so one order cannot hand two of its tickets the same code.
    """

    def taken(code: str) -> bool:
        if code in reserved:
            return True
        return db.scalar(select(Ticket.id).where(Ticket.public_code == code)) is not None

    code = _unique(lambda: f"BF-{_random(4)}-{_random(4)}", taken)
    reserved.add(code)
    return code


def new_qr_nonce() -> str:
    """The per-ticket secret mixed into the signed QR (docs/data-model/qr-codes.md).

    Rotating it voids a leaked QR without changing the ticket's public_code.
    """
    return secrets.token_urlsafe(24)
