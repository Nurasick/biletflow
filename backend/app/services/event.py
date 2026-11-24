from collections.abc import Sequence
from datetime import datetime

from jwt import InvalidTokenError
from sqlalchemy import exists, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import as_utc
from app.core.config import settings
from app.core.security import (
    create_event_access_token,
    create_event_invite_token,
    decode_token,
    hash_event_access_code,
    verify_event_access_code,
)
from app.models.event import Event, EventStatus, EventVisibility
from app.models.organizer import OrganizerProfile
from app.models.staff import StaffAssignment
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.event import EventCreate, EventUpdate, check_windows
from app.services import audit, notify
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


class CapacityBelowCommitted(Exception):
    """Event capacity would drop below tickets already sold or reserved."""

    def __init__(self, committed: int):
        super().__init__(committed)
        self.committed = committed


# Organizers edit drafts and published events (a published event can change,
# and §4.10 "Event updates" notifies its attendees). Suspended events are under
# a platform admin's review and cancelled ones are terminal, so both are frozen.
# The web form applies the same rule (audit finding #15).
EDITABLE = (EventStatus.DRAFT, EventStatus.PUBLISHED)

# Fields whose change is worth a timeline entry (§4.16 names capacity changes)
# and ticket-holder notification when published (§4.10).
_AUDITED_CHANGES = (
    "title",
    "description",
    "timezone",
    "starts_at",
    "ends_at",
    "capacity",
    "venue_name",
    "venue_address",
    "venue_city",
    "visibility",
    "refund_policy",
    "refunds_allowed",
    "refund_cutoff_hours_before_start",
)


def get_organizer_profile(db: Session, user: User) -> OrganizerProfile | None:
    return db.scalar(select(OrganizerProfile).where(OrganizerProfile.user_id == user.id))


def create_event(
    db: Session, profile: OrganizerProfile, data: EventCreate, actor: User | None = None
) -> Event:
    fields = data.model_dump(exclude={"access_code"})
    if fields["slug"] is None:
        # A generated slug picks a free variant up front. A slug the client
        # chose is used as sent, and a clash with it is the client's 409.
        fields["slug"] = unique_slug(db, slugify(data.title))
    if data.access_code:
        fields["access_code_hash"] = hash_event_access_code(data.access_code)
    event = Event(**fields, organizer_profile_id=profile.id)
    db.add(event)
    try:
        db.flush()
    except IntegrityError:
        # The unique index is the authority, as in create_user: a prior SELECT
        # cannot stop two requests racing for the same slug.
        db.rollback()
        raise SlugAlreadyTaken from None
    audit.record(
        db,
        action="event.created",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor=actor,
        summary="Event draft created",
        payload={"visibility": str(event.visibility), "seating_mode": str(event.seating_mode)},
    )
    db.commit()
    db.refresh(event)
    return event


def update_event(db: Session, event: Event, data: EventUpdate, actor: User | None = None) -> Event:
    if event.status not in EDITABLE:
        raise EventNotEditable(event.status)
    changes = data.model_dump(exclude_unset=True)
    access_code_provided = "access_code" in changes
    raw_access_code = changes.pop("access_code", None)
    _check_merged_windows(event, changes)

    if "capacity" in changes and changes["capacity"] is not None:
        db.refresh(event, with_for_update=True)
        committed = int(
            db.scalar(
                select(
                    func.coalesce(
                        func.sum(TicketType.quantity_sold + TicketType.quantity_reserved), 0
                    )
                ).where(TicketType.event_id == event.id)
            )
            or 0
        )
        if changes["capacity"] < committed:
            raise CapacityBelowCommitted(committed)

    before = {field: getattr(event, field) for field in _AUDITED_CHANGES if field in changes}
    for field, value in changes.items():
        setattr(event, field, value)
    if access_code_provided:
        event.access_code_hash = (
            hash_event_access_code(raw_access_code) if raw_access_code else None
        )
    changed = {f: v for f, v in before.items() if _differs(v, changes[f])}
    if changed or access_code_provided:
        payload = {
            field: {"from": _jsonable(old), "to": _jsonable(changes[field])}
            for field, old in changed.items()
        }
        if access_code_provided:
            payload["access_code"] = {"updated": True, "has_access_code": event.has_access_code}
        changed_names = sorted(changed)
        audit.record(
            db,
            action="event.capacity_changed"
            if changed_names == ["capacity"] and not access_code_provided
            else "event.updated",
            entity_type="event",
            entity_id=event.id,
            event_id=event.id,
            actor=actor,
            summary="Event details changed: "
            + ", ".join(changed_names + (["access_code"] if access_code_provided else [])),
            payload=payload,
        )
        if changed and event.status == EventStatus.PUBLISHED:
            _tell_ticket_holders(db, event, changed_names)
    try:
        db.commit()
    except IntegrityError:
        # The CHECK constraints on the table are the final authority on the
        # windows the merged check above might have missed in a race.
        db.rollback()
        raise InvalidEventWindow("the dates conflict with each other") from None
    db.refresh(event)
    return event


