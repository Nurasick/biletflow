"""Paying a pending order through the Halyk ePay sandbox (§4.6).

The simulator (payment.py) charges inside one request. Halyk cannot: the
buyer leaves for Halyk's card page and comes back minutes later, so a
payment here is a row that starts `pending` and is settled afterwards.

    start()  -> a pending payments row with a fresh invoice number
    (buyer pays on Halyk's page; Halyk calls our postLink, redirects back)
    sync()   -> asks Halyk's status API what happened and settles the row

`sync` is the only function that confirms or fails an order, and it believes
only the status API. The postLink body and the buyer's return are just
"go and look now" signals: both arrive over channels anyone can forge.
That also makes local development work: Halyk's postLink cannot reach
localhost, but the buyer's return can, and it calls `sync` too.

Everything here runs in the caller's transaction and does not commit.
"""

import hashlib
import hmac
import logging
import secrets
from datetime import datetime
from urllib.parse import urlencode, urlsplit

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.models.order import Order, OrderStatus
from app.models.payment import Payment, PaymentPurpose, PaymentStatus
from app.models.user import User
from app.services import audit, campaign, halyk_epay
from app.services import order as order_service
from app.services import payment as payment_service

logger = logging.getLogger(__name__)

NAME = halyk_epay.NAME
_INVOICE_SUFFIX = 10**6


class InvalidReturnUrl(Exception):
    """The client asked to be sent back somewhere we do not own."""


# --- start -------------------------------------------------------------------


def validate_return_url(url: str) -> str:
    """Accept only our web app or the mobile app's own URL schemes.

    Without this the return link is an open redirect: a phishing page could
    start a real checkout and have Halyk's page hand the buyer to it.
    """
    parts = urlsplit(url)
    if parts.scheme in ("http", "https"):
        # The web app, plus the browser frontends CORS already trusts (Expo
        # web on :8081 in development).
        trusted = [settings.PUBLIC_WEB_URL, *(str(origin) for origin in settings.CORS_ORIGINS)]
        origins = {(urlsplit(u).scheme, urlsplit(u).netloc) for u in trusted}
        if (parts.scheme, parts.netloc) in origins:
            return url
    elif parts.scheme.lower() in settings.APP_RETURN_SCHEMES:
        return url
    raise InvalidReturnUrl


def start(db: Session, order: Order, actor: User | None, now: datetime | None = None) -> Payment:
    """The pending payment the buyer is about to pay on Halyk's page.

    Locks the order first, so a double-click cannot open two invoices for it.
    If an earlier attempt is still pending (the buyer closed Halyk's tab and
    came back), that invoice is synced and, if still undecided, reused.
    """
    now = now or utcnow()
    db.refresh(order, with_for_update=True)
    earlier = db.scalar(
        select(Payment)
        .where(
            Payment.order_id == order.id,
            Payment.provider == NAME,
            Payment.status == PaymentStatus.PENDING,
        )
        .order_by(Payment.id.desc())
        .limit(1)
    )
    if earlier is not None:
        sync(db, earlier, actor, now)
        # confirm_order updates with synchronize_session=False: re-read it.
        db.refresh(order)
        # Still undecided: reuse it. Settled (paid, or failed and cancelled):
        # return it rather than raise, so the caller commits the settlement
        # instead of rolling it back; the checkout page then just sends the
        # buyer back to see the result.
        if earlier.status == PaymentStatus.PENDING or order.status != OrderStatus.PENDING:
            return earlier

    # The same checks the simulator makes before charging, for the same
    # reason: refusing now costs nothing; refusing after Halyk took the money
    # means a refund.
    payment_service.ensure_payable(order, now)
    payment_service.ensure_still_on_sale(db, order)

    payment = Payment(
        purpose=PaymentPurpose.TICKET_ORDER,
        order_id=order.id,
        provider=NAME,
        amount_minor=order.total_minor,
        currency=order.currency,
        status=PaymentStatus.PENDING,
        is_simulated=settings.HALYK_IS_SANDBOX,
    )
    db.add(payment)
    db.flush()  # for payment.id, which the invoice number is built from
    payment.provider_ref = _invoice_number(payment.id)
    audit.record(
        db,
        action="payment.started",
        entity_type="payment",
        entity_id=payment.id,
        event_id=order.event_id,
        actor=actor,
        summary=f"Halyk ePay payment started for order {order.order_number}",
        payload={"invoice_id": payment.provider_ref, "amount_minor": payment.amount_minor},
    )
    return payment


