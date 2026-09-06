from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.db.session import get_db
from app.main import app
from app.models.user import User


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


class FakeSession:
    def __init__(self, user: User | None):
        self._user = user

    def get(self, model, pk):
        if self._user is not None and pk == self._user.id:
            return self._user
        return None


@pytest.fixture
def as_user():
    def _install(user: User | None):
        app.dependency_overrides[get_db] = lambda: FakeSession(user)
        return TestClient(app)

    yield _install
    app.dependency_overrides.clear()


def make_user(**overrides) -> User:
    defaults = dict(
        id=1,
        email="abai@example.com",
        hashed_password="$argon2id$fake",
        first_name="Abai",
        last_name="Kunanbayev",
        phone=None,
        is_email_verified=True,
        is_platform_admin=False,
        status="active",
        locale="kk",
        created_at=datetime.now(UTC),
    )
    return User(**(defaults | overrides))
