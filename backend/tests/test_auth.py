from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, create_refresh_token
from app.models.user import User, UserStatus

REGISTER = "/api/v1/auth/register"
LOGIN = "/api/v1/auth/login"
REFRESH = "/api/v1/auth/refresh"
LOGOUT = "/api/v1/auth/logout"
ME = "/api/v1/users/me"

PASSWORD = "abaiqunanbaiuly"


def registration_payload(**overrides) -> dict:
    return (
        dict(
            email="abai@example.com",
            password=PASSWORD,
            first_name="Abai",
            last_name="Kunanbayev",
            locale="kk",
        )
        | overrides
    )


@pytest.fixture
def registered(api: TestClient) -> dict:
    """An account that exists, created through the public endpoint."""
    response = api.post(REGISTER, json=registration_payload())
    assert response.status_code == 201
    return response.json()


def login(api: TestClient, *, mode: str = "bearer", **overrides) -> Response:
    """Log in. Defaults to bearer mode, where both tokens come back in the body.

    Browsers use the default cookie mode instead; `mode="cookie"` omits the
    opt-out header to exercise it.
    """
    payload = dict(email="abai@example.com", password=PASSWORD) | overrides
    headers = {"X-Auth-Mode": "bearer"} if mode == "bearer" else {}
    return api.post(LOGIN, json=payload, headers=headers)


def set_cookie_header(response: Response, name: str) -> str:
    """The raw Set-Cookie line for `name`, so attributes can be asserted on."""
    for header in response.headers.get_list("set-cookie"):
        if header.startswith(f"{name}="):
            return header
    raise AssertionError(f"no {name} cookie in {response.headers.get_list('set-cookie')}")


def suspend(db: Session, email: str = "abai@example.com") -> None:
    user = db.scalar(select(User).where(User.email == email))
    assert user is not None
    user.status = UserStatus.SUSPENDED
    db.commit()


# --- register ---------------------------------------------------------------


