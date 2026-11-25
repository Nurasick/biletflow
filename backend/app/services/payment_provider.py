"""Payment provider abstraction: built-in simulator and Halyk Bank ePay 2.0.

§3.2 and §4.6 allow "a provider sandbox or a clearly labelled internal
simulation" for the academic MVP; no real money moves. This module is the
simulation. The Halyk ePay sandbox (PAYMENT_PROVIDER=halyk) cannot fit the
one-call `charge` shape, because the buyer pays on Halyk's own page; it lives
in halyk_payment.py, and only `refund` here dispatches to it.

- `simulator`: immediate synthetic charges/refunds (`biletflow_simulator`).
- `halyk_sandbox`: Halyk Bank ePay 2.0 test gateway (`test-epay.epayment.kz`),
  using custom sandbox credentials from env or Halyk's public developer sandbox.
- `halyk`: Halyk Bank ePay 2.0 production gateway (`epay.homebank.kz`).
"""

import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from app.core.clock import utcnow
from app.core.config import settings
from app.models.payment import Payment
from app.services import halyk_epay

NAME = "biletflow_simulator"
IS_SIMULATED = True

HALYK_SANDBOX_NAME = "halyk_epay_sandbox"
HALYK_PROD_NAME = "halyk_epay"

# Official Halyk Bank ePay 2.0 public developer sandbox defaults
# (https://epayment.kz/docs/). Used only when PAYMENT_PROVIDER=halyk_sandbox
# and merchant-specific sandbox credentials are not configured in `.env`.
DEFAULT_SANDBOX_CLIENT_ID = "test"
DEFAULT_SANDBOX_CLIENT_SECRET = "yF587AV9Ms94qN2QShFzVR3vFnWkhjbAK3sG"
DEFAULT_SANDBOX_TERMINAL = "67e34d63-102f-4bd1-898e-370781d0074d"

DEFAULT_SANDBOX_OAUTH_URL = "https://test-epay-oauth.epayment.kz/oauth2/token"
DEFAULT_SANDBOX_API_URL = "https://test-epay-api.epayment.kz"
DEFAULT_SANDBOX_SCRIPT_URL = "https://test-epay.epayment.kz/payform/payment-api.js"

DEFAULT_PROD_OAUTH_URL = "https://epay-oauth.homebank.kz/oauth2/token"
DEFAULT_PROD_API_URL = "https://epay-api.homebank.kz"
DEFAULT_PROD_SCRIPT_URL = "https://epay.homebank.kz/payform/payment-api.js"

_API_SCOPE = "webapi usermanagement email_send verification statement statistics payment"
_SUCCESS_STATUSES = {"CHARGE", "AUTH", "SUCCESS", "PAID"}
_FAILURE_STATUSES = {"REJECT", "FAILED", "CANCEL", "DECLINED", "ERROR"}

Outcome = Literal["succeed", "fail"]
ProviderMode = Literal["simulator", "halyk_sandbox", "halyk"]


class PaymentGatewayError(Exception):
    """Raised when Halyk ePay returns an error or cannot be reached."""


@dataclass(frozen=True)
class Result:
    succeeded: bool
    provider_ref: str | None
    failure_reason: str | None = None


@dataclass(frozen=True)
class HalykConfig:
    mode: Literal["halyk_sandbox", "halyk"]
    client_id: str
    client_secret: str
    terminal: str
    oauth_url: str
    api_url: str
    script_url: str
    timeout_seconds: int


@dataclass(frozen=True)
class HalykTransactionStatus:
    state: Literal["pending", "succeeded", "failed"]
    invoice_id: str
    transaction_id: str | None = None
    status_name: str = ""
    amount_minor: int | None = None
    currency: str | None = None
    reason: str | None = None
    approval_code: str | None = None
    card_mask: str | None = None


def active_provider_mode() -> ProviderMode:
    return settings.PAYMENT_PROVIDER


def is_halyk_enabled() -> bool:
    return settings.PAYMENT_PROVIDER in ("halyk_sandbox", "halyk")


def current_provider_name() -> str:
    mode = settings.PAYMENT_PROVIDER
    if mode == "halyk_sandbox":
        return HALYK_SANDBOX_NAME
    if mode == "halyk":
        return HALYK_PROD_NAME
    return NAME


def current_is_simulated() -> bool:
    # Sandbox test-card transactions are clearly flagged so reports never
    # present test money as real revenue (§4.6); only live production is False.
    return settings.PAYMENT_PROVIDER != "halyk"