def _invoice_number(payment_id: int) -> str:
    """15 digits, which is Halyk's maximum ("от 6 до 15 цифр").

    Halyk also wants the last 6 digits unique per terminal, so they come
    from our own payment id. The 9 random leading digits are for the
    sandbox: its test terminal is shared by every developer in Kazakhstan,
    and "000000001" was taken long ago.
    """
    prefix = secrets.randbelow(9 * 10**8) + 10**8  # 9 digits, no leading zero
    return f"{prefix}{payment_id % _INVOICE_SUFFIX:06d}"


def secret_hash(invoice_id: str) -> str:
    """The value Halyk echoes back in the postLink, so we can tell our own
    invoices' callbacks from junk. Derived, not stored: HMAC of the invoice
    under SECRET_KEY, so a forger who knows an invoice number cannot make it."""
    key = settings.SECRET_KEY.encode()
    return hmac.new(key, f"halyk:{invoice_id}".encode(), hashlib.sha256).hexdigest()[:32]


def api_url(path: str, **query: str) -> str:
    base = f"{settings.PUBLIC_API_URL.rstrip('/')}{settings.API_V1_PREFIX}{path}"
    return f"{base}?{urlencode(query)}" if query else base


def payment_object(db: Session, payment: Payment, checkout_token: str) -> dict:
    """The argument to Halyk's `halyk.pay(...)`, with a token bound to this
    invoice and amount. Built when the page loads, because Halyk wants a fresh
    token per operation. Raises halyk_epay.HalykError if Halyk is down."""
    order = db.get(Order, payment.order_id)
    post_link = api_url("/payments/halyk/callback")
    token = halyk_epay.request_token(
        invoice_id=payment.provider_ref,
        amount_minor=payment.amount_minor,
        currency=payment.currency,
        secret_hash=secret_hash(payment.provider_ref),
        post_link=post_link,
    )
    return {
        "invoiceId": payment.provider_ref,
        "backLink": api_url("/payments/halyk/return", t=checkout_token),
        "failureBackLink": api_url("/payments/halyk/return", t=checkout_token),
        "postLink": post_link,
        "failurePostLink": post_link,
        "language": "rus",
        # Halyk's limit is 125 bytes; an order number keeps it far below.
        "description": f"BiletFlow order {order.order_number}",
        "terminal": settings.HALYK_TERMINAL_ID,
        "amount": float(halyk_epay.tenge(payment.amount_minor)),
        "currency": payment.currency,
        "email": order.contact_email,
        "auth": token,
    }


# --- sync --------------------------------------------------------------------


def sync(db: Session, payment: Payment, actor: User | None, now: datetime | None = None) -> Payment:
    """Ask Halyk what happened to this invoice and settle the row to match.

    Safe to call any number of times, from the callback and the buyer's
    return at once: the row is locked, and only a `pending` row is acted on.
    Raises halyk_epay.HalykError when Halyk cannot be asked; the row then
    stays pending and the next call tries again.
    """
    now = now or utcnow()
    db.refresh(payment, with_for_update=True)
    if payment.status != PaymentStatus.PENDING:
        return payment
    status = halyk_epay.check_status(payment.provider_ref)
    order = db.get(Order, payment.order_id)

    if status.outcome == "pending":
        return payment
    if status.outcome == "failed":
        _settle_failed(db, payment, order, status.reason, actor, now)
        return payment

    if status.amount_minor not in (None, payment.amount_minor) or status.currency not in (
        None,
        payment.currency,
    ):
        # The token pins the amount, so this should be impossible. If it ever
        # happens, never issue tickets for money we did not ask for.
        logger.error("Halyk invoice %s paid a different amount", payment.provider_ref)
        _mark_succeeded(db, payment, order, actor)
        _reverse(db, payment, order, status, "the amount paid did not match the order", actor, now)
        return payment
    if status.status_name == "AUTH":
        # A two-step terminal only held the money. Capture it before issuing
        # tickets; if capture fails, stay pending and try again next sync.
        halyk_epay.capture(status.transaction_id)

    _mark_succeeded(db, payment, order, actor)
    try:
        # A savepoint, because confirm_order may fail halfway (a hold lapsed
        # while the buyer was on Halyk's page) and its half must not stay.
        with db.begin_nested():
            payment_service.ensure_still_on_sale(db, order)
            order_service.confirm_order(db, order, now, actor=actor)
    except payment_service.SalesSuspended as exc:
        _reverse(db, payment, order, status, exc.reason, actor, now)
    except (order_service.OrderNotPending, order_service.HoldLapsed):
        _reverse(db, payment, order, status, "the reservation expired before payment", actor, now)
    except campaign.PromoRejected as exc:
        _reverse(db, payment, order, status, exc.reason, actor, now)
    return payment


