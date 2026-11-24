from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

from app.core.config import settings


def build_engine(database_url: str, sslmode: str = "") -> Engine:
    """Create the SQLAlchemy engine with optional PostgreSQL TLS `sslmode` (§7)."""
    connect_args: dict[str, object] = {}
    if sslmode and database_url.startswith("postgresql"):
        connect_args["sslmode"] = sslmode
    return create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)


engine = build_engine(settings.DATABASE_URL, settings.DB_SSLMODE)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
