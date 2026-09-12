from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


@compiles(BigInteger, "sqlite")
def _bigint_as_integer(type_, compiler, **kw):
    """SQLite autoincrements INTEGER PRIMARY KEY only, never BIGINT.

    Production is Postgres; this override exists so the same models can back a
    throwaway in-memory database here instead of forcing every test to run
    against a live server.
    """
    return "INTEGER"


from app.db.base import Base  # noqa: E402 - must import after the compiles() override
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402


@pytest.fixture
def client() -> Iterator[TestClient]:
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


@pytest.fixture
def db() -> Iterator[Session]:
    """A real session over an empty in-memory database, one per test."""
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


@pytest.fixture
def api(db: Session) -> Iterator[TestClient]:
    """A client whose requests hit the `db` fixture's database."""
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
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
