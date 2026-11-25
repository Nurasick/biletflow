"""The Halyk Bank ePay HTTP client: the only module that talks to Halyk.

Everything Halyk-specific about the wire lives here (URLs, form fields, the
tenge-not-tiyn amount, the status vocabulary), so the payment logic in
halyk_payment.py reads in BiletFlow terms. Source: epayment.kz/docs, pages
"Платежная страница", "Получение токена", "Проверка статуса платежа",
"Возврат", "Отмена", "Подтверждение" (read 2026-11-25).

The flow, in one paragraph: the server asks Halyk's OAuth endpoint for a
token bound to one invoice and amount; the buyer's browser loads Halyk's
payment-api.js and calls `halyk.pay(paymentObject)` with that token, which
takes them to Halyk's card page; Halyk then calls our postLink and redirects
the buyer to our backLink. Neither of those is proof of payment: anyone can
POST to a URL or open a link. The proof is the status-check API, called
server to server with our own credentials. `check_status` is that call.
"""

import logging
from dataclasses import dataclass
from decimal import Decimal
from typing import Literal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

NAME = "halyk_epay"

# The token scope from the payment-page example, verbatim.
_PAYMENT_SCOPE = "webapi usermanagement email_send verification statement statistics payment"

# statusName values from the status-check page, sorted by what they mean for us.
# CHARGE is a one-step payment (the terminal default); AUTH is a hold that a
# two-step terminal still has to capture with `charge`.
_PAID = frozenset({"CHARGE", "AUTH"})
_FAILED = frozenset({"FAILED", "REJECT", "CANCEL", "CANCEL_OLD", "3D", "REFUND"})
# Anything else (NEW, FINGERPRINT, resultCode 102 "not found yet", 107 "in
# progress", 103 "try again") means "not decided yet": ask again later.

Outcome = Literal["paid", "failed", "pending"]


class HalykError(Exception):
    """Halyk was unreachable or answered something we cannot use."""


@dataclass(frozen=True)
class Status:
    outcome: Outcome
    # Halyk's own transaction id: the `:id` that refund/cancel/charge need.
    transaction_id: str | None = None
    status_name: str | None = None
    amount_minor: int | None = None
    currency: str | None = None
    reason: str | None = None


def tenge(amount_minor: int) -> str:
    """Halyk amounts are in tenge (the refund page's "10 тенге" minimum and
    every example are major units); BiletFlow stores tiyn. 150000 -> "1500"."""
    value = Decimal(amount_minor) / 100
    return f"{value:f}" if amount_minor % 100 else str(amount_minor // 100)


def _to_minor(amount: object) -> int | None:
    try:
        return int((Decimal(str(amount)) * 100).to_integral_value())
    except (ArithmeticError, ValueError):
        return None


def _client() -> httpx.Client:
    return httpx.Client(timeout=settings.HALYK_TIMEOUT_SECONDS)


def request_token(
    *,
    invoice_id: str | None = None,
    amount_minor: int | None = None,
    currency: str = "KZT",
    secret_hash: str | None = None,
    post_link: str | None = None,
) -> dict:
    """A client-credentials token. With an invoice it is the payment token the
    payment page needs, bound to that invoice and amount so the buyer cannot
    change what they pay. Halyk asks for a fresh token per operation."""
    form = {
        "grant_type": "client_credentials",
        "scope": _PAYMENT_SCOPE,
        "client_id": settings.HALYK_CLIENT_ID,
        "client_secret": settings.HALYK_CLIENT_SECRET,
        "terminal": settings.HALYK_TERMINAL_ID,
    }
    if invoice_id is not None:
        if amount_minor is None or secret_hash is None or post_link is None:
            raise ValueError("an invoice token needs amount_minor, secret_hash and post_link")
        form |= {
            "invoiceID": invoice_id,
            "amount": tenge(amount_minor),
            "currency": currency,
            "secret_hash": secret_hash,
            "postLink": post_link,
            "failurePostLink": post_link,
        }
    try:
        with _client() as client:
            response = client.post(settings.HALYK_OAUTH_URL, data=form)
    except httpx.HTTPError as exc:
        logger.warning("Halyk token request failed: %s", exc)
        raise HalykError("Halyk ePay could not be reached") from exc
    if response.status_code != 200:
        # The body can echo our form back; log the status only, never the secret.
        logger.warning("Halyk token request refused: HTTP %s", response.status_code)
        raise HalykError("Halyk ePay refused the payment request")
    body = response.json()
    if not isinstance(body, dict) or not body.get("access_token"):
        raise HalykError("Halyk ePay returned no token")
    return body


def _bearer() -> dict[str, str]:
    return {"Authorization": f"Bearer {request_token()['access_token']}"}


def check_status(invoice_id: str) -> Status:
    """The source of truth for whether an invoice was paid."""
    url = f"{settings.HALYK_API_URL}/check-status/payment/transaction/{invoice_id}"
    try:
        with _client() as client:
            response = client.get(url, headers=_bearer())
    except httpx.HTTPError as exc:
        raise HalykError("Halyk ePay could not be reached") from exc
    try:
        body = response.json()
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise HalykError(f"Halyk status check answered HTTP {response.status_code}")
    return _parse_status(body)


def _parse_status(body: dict) -> Status:
    code = str(body.get("resultCode", ""))
    transaction = body.get("transaction") if isinstance(body.get("transaction"), dict) else {}
    if code == "101":
        return Status("failed", reason=body.get("resultMessage") or "Payment rejected")
    if code != "100":
        return Status("pending")
    status_name = str(transaction.get("statusName", "")).upper()
    if status_name in _PAID:
        outcome: Outcome = "paid"
    elif status_name in _FAILED:
        outcome = "failed"
    else:
        outcome = "pending"
    return Status(
        outcome,
        transaction_id=str(transaction["id"]) if transaction.get("id") else None,
        status_name=status_name,
        amount_minor=_to_minor(transaction.get("amount")),
        currency=transaction.get("currency"),
        reason=transaction.get("reason") or None,
    )


def _operation(transaction_id: str, action: Literal["charge", "refund", "cancel"], **params):
    url = f"{settings.HALYK_API_URL}/operation/{transaction_id}/{action}"
    try:
        with _client() as client:
            response = client.post(url, headers=_bearer(), params=params or None)
    except httpx.HTTPError as exc:
        raise HalykError("Halyk ePay could not be reached") from exc
    if response.status_code != 200:
        logger.warning(
            "Halyk %s of %s refused: HTTP %s", action, transaction_id, response.status_code
        )
        raise HalykError(f"Halyk ePay refused the {action}")


def capture(transaction_id: str) -> None:
    """Turn an AUTH hold into a charge (two-step terminals only)."""
    _operation(transaction_id, "charge")


def refund(transaction_id: str, amount_minor: int) -> None:
    """Return a CHARGE. Halyk's minimum is 10 tenge."""
    _operation(transaction_id, "refund", amount=tenge(amount_minor))


def cancel(transaction_id: str) -> None:
    """Release an AUTH hold that was never captured."""
    _operation(transaction_id, "cancel")
