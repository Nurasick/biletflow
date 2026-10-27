"""Checkout step 3b: paying for a pending order (03-ordering.md#the-checkout-flow).

Free orders never come here; they are confirmed inside checkout and have no
payments row at all.
"""

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import as_utc, utcnow
from app.models.order import Order, OrderStatus
from app.models.payment import Payment, PaymentPurpose, PaymentStatus
from app.models.user import User
from app.services import audit, order_lifecycle
from app.services import order as order_service
from app.services import payment_provider as provider
from app.services.order_lifecycle import IllegalOrderTransition


class IdempotencyKeyReused(Exception):
    """The key was already used for a different order. Never silently accept it."""


class ReservationExpired(Exception):
    """The order's 10-minute hold ran out before payment. Nothing was charged."""


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
