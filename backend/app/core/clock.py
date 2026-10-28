from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC)


def as_utc(value: datetime) -> datetime:
    """Postgres hands back aware datetimes. SQLite, which backs most tests,
    drops the offset, and every value this app stores is UTC."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
