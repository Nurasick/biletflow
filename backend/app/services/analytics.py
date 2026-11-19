"""Basic organizer analytics (§4.15, UC11).

Everything is computed from the authoritative rows on each request: orders,
order items, tickets, refunds, promo redemptions and check-ins. Nothing is
pre-aggregated or cached, so a figure here can never disagree with the order
list next to it. These are read-only SELECTs in their own request; nothing in
checkout or payment waits on them (§7).

Filters (§4.15 "event, date range, and ticket type"): the event is the URL,
`since`/`until` bound the order's confirmation time, and `ticket_type_id`
narrows every figure to one type.
"""

from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import as_utc
from app.models.campaign import Campaign
from app.models.event import Event
from app.models.order import Order, OrderItem, OrderStatus
from app.models.payment import Refund, RefundStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.services import campaign as campaign_service

# An order that was really sold, even if later refunded: it still belongs on
# the sales-over-time chart at the moment it happened.
SOLD = (OrderStatus.CONFIRMED, OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED)

# Which filters each part of the response honours, so a client can label it.
# Inventory and attendance are the state now, campaigns are lifetime totals;
# only the money and the per-type sales follow the date range.
FILTER_SCOPE: dict[str, list[str]] = {
    "inventory": ["ticket_type"],
    "money": ["date_range", "ticket_type"],
    "sales_over_time": ["date_range", "ticket_type"],
    "by_ticket_type": ["date_range", "ticket_type"],
    "campaigns": [],
    "attendance": ["ticket_type"],
}


def event_analytics(
    db: Session,
    event: Event,
    *,
    since: datetime | None = None,
    until: datetime | None = None,
    ticket_type_id: int | None = None,
) -> dict:
    types = db.scalars(
        select(TicketType).where(TicketType.event_id == event.id).order_by(TicketType.position)
    ).all()
    if ticket_type_id is not None:
        types = [t for t in types if t.id == ticket_type_id]

    lines = _sold_lines(db, event, since, until, ticket_type_id)
    refunds_by_type = _refunds_by_type(db, event, since, until)
    if ticket_type_id is None:
        refunds = sum(refunds_by_type.values())
    else:
        refunds = refunds_by_type.get(ticket_type_id, 0)

    gross = sum(line["gross"] for line in lines)
    discounts = sum(line["discount"] for line in lines)
    total = sum(t.quantity_total for t in types)
    capacity = min(event.capacity, total) if event.capacity is not None else total
    # Counters, not the date-filtered lines: "tickets remaining" is about now.
    sold_now = sum(t.quantity_sold for t in types)

    return {
        "currency": "KZT",
        # §4.6: demonstration money is never presented as real.
        "is_simulated": True,
        "capacity": capacity,
        "tickets_sold": sold_now,
        "tickets_remaining": max(capacity - sold_now, 0),
        "percent_sold": round(100 * sold_now / capacity, 1) if capacity else 0.0,
        "gross_minor": gross,
        "discounts_minor": discounts,
        "refunds_minor": refunds,
        "net_minor": gross - discounts - refunds,
        "sales_over_time": _by_day(lines, event.timezone),
        "by_ticket_type": _by_type(lines, types, refunds_by_type),
        "filter_scope": FILTER_SCOPE,
        "campaigns": [
            {
                "id": campaign.id,
                "name": campaign.name,
                "code": campaign.code,
                "is_active": campaign.is_active,
                **campaign_service.stats(db, campaign),
            }
            for campaign in db.scalars(
                select(Campaign).where(Campaign.event_id == event.id).order_by(Campaign.id)
            )
        ],
        "attendance": _attendance(db, event, ticket_type_id),
    }


def _sold_lines(
    db: Session,
    event: Event,
    since: datetime | None,
    until: datetime | None,
    ticket_type_id: int | None,
) -> list[dict]:
    """One row per order line of a sold order: when, which type, how much.

    Order lines rather than orders, because the ticket-type filter and the
    per-type comparison both need the split. Amounts come from the line's
    snapshot, so a later price edit does not rewrite history.
    """
    query = (
        select(
            Order.confirmed_at,
            OrderItem.ticket_type_id,
            OrderItem.quantity,
            OrderItem.subtotal_minor,
            OrderItem.discount_minor,
        )
        .join(OrderItem, OrderItem.order_id == Order.id)
        .where(Order.event_id == event.id, Order.status.in_(SOLD))
    )
    if since is not None:
        query = query.where(Order.confirmed_at >= since)
    if until is not None:
        query = query.where(Order.confirmed_at < until)
    if ticket_type_id is not None:
        query = query.where(OrderItem.ticket_type_id == ticket_type_id)
    return [
        {
            "at": as_utc(confirmed_at),
            "ticket_type_id": type_id,
            "quantity": quantity,
            "gross": subtotal,
            "discount": discount,
        }
        for confirmed_at, type_id, quantity, subtotal, discount in db.execute(query)
        if confirmed_at is not None
    ]


