"""Halyk ePay sandbox checkout (§4.6). The flow is in services/halyk_payment.py.

    POST /orders/{n}/halyk          -> {checkout_url}; the client opens it
    GET  /payments/halyk/checkout   -> our page that runs Halyk's halyk.pay()
    GET  /payments/halyk/return     <- Halyk sends the buyer back here
    POST /payments/halyk/callback   <- Halyk's server-to-server postLink
    POST /orders/{n}/halyk/sync     -> re-check now (the app after returning)

The checkout page is served by the API, not by each frontend, so the web app
and the mobile app (in an in-app browser) share one integration.
"""

import html
import json
import logging
from datetime import datetime

import jwt
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DbSession, OptionalUser
from app.api.v1.routes.orders import OrderToken, _read, _viewable
from app.core.clock import as_utc, utcnow
from app.core.config import settings
from app.core.security import (
    HALYK_CHECKOUT_TOKEN_TYPE,
    create_halyk_checkout_token,
    decode_token,
)
from app.models.order import Order, OrderStatus
from app.models.payment import Payment, PaymentStatus
from app.schemas.order import OrderRead
from app.services import halyk_epay, halyk_payment, order_lifecycle
from app.services import payment as payment_service

logger = logging.getLogger(__name__)

router = APIRouter(tags=["payments"])

HALYK_UNAVAILABLE = HTTPException(
    status.HTTP_502_BAD_GATEWAY, "Halyk ePay is unavailable right now. Please try again."
)


class PaymentProviderRead(BaseModel):
    provider: str
    is_sandbox: bool


class HalykStartRequest(BaseModel):
    # Where to send the buyer afterwards: our web app, or the mobile app's
    # deep link. Checked against an allowlist (validate_return_url).
    return_url: str = Field(min_length=1, max_length=2048)


class HalykStartResponse(BaseModel):
    checkout_url: str
    invoice_id: str


@router.get("/payments/provider", response_model=PaymentProviderRead)
def payment_provider() -> dict:
    """Which checkout the clients should show: simulator buttons or Halyk."""
    halyk = settings.PAYMENT_PROVIDER == "halyk"
    return {
        "provider": settings.PAYMENT_PROVIDER,
        "is_sandbox": halyk and settings.HALYK_IS_SANDBOX,
    }


def _require_halyk() -> None:
    if settings.PAYMENT_PROVIDER != "halyk":
        raise HTTPException(status.HTTP_409_CONFLICT, "Halyk ePay is not enabled on this server")


@router.post("/orders/{order_number}/halyk", response_model=HalykStartResponse)
def start_halyk_payment(
    order_number: str,
    data: HalykStartRequest,
    db: DbSession,
    user: OptionalUser,
    token: OrderToken = None,
) -> dict:
    """Open (or reopen) a Halyk invoice for a pending order and get the
    link to Halyk's payment page. Nothing is charged until the buyer pays there."""
    _require_halyk()
    order = _viewable(db, order_number, user, token)
    try:
        return_url = halyk_payment.validate_return_url(data.return_url)
    except halyk_payment.InvalidReturnUrl:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "return_url is not an allowed destination"
        ) from None
    try:
        payment = halyk_payment.start(db, order, user)
    except order_lifecycle.IllegalOrderTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    except payment_service.ReservationExpired:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The reservation expired before payment; nothing was charged"
        ) from None
    except payment_service.SalesSuspended as exc:
        # As in /pay (T13): cancel so the holds go back to inventory now.
        db.rollback()
        try:
            order_lifecycle.cancel_pending(db, order, user)
            db.commit()
        except order_lifecycle.IllegalOrderTransition:
            db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{exc.reason}. Nothing was charged."
        ) from None
    except halyk_epay.HalykError:
        # Only an earlier pending invoice's sync talks to Halyk in start().
        db.rollback()
        raise HALYK_UNAVAILABLE from None
    db.commit()
    checkout_token = create_halyk_checkout_token(payment.id, return_url)
    return {
        "checkout_url": halyk_payment.api_url("/payments/halyk/checkout", t=checkout_token),
        "invoice_id": payment.provider_ref,
    }


def _checkout_claims(t: str) -> tuple[int, str] | None:
    try:
        claims = decode_token(t)
    except jwt.PyJWTError:
        return None
    if claims.get("type") != HALYK_CHECKOUT_TOKEN_TYPE or not isinstance(claims.get("ret"), str):
        return None
    return int(claims["sub"]), claims["ret"]


def _still_payable(order: Order, now: datetime) -> bool:
    return order.status == OrderStatus.PENDING and (
        order.expires_at is None or as_utc(order.expires_at) > now
    )


