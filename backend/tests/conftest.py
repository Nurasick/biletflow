import os
from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import BigInteger, create_engine, text
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool


@compiles(BigInteger, "sqlite")
def _bigint_as_integer(type_, compiler, **kw):
    """SQLite autoincrements INTEGER PRIMARY KEY only, never BIGINT.

    Production is Postgres; this override exists so the same models can back a
    throwaway in-memory database locally instead of forcing every local run to
    stand up a server. In CI (or with TEST_USE_POSTGRES=1 / --postgres), the
    `db` fixture runs directly against PostgreSQL 17.
    """
    return "INTEGER"


# Before any app import reads settings: the hold sweeper would otherwise start
# with every TestClient and write to the real database in the background.
os.environ["HOLD_SWEEP_INTERVAL_SECONDS"] = "0"
# Same for the notification sender, and never hit a real email provider.
os.environ["NOTIFY_INTERVAL_SECONDS"] = "0"
os.environ["SMTP_HOST"] = ""
os.environ["RESEND_API_KEY"] = ""
os.environ["EMAIL_PROVIDER"] = "console"

from app.core.config import settings  # noqa: E402
from app.db.base import Base  # noqa: E402 - must import after the compiles() override
from app.db.session import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.user import User  # noqa: E402


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--postgres",
        action="store_true",
        default=False,
        help="Run the standard db fixture against PostgreSQL (DATABASE_URL) instead of SQLite.",
    )


def _use_postgres(request: pytest.FixtureRequest) -> bool:
    return bool(request.config.getoption("--postgres")) or os.environ.get(
        "TEST_USE_POSTGRES", ""
    ).strip().lower() in ("1", "true", "yes")


@pytest.fixture(scope="session")
def _pg_test_engine(request: pytest.FixtureRequest):
    if not _use_postgres(request):
        yield None
        return
    if not settings.DATABASE_URL.startswith("postgresql"):
        pytest.fail("TEST_USE_POSTGRES/--postgres requires a postgresql DATABASE_URL")
    engine = create_engine(
        settings.DATABASE_URL,
        pool_pre_ping=True,
        connect_args={"connect_timeout": 5, "options": "-c timezone=UTC"},
    )
    Base.metadata.create_all(engine)
    # Start a clean session with no stale rows left over from any interrupted run.
    tables = [f'"{table.name}"' for table in Base.metadata.sorted_tables]
    if tables:
        with engine.begin() as conn:
            conn.execute(text(f"TRUNCATE TABLE {', '.join(tables)} RESTART IDENTITY CASCADE"))
    try:
        yield engine
    finally:
        engine.dispose()


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

    def scalar(self, *_args, **_kwargs):
        # Every other lookup finds nothing: no organizer profile, no staff row.
        return None


@pytest.fixture
def as_user():
    def _install(user: User | None):
        app.dependency_overrides[get_db] = lambda: FakeSession(user)
        return TestClient(app)

    yield _install
    app.dependency_overrides.clear()


@pytest.fixture
def db(request: pytest.FixtureRequest, _pg_test_engine) -> Iterator[Session]:
    """A real session over an empty database, one per test.

    Uses in-memory SQLite by default for fast local feedback; switches to real
    PostgreSQL 17 (isolated per test via an outer transaction + SAVEPOINT) when
    `TEST_USE_POSTGRES=1` or `--postgres` is passed.
    """
    if _pg_test_engine is not None:
        connection = _pg_test_engine.connect()
        transaction = connection.begin()
        session = sessionmaker(
            bind=connection,
            join_transaction_mode="create_savepoint",
            autoflush=False,
            autocommit=False,
        )()
        try:
            yield session
        finally:
            session.close()
            transaction.rollback()
            connection.close()
        return

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