def _by_day(lines: list[dict], timezone: str) -> list[dict]:
    """§4.15 "sales over time using order timestamps", one point per day.

    Days are the event's local days: an order at 23:30 in Almaty belongs to
    that evening, not to the next day in UTC.
    """
    zone = ZoneInfo(timezone)
    days: dict[str, dict] = defaultdict(lambda: {"tickets": 0, "revenue_minor": 0})
    for line in lines:
        day = line["at"].astimezone(zone).date().isoformat()
        days[day]["tickets"] += line["quantity"]
        days[day]["revenue_minor"] += line["gross"] - line["discount"]
    return [{"date": day, **days[day]} for day in sorted(days)]


def _by_type(
    lines: list[dict], types: list[TicketType], refunds_by_type: dict[int, int]
) -> list[dict]:
    sold: dict[int, dict] = defaultdict(lambda: {"tickets": 0, "revenue_minor": 0})
    for line in lines:
        sold[line["ticket_type_id"]]["tickets"] += line["quantity"]
        sold[line["ticket_type_id"]]["revenue_minor"] += line["gross"] - line["discount"]
    return [
        {
            "ticket_type_id": t.id,
            "name": t.name,
            "price_minor": t.price_minor,
            "quantity_total": t.quantity_total,
            "quantity_sold": t.quantity_sold,
            "quantity_reserved": t.quantity_reserved,
            "tickets_in_range": sold[t.id]["tickets"],
            "revenue_minor": sold[t.id]["revenue_minor"],
            "refunds_minor": refunds_by_type.get(t.id, 0),
        }
        for t in types
    ]


def _refunds_by_type(
    db: Session, event: Event, since: datetime | None, until: datetime | None
) -> dict[int, int]:
    """Succeeded refunds in the date range, split across ticket types.

    A refund is of a whole order, so with a mixed order it has to be shared
    out: each line gets the part of the refund that it was paid, that is its
    subtotal less its own discount. Rounding is settled with the largest
    remainder, so the per-type figures always add up to the full refund.
    """
    query = (
        select(Refund.order_id, Refund.amount_minor)
        .join(Order, Order.id == Refund.order_id)
        .where(Order.event_id == event.id, Refund.status == RefundStatus.SUCCEEDED)
    )
    if since is not None:
        query = query.where(Refund.created_at >= since)
    if until is not None:
        query = query.where(Refund.created_at < until)
    refunds = db.execute(query).all()
    if not refunds:
        return {}

    lines: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for order_id, type_id, paid in db.execute(
        select(
            OrderItem.order_id,
            OrderItem.ticket_type_id,
            OrderItem.subtotal_minor - OrderItem.discount_minor,
        )
        .where(OrderItem.order_id.in_({order_id for order_id, _ in refunds}))
        .order_by(OrderItem.id)
    ):
        lines[order_id].append((type_id, paid))

    by_type: dict[int, int] = defaultdict(int)
    for order_id, amount in refunds:
        for type_id, share in split_refund(amount, lines[order_id]).items():
            by_type[type_id] += share
    return dict(by_type)


def split_refund(amount: int, lines: list[tuple[int, int]]) -> dict[int, int]:
    """Share `amount` across (ticket_type_id, paid) lines in proportion to
    `paid`. The shares are whole tiyn and always sum to exactly `amount`.

    Each line first gets the rounded-down share; the tiyn left over go one at
    a time to the lines with the largest remainders, the earlier line first
    on a tie, so the same order always splits the same way.
    """
    if not lines:
        return {}
    weight = sum(paid for _, paid in lines)
    if weight <= 0:
        # Nothing was paid for any line, so there is no proportion to follow.
        # A refund here would be a data error; keep it on the books regardless.
        return {lines[0][0]: amount} if amount else {}

    shares = [amount * paid // weight for _, paid in lines]
    remainders = [amount * paid % weight for _, paid in lines]
    left = amount - sum(shares)
    for index in sorted(range(len(lines)), key=lambda i: -remainders[i])[:left]:
        shares[index] += 1

    by_type: dict[int, int] = defaultdict(int)
    for (type_id, _), share in zip(lines, shares, strict=True):
        by_type[type_id] += share
    return dict(by_type)


def _attendance(db: Session, event: Event, ticket_type_id: int | None) -> dict:
    """§4.15: checked-in attendees, absent ticket holders, and the percentage."""
    query = select(Ticket.status, func.count()).where(Ticket.event_id == event.id)
    if ticket_type_id is not None:
        query = query.where(Ticket.ticket_type_id == ticket_type_id)
    rows = dict(db.execute(query.group_by(Ticket.status)).all())
    checked_in = rows.get(TicketStatus.CHECKED_IN, 0)
    registered = rows.get(TicketStatus.VALID, 0) + checked_in
    return {
        "registered": registered,
        "checked_in": checked_in,
        "absent": registered - checked_in,
        "checked_in_percent": round(100 * checked_in / registered, 1) if registered else 0.0,
    }