def get_halyk_config(
    *, mode_override: Literal["halyk_sandbox", "halyk"] | None = None
) -> HalykConfig:
    mode = mode_override or settings.PAYMENT_PROVIDER
    if mode not in ("halyk_sandbox", "halyk"):
        raise PaymentGatewayError("Halyk Bank payment gateway is not enabled")

    if mode == "halyk_sandbox":
        client_id = settings.HALYK_EPAY_CLIENT_ID.strip() or DEFAULT_SANDBOX_CLIENT_ID
        client_secret = settings.HALYK_EPAY_CLIENT_SECRET.strip() or DEFAULT_SANDBOX_CLIENT_SECRET
        terminal = settings.HALYK_EPAY_TERMINAL.strip() or DEFAULT_SANDBOX_TERMINAL
        oauth_url = settings.HALYK_EPAY_OAUTH_URL.strip() or DEFAULT_SANDBOX_OAUTH_URL
        api_url = (settings.HALYK_EPAY_API_URL.strip() or DEFAULT_SANDBOX_API_URL).rstrip("/")
        script_url = settings.HALYK_EPAY_PAYFORM_SCRIPT_URL.strip() or DEFAULT_SANDBOX_SCRIPT_URL
    else:
        client_id = settings.HALYK_EPAY_CLIENT_ID.strip()
        client_secret = settings.HALYK_EPAY_CLIENT_SECRET.strip()
        terminal = settings.HALYK_EPAY_TERMINAL.strip()
        if not (client_id and client_secret and terminal):
            raise PaymentGatewayError(
                "Halyk ePay production credentials (HALYK_EPAY_CLIENT_ID, "
                "HALYK_EPAY_CLIENT_SECRET, HALYK_EPAY_TERMINAL) must be configured"
            )
        oauth_url = settings.HALYK_EPAY_OAUTH_URL.strip() or DEFAULT_PROD_OAUTH_URL
        api_url = (settings.HALYK_EPAY_API_URL.strip() or DEFAULT_PROD_API_URL).rstrip("/")
        script_url = settings.HALYK_EPAY_PAYFORM_SCRIPT_URL.strip() or DEFAULT_PROD_SCRIPT_URL

    return HalykConfig(
        mode=mode,
        client_id=client_id,
        client_secret=client_secret,
        terminal=terminal,
        oauth_url=oauth_url,
        api_url=api_url,
        script_url=script_url,
        timeout_seconds=max(5, settings.HALYK_EPAY_TIMEOUT_SECONDS),
    )


def format_major_amount(amount_minor: int) -> int | float:
    if amount_minor % 100 == 0:
        return amount_minor // 100
    return float(Decimal(amount_minor) / Decimal(100))


