"""Read-only views an organizer has of one event: orders, attendees, money.

Every figure is computed from authoritative rows (§4.15 "calculated from
authoritative BiletFlow order, ticket, ... refund, and check-in records") and
nothing here is cached or stored. Callers check event ownership first.
"""

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.attendee import Attendee
from app.models.event import Event
from app.models.order import Order, OrderItem, OrderStatus
from app.models.payment import Payment, PaymentPurpose, PaymentStatus, Refund, RefundStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.services import check_in

# Orders that represent a real outcome. Pending ones are still in someone's
# checkout and expired ones never happened; neither belongs in a sales list.
SETTLED = (
    OrderStatus.CONFIRMED,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
    OrderStatus.PARTIALLY_REFUNDED,
)


def event_orders(db: Session, event: Event, *, limit: int, offset: int) -> Sequence[tuple]:
    """(order, ticket count) rows, newest first, pending and expired left out."""
    tickets = (
        select(func.count()).where(Ticket.order_id == Order.id).correlate(Order).scalar_subquery()
    )
    return db.execute(
        select(Order, tickets)
        .where(Order.event_id == event.id, Order.status.in_(SETTLED))
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()


def attendees(db: Session, event: Event, *, limit: int, offset: int) -> Sequence[tuple]:
    """§4.4 "The organizer shall see the registration in the attendee list."

    One row per ticket, because a ticket is what admits a person.
    """
    return db.execute(
        select(Ticket, Attendee, TicketType.name, Order.order_number)
        .join(Attendee, Attendee.id == Ticket.attendee_id)
        .join(TicketType, TicketType.id == Ticket.ticket_type_id)
        .join(Order, Order.id == Ticket.order_id)
        .where(Ticket.event_id == event.id)
        .order_by(Attendee.full_name, Ticket.id)
        .limit(limit)
        .offset(offset)
    ).all()


def summary(db: Session, event: Event) -> dict:
    """Capacity, sales and money for one event, in KZT minor units.

    `is_simulated` is reported alongside the money: §4.6 forbids presenting
    demonstration payments as real, so the UI must label these figures.
    """
    types = db.scalars(
        select(TicketType).where(TicketType.event_id == event.id).order_by(TicketType.position)
    ).all()
    gross = _sum(
        db,
        select(func.sum(Payment.amount_minor))
        .join(Order, Order.id == Payment.order_id)
        .where(
            Order.event_id == event.id,
            Payment.purpose == PaymentPurpose.TICKET_ORDER,
            Payment.status.in_((PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED)),
        ),
    )
    refunded = _sum(
        db,
        select(func.sum(Refund.amount_minor))
        .join(Order, Order.id == Refund.order_id)
        .where(Order.event_id == event.id, Refund.status == RefundStatus.SUCCEEDED),
    )
    # Fees are 0 until open question #3 (who pays processing) is decided.
    fees = _sum(
        db,
        select(func.sum(Order.fee_minor)).where(
            Order.event_id == event.id, Order.status == OrderStatus.CONFIRMED
        ),
    )
    sold = sum(t.quantity_sold for t in types)
    total = sum(t.quantity_total for t in types)
    capacity = min(event.capacity, total) if event.capacity is not None else total
    return {
        "currency": "KZT",
        "is_simulated": True,
        "capacity": capacity,
        "tickets_sold": sold,
        "tickets_reserved": sum(t.quantity_reserved for t in types),
        "tickets_remaining": max(capacity - sold - sum(t.quantity_reserved for t in types), 0),
        "percent_sold": round(100 * sold / capacity, 1) if capacity else 0.0,
        "gross_minor": gross,
        "refunds_minor": refunded,
        "fees_minor": fees,
        "net_minor": gross - refunded - fees,
        "estimated_payout_minor": gross - refunded - fees,
        "tickets_refunded": _ticket_count(db, event, TicketStatus.REFUNDED),
        "attendance": check_in.counts(db, event),
        "by_ticket_type": [
            {
                "ticket_type_id": t.id,
                "name": t.name,
                "price_minor": t.price_minor,
                "quantity_total": t.quantity_total,
                "quantity_sold": t.quantity_sold,
                "quantity_reserved": t.quantity_reserved,
                "revenue_minor": _type_revenue(db, t.id),
            }
            for t in types
        ],
    }


def _type_revenue(db: Session, ticket_type_id: int) -> int:
    # From the order line snapshot, not today's price: an organizer's later
    # price edit must not rewrite what was earned.
    return _sum(
        db,
        select(func.sum(OrderItem.subtotal_minor))
        .join(Order, Order.id == OrderItem.order_id)
        .where(OrderItem.ticket_type_id == ticket_type_id, Order.status == OrderStatus.CONFIRMED),
    )


def _ticket_count(db: Session, event: Event, status: TicketStatus) -> int:
    return db.scalar(
        select(func.count()).where(Ticket.event_id == event.id, Ticket.status == status)
    )


def _sum(db: Session, query) -> int:
    return int(db.scalar(query) or 0)
