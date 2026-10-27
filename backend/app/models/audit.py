from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, ForeignKey, Identity, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base

# JSONB on Postgres; plain JSON on the SQLite database the tests run on.
PAYLOAD = JSON().with_variant(JSONB(), "postgresql")


class AuditLog(Base):
    """One row per thing that happened, never edited and never deleted (§4.16).

    No updated_at column: its absence is the point. A correction is a new row,
    the same way a check-in reversal is. The service layer exposes `record()`
    and read queries only; see app/services/audit.py.

    `event_id` is a real FK because every timeline query filters on it.
    `entity_type`/`entity_id` deliberately have no FK: one column cannot point
    at ten tables (docs/data-model/07-platform.md#the-polymorphic-problem).
    """

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    # NULL for account-level actions with no event, e.g. a profile change.
    event_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("events.id"))
    # NULL means the system did it: the hold sweeper, a payment callback.
    actor_user_id: Mapped[int | None] = mapped_column(BigInteger, ForeignKey("users.id"))
    # noun.verb_past, e.g. event.published. A filter facet in the UI, so keep
    # the vocabulary consistent (07-platform.md#action-naming).
    action: Mapped[str] = mapped_column(String(64))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int] = mapped_column(BigInteger)
    summary: Mapped[str] = mapped_column(Text)
    # Before/after values, amounts, reasons. Never names, emails or phones:
    # an append-only table is the one place personal data can never be fixed.
    payload: Mapped[dict | None] = mapped_column(PAYLOAD)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_audit_logs_event_id_created_at", "event_id", "created_at"),
        Index("ix_audit_logs_event_id_action", "event_id", "action"),
    )
