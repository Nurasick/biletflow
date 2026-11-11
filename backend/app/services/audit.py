"""The audit log: one way in, read-only ways out.

There is intentionally no update or delete function in this module. §4.16:
"Audit entries shall not be editable or deletable through normal organizer
interfaces." Not "we promise not to call it": the function does not exist.
"""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.user import User


def record(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: int,
    summary: str,
    event_id: int | None = None,
    actor: User | None = None,
    payload: dict | None = None,
) -> AuditLog:
    """Append one row inside the caller's transaction. Does not commit.

    Writing in the same transaction as the change it describes is the whole
    design: a rolled-back publish leaves no "event.published" row behind, and
    a committed one can never be missing its row.
    """
    entry = AuditLog(
        event_id=event_id,
        actor_user_id=actor.id if actor is not None else None,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        summary=summary,
        payload=payload,
    )
    db.add(entry)
    return entry


def with_actor_names(db: Session, entries: Sequence[AuditLog]) -> list[dict]:
    """The entries as dicts with `actor_name` filled in (§4.16 "acting user").

    One query for all the actors on the page, not one per row.
    """
    ids = {entry.actor_user_id for entry in entries if entry.actor_user_id is not None}
    names = {}
    if ids:
        names = {
            user_id: f"{first} {last}"
            for user_id, first, last in db.execute(
                select(User.id, User.first_name, User.last_name).where(User.id.in_(ids))
            )
        }
    return [
        {
            "id": entry.id,
            "created_at": entry.created_at,
            "actor_user_id": entry.actor_user_id,
            "actor_name": names.get(entry.actor_user_id),
            "action": entry.action,
            "entity_type": entry.entity_type,
            "entity_id": entry.entity_id,
            "summary": entry.summary,
            "payload": entry.payload,
        }
        for entry in entries
    ]


def event_timeline(
    db: Session,
    event_id: int,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
    actions: Sequence[str] = (),
    limit: int = 100,
    offset: int = 0,
) -> Sequence[AuditLog]:
    """Newest first. The caller has already checked the user may see this event."""
    query = select(AuditLog).where(AuditLog.event_id == event_id)
    if since is not None:
        query = query.where(AuditLog.created_at >= since)
    if until is not None:
        query = query.where(AuditLog.created_at < until)
    if actions:
        query = query.where(AuditLog.action.in_(actions))
    return db.scalars(
        query.order_by(AuditLog.created_at.desc(), AuditLog.id.desc()).limit(limit).offset(offset)
    ).all()