def format_major_amount_str(amount_minor: int) -> str:
    if amount_minor % 100 == 0:
        return str(amount_minor // 100)
    return f"{Decimal(amount_minor) / Decimal(100):.2f}"


def major_to_minor(amount: int | float | str | Decimal | None) -> int | None:
    if amount is None or amount == "":
        return None
    try:
        dec = Decimal(str(amount))
    except InvalidOperation:
        return None
    return int((dec * Decimal(100)).quantize(Decimal("1")))


def generate_halyk_invoice_id(payment_id: int, now: datetime | None = None) -> str:
    """Strictly numeric 12-digit invoice ID required by Halyk ePay (6-15 digits)."""
    stamp = (now or utcnow()).strftime("%y%m%d")
    if payment_id < 1_000_000:
        return f"{stamp}{payment_id:06d}"
    return f"{stamp}{payment_id}"[-15:]


def pack_halyk_ref(invoice_id: str, transaction_id: str | None = None) -> str:
    if transaction_id:
        return f"{invoice_id}:{transaction_id}"
    return invoice_id


def unpack_halyk_ref(provider_ref: str | None) -> tuple[str | None, str | None]:
    if not provider_ref:
        return None, None
    if ":" in provider_ref:
        invoice_id, txn_id = provider_ref.split(":", 1)
        return invoice_id or None, txn_id or None
    return provider_ref, None


def halyk_language(locale: str | None) -> str:
    code = (locale or "en").lower()[:2]
    if code == "kk":
        return "kaz"
    if code == "ru":
        return "rus"
    return "eng"


def _http_json(
    url: str,
    *,
    method: str = "GET",
    form_data: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
    timeout: int = 15,
) -> tuple[int, dict[str, Any]]:
    req_headers = {"User-Agent": "BiletFlow/1.0", "Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    data: bytes | None = None
    if form_data is not None:
        data = urllib.parse.urlencode(form_data).encode("utf-8")
        req_headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            return resp.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed = json.loads(raw) if raw.strip() else {}
        except json.JSONDecodeError:
            parsed = {"raw": raw[:300]}
        return exc.code, parsed
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise PaymentGatewayError(f"Could not reach Halyk ePay: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise PaymentGatewayError("Halyk ePay returned invalid JSON") from exc


def request_halyk_payment_token(
    *,
    invoice_id: str,
    amount_minor: int,
    currency: str,
    post_link: str,
    failure_post_link: str,
    secret_hash: str,
    cfg: HalykConfig | None = None,
) -> dict[str, Any]:
    cfg = cfg or get_halyk_config()
    status_code, body = _http_json(
        cfg.oauth_url,
        method="POST",
        form_data={
            "grant_type": "client_credentials",
            "scope": "payment",
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "invoiceID": invoice_id,
            "amount": format_major_amount_str(amount_minor),
            "currency": currency,
            "terminal": cfg.terminal,
            "postLink": post_link,
            "failurePostLink": failure_post_link,
            "secret_hash": secret_hash,
        },
        timeout=cfg.timeout_seconds,
    )
    if status_code >= 400 or not body.get("access_token"):
        detail = (
            body.get("error_description") or body.get("message") or body.get("raw") or status_code
        )
        raise PaymentGatewayError(f"Halyk OAuth token request failed: {detail}")
    return body


def request_halyk_api_token(cfg: HalykConfig | None = None) -> str:
    cfg = cfg or get_halyk_config()
    status_code, body = _http_json(
        cfg.oauth_url,
        method="POST",
        form_data={
            "grant_type": "client_credentials",
            "scope": _API_SCOPE,
            "client_id": cfg.client_id,
            "client_secret": cfg.client_secret,
            "terminal": cfg.terminal,
        },
        timeout=cfg.timeout_seconds,
    )
    token = body.get("access_token")
    if status_code >= 400 or not token:
        detail = body.get("error_description") or body.get("message") or status_code
        raise PaymentGatewayError(f"Halyk API authorization failed: {detail}")
    return str(token)


def check_halyk_transaction_status(
    invoice_id: str,
    *,
    cfg: HalykConfig | None = None,
) -> HalykTransactionStatus:
    cfg = cfg or get_halyk_config()
    token = request_halyk_api_token(cfg)
    url = (
        f"{cfg.api_url}/check-status/payment/transaction/{urllib.parse.quote(invoice_id, safe='')}"
    )
    status_code, body = _http_json(
        url,
        method="GET",
        headers={"Authorization": f"Bearer {token}"},
        timeout=cfg.timeout_seconds,
    )
    if status_code >= 400:
        detail = body.get("resultMessage") or body.get("message") or status_code
        raise PaymentGatewayError(f"Halyk status check failed: {detail}")

    result_code = str(body.get("resultCode") or "")
    txn = body.get("transaction") if isinstance(body.get("transaction"), dict) else {}
    txn_id = str(txn.get("id") or "") or None
    status_name = str(txn.get("statusName") or "").strip().upper()
    reason_code = str(txn.get("reasonCode") or "").strip()
    reason = str(txn.get("reason") or body.get("resultMessage") or "").strip() or None
    amount_minor = (
        major_to_minor(txn.get("amount")) if txn.get("amount") not in (None, 0, "") else None
    )
    currency = str(txn.get("currency") or "").strip().upper() or None
    approval_code = str(txn.get("approvalCode") or "").strip() or None
    card_mask = str(txn.get("cardMask") or "").strip() or None

    # 102 = invoice not yet submitted on Halyk's form.
    if result_code == "102" or not txn_id:
        return HalykTransactionStatus(
            state="pending",
            invoice_id=invoice_id,
            status_name=status_name,
            reason=reason,
        )

    if status_name in _SUCCESS_STATUSES and reason_code in ("", "0", "00"):
        state: Literal["pending", "succeeded", "failed"] = "succeeded"
    elif status_name in _FAILURE_STATUSES or (reason_code not in ("", "0", "00")):
        state = "failed"
    else:
        state = "pending"

    return HalykTransactionStatus(
        state=state,
        invoice_id=invoice_id,
        transaction_id=txn_id,
        status_name=status_name,
        amount_minor=amount_minor,
        currency=currency,
        reason=reason,
        approval_code=approval_code,
        card_mask=card_mask,
    )


def charge(amount_minor: int, outcome: Outcome) -> Result:
    ref = f"sim_ch_{secrets.token_hex(8)}"
    if outcome == "fail":
        return Result(False, ref, "Simulated decline: the card was refused")
    return Result(True, ref)


def refund(payment: Payment, amount_minor: int) -> Result:
    """Refund through whichever provider took the payment.

    Dispatches on the row, not on settings.PAYMENT_PROVIDER: a deploy that
    switched providers must still refund old payments where they were made.
    """
    if payment.provider == halyk_epay.NAME:
        # Imported here: halyk_payment imports payment.py, which imports us.
        from app.services import halyk_payment

        try:
            return Result(True, halyk_payment.refund(payment, amount_minor))
        except halyk_epay.HalykError as exc:
            return Result(False, None, f"Halyk ePay refused the refund: {exc}")
    # A simulated charge can always be simulated back.
    return Result(True, f"sim_re_{secrets.token_hex(8)}")
