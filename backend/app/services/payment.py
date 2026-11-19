"""Checkout step 3b: paying for a pending order (03-ordering.md#the-checkout-flow).

Free orders never come here; they are confirmed inside checkout and have no
payments row at all.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, utcnow
from app.models.activation import ActivationStatus, EventActivation
from app.models.event import Event, EventStatus
from app.models.order import Order, OrderStatus
from app.models.payment import Payment, PaymentPurpose, PaymentStatus
from app.models.user import User
from app.services import audit, notify, order_lifecycle
from app.services import order as order_service
from app.services import payment_provider as provider
from app.services.order_lifecycle import IllegalOrderTransition


class IdempotencyKeyReused(Exception):
    """The key was already used for a different order. Never silently accept it."""


class ReservationExpired(Exception):
    """The order's 10-minute hold ran out before payment. Nothing was charged."""


class SalesSuspended(Exception):
    """An admin stopped sales after this order was reserved (§4.5, §4.12).
    Nothing was charged. `reason` is safe to show the buyer."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def pay_order(
    db: Session,
    order: Order,
    outcome: provider.Outcome,
    idempotency_key: str,
    actor: User | None,
    now: datetime | None = None,
) -> Payment:
    """Charge the order's total and, on success, confirm it and issue tickets.

    Does not commit. On success the charge, the confirmation and the tickets
    are one transaction: if confirmation fails (a hold lapsed in between), the
    caller rolls back and the simulated charge never happened. A real provider
    would need a compensating refund there; the simulator does not.
    """
    now = now or utcnow()
    replay = db.scalar(select(Payment).where(Payment.idempotency_key == idempotency_key))
    if replay is not None:
        # The same request again: a double-click, a retried network call.
        # Answer with what happened the first time and charge nothing.
        if replay.order_id != order.id:
            raise IdempotencyKeyReused
        return replay

    _ensure_payable(order, now)
    # Before the charge, not after: with a real provider, refusing after
    # charging would mean a refund. The simulator would roll back anyway.
    _ensure_still_on_sale(db, order)
    result = provider.charge(order.total_minor, outcome)
    payment = Payment(
        purpose=PaymentPurpose.TICKET_ORDER,
        order_id=order.id,
        provider=provider.NAME,
        provider_ref=result.provider_ref,
        amount_minor=order.total_minor,
        currency=order.currency,
        status=PaymentStatus.SUCCEEDED if result.succeeded else PaymentStatus.FAILED,
        is_simulated=provider.IS_SIMULATED,
        failure_reason=result.failure_reason,
        idempotency_key=idempotency_key,
    )
    db.add(payment)
    db.flush()
    _audit_payment(db, order, payment, actor)

    if not result.succeeded:
        # state-machines.md §5: a failed payment releases the holds. The order
        # is cancelled so the buyer starts a fresh checkout rather than
        # retrying against inventory that is no longer theirs.
        order_lifecycle.cancel_pending(db, order, actor, now)
        # §4.10 "Payment failure". The link goes back to the event, because
        # this order is over and a retry is a fresh checkout.
        event = db.get(Event, order.event_id)
        notify.notify(
            db,
            "payment.failed",
            {
                "order_number": order.order_number,
                "event_title": event.title,
                "reason": result.failure_reason,
                "link": notify.web_link(f"/events/{event.slug}"),
            },
            email=order.contact_email,
            user_id=order.user_id,
        )
        return payment

    order_service.confirm_order(db, order, now)
    return payment


def _ensure_payable(order: Order, now: datetime) -> None:
    if order.status != OrderStatus.PENDING:
        raise IllegalOrderTransition(
            f"only a pending order can be paid; this one is {order.status}"
        )
    if order.total_minor == 0:
        raise IllegalOrderTransition("a free order needs no payment")
    if order.expires_at is not None and as_utc(order.expires_at) <= now:
        raise ReservationExpired


def _ensure_still_on_sale(db: Session, order: Order) -> None:
    """Re-check, at payment time, what checkout checked at reservation time (T13).

    Checkout refuses paid lines unless the event is published and its paid
    sales are active, but a buyer can reserve, then an admin suspends, then
    the buyer pays. Without this the payment went through and issued tickets
    for an event the admin had just stopped.

    Why FOR SHARE and not a plain read: under READ COMMITTED a plain SELECT
    never waits for an uncommitted UPDATE; it returns the last committed row.
    So a payment could read "active" while a suspension is half-done, then
    confirm after the admin was told sales had stopped. A locking read closes
    that window in both directions:

    - suspension first: its UPDATE holds the row, our FOR SHARE waits for it
      to commit, and Postgres re-reads the row, so we see "suspended";
    - payment first: our FOR SHARE holds the row, the suspension's UPDATE
      waits until this payment commits. The payment completed before the
      suspension took effect, which is the honest order of events.

    FOR SHARE, not FOR UPDATE: concurrent payments for the same event can all
    hold a share lock at once, so this does not serialize the checkout queue;
    only the (rare) suspension waits. Lock order is event, then activation,
    the same event-first order checkout uses (_ensure_capacity), so the two
    cannot deadlock. SQLite ignores the lock clause; the race test runs on
    Postgres (tests/test_payment_suspension_race.py).

    Only paid orders reach this function (_ensure_payable refuses free ones),
    so an inactive activation always means "refuse". Free registration on an
    event with only its paid sales suspended never comes through here.
    """
    event_status = db.scalar(
        select(Event.status).where(Event.id == order.event_id).with_for_update(read=True)
    )
    if event_status != EventStatus.PUBLISHED:
        # Covers suspended, and also cancelled/draft as a backstop, though
        # cancelling an event already cancels its pending orders.
        raise SalesSuspended("Sales for this event have been stopped")
    activation_status = db.scalar(
        select(EventActivation.status)
        .where(EventActivation.event_id == order.event_id)
        .with_for_update(read=True)
    )
    if activation_status != ActivationStatus.ACTIVE:
        raise SalesSuspended("Paid sales for this event are suspended")


def _audit_payment(db: Session, order: Order, payment: Payment, actor: User | None) -> None:
    succeeded = payment.status == PaymentStatus.SUCCEEDED
    audit.record(
        db,
        action="payment.succeeded" if succeeded else "payment.failed",
        entity_type="payment",
        entity_id=payment.id,
        event_id=order.event_id,
        actor=actor,
        summary=(
            f"Simulated payment for order {order.order_number} "
            + ("succeeded" if succeeded else "was declined")
        ),
        payload={
            "amount_minor": payment.amount_minor,
            "currency": payment.currency,
            "is_simulated": payment.is_simulated,
        },
    )