def _tell_ticket_holders(db: Session, event: Event, changed: list[str]) -> None:
    """§4.10 "Event updates": people holding tickets hear when details of a
    published event change."""
    # Imported here: event_lifecycle imports this module.
    from app.services.event_lifecycle import ticket_holders

    for email, user_id in ticket_holders(db, event):
        notify.notify(
            db,
            "event.updated",
            {
                "event_title": event.title,
                "changed_fields": changed,
                "changes": ", ".join(field.replace("_", " ") for field in changed),
                "link": notify.web_link(f"/events/{event.slug}"),
            },
            email=email,
            user_id=user_id,
        )


def can_access_event(
    db: Session,
    event: Event,
    user: User | None,
    *,
    access_token: str | None = None,
    access_code: str | None = None,
) -> bool:
    """Enforce EventVisibility.PRIVATE access control (§4.2).

    Public and unlisted events are open to anyone with the link. Private events
    require one of: platform admin, event owner, assigned event staff, a valid
    signed invite/access token for this event, or the event's access code.
    """
    if event.visibility != EventVisibility.PRIVATE:
        return True
    if user is not None:
        if user.is_platform_admin:
            return True
        owner_user_id = db.scalar(
            select(OrganizerProfile.user_id).where(
                OrganizerProfile.id == event.organizer_profile_id
            )
        )
        if owner_user_id == user.id:
            return True
        is_staff = db.scalar(
            select(StaffAssignment.id).where(
                StaffAssignment.event_id == event.id, StaffAssignment.user_id == user.id
            )
        )
        if is_staff is not None:
            return True
    if access_token and _valid_event_token(access_token, event.id):
        return True
    if access_code and event.access_code_hash:
        if verify_event_access_code(access_code, event.access_code_hash):
            return True
    return False


def unlock_private_event(
    event: Event, *, access_code: str | None = None, invite_token: str | None = None
) -> str | None:
    """Exchange a valid private-event access code or invite token for an access token."""
    if invite_token and _valid_event_token(invite_token, event.id):
        return create_event_access_token(event.id)
    if access_code and event.access_code_hash:
        if verify_event_access_code(access_code, event.access_code_hash):
            return create_event_access_token(event.id)
    return None


def create_invite_link(db: Session, event: Event, actor: User) -> tuple[str, str]:
    token = create_event_invite_token(event.id)
    url = f"{settings.PUBLIC_WEB_URL.rstrip('/')}/events/{event.slug}?invite={token}"
    audit.record(
        db,
        action="event.invite_link_created",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor=actor,
        summary="Private event invite link generated",
    )
    db.commit()
    return token, url


def _valid_event_token(token: str, event_id: int) -> bool:
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return False
    if payload.get("type") not in ("event_access", "event_invite"):
        return False
    try:
        return int(payload["sub"]) == event_id
    except (KeyError, TypeError, ValueError):
        return False


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


def list_organizer_events(
    db: Session, profile: OrganizerProfile, *, phase: str | None = None
) -> Sequence[Event]:
    events = db.scalars(
        select(Event)
        .where(Event.organizer_profile_id == profile.id)
        .order_by(Event.starts_at.desc(), Event.id.desc())
    ).all()
    if phase is None:
        return events
    from app.services.event_lifecycle import phase as compute_phase

    return [e for e in events if compute_phase(e) == phase]


def list_public_events(
    db: Session,
    *,
    limit: int,
    offset: int,
    q: str | None = None,
    category: str | None = None,
    city: str | None = None,
    price_type: str | None = None,
    sort: str = "soonest",
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
                Event.venue_city.ilike(needle, escape="\\"),
            )
        )
    if category:
        query = query.where(Event.category == category)
    if city:
        city_needle = "%" + city.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(
            or_(
                Event.venue_city.ilike(city_needle, escape="\\"),
                Event.venue_address.ilike(city_needle, escape="\\"),
            )
        )
    if price_type == "free":
        query = query.where(
            exists(
                select(TicketType.id).where(
                    TicketType.event_id == Event.id,
                    TicketType.is_hidden.is_(False),
                    TicketType.price_minor == 0,
                )
            )
        )
    elif price_type == "paid":
        query = query.where(
            exists(
                select(TicketType.id).where(
                    TicketType.event_id == Event.id,
                    TicketType.is_hidden.is_(False),
                    TicketType.price_minor > 0,
                )
            )
        )
    if starts_after:
        query = query.where(Event.starts_at >= starts_after)
    if starts_before:
        query = query.where(Event.starts_at < starts_before)
    if sort == "newest":
        order = (Event.created_at.desc(), Event.id.desc())
    elif sort == "title":
        order = (Event.title.asc(), Event.id.asc())
    else:
        order = (Event.starts_at.asc(), Event.id.asc())
    return db.scalars(query.order_by(*order).limit(limit).offset(offset)).all()


def get_event_by_slug(db: Session, slug: str) -> Event | None:
    """Any event an attendee may open by link: everything except drafts.

    Unlisted and private events are reachable by direct link by design, and
    cancelled and suspended ones must still render their notice (§4.16).
    """
    return db.scalar(select(Event).where(Event.slug == slug, Event.status != EventStatus.DRAFT))