@router.get("/payments/halyk/checkout", response_class=HTMLResponse, include_in_schema=False)
def halyk_checkout_page(db: DbSession, t: str = Query(max_length=4096)):
    """A page whose only job is to run Halyk's script and hand over to Halyk."""
    claims = _checkout_claims(t)
    if claims is None:
        return _page("This payment link is invalid or has expired.", status_code=400)
    payment_id, return_url = claims
    payment = db.get(Payment, payment_id)
    order = db.get(Order, payment.order_id) if payment is not None else None
    if payment is None or order is None:
        return _page("This payment link is invalid or has expired.", status_code=400)
    if payment.status != PaymentStatus.PENDING or not _still_payable(order, utcnow()):
        # Already settled, or the hold is gone: there is nothing to pay.
        return RedirectResponse(return_url, status.HTTP_303_SEE_OTHER)
    try:
        payment_object = halyk_payment.payment_object(db, payment, t)
    except halyk_epay.HalykError:
        return _page("Halyk ePay is unavailable right now. Please try again.", status_code=502)
    return _page(None, payment_object=payment_object)


@router.get("/payments/halyk/return", include_in_schema=False)
def halyk_return(db: DbSession, t: str = Query(max_length=4096)):
    """Halyk's backLink: settle what we can, then send the buyer home."""
    claims = _checkout_claims(t)
    if claims is None:
        # An expired link: we no longer know where they came from.
        return RedirectResponse(settings.PUBLIC_WEB_URL, status.HTTP_303_SEE_OTHER)
    payment_id, return_url = claims
    payment = db.get(Payment, payment_id)
    if payment is not None:
        try:
            halyk_payment.sync(db, payment, actor=None)
            db.commit()
        except halyk_epay.HalykError:
            # Still pending; the app's own sync call or the postLink settles it.
            db.rollback()
    return RedirectResponse(return_url, status.HTTP_303_SEE_OTHER)


@router.post("/payments/halyk/callback", include_in_schema=False)
async def halyk_callback(request: Request, db: DbSession) -> dict:
    """Halyk's postLink. The body is only a hint; sync() asks Halyk itself."""
    try:
        body = await request.json()
    except ValueError:
        body = None
    payment = halyk_payment.payment_for_callback(db, body) if isinstance(body, dict) else None
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown invoice")
    try:
        halyk_payment.sync(db, payment, actor=None)
    except halyk_epay.HalykError:
        db.rollback()
        # A non-2xx tells Halyk to deliver again later.
        raise HALYK_UNAVAILABLE from None
    db.commit()
    return {"accepted": True}


@router.post("/orders/{order_number}/halyk/sync", response_model=OrderRead)
def sync_halyk_payment(
    order_number: str, db: DbSession, user: OptionalUser, token: OrderToken = None
) -> dict:
    """Ask Halyk now about this order's latest invoice, and return the order.

    The apps call this when the buyer comes back from Halyk's page.
    """
    order = _viewable(db, order_number, user, token)
    payment = db.scalar(
        select(Payment)
        .where(Payment.order_id == order.id, Payment.provider == halyk_payment.NAME)
        .order_by(Payment.id.desc())
        .limit(1)
    )
    if payment is not None:
        try:
            halyk_payment.sync(db, payment, user)
            db.commit()
        except halyk_epay.HalykError:
            db.rollback()
            raise HALYK_UNAVAILABLE from None
    db.refresh(order)
    return _read(db, order)


# --- the page ----------------------------------------------------------------

_SANDBOX_NOTE = (
    "Halyk ePay test environment: no real money moves. "
    "Test card 4405 6397 0401 5096, 01/27, CVC 321."
)


def _script_json(value: dict) -> str:
    """JSON that is safe inside <script>: no "</script>" can close the tag early."""
    return (
        json.dumps(value, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
    )


def _page(
    message: str | None, *, payment_object: dict | None = None, status_code: int = 200
) -> HTMLResponse:
    note = f"<p class=note>{html.escape(_SANDBOX_NOTE)}</p>" if settings.HALYK_IS_SANDBOX else ""
    if payment_object is None:
        body = f"<p>{html.escape(message or '')}</p>"
        script = ""
    else:
        body = "<p id=status>Opening Halyk ePay…</p>" + note
        script = (
            f'<script src="{html.escape(settings.HALYK_PAYFORM_JS_URL)}"></script>'
            "<script>"
            f"var paymentObject = {_script_json(payment_object)};"
            "if (window.halyk && halyk.pay) { halyk.pay(paymentObject); }"
            " else { document.getElementById('status').textContent ="
            " 'Halyk ePay could not be loaded. Please try again.'; }"
            "</script>"
        )
    document = (
        "<!doctype html><html lang=en><head><meta charset=utf-8>"
        "<meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>BiletFlow · Halyk ePay</title>"
        "<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;"
        "padding:0 16px;text-align:center;color:#1f2933}.note{font-size:.85rem;color:#52606d}"
        "</style></head><body>"
        f"{body}{script}</body></html>"
    )
    return HTMLResponse(
        document,
        status_code=status_code,
        # The link carries a signed token: keep it out of caches and referrers.
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )
