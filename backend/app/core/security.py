import hashlib
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


def create_access_token(subject: str | int, expires_delta: timedelta | None = None) -> str:
    delta = expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return _create_token(subject, "access", delta)


def create_refresh_token(
    subject: str | int,
    expires_delta: timedelta | None = None,
    csrf: str | None = None,
) -> str:
    """A refresh token, optionally bound to a CSRF value.

    The claim is only set when the token will be delivered as a cookie: it is
    the value the caller must echo back in a header to prove the request came
    from our own frontend rather than from a cross-site form.
    """
    delta = expires_delta or timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    return _create_token(subject, "refresh", delta, {"csrf": csrf} if csrf else None)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])


def generate_url_token() -> str:
    return secrets.token_urlsafe(32)


def hash_url_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode()).hexdigest()
