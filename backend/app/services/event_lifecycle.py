"""Event status transitions: docs/state-machines.md §1.

Every status change for an event goes through a function in this module
(rule §0.1), and each one writes its audit row in the same transaction.

    draft --publish--> published --unpublish--> draft
    draft | published | suspended --cancel--> cancelled
    published --suspend (admin)--> suspended --lift (admin)--> published

`unpublish` is not in the original diagram; §4.2 requires it ("publish,
unpublish, and cancel"). It is only allowed while nothing has been sold or
held, because taking a page down under a buyer's feet with tickets in hand is
what `cancel` (with its refunds) is for.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.clock import as_utc, utcnow
from app.models.event import Event, EventStatus
from app.models.order import Order, OrderStatus
from app.models.organizer import OrganizerProfile
from app.models.ticket_type import TicketType
from app.models.user import User
from app.services import audit, order_lifecycle
from app.services.event import unique_slug

RequirementCode = Literal["title", "venue", "schedule", "future_start", "visible_ticket_type"]
Action = Literal["publish", "unpublish", "cancel"]
Phase = Literal["draft", "upcoming", "active", "completed", "cancelled", "suspended"]


class IllegalEventTransition(Exception):
    """The event's status does not allow this. `reason` is shown to the user."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Requirement:
    code: RequirementCode
    met: bool


def phase(event: Event, now: datetime | None = None) -> Phase:
    """§4.16's Upcoming / Active / Completed, derived from the clock, never stored
    (state-machines.md §1.1): a stored label is wrong between scheduler runs."""
    if event.status != EventStatus.PUBLISHED:
        return event.status.value
    now = now or utcnow()
    if now < as_utc(event.starts_at):
        return "upcoming"
    if now <= as_utc(event.ends_at):
        return "active"
    return "completed"


def publish_requirements(
    db: Session, event: Event, now: datetime | None = None
) -> list[Requirement]:
    """The draft -> published guards, as a checklist the preview can show.

    Title, venue and times are NOT NULL columns, so those three are about
    content (not blank) rather than presence.
    """
    now = now or utcnow()
    visible_type = db.scalar(
        select(TicketType.id).where(
            TicketType.event_id == event.id, TicketType.is_hidden.is_(False)
        )
    )
    return [
        Requirement("title", bool(event.title.strip())),
        Requirement("venue", bool(event.venue_name.strip() and event.venue_address.strip())),
        Requirement("schedule", as_utc(event.ends_at) > as_utc(event.starts_at)),
        Requirement("future_start", as_utc(event.starts_at) > now),
        Requirement("visible_ticket_type", visible_type is not None),
    ]


def allowed_actions(db: Session, event: Event, requirements: list[Requirement]) -> list[Action]:
    """What the organizer may do next. The web shows exactly these buttons."""
    if event.status == EventStatus.DRAFT:
        return (["publish"] if all(r.met for r in requirements) else []) + ["cancel"]
    if event.status == EventStatus.PUBLISHED:
        return (["unpublish"] if not _has_sales(db, event) else []) + ["cancel"]
    # Suspended is in the platform admin's hands; cancelled is terminal.
    return []


_REQUIREMENT_MESSAGES = {
    "title": "the event needs a title",
    "venue": "the event needs a venue name and address",
    "schedule": "ends_at must be after starts_at",
    "future_start": "starts_at must be in the future",
    "visible_ticket_type": "add at least one visible ticket type first",
}


def publish(db: Session, event: Event, actor: User, now: datetime | None = None) -> Event:
    now = now or utcnow()
    if event.status != EventStatus.DRAFT:
        raise IllegalEventTransition(f"only a draft can be published; this event is {event.status}")
    unmet = [r.code for r in publish_requirements(db, event, now) if not r.met]
    if unmet:
        raise IllegalEventTransition("; ".join(_REQUIREMENT_MESSAGES[code] for code in unmet))
    _flip(db, event, EventStatus.DRAFT, EventStatus.PUBLISHED, published_at=now)
    _audit(db, event, actor, "event.published", "Event published")
    return _commit(db, event)


def unpublish(db: Session, event: Event, actor: User) -> Event:
    if event.status != EventStatus.PUBLISHED:
        raise IllegalEventTransition(
            f"only a published event can be unpublished; this is {event.status}"
        )
    if _has_sales(db, event):
        raise IllegalEventTransition(
            "tickets are already sold or reserved; cancel the event instead"
        )
    _flip(db, event, EventStatus.PUBLISHED, EventStatus.DRAFT, published_at=None)
    _audit(db, event, actor, "event.unpublished", "Event unpublished back to draft")
    return _commit(db, event)


def cancel(
    db: Session, event: Event, actor: User, reason: str | None = None, now: datetime | None = None
) -> Event:
    """-> cancelled, with every side effect in one transaction (§4.9, §1 table).

    Pending orders lose their holds, free registrations are cancelled and
    paid orders refunded in full. If one refund fails the whole cancellation
    rolls back, rather than leaving an event that is half cancelled.
    """
    now = now or utcnow()
    if event.status == EventStatus.CANCELLED:
        raise IllegalEventTransition("the event is already cancelled")
    previous = event.status
    try:
        counts = _settle_orders(db, event, actor, now)
        _flip(db, event, previous, EventStatus.CANCELLED, cancelled_at=now)
        _audit(db, event, actor, "event.cancelled", "Event cancelled", {"reason": reason, **counts})
    except Exception:
        db.rollback()
        raise
    return _commit(db, event)


