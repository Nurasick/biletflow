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
from app.models.organizer import OrganizerProfile
from app.models.payment import Payment, Refund, RefundStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.services import campaign as campaign_service
from app.services import seating as seating_service
from app.services import ticket_type as ticket_type_service

# An order that was really sold, even if later refunded: it still belongs on
# the sales-over-time chart at the moment it happened.
SOLD = (OrderStatus.CONFIRMED, OrderStatus.REFUNDED, OrderStatus.PARTIALLY_REFUNDED)

# Which filters each part of the response honours, so a client can label it.
FILTER_SCOPE: dict[str, list[str]] = {
    "inventory": ["ticket_type"],
    "money": ["date_range", "ticket_type"],
    "sales_over_time": ["date_range", "ticket_type"],
    "by_ticket_type": ["date_range", "ticket_type"],
    "campaigns": ["date_range", "ticket_type"],
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
    fees_by_type = _fees_by_type(db, event, since, until)
    if ticket_type_id is None:
        refunds = sum(refunds_by_type.values())
        fees = sum(fees_by_type.values())
    else:
        refunds = refunds_by_type.get(ticket_type_id, 0)
        fees = fees_by_type.get(ticket_type_id, 0)

    gross = sum(line["gross"] for line in lines)
    discounts = sum(line["discount"] for line in lines)
    total = sum(t.quantity_total for t in types)
    if ticket_type_id is None:
        sellable = seating_service.sellable_seat_count(db, event.id)
        if sellable is not None:
            total = sellable
    capacity = min(event.capacity, total) if event.capacity is not None else total
    # Counters, not the date-filtered lines: "tickets remaining" is about now.
    sold_now = sum(t.quantity_sold for t in types)
    reserved_now = sum(t.quantity_reserved for t in types)
    metrics = ticket_type_service.ticket_metrics_by_type(db, event.id)
    has_simulated_payments = (
        db.scalar(
            select(Payment.id)
            .join(Order, Order.id == Payment.order_id)
            .where(Order.event_id == event.id, Payment.is_simulated.is_(True))
            .limit(1)
        )
        is not None
    )
    net = gross - discounts - refunds

    return {
        "currency": types[0].currency if types else "KZT",
        # §4.6: derived from actual payment records; free-only events are not simulated.
        "is_simulated": has_simulated_payments,
        "capacity": capacity,
        "tickets_sold": sold_now,
        "tickets_reserved": reserved_now,
        "tickets_remaining": max(capacity - sold_now - reserved_now, 0),
        "percent_sold": round(100 * sold_now / capacity, 1) if capacity else 0.0,
        "gross_minor": gross,
        "discounts_minor": discounts,
        "refunds_minor": refunds,
        "fees_minor": fees,
        "net_minor": net,
        "estimated_payout_minor": net - fees,
        "sales_over_time": _by_day(lines, event.timezone),
        "by_ticket_type": _by_type(lines, types, refunds_by_type, metrics),
        "filter_scope": FILTER_SCOPE,
        "campaigns": [
            {
                "id": campaign.id,
                "name": campaign.name,
                "code": campaign.code,
                "is_active": campaign.is_active,
                **campaign_service.stats(
                    db,
                    campaign,
                    since=since,
                    until=until,
                    ticket_type_id=ticket_type_id,
                ),
            }
            for campaign in db.scalars(
                select(Campaign).where(Campaign.event_id == event.id).order_by(Campaign.id)
            )
        ],
        "attendance": _attendance(db, event, ticket_type_id),
    }


def organizer_analytics(
    db: Session,
    profile: OrganizerProfile,
    *,
    event_id: int | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
) -> dict | None:
    """Multi-event summary and analytics for an organizer (§4.15)."""
    query = (
        select(Event)
        .where(Event.organizer_profile_id == profile.id)
        .order_by(Event.starts_at.desc(), Event.id.desc())
    )
    if event_id is not None:
        query = query.where(Event.id == event_id)
    events = db.scalars(query).all()
    if event_id is not None and not events:
        return None

    total_capacity = 0
    total_sold = 0
    total_reserved = 0
    total_remaining = 0
    total_gross = 0
    total_discounts = 0
    total_refunds = 0
    total_fees = 0
    total_net = 0
    total_payout = 0
    total_registered = 0
    total_checked_in = 0
    any_simulated = False
    currency = "KZT"
    days: dict[str, dict[str, int]] = defaultdict(lambda: {"tickets": 0, "revenue_minor": 0})
    per_event: list[dict] = []

    for ev in events:
        data = event_analytics(db, ev, since=since, until=until)
        currency = data["currency"]
        any_simulated = any_simulated or data["is_simulated"]
        total_capacity += data["capacity"]
        total_sold += data["tickets_sold"]
        total_reserved += data["tickets_reserved"]
        total_remaining += data["tickets_remaining"]
        total_gross += data["gross_minor"]
        total_discounts += data["discounts_minor"]
        total_refunds += data["refunds_minor"]
        total_fees += data["fees_minor"]
        total_net += data["net_minor"]
        total_payout += data["estimated_payout_minor"]
        total_registered += data["attendance"]["registered"]
        total_checked_in += data["attendance"]["checked_in"]
        for point in data["sales_over_time"]:
            days[point["date"]]["tickets"] += point["tickets"]
            days[point["date"]]["revenue_minor"] += point["revenue_minor"]
        per_event.append(
            {
                "event_id": ev.id,
                "slug": ev.slug,
                "title": ev.title,
                "status": str(ev.status),
                "starts_at": ev.starts_at,
                "capacity": data["capacity"],
                "tickets_sold": data["tickets_sold"],
                "tickets_reserved": data["tickets_reserved"],
                "tickets_remaining": data["tickets_remaining"],
                "gross_minor": data["gross_minor"],
                "discounts_minor": data["discounts_minor"],
                "refunds_minor": data["refunds_minor"],
                "fees_minor": data["fees_minor"],
                "net_minor": data["net_minor"],
                "estimated_payout_minor": data["estimated_payout_minor"],
                "attendance": data["attendance"],
            }
        )

    return {
        "currency": currency,
        "is_simulated": any_simulated,
        "event_count": len(events),
        "capacity": total_capacity,
        "tickets_sold": total_sold,
        "tickets_reserved": total_reserved,
        "tickets_remaining": total_remaining,
        "percent_sold": round(100 * total_sold / total_capacity, 1) if total_capacity else 0.0,
        "gross_minor": total_gross,
        "discounts_minor": total_discounts,
        "refunds_minor": total_refunds,
        "fees_minor": total_fees,
        "net_minor": total_net,
        "estimated_payout_minor": total_payout,
        "attendance": {
            "registered": total_registered,
            "checked_in": total_checked_in,
            "absent": total_registered - total_checked_in,
            "checked_in_percent": round(100 * total_checked_in / total_registered, 1)
            if total_registered
            else 0.0,
        },
        "sales_over_time": [{"date": day, **days[day]} for day in sorted(days)],
        "events": per_event,
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
    lines: list[dict],
    types: list[TicketType],
    refunds_by_type: dict[int, int],
    metrics: dict[int, dict[str, int]],
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
            "available": max(t.quantity_total - t.quantity_sold - t.quantity_reserved, 0),
            "quantity_refunded": metrics.get(t.id, {}).get("refunded", 0),
            "quantity_checked_in": metrics.get(t.id, {}).get("checked_in", 0),
            "tickets_in_range": sold[t.id]["tickets"],
            "revenue_minor": sold[t.id]["revenue_minor"],
            "refunds_minor": refunds_by_type.get(t.id, 0),
        }
        for t in types
    ]


def _fees_by_type(
    db: Session, event: Event, since: datetime | None, until: datetime | None
) -> dict[int, int]:
    """Processing fees of confirmed orders in the date range, split across ticket types."""
    query = select(Order.id, Order.fee_minor).where(
        Order.event_id == event.id,
        Order.status == OrderStatus.CONFIRMED,
        Order.fee_minor > 0,
    )
    if since is not None:
        query = query.where(Order.confirmed_at >= since)
    if until is not None:
        query = query.where(Order.confirmed_at < until)
    orders = db.execute(query).all()
    if not orders:
        return {}

    lines: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for order_id, type_id, paid in db.execute(
        select(
            OrderItem.order_id,
            OrderItem.ticket_type_id,
            OrderItem.subtotal_minor - OrderItem.discount_minor,
        )
        .where(OrderItem.order_id.in_({oid for oid, _ in orders}))
        .order_by(OrderItem.id)
    ):
        lines[order_id].append((type_id, paid))

    by_type: dict[int, int] = defaultdict(int)
    for order_id, fee in orders:
        for type_id, share in split_refund(fee, lines[order_id]).items():
            by_type[type_id] += share
    return dict(by_type)


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
