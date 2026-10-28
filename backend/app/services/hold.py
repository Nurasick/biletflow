"""Claiming ticket-type inventory, and giving it back when a claim lapses.

Checkout step 1 in docs/data-model/03-ordering.md. The design and the
measurements behind it are in docs/data-model/concurrency.md; read that before
changing anything here.
"""

from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.hold import Hold
from app.models.order import Order, OrderStatus
from app.models.ticket_type import TicketType

# How long a buyer has between choosing tickets and paying. The contract
# says 10 minutes; the frontend shows it as a countdown from `expires_at`.
HOLD_TTL = timedelta(minutes=10)


class NotOnSale(Exception):
    """The ticket type cannot be bought right now. `reason` says why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class QuantityNotAllowed(Exception):
    """The requested quantity is below 1 or above the type's max_per_order."""


class SoldOut(Exception):
    """Not enough unclaimed inventory left. The API turns this into 409."""


def reserve(
    db: Session, event: Event, ticket_type: TicketType, quantity: int, now: datetime | None = None
) -> Hold:
    """Claim `quantity` units of `ticket_type` for HOLD_TTL, commit, return the hold.

    The hold has no order (order_id NULL). Checkout uses claim() directly so
    that every line of an order and the order itself share one transaction.
    """
    try:
        hold = claim(db, event, ticket_type, quantity, now)
    except SoldOut:
        db.rollback()
        raise
    db.commit()
    db.refresh(hold)
    db.refresh(ticket_type)
    return hold


def claim(
    db: Session, event: Event, ticket_type: TicketType, quantity: int, now: datetime | None = None
) -> Hold:
    """Like reserve(), but inside the caller's transaction: nothing is committed.

    On SoldOut the caller must roll back, which also returns any units that
    earlier claim() calls in the same transaction took.
    """
    now = now or datetime.now(UTC)
    _ensure_on_sale(event, ticket_type, now)
    if quantity < 1 or (ticket_type.max_per_order and quantity > ticket_type.max_per_order):
        raise QuantityNotAllowed

    # The check and the write in ONE statement. Do not split this into a
    # SELECT and then an UPDATE: concurrency.md row 1 shows that version
    # selling 115 of 100 tickets. Here, a second buyer blocks on the row lock
    # and Postgres re-checks the WHERE against the row the first buyer left.
    claimed = db.execute(
        update(TicketType)
        .where(
            TicketType.id == ticket_type.id,
            TicketType.quantity_total - TicketType.quantity_sold - TicketType.quantity_reserved
            >= quantity,
        )
        .values(quantity_reserved=TicketType.quantity_reserved + quantity)
        # The ORM would otherwise try to patch `ticket_type` in memory by
        # evaluating the expression in Python; callers refresh it instead.
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount == 0:
        raise SoldOut

    # Same transaction as the counter bump: if this insert fails, the
    # rollback hands the units back, so the counter never runs ahead of the
    # hold rows.
    hold = Hold(ticket_type_id=ticket_type.id, quantity=quantity, expires_at=now + HOLD_TTL)
    db.add(hold)
    db.flush()
    return hold


def release_expired_holds(db: Session, now: datetime | None = None) -> int:
    """Release every lapsed hold and return its units. Returns how many holds.

    Meant to run on a timer (see app.main). The browser that abandoned
    checkout is exactly the one that will never tell us, so nothing else
    releases these.
    """
    now = now or datetime.now(UTC)

    # Marking the holds released and reading back what they held is one
    # statement. Two sweepers running at once is therefore safe without
    # SKIP LOCKED: the second blocks on each row lock, re-checks
    # `released_at IS NULL`, finds it false, and skips the row. No hold can
    # be returned to inventory twice.
    released = db.execute(
        update(Hold)
        .where(Hold.released_at.is_(None), Hold.expires_at <= now)
        .values(released_at=now)
        .returning(Hold.ticket_type_id, Hold.quantity)
        .execution_options(synchronize_session=False)
    ).all()

    units = Counter()
    for ticket_type_id, quantity in released:
        units[ticket_type_id] += quantity

    # Sorted, so two sweepers lock ticket types in the same order and cannot
    # deadlock on each other.
    for ticket_type_id in sorted(units):
        db.execute(
            update(TicketType)
            .where(TicketType.id == ticket_type_id)
            .values(quantity_reserved=TicketType.quantity_reserved - units[ticket_type_id])
            .execution_options(synchronize_session=False)
        )

    # A pending order lives exactly as long as its holds (same expires_at), so
    # it expires in the same sweep. Confirmation flips status with a
    # conditional UPDATE on 'pending', so it cannot race this into a
    # confirmed order without inventory.
    db.execute(
        update(Order)
        .where(Order.status == OrderStatus.PENDING, Order.expires_at <= now)
        .values(status=OrderStatus.EXPIRED)
        .execution_options(synchronize_session=False)
    )

    db.commit()
    return len(released)


def find_reserved_drift(db: Session) -> list[tuple[int, int, int]]:
    """Ticket types whose quantity_reserved disagrees with their live holds.

    Returns (ticket_type_id, counter, actual) rows; empty means consistent.
    The counter is denormalized for speed, so this is how drift gets caught.
    Expired-but-unswept holds still count as live here, because the counter
    still includes them until the sweeper runs. (The query in concurrency.md
    filters on expires_at too, so it reports drift in that gap that is not
    really there.)
    """
    live = func.coalesce(func.sum(Hold.quantity), 0)
    rows = db.execute(
        select(TicketType.id, TicketType.quantity_reserved, live)
        .outerjoin(
            Hold,
            (Hold.ticket_type_id == TicketType.id) & Hold.released_at.is_(None),
        )
        .group_by(TicketType.id, TicketType.quantity_reserved)
        .having(TicketType.quantity_reserved != live)
    ).all()
    return [tuple(row) for row in rows]


def _ensure_on_sale(event: Event, ticket_type: TicketType, now: datetime) -> None:
    if ticket_type.event_id != event.id:
        # Callers look the type up by event already; this is the backstop
        # against buying event A's ticket through event B's URL.
        raise NotOnSale("ticket type does not belong to this event")
    if event.status != EventStatus.PUBLISHED:
        raise NotOnSale("event is not published")
    if ticket_type.is_hidden:
        raise NotOnSale("ticket type is hidden")
    if _before(now, event.registration_opens_at) or _before(now, ticket_type.sales_start_at):
        raise NotOnSale("sales have not started")
    if _not_before(now, event.registration_closes_at) or _not_before(now, ticket_type.sales_end_at):
        raise NotOnSale("sales have ended")


def _before(now: datetime, moment: datetime | None) -> bool:
    return moment is not None and now < _as_utc(moment)


def _not_before(now: datetime, moment: datetime | None) -> bool:
    return moment is not None and now >= _as_utc(moment)


def _as_utc(value: datetime) -> datetime:
    # SQLite, which backs most tests, drops the offset; every stored value is UTC.
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
