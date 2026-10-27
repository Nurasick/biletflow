from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import as_utc
from app.models.event import Event, EventStatus, EventVisibility
from app.models.organizer import OrganizerProfile
from app.models.user import User
from app.schemas.event import EventCreate, EventUpdate, check_windows
from app.services import audit
from app.services.slugs import slugify


class SlugAlreadyTaken(Exception):
    """Another event already uses this slug."""


class EventNotEditable(Exception):
    """The event's status does not allow edits. `status` says which status."""

    def __init__(self, status: EventStatus):
        super().__init__(status)
        self.status = status


class InvalidEventWindow(Exception):
    """The merged dates break a window rule. `reason` says which one."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# Organizers edit drafts and published events (a published event can change,
# and §4.10 "Event updates" notifies its attendees). Suspended events are under
# a platform admin's review and cancelled ones are terminal, so both are frozen.
# The web form applies the same rule (audit finding #15).
EDITABLE = (EventStatus.DRAFT, EventStatus.PUBLISHED)

# Fields whose change is worth a timeline entry (§4.16 names capacity changes).
_AUDITED_CHANGES = ("starts_at", "ends_at", "capacity", "venue_name", "venue_address", "visibility")


def get_organizer_profile(db: Session, user: User) -> OrganizerProfile | None:
    return db.scalar(select(OrganizerProfile).where(OrganizerProfile.user_id == user.id))


def create_event(db: Session, profile: OrganizerProfile, data: EventCreate) -> Event:
    fields = data.model_dump()
    if fields["slug"] is None:
        # A generated slug picks a free variant up front. A slug the client
        # chose is used as sent, and a clash with it is the client's 409.
        fields["slug"] = unique_slug(db, slugify(data.title))
    event = Event(**fields, organizer_profile_id=profile.id)
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        # The unique index is the authority, as in create_user: a prior SELECT
        # cannot stop two requests racing for the same slug.
        db.rollback()
        raise SlugAlreadyTaken from None
    db.refresh(event)
    return event


def update_event(db: Session, event: Event, data: EventUpdate, actor: User | None = None) -> Event:
    if event.status not in EDITABLE:
        raise EventNotEditable(event.status)
    changes = data.model_dump(exclude_unset=True)
    _check_merged_windows(event, changes)

    before = {field: getattr(event, field) for field in _AUDITED_CHANGES if field in changes}
    for field, value in changes.items():
        setattr(event, field, value)
    changed = {f: v for f, v in before.items() if _differs(v, changes[f])}
    if changed:
        audit.record(
            db,
            action="event.capacity_changed" if list(changed) == ["capacity"] else "event.updated",
            entity_type="event",
            entity_id=event.id,
            event_id=event.id,
            actor=actor,
            summary="Event details changed: " + ", ".join(sorted(changed)),
            payload={
                field: {"from": _jsonable(old), "to": _jsonable(changes[field])}
                for field, old in changed.items()
            },
        )
    try:
        db.commit()
    except IntegrityError:
        # The CHECK constraints on the table are the final authority on the
        # windows the merged check above might have missed in a race.
        db.rollback()
        raise InvalidEventWindow("the dates conflict with each other") from None
    db.refresh(event)
    return event


def _check_merged_windows(event: Event, changes: dict) -> None:
    """The schema only sees the request; the rule applies to request + stored row."""

    def merged(field: str) -> datetime | None:
        value = changes.get(field, getattr(event, field))
        return as_utc(value) if value is not None else None

    try:
        check_windows(
            merged("starts_at"),
            merged("ends_at"),
            merged("registration_opens_at"),
            merged("registration_closes_at"),
        )
    except ValueError as exc:
        raise InvalidEventWindow(str(exc)) from None


def _differs(old, new) -> bool:
    if isinstance(old, datetime) and isinstance(new, datetime):
        return as_utc(old) != as_utc(new)
    return old != new


def _jsonable(value):
    return as_utc(value).isoformat() if isinstance(value, datetime) else value


def unique_slug(db: Session, base: str) -> str:
    """`base`, or `base-2`, `base-3`… whichever is free. For copies, not user input."""
    base = base[:190]
    taken = set(db.scalars(select(Event.slug).where(Event.slug.like(f"{base}%"))))
    if base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


def get_owned_event(db: Session, profile: OrganizerProfile, event_id: int) -> Event | None:
    return db.scalar(
        select(Event).where(Event.id == event_id, Event.organizer_profile_id == profile.id)
    )


def list_organizer_events(db: Session, profile: OrganizerProfile) -> Sequence[Event]:
    return db.scalars(
        select(Event)
        .where(Event.organizer_profile_id == profile.id)
        .order_by(Event.starts_at.desc(), Event.id.desc())
    ).all()


def list_public_events(
    db: Session,
    *,
    limit: int,
    offset: int,
    q: str | None = None,
    category: str | None = None,
    starts_after: datetime | None = None,
    starts_before: datetime | None = None,
) -> Sequence[Event]:
    """Published, publicly listed events that have not ended yet."""
    query = select(Event).where(
        Event.status == EventStatus.PUBLISHED,
        Event.visibility == EventVisibility.PUBLIC,
        Event.ends_at > func.now(),
    )
    if q:
        # Escape LIKE's wildcards so a search for "100%" means the text "100%".
        needle = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(
            or_(
                Event.title.ilike(needle, escape="\\"),
                Event.venue_name.ilike(needle, escape="\\"),
            )
        )
    if category:
        query = query.where(Event.category == category)
    if starts_after:
        query = query.where(Event.starts_at >= starts_after)
    if starts_before:
        query = query.where(Event.starts_at < starts_before)
    return db.scalars(query.order_by(Event.starts_at, Event.id).limit(limit).offset(offset)).all()


def get_event_by_slug(db: Session, slug: str) -> Event | None:
    """Any event an attendee may open by link: everything except drafts.

    Unlisted and private events are reachable by direct link by design, and
    cancelled and suspended ones must still render their notice (§4.16).
    """
    return db.scalar(select(Event).where(Event.slug == slug, Event.status != EventStatus.DRAFT))