def suspend(db: Session, event: Event, admin: User, reason: str) -> Event:
    """Platform admin only (§4.12). Sales stop at once: checkout requires
    'published', and a suspended event is not."""
    if event.status != EventStatus.PUBLISHED:
        raise IllegalEventTransition(
            f"only a published event can be suspended; this is {event.status}"
        )
    _flip(db, event, EventStatus.PUBLISHED, EventStatus.SUSPENDED)
    _audit(
        db,
        event,
        admin,
        "event.suspended",
        "Event suspended by a platform admin",
        {"reason": reason},
    )
    return _commit(db, event)


def lift_suspension(db: Session, event: Event, admin: User) -> Event:
    if event.status != EventStatus.SUSPENDED:
        raise IllegalEventTransition(f"the event is not suspended; it is {event.status}")
    _flip(db, event, EventStatus.SUSPENDED, EventStatus.PUBLISHED)
    _audit(db, event, admin, "event.unsuspended", "Suspension lifted by a platform admin")
    return _commit(db, event)


def duplicate(db: Session, event: Event, profile: OrganizerProfile, actor: User) -> Event:
    """A new draft with the same configuration and none of the history (§4.16, UC12).

    Copied: the event's own fields and its ticket types with zeroed counters.
    Not copied: orders, tickets, payments, check-ins, support cases, images
    (image files belong to one event; re-upload them on the copy).
    """
    copy = Event(
        slug=unique_slug(db, f"{event.slug}-copy"),
        organizer_profile_id=profile.id,
        **{field: getattr(event, field) for field in _DUPLICATED_FIELDS},
    )
    db.add(copy)
    db.flush()
    for source in db.scalars(select(TicketType).where(TicketType.event_id == event.id)):
        db.add(
            TicketType(
                event_id=copy.id,
                **{field: getattr(source, field) for field in _DUPLICATED_TICKET_FIELDS},
            )
        )
    _audit(
        db,
        copy,
        actor,
        "event.duplicated",
        "Event created as a copy",
        {"source_event_id": event.id},
    )
    return _commit(db, copy)


_DUPLICATED_FIELDS = (
    "title", "description", "category", "visibility", "seating_mode", "venue_name",
    "venue_address", "starts_at", "ends_at", "timezone", "capacity",
    "registration_opens_at", "registration_closes_at", "refund_policy",
)  # fmt: skip
_DUPLICATED_TICKET_FIELDS = (
    "name", "description", "price_minor", "currency", "quantity_total", "sales_start_at",
    "sales_end_at", "max_per_order", "is_hidden", "position",
)  # fmt: skip


def _settle_orders(db: Session, event: Event, actor: User, now: datetime) -> dict[str, int]:
    counts = {"pending_cancelled": 0, "registrations_cancelled": 0, "orders_refunded": 0}
    orders = db.scalars(
        select(Order)
        .where(
            Order.event_id == event.id,
            Order.status.in_((OrderStatus.PENDING, OrderStatus.CONFIRMED)),
        )
        .order_by(Order.id)
    ).all()
    for order in orders:
        if order.status == OrderStatus.PENDING:
            order_lifecycle.cancel_pending(db, order, actor, now)
            counts["pending_cancelled"] += 1
        elif order.total_minor == 0:
            order_lifecycle.cancel_registration(db, order, actor, now)
            counts["registrations_cancelled"] += 1
        else:
            order_lifecycle.refund(db, order, actor, "Event cancelled by the organizer", now)
            counts["orders_refunded"] += 1
    return counts


def _has_sales(db: Session, event: Event) -> bool:
    committed = db.scalar(
        select(
            func.coalesce(func.sum(TicketType.quantity_sold + TicketType.quantity_reserved), 0)
        ).where(TicketType.event_id == event.id)
    )
    return committed > 0


def _flip(db: Session, event: Event, frm: EventStatus, to: EventStatus, **values) -> None:
    # Conditional on the status we checked, so an organizer's cancel and an
    # admin's suspend arriving together cannot both win (rule §0.3).
    flipped = db.execute(
        update(Event)
        .where(Event.id == event.id, Event.status == frm)
        .values(status=to, **values)
        .execution_options(synchronize_session=False)
    )
    if flipped.rowcount == 0:
        db.rollback()
        raise IllegalEventTransition("the event changed status while this was being saved; reload")


def _audit(
    db: Session, event: Event, actor: User, action: str, summary: str, payload: dict | None = None
):
    audit.record(
        db,
        action=action,
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        actor=actor,
        summary=summary,
        payload=payload,
    )


def _commit(db: Session, event: Event) -> Event:
    db.commit()
    db.refresh(event)
    return event
