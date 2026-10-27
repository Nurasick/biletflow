"""Order transitions after checkout: cancellation and refunds.

docs/state-machines.md §4, §6 and §7. Every transition here is a conditional
UPDATE on the current status (rule §0.3), so two actors racing for the same
order produce one winner and one clean error instead of a double refund.

Nothing in this module commits. The route (or event cancellation, which
cancels many orders at once) owns the transaction, so an event cancel that
fails half way leaves every order as it was.
"""

from collections import Counter
from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.hold import Hold
from app.models.order import Order, OrderStatus
from app.models.payment import Payment, PaymentPurpose, PaymentStatus, Refund, RefundStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.models.user import User
from app.services import audit
from app.services import payment_provider as provider

# Tickets that still admit someone. Cancelling or refunding voids exactly these.
LIVE_TICKETS = (TicketStatus.VALID, TicketStatus.CHECKED_IN)


class IllegalOrderTransition(Exception):
    """The order is not in a status this transition starts from. `reason` says why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


class RefundFailed(Exception):
    """The provider rejected the refund. The order and its tickets are unchanged."""


def cancel_pending(db: Session, order: Order, actor: User | None, now: datetime | None = None):
    """pending -> cancelled: the buyer walks away, or a payment failed.

    The holds go back to inventory now rather than when the sweeper finds them
    expired, so the next buyer does not wait up to ten minutes for nothing.
    """
    now = now or utcnow()
    _flip(db, order, OrderStatus.PENDING, OrderStatus.CANCELLED, cancelled_at=now)
    release_holds(db, order.id, now)
    audit.record(
        db,
        action="order.cancelled",
        entity_type="order",
        entity_id=order.id,
        event_id=order.event_id,
        actor=actor,
        summary=f"Pending order {order.order_number} cancelled before payment",
    )


def cancel_registration(db: Session, order: Order, actor: User, now: datetime | None = None):
    """confirmed -> cancelled, for free orders only (§4.9).

    A paid order cannot take this path: cancelling it without a refund would
    keep the buyer's money and void their ticket. Paid orders are refunded.
    """
    now = now or utcnow()
    if order.total_minor != 0:
        raise IllegalOrderTransition("a paid order is refunded, not cancelled")
    _flip(db, order, OrderStatus.CONFIRMED, OrderStatus.CANCELLED, cancelled_at=now)
    voided = void_tickets(db, order.id, TicketStatus.CANCELLED)
    audit.record(
        db,
        action="order.cancelled",
        entity_type="order",
        entity_id=order.id,
        event_id=order.event_id,
        actor=actor,
        summary=f"Registration {order.order_number} cancelled by the organizer",
        payload={"tickets_voided": voided},
    )


def refund(db: Session, order: Order, actor: User, reason: str, now: datetime | None = None):
    """A full refund of a confirmed paid order (§4.9 "full refunds").

    Partial refunds are excluded from the MVP (§8 "advanced refund
    workflows"); the refunds table already allows several per payment, so
    adding them later is a new function, not a schema change.
    """
    now = now or utcnow()
    if order.status != OrderStatus.CONFIRMED:
        raise IllegalOrderTransition(
            f"only a confirmed order can be refunded; this is {order.status}"
        )
    payment = db.scalar(
        select(Payment).where(
            Payment.order_id == order.id,
            Payment.purpose == PaymentPurpose.TICKET_ORDER,
            Payment.status == PaymentStatus.SUCCEEDED,
        )
    )
    if payment is None:
        # A free order has no payment to refund; it is cancelled instead.
        raise IllegalOrderTransition("this order has no successful payment to refund")

    entry = Refund(
        payment_id=payment.id,
        order_id=order.id,
        amount_minor=payment.amount_minor,
        currency=payment.currency,
        reason=reason,
        status=RefundStatus.PENDING,
        initiated_by_user_id=actor.id,
    )
    db.add(entry)
    db.flush()
    # §4.9: "All payment and refund actions shall be recorded in an audit log."
    # Written before the provider answers, so a failed refund is on record too.
    audit.record(
        db,
        action="refund.initiated",
        entity_type="refund",
        entity_id=entry.id,
        event_id=order.event_id,
        actor=actor,
        summary=f"Full refund requested for order {order.order_number}",
        payload={"amount_minor": entry.amount_minor, "currency": entry.currency},
    )

    result = provider.refund(payment, entry.amount_minor)
    entry.provider_ref = result.provider_ref
    if not result.succeeded:
        entry.status = RefundStatus.FAILED
        raise RefundFailed

    entry.status = RefundStatus.SUCCEEDED
    payment.status = PaymentStatus.REFUNDED
    _flip(db, order, OrderStatus.CONFIRMED, OrderStatus.REFUNDED, cancelled_at=now)
    voided = void_tickets(db, order.id, TicketStatus.REFUNDED)
    audit.record(
        db,
        action="order.refunded",
        entity_type="order",
        entity_id=order.id,
        event_id=order.event_id,
        actor=actor,
        summary=f"Order {order.order_number} refunded in full",
        payload={"amount_minor": entry.amount_minor, "tickets_voided": voided},
    )


def release_holds(db: Session, order_id: int, now: datetime) -> None:
    """Hand an order's live holds back to inventory. Same shape as the sweeper."""
    released = db.execute(
        update(Hold)
        .where(Hold.order_id == order_id, Hold.released_at.is_(None))
        .values(released_at=now)
        .returning(Hold.ticket_type_id, Hold.quantity)
        .execution_options(synchronize_session=False)
    ).all()
    units = Counter()
    for ticket_type_id, quantity in released:
        units[ticket_type_id] += quantity
    for ticket_type_id in sorted(units):
        db.execute(
            update(TicketType)
            .where(TicketType.id == ticket_type_id)
            .values(quantity_reserved=TicketType.quantity_reserved - units[ticket_type_id])
            .execution_options(synchronize_session=False)
        )


def void_tickets(db: Session, order_id: int, to: TicketStatus) -> int:
    """Move every live ticket of an order to `to` and return the seats to sale.

    Returns how many tickets were voided. A voided ticket is no longer sold,
    so quantity_sold drops by the same count; otherwise a cancelled
    registration would keep its seat off the market forever.
    """
    per_type = Counter(
        dict(
            db.execute(
                select(Ticket.ticket_type_id, func.count())
                .where(Ticket.order_id == order_id, Ticket.status.in_(LIVE_TICKETS))
                .group_by(Ticket.ticket_type_id)
            ).all()
        )
    )
    db.execute(
        update(Ticket)
        .where(Ticket.order_id == order_id, Ticket.status.in_(LIVE_TICKETS))
        .values(status=to)
        .execution_options(synchronize_session=False)
    )
    for ticket_type_id in sorted(per_type):
        db.execute(
            update(TicketType)
            .where(TicketType.id == ticket_type_id)
            .values(quantity_sold=TicketType.quantity_sold - per_type[ticket_type_id])
            .execution_options(synchronize_session=False)
        )
    return sum(per_type.values())


def _flip(db: Session, order: Order, frm: OrderStatus, to: OrderStatus, **values) -> None:
    flipped = db.execute(
        update(Order)
        .where(Order.id == order.id, Order.status == frm)
        .values(status=to, **values)
        .execution_options(synchronize_session=False)
    )
    if flipped.rowcount == 0:
        db.refresh(order)
        raise IllegalOrderTransition(f"expected a {frm} order; this one is {order.status}")
    db.refresh(order)
