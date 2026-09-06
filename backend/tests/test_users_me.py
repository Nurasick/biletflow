from datetime import timedelta

from app.core.security import create_access_token, create_refresh_token
from tests.conftest import make_user

URL = "/api/v1/users/me"


def test_users_me_returns_the_authenticated_user(as_user):
    user = make_user()
    client = as_user(user)
    token = create_access_token(user.id)

    response = client.get(URL, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == user.email
    assert body["id"] == user.id
    assert "hashed_password" not in body


def test_users_me_returns_401_when_no_authorization_header(as_user):
    user = make_user()
    client = as_user(user)
    response = client.get(URL)

    assert response.status_code == 401


def test_users_me_returns_401_when_refresh_token_is_sent(as_user):

    user = make_user()
    client = as_user(user)
    token = create_refresh_token(user.id)

    response = client.get(URL, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_users_me_returns_401_when_access_token_is_expired(as_user):
    user = make_user()
    client = as_user(user)
    token = create_refresh_token(user.id, timedelta(minutes=-1))

    response = client.get(URL, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_users_me_returns_401_when_id_is_not_matching(as_user):
    user = make_user()
    client = as_user(user)
    token = create_refresh_token(999)

    response = client.get(URL, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401


def test_users_me_returns_403_when_user_is_suspended(as_user):
    user = make_user(status="suspended")
    client = as_user(user)
    token = create_access_token(user.id)

    response = client.get(URL, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 403


def test_users_me_returns_401_when_token_is_garbage(as_user):
    user = make_user()
    client = as_user(user)
    token = "not.a.token"

    response = client.get(URL, headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
