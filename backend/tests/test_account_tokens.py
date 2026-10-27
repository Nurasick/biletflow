"""Password reset and email verification (§4.1). The checklist item in
01-identity.md: user_tokens are single-use and expire."""

import re
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.core.clock import utcnow
from app.models.token import UserToken
from app.models.user import User
from app.services import account_tokens, mailer
from tests.test_events import add_user


@pytest.fixture(autouse=True)
def empty_outbox():
    mailer.outbox.clear()
    yield
    mailer.outbox.clear()


def link_token() -> str:
    return re.search(r"token=([\w-]+)", mailer.outbox[-1].body).group(1)


def test_reset_request_is_202_whether_or_not_the_account_exists(api, db):
    add_user(db, "real@example.com")

    known = api.post("/api/v1/auth/password-reset", json={"email": "REAL@example.com"})
    unknown = api.post("/api/v1/auth/password-reset", json={"email": "ghost@example.com"})

    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json()
    assert [m.to for m in mailer.outbox] == ["real@example.com"]


def test_a_reset_link_works_once_and_the_new_password_logs_in(api, db):
    add_user(db, "real@example.com")
    api.post("/api/v1/auth/password-reset", json={"email": "real@example.com"})
    token = link_token()

    first = api.post(
        "/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "brand-new-pw"}
    )
    second = api.post(
        "/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "other-pw-123"}
    )
    login = api.post(
        "/api/v1/auth/login",
        json={"email": "real@example.com", "password": "brand-new-pw"},
        headers={"X-Auth-Mode": "bearer"},
    )

    assert first.status_code == 204
    assert second.status_code == 400
    assert login.status_code == 200


def test_an_expired_reset_link_is_refused(api, db):
    add_user(db, "real@example.com")
    api.post("/api/v1/auth/password-reset", json={"email": "real@example.com"})
    token = link_token()
    row = db.scalar(select(UserToken))
    row.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    response = api.post(
        "/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "brand-new-pw"}
    )

    assert response.status_code == 400


def test_a_newer_link_retires_the_older_one(api, db):
    add_user(db, "real@example.com")
    api.post("/api/v1/auth/password-reset", json={"email": "real@example.com"})
    old = link_token()
    api.post("/api/v1/auth/password-reset", json={"email": "real@example.com"})

    response = api.post(
        "/api/v1/auth/password-reset/confirm", json={"token": old, "new_password": "brand-new-pw"}
    )

    assert response.status_code == 400


def test_only_the_hash_of_a_token_is_stored(api, db):
    user = add_user(db, "real@example.com")
    account_tokens.send_verification(db, user)

    stored = db.scalar(select(UserToken.token_hash))

    assert stored != link_token() and len(stored) == 64


def test_registration_sends_a_verification_link_that_verifies(api, db):
    api.post(
        "/api/v1/auth/register",
        json={
            "email": "new@example.com",
            "password": "long-enough",
            "first_name": "Aru",
            "last_name": "S",
            "locale": "kk",
        },
    )

    response = api.post("/api/v1/auth/verify-email", json={"token": link_token()})

    assert response.status_code == 204
    user = db.scalar(select(User).where(User.email == "new@example.com"))
    assert user.is_email_verified is True
    assert user.locale == "kk"
