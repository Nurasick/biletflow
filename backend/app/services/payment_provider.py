"""The payment provider, simulated.

§3.2 and §4.6 allow "a provider sandbox or a clearly labelled internal
simulation" for the academic MVP; no real money moves. This module is the
simulation. The Halyk ePay sandbox (PAYMENT_PROVIDER=halyk) cannot fit the
one-call `charge` shape, because the buyer pays on Halyk's own page; it lives
in halyk_payment.py, and only `refund` here dispatches to it.

The caller picks the outcome. That is what makes the failure path (§4.10
"Payment failure") demonstrable on stage instead of theoretical.
"""

import secrets
from dataclasses import dataclass
from typing import Literal

from app.models.payment import Payment
from app.services import halyk_epay

NAME = "biletflow_simulator"
IS_SIMULATED = True

Outcome = Literal["succeed", "fail"]


@dataclass(frozen=True)
class Result:
    succeeded: bool
    provider_ref: str | None
    failure_reason: str | None = None


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