def _mark_succeeded(db: Session, payment: Payment, order: Order, actor: User | None) -> None:
    payment.status = PaymentStatus.SUCCEEDED
    _audit(db, payment, order, actor, "payment.succeeded", "succeeded")


def _settle_failed(
    db: Session,
    payment: Payment,
    order: Order,
    reason: str | None,
    actor: User | None,
    now: datetime,
) -> None:
    payment.status = PaymentStatus.FAILED
    payment.failure_reason = reason or "Halyk ePay declined the payment"
    _audit(db, payment, order, actor, "payment.failed", "was declined")
    # The order may have expired meanwhile; then there is nothing to release.
    if order.status == OrderStatus.PENDING:
        payment_service.release_failed_order(db, order, payment.failure_reason, actor, now)


def _reverse(
    db: Session,
    payment: Payment,
    order: Order,
    status: halyk_epay.Status,
    why: str,
    actor: User | None,
    now: datetime,
) -> None:
    """Halyk took the money but the order cannot be confirmed: give it back.

    The simulator never needs this, because it refuses before charging. Here
    the buyer can still be on Halyk's page when the 10-minute hold runs out.
    """
    reason = f"Paid, but {why}; the charge was refunded"
    try:
        halyk_epay.refund(status.transaction_id, payment.amount_minor)
    except halyk_epay.HalykError:
        # Leave the payment `succeeded` with a loud reason: an admin must
        # refund it by hand in the Halyk merchant cabinet.
        logger.error("Halyk refund of invoice %s failed; refund it by hand", payment.provider_ref)
        payment.failure_reason = f"Paid, but {why}; the automatic refund failed"
        _audit(db, payment, order, actor, "payment.refund_failed", "needs a manual refund")
    else:
        payment.status = PaymentStatus.REFUNDED
        payment.failure_reason = reason
        _audit(db, payment, order, actor, "payment.reversed", "was refunded automatically")
    if order.status == OrderStatus.PENDING:
        payment_service.release_failed_order(db, order, reason, actor, now)


def _audit(
    db: Session, payment: Payment, order: Order, actor: User | None, action: str, verb: str
) -> None:
    label = "Halyk ePay sandbox" if payment.is_simulated else "Halyk ePay"
    audit.record(
        db,
        action=action,
        entity_type="payment",
        entity_id=payment.id,
        event_id=order.event_id,
        actor=actor,
        summary=f"{label} payment for order {order.order_number} {verb}",
        payload={
            "invoice_id": payment.provider_ref,
            "amount_minor": payment.amount_minor,
            "currency": payment.currency,
            "is_simulated": payment.is_simulated,
            "reason": payment.failure_reason,
        },
    )


# --- callback ----------------------------------------------------------------


def payment_for_callback(db: Session, body: dict) -> Payment | None:
    """The payment a postLink is about, or None if the call is not genuine.

    Only `invoiceId` and `secret_hash` are read; the outcome fields are
    ignored, since `sync` asks Halyk directly.
    """
    invoice_id = body.get("invoiceId")
    claimed = body.get("secret_hash")
    if not isinstance(invoice_id, str) or not isinstance(claimed, str):
        return None
    if not hmac.compare_digest(claimed, secret_hash(invoice_id)):
        return None
    return db.scalar(
        select(Payment).where(Payment.provider == NAME, Payment.provider_ref == invoice_id)
    )


# --- refunds -------------------------------------------------------------------


def refund(payment: Payment, amount_minor: int) -> str:
    """Refund a settled Halyk payment (organizer or admin refunds, §4.9).

    Returns a reference for the refunds row. Raises HalykError on failure.
    The transaction id is not stored; the status API is asked for it.
    """
    status = halyk_epay.check_status(payment.provider_ref)
    if status.transaction_id is None or status.status_name != "CHARGE":
        raise halyk_epay.HalykError(f"invoice is {status.status_name or 'unknown'}, not CHARGE")
    halyk_epay.refund(status.transaction_id, amount_minor)
    return f"halyk_re_{status.transaction_id}"
