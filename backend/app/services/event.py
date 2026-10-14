from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus, EventVisibility
from app.models.organizer import OrganizerProfile
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.event import EventCreate, EventUpdate


class SlugAlreadyTaken(Exception):
    """Another event already uses this slug."""


class EventNotEditable(Exception):
    """The event is in a terminal state and can no longer change."""


class InvalidEventWindow(Exception):
    """The merged dates break one of the ordering CHECK constraints."""


class CannotPublish(Exception):
    """A guard on draft -> published failed. `reason` says which one."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def get_organizer_profile(db: Session, user: User) -> OrganizerProfile | None:
    return db.scalar(select(OrganizerProfile).where(OrganizerProfile.user_id == user.id))


def create_event(db: Session, profile: OrganizerProfile, data: EventCreate) -> Event:
    event = Event(**data.model_dump(), organizer_profile_id=profile.id)
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


def update_event(db: Session, event: Event, data: EventUpdate) -> Event:
    if event.status == EventStatus.CANCELLED:
        raise EventNotEditable
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    try:
        db.commit()
    except IntegrityError:
        # A request that moves only one end of a window cannot be checked by
        # the schema, which never sees the stored other end. The CHECK
        # constraints on the table can, so they decide.
        db.rollback()
        raise InvalidEventWindow from None
    db.refresh(event)
    return event


def publish_event(db: Session, event: Event, now: datetime | None = None) -> Event:
    """draft -> published, with the guards from docs/state-machines.md section 1.

    Venue and times are NOT NULL columns, so that guard is already enforced.
    """
    now = now or datetime.now(UTC)
    if event.status != EventStatus.DRAFT:
        raise CannotPublish(f"only a draft can be published; this event is {event.status}")
    starts_at = event.starts_at if event.starts_at.tzinfo else event.starts_at.replace(tzinfo=UTC)
    if starts_at <= now:
        raise CannotPublish("starts_at must be in the future")
    has_visible_type = db.scalar(
        select(func.count())
        .select_from(TicketType)
        .where(TicketType.event_id == event.id, TicketType.is_hidden.is_(False))
    )
    if not has_visible_type:
        raise CannotPublish("add at least one visible ticket type first")

    event.status = EventStatus.PUBLISHED
    event.published_at = now
    db.commit()
    db.refresh(event)
    return event


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


def list_public_events(db: Session, *, limit: int, offset: int) -> Sequence[Event]:
    """Published, publicly listed events that have not ended yet."""
    return db.scalars(
        select(Event)
        .where(
            Event.status == EventStatus.PUBLISHED,
            Event.visibility == EventVisibility.PUBLIC,
            Event.ends_at > func.now(),
        )
        .order_by(Event.starts_at, Event.id)
        .limit(limit)
        .offset(offset)
    ).all()


def get_event_by_slug(db: Session, slug: str) -> Event | None:
    """Any event an attendee may open by link: everything except drafts.

    Unlisted and private events are reachable by direct link by design, and
    cancelled and suspended ones must still render their notice (§4.16).
    """
    return db.scalar(select(Event).where(Event.slug == slug, Event.status != EventStatus.DRAFT))