def test_register_creates_an_active_unverified_account(api):
    response = api.post(REGISTER, json=registration_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "abai@example.com"
    assert body["status"] == "active"
    assert body["is_email_verified"] is False
    assert body["id"]


def test_register_never_returns_the_password(api):
    response = api.post(REGISTER, json=registration_payload())

    assert "password" not in response.json()
    assert "hashed_password" not in response.json()


def test_register_stores_the_password_hashed(api, db):
    api.post(REGISTER, json=registration_payload())

    user = db.scalar(select(User).where(User.email == "abai@example.com"))
    assert user.hashed_password != PASSWORD
    assert PASSWORD not in user.hashed_password


def test_register_lowercases_the_email(api, db):
    response = api.post(REGISTER, json=registration_payload(email="ABAI@Example.COM"))

    assert response.json()["email"] == "abai@example.com"
    assert db.scalar(select(User).where(User.email == "abai@example.com")) is not None


def test_register_rejects_an_email_that_is_already_taken(api, registered):
    response = api.post(REGISTER, json=registration_payload())

    assert response.status_code == 409


def test_register_rejects_an_email_that_differs_only_in_case(api, registered):
    response = api.post(REGISTER, json=registration_payload(email="ABAI@EXAMPLE.COM"))

    assert response.status_code == 409


def test_register_rejects_a_short_password(api):
    response = api.post(REGISTER, json=registration_payload(password="short"))

    assert response.status_code == 422


def test_register_rejects_an_unsupported_locale(api):
    response = api.post(REGISTER, json=registration_payload(locale="de"))

    assert response.status_code == 422


# --- login ------------------------------------------------------------------


def test_login_returns_a_bearer_token_pair(api, registered):
    response = login(api)

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["access_token"] != body["refresh_token"]


def test_login_access_token_authenticates_users_me(api, registered):
    token = login(api).json()["access_token"]

    response = api.get(ME, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "abai@example.com"


def test_login_is_case_insensitive_on_the_email(api, registered):
    response = login(api, email="ABAI@Example.COM")

    assert response.status_code == 200


def test_login_returns_401_for_a_wrong_password(api, registered):
    response = login(api, password="wrong-but-long-enough")

    assert response.status_code == 401


def test_login_returns_401_for_an_unknown_email(api):
    response = login(api, email="nobody@example.com")

    assert response.status_code == 401


def test_login_does_not_reveal_whether_the_email_exists(api, registered):
    unknown = login(api, email="nobody@example.com")
    wrong_password = login(api, password="wrong-but-long-enough")

    assert unknown.status_code == wrong_password.status_code
    assert unknown.json()["detail"] == wrong_password.json()["detail"]


def test_login_returns_403_when_the_account_is_suspended(api, db, registered):
    suspend(db)

    response = login(api)

    assert response.status_code == 403


def test_login_hides_suspension_from_someone_without_the_password(api, db, registered):
    suspend(db)

    response = login(api, password="wrong-but-long-enough")

    assert response.status_code == 401


# --- refresh ----------------------------------------------------------------


def test_refresh_returns_a_usable_new_pair(api, registered):
    refresh_token = login(api).json()["refresh_token"]

    response = api.post(REFRESH, json={"refresh_token": refresh_token})

    assert response.status_code == 200
    new_access = response.json()["access_token"]
    assert api.get(ME, headers={"Authorization": f"Bearer {new_access}"}).status_code == 200


def test_refresh_rejects_an_access_token(api, registered):
    access_token = login(api).json()["access_token"]

    response = api.post(REFRESH, json={"refresh_token": access_token})

    assert response.status_code == 401


def test_refresh_rejects_a_garbage_token(api, registered):
    response = api.post(REFRESH, json={"refresh_token": "not.a.token"})

    assert response.status_code == 401


def test_refresh_rejects_an_expired_token(api, registered):
    expired = create_refresh_token(registered["id"], timedelta(minutes=-1))

    response = api.post(REFRESH, json={"refresh_token": expired})

    assert response.status_code == 401


def test_refresh_rejects_a_token_for_a_user_that_does_not_exist(api):
    response = api.post(REFRESH, json={"refresh_token": create_refresh_token(999)})

    assert response.status_code == 401


def test_refresh_returns_403_when_the_account_was_suspended_after_login(api, db, registered):
    refresh_token = login(api).json()["refresh_token"]
    suspend(db)

    response = api.post(REFRESH, json={"refresh_token": refresh_token})

    assert response.status_code == 403


# --- logout -----------------------------------------------------------------


def test_logout_returns_204_for_an_authenticated_caller(api, registered):
    token = login(api).json()["access_token"]

    response = api.post(LOGOUT, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 204


def test_logout_returns_401_without_a_token(api, registered):
    response = api.post(LOGOUT)

    assert response.status_code == 401


def test_logout_returns_403_for_a_suspended_caller(api, db, registered):
    token = create_access_token(registered["id"])
    suspend(db)

    response = api.post(LOGOUT, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403


# --- cookie mode ------------------------------------------------------------


def test_login_defaults_to_setting_an_httponly_refresh_cookie(api, registered):
    response = login(api, mode="cookie")

    assert response.status_code == 200
    cookie = set_cookie_header(response, "refresh_token")
    assert "HttpOnly" in cookie
    assert "Path=/api/v1/auth" in cookie
    assert "SameSite=lax" in cookie.replace("samesite", "SameSite")


def test_login_in_cookie_mode_keeps_the_refresh_token_out_of_the_body(api, registered):
    body = login(api, mode="cookie").json()

    assert body["refresh_token"] is None
    assert body["access_token"]
    assert body["csrf_token"]


def test_login_in_bearer_mode_returns_the_refresh_token_and_sets_no_cookies(api, registered):
    response = login(api, mode="bearer")

    assert response.json()["refresh_token"]
    assert response.json()["csrf_token"] is None
    assert response.headers.get_list("set-cookie") == []


def test_refresh_reads_the_cookie_when_the_body_has_no_token(api, registered):
    csrf = login(api, mode="cookie").json()["csrf_token"]

    response = api.post(REFRESH, headers={"X-CSRF-Token": csrf})

    assert response.status_code == 200
    new_access = response.json()["access_token"]
    assert api.get(ME, headers={"Authorization": f"Bearer {new_access}"}).status_code == 200


def test_refresh_by_cookie_rejects_a_missing_csrf_header(api, registered):
    login(api, mode="cookie")

    response = api.post(REFRESH)

    assert response.status_code == 403


def test_refresh_by_cookie_rejects_a_mismatched_csrf_header(api, registered):
    login(api, mode="cookie")

    response = api.post(REFRESH, headers={"X-CSRF-Token": "not-the-right-value"})

    assert response.status_code == 403


def test_refresh_by_cookie_rotates_the_cookie(api, registered):
    first = login(api, mode="cookie")
    old_cookie = set_cookie_header(first, "refresh_token")
    csrf = first.json()["csrf_token"]

    second = api.post(REFRESH, headers={"X-CSRF-Token": csrf})

    assert second.status_code == 200
    assert set_cookie_header(second, "refresh_token") != old_cookie


def test_refresh_in_bearer_mode_needs_no_csrf_header(api, registered):
    refresh_token = login(api, mode="bearer").json()["refresh_token"]

    response = api.post(REFRESH, json={"refresh_token": refresh_token})

    assert response.status_code == 200


def test_logout_clears_the_refresh_cookie(api, registered):
    access = login(api, mode="cookie").json()["access_token"]

    response = api.post(LOGOUT, headers={"Authorization": f"Bearer {access}"})

    assert response.status_code == 204
    cleared = set_cookie_header(response, "refresh_token")
    assert 'refresh_token=""' in cleared or "refresh_token=;" in cleared
    assert "Max-Age=0" in cleared or "expires=" in cleared.lower()
