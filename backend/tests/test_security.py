import re
import string
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from jwt import DecodeError, ExpiredSignatureError, InvalidSignatureError

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    generate_url_token,
    get_password_hash,
    hash_url_token,
    verify_hashed_password,
)

WRONG_KEY = "this-is-not-the-real-signing-key-but-it-is-long-enough"

# SHA-256 of "test" -- a published constant. Pins the algorithm itself.
SHA256_OF_TEST = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"


# --------------------------------------------------------------------------
# passwords
# --------------------------------------------------------------------------


def test_security_hash_and_verify_password():
    password = "correct horse"
    hashed_password = get_password_hash(password)
    assert verify_hashed_password(password, hashed_password=hashed_password)


def test_security_verify_password_returns_false_for_wrong_password():
    hashed_password = get_password_hash("correct horse")
    assert verify_hashed_password("wrong horse", hashed_password) is False


def test_security_same_password_hashes_differently_each_time():
    # argon2 salts every hash, so equal inputs must NOT produce equal output.
    assert get_password_hash("correct horse") != get_password_hash("correct horse")


def test_security_password_hash_does_not_contain_the_plaintext():
    password = "correct horse"
    assert password not in get_password_hash(password)


# --------------------------------------------------------------------------
# jwt
# --------------------------------------------------------------------------


def test_security_jwt_create_and_verify_tokens():
    sub = 1
    access_token = create_access_token(sub)
    payload_access = decode_token(access_token)
    refresh_token = create_refresh_token(sub)
    payload_refresh = decode_token(refresh_token)

    assert payload_access["sub"] == "1"
    assert payload_access["type"] == "access"
    assert payload_refresh["sub"] == "1"
    assert payload_refresh["type"] == "refresh"
    assert payload_access["exp"] < payload_refresh["exp"]


def test_security_jwt_expired_tokens_raise_error():
    sub = "1"
    access_token = create_access_token(sub, timedelta(days=-2))
    refresh_token = create_refresh_token(sub, timedelta(days=-8))

    with pytest.raises(ExpiredSignatureError):
        decode_token(access_token)
    with pytest.raises(ExpiredSignatureError):
        decode_token(refresh_token)


def test_security_jwt_check_token_with_different_key():
    now = datetime.now(UTC)
    payload = {
        "sub": "1",
        "type": "access",
        "iat": now,
        "exp": now + timedelta(hours=24),
    }
    access_token = jwt.encode(payload, WRONG_KEY, algorithm="HS256")

    with pytest.raises(InvalidSignatureError):
        decode_token(access_token)


def test_security_jwt_check_garbage_token():
    with pytest.raises(DecodeError):
        decode_token("not.a.token")


# --------------------------------------------------------------------------
# url tokens
# --------------------------------------------------------------------------


def test_security_url_tokens_produce_different_values():
    tokens = {generate_url_token() for _ in range(1000)}
    assert len(tokens) == 1000


def test_security_url_token_is_url_safe():
    # It goes into an email link unescaped, so no '+' or '/' from plain base64.
    assert re.fullmatch(r"[a-zA-Z0-9_-]+", generate_url_token())


def test_security_url_token_has_enough_entropy():
    assert len(generate_url_token()) > 40


def test_security_hash_url_token_is_deterministic():
    # The lookup finds the row BY this hash, so it must not be salted.
    token = generate_url_token()
    assert hash_url_token(token) == hash_url_token(token)


def test_security_hash_url_token_exactly_64_and_valid_hex():
    digest = hash_url_token(generate_url_token())
    assert len(digest) == 64
    assert all(c in string.hexdigits for c in digest)


def test_security_hash_url_token_different_inputs_different_hashes():
    assert hash_url_token(generate_url_token()) != hash_url_token(generate_url_token())


def test_security_hash_url_token_does_not_contain_the_raw_token():
    token = generate_url_token()
    assert token not in hash_url_token(token)


def test_security_hash_url_token_is_really_sha256():
    # Known-answer test: every other test here would still pass under SHA-1.
    assert hash_url_token("test") == SHA256_OF_TEST
