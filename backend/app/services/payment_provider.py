"""The payment provider, simulated.

§3.2 and §4.6 allow "a provider sandbox or a clearly labelled internal
simulation" for the academic MVP; no real money moves. This module is the only
code that would change for a real sandbox: everything else talks to `charge`
and `refund` and reads `is_simulated` off the payment row.

The caller picks the outcome. That is what makes the failure path (§4.10
"Payment failure") demonstrable on stage instead of theoretical.
"""

import secrets
from dataclasses import dataclass
from typing import Literal

from app.models.payment import Payment

NAME = "biletflow_simulator"
IS_SIMULATED = True

Outcome = Literal["succeed", "fail"]


@dataclass(frozen=True)
class Result:
    succeeded: bool
    provider_ref: str
    failure_reason: str | None = None


def charge(amount_minor: int, outcome: Outcome) -> Result:
    ref = f"sim_ch_{secrets.token_hex(8)}"
    if outcome == "fail":
        return Result(False, ref, "Simulated decline: the card was refused")
    return Result(True, ref)


def refund(payment: Payment, amount_minor: int) -> Result:
    # A simulated charge can always be simulated back.
    return Result(True, f"sim_re_{secrets.token_hex(8)}")
