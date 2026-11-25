import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

password_hash = PasswordHash.recommended()
ALGORITHM = "HS256"


def get_password_hash(plain_password: str) -> str:
    hashed_password = password_hash.hash(plain_password)
    return hashed_password


def verify_hashed_password(plain_password: str, hashed_password: str) -> bool:
    return password_hash.verify(plain_password, hashed_password)


def _create_token(
    subject: str | int,
    token_type: str,
    expires_delta: timedelta,
    extra_claims: dict | None = None,
) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(subject),
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    if extra_claims:
        payload |= extra_claims

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(
    subject: str | int,
    expires_delta: timedelta | None = None,
    *,
    token_version: int = 0,
) -> str:
    delta = expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return _create_token(
        subject,
        "access",
        delta,
        {"jti": secrets.token_hex(16), "tv": token_version},
    )


def create_refresh_token(
    subject: str | int,
    expires_delta: timedelta | None = None,
    csrf: str | None = None,
    *,
    token_version: int = 0,
) -> str:
    """A refresh token, optionally bound to a CSRF value.

    The claim is only set when the token will be delivered as a cookie: it is
    the value the caller must echo back in a header to prove the request came
    from our own frontend rather than from a cross-site form.
    """
    delta = expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    claims: dict = {"jti": secrets.token_hex(16), "tv": token_version}
    if csrf:
        claims["csrf"] = csrf
    return _create_token(subject, "refresh", delta, claims)


def create_order_token(order_id: int) -> str:
    """The signed link that lets a guest, who has no session, open their order.

    Typed "order" so it can never be replayed as an access token, and the
    reverse: resolve_token_user rejects any type but the one it expects.
    """
    return _create_token(order_id, "order", timedelta(days=settings.ORDER_LINK_EXPIRE_DAYS))


def create_support_case_token(case_id: int) -> str:
    """The signed link that lets a guest follow their support case (06-support.md).

    Typed "support_case" so it opens this one case and nothing else: not an
    order, and never a session.
    """
    return _create_token(case_id, "support_case", timedelta(days=settings.SUPPORT_LINK_EXPIRE_DAYS))


HALYK_CHECKOUT_TOKEN_TYPE = "halyk_checkout"


def create_halyk_checkout_token(payment_id: int, return_url: str) -> str:
    """The signed link to our Halyk checkout page and back (halyk_payment.py).

    It names one payment and where to send the buyer afterwards, so neither
    can be swapped in the URL. Typed, like the order token, so it opens that
    page and nothing else. An hour covers the 10-minute hold plus a slow
    3-D Secure step; after that the return link just lands on the web app.
    """
    return _create_token(
        payment_id, HALYK_CHECKOUT_TOKEN_TYPE, timedelta(hours=1), {"ret": return_url}
    )


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])


def generate_url_token() -> str:
    return secrets.token_urlsafe(32)


def hash_url_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()


def hash_event_access_code(code: str) -> str:
    """Keyed SHA-256 digest of a private event access code."""
    normalized = code.strip()
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"event-access:{normalized}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_event_access_code(code: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_event_access_code(code), stored_hash)


def create_event_access_token(event_id: int) -> str:
    """Short-lived access token minted after unlocking a private event."""
    return _create_token(event_id, "event_access", timedelta(days=7))


def create_event_invite_token(event_id: int) -> str:
    """Long-lived signed invite token an organizer shares for a private event."""
    return _create_token(event_id, "event_invite", timedelta(days=365))


def create_halyk_checkout_token(
    payment_id: int, payment_object: dict, script_url: str
) -> str:
    """Short-lived signed token for the hosted Halyk ePay HTML launcher page.

    Used by mobile WebBrowser and redirect flows so payment parameters cannot
    be tampered with in query strings.
    """
    return _create_token(
        payment_id,
        "halyk_checkout",
        timedelta(minutes=15),
        {"payment_object": payment_object, "script_url": script_url},
    )


def decode_halyk_checkout_token(token: str) -> dict:
    payload = decode_token(token)
    if payload.get("type") != "halyk_checkout":
        raise jwt.InvalidTokenError("invalid token type")
    return payload


def halyk_secret_hash(payment_id: int, invoice_id: str) -> str:
    """Keyed HMAC sent as Halyk `secret_hash` and verified on `postLink` webhooks."""
    return hmac.new(
        settings.SECRET_KEY.encode("utf-8"),
        f"halyk-epay:{payment_id}:{invoice_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()[:32]


def verify_halyk_secret_hash(payment_id: int, invoice_id: str, candidate: str) -> bool:
    if not candidate:
        return False
    return hmac.compare_digest(halyk_secret_hash(payment_id, invoice_id), candidate.strip())
