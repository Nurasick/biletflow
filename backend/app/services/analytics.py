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
    refunds = _refunds(db, event, since, until, ticket_type_id)

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
        "by_ticket_type": _by_type(lines, types),
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


def _by_type(lines: list[dict], types: list[TicketType]) -> list[dict]:
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
        }
        for t in types
    ]


def _refunds(
    db: Session,
    event: Event,
    since: datetime | None,
    until: datetime | None,
    ticket_type_id: int | None,
) -> int:
    query = (
        select(func.coalesce(func.sum(Refund.amount_minor), 0))
        .join(Order, Order.id == Refund.order_id)
        .where(Order.event_id == event.id, Refund.status == RefundStatus.SUCCEEDED)
    )
    if since is not None:
        query = query.where(Refund.created_at >= since)
    if until is not None:
        query = query.where(Refund.created_at < until)
    if ticket_type_id is not None:
        # A refund is of a whole order; count it when the order contains the type.
        query = query.where(
            Order.id.in_(
                select(OrderItem.order_id).where(OrderItem.ticket_type_id == ticket_type_id)
            )
        )
    return int(db.scalar(query))


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
