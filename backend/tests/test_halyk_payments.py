"""Halyk ePay sandbox checkout (services/halyk_payment.py, routes/halyk.py).

Halyk itself is faked at the HTTP-client boundary (services/halyk_epay.py):
these tests are about what BiletFlow does with each answer Halyk can give,
not about Halyk. The fake's `status` is what the status-check API reports.
"""

from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import func, select

from app.core.clock import utcnow
from app.core.config import settings
from app.models.order import Order, OrderStatus
from app.models.payment import Payment, PaymentStatus
from app.models.ticket_type import TicketType
from app.services import halyk_epay, halyk_payment
from app.services import hold as hold_service
from tests import test_paid_checkout as paid
from tests.test_events import auth
from tests.test_paid_checkout import REFUND, actions, buy, pay

# Reuse that module's fixtures. Bound by assignment, not imported by name, so
# pytest finds them here and ruff does not read each use as a shadowed import.
organizer = paid.organizer
event = paid.event
vip = paid.vip

WEB_RETURN = f"{settings.PUBLIC_WEB_URL}/orders/X?halyk=1"


class FakeHalyk:
    def __init__(self) -> None:
        self.status = halyk_epay.Status("pending")
        self.token_requests: list[dict] = []
        self.refunds: list[tuple[str, int]] = []
        self.captures: list[str] = []
        self.down = False

    def request_token(self, **kwargs) -> dict:
        if self.down:
            raise halyk_epay.HalykError("down")
        self.token_requests.append(kwargs)
        return {"access_token": "tok", "token_type": "Bearer", "expires_in": 7200}

    def check_status(self, invoice_id: str) -> halyk_epay.Status:
        if self.down:
            raise halyk_epay.HalykError("down")
        return self.status

    def refund(self, transaction_id: str, amount_minor: int) -> None:
        self.refunds.append((transaction_id, amount_minor))

    def capture(self, transaction_id: str) -> None:
        self.captures.append(transaction_id)

    def paid(self, amount_minor: int, status_name: str = "CHARGE") -> None:
        self.status = halyk_epay.Status(
            "paid", "tx-1", status_name, amount_minor=amount_minor, currency="KZT"
        )


@pytest.fixture
def halyk(monkeypatch) -> FakeHalyk:
    fake = FakeHalyk()
    for name in ("request_token", "check_status", "refund", "capture"):
        monkeypatch.setattr(halyk_epay, name, getattr(fake, name))
    monkeypatch.setattr(settings, "PAYMENT_PROVIDER", "halyk")
    monkeypatch.setattr(settings, "HALYK_TERMINAL_ID", "terminal-1")
    return fake


def start(api, order: dict, return_url: str = WEB_RETURN):
    return api.post(
        f"/api/v1/orders/{order['order_number']}/halyk",
        params={"token": order["access_token"]},
        json={"return_url": return_url},
    )


def checkout_token(response) -> str:
    return parse_qs(urlsplit(response.json()["checkout_url"]).query)["t"][0]


def sync(api, order: dict):
    return api.post(
        f"/api/v1/orders/{order['order_number']}/halyk/sync",
        params={"token": order["access_token"]},
    )


# --- which checkout --------------------------------------------------------------


def test_provider_endpoint_reports_the_simulator_by_default(api):
    assert api.get("/api/v1/payments/provider").json() == {
        "provider": "simulator",
        "is_sandbox": False,
    }


def test_the_simulated_pay_endpoint_is_closed_in_halyk_mode(api, db, event, vip, halyk):
    order = buy(api, event, vip)

    response = pay(api, order)

    assert response.status_code == 409
    assert db.scalar(select(Order.status)) == OrderStatus.PENDING


def test_halyk_checkout_is_refused_while_the_simulator_is_on(api, event, vip):
    order = buy(api, event, vip)
    assert start(api, order).status_code == 409


# --- start ---------------------------------------------------------------------


def test_start_opens_a_pending_sandbox_invoice(api, db, event, vip, halyk):
    order = buy(api, event, vip, 2)

    response = start(api, order)

    assert response.status_code == 200, response.text
    payment = db.scalar(select(Payment))
    assert payment.status == PaymentStatus.PENDING
    assert payment.is_simulated and payment.amount_minor == 3_000_000
    assert payment.provider_ref == response.json()["invoice_id"]
    assert len(payment.provider_ref) == 15 and payment.provider_ref.isdigit()
    assert db.scalar(select(Order.status)) == OrderStatus.PENDING


def test_a_second_start_reuses_the_undecided_invoice(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    first = start(api, order).json()["invoice_id"]

    second = start(api, order).json()["invoice_id"]

    assert first == second
    assert db.scalar(select(func.count()).select_from(Payment)) == 1


@pytest.mark.parametrize(
    "url",
    ["https://evil.example/orders", "javascript:alert(1)", "http://localhost:5173.evil.example/"],
)
def test_start_refuses_a_return_url_we_do_not_own(api, event, vip, halyk, url):
    order = buy(api, event, vip)
    assert start(api, order, url).status_code == 422


def test_start_accepts_the_mobile_apps_deep_link(api, event, vip, halyk):
    order = buy(api, event, vip)
    assert start(api, order, "exp://192.168.1.5:8081/--/payment-return").status_code == 200


def test_an_expired_reservation_cannot_start_a_payment(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    db.scalar(select(Order)).expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    assert start(api, order).status_code == 409
    assert db.scalar(select(func.count()).select_from(Payment)) == 0


# --- the checkout page -------------------------------------------------------------


def test_checkout_page_runs_halyk_pay_with_a_token_bound_to_the_invoice(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    started = start(api, order)

    page = api.get("/api/v1/payments/halyk/checkout", params={"t": checkout_token(started)})

    assert page.status_code == 200
    assert "halyk.pay(paymentObject)" in page.text
    assert settings.HALYK_PAYFORM_JS_URL in page.text
    assert page.headers["cache-control"] == "no-store"
    [request] = halyk.token_requests
    invoice = started.json()["invoice_id"]
    assert request["invoice_id"] == invoice and request["amount_minor"] == 1_500_000
    assert request["secret_hash"] == halyk_payment.secret_hash(invoice)


def test_checkout_page_json_cannot_close_the_script_tag(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    db.scalar(select(Order)).contact_email = "a</script><script>alert(1)//@x.kz"
    db.commit()

    page = api.get(
        "/api/v1/payments/halyk/checkout", params={"t": checkout_token(start(api, order))}
    )

    assert "</script><script>alert" not in page.text


def test_a_forged_checkout_token_is_refused(api, halyk):
    page = api.get("/api/v1/payments/halyk/checkout", params={"t": "not-a-token"})
    assert page.status_code == 400


# --- settling ----------------------------------------------------------------------


def test_a_charge_confirms_the_order_and_issues_tickets(api, db, event, vip, halyk):
    order = buy(api, event, vip, 2)
    start(api, order)
    halyk.paid(3_000_000)

    response = sync(api, order)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "confirmed"
    assert len(response.json()["tickets"]) == 2
    assert db.scalar(select(Payment.status)) == PaymentStatus.SUCCEEDED
    assert actions(db)[-2:] == ["payment.succeeded", "order.confirmed"]


def test_syncing_twice_issues_tickets_once(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    start(api, order)
    halyk.paid(1_500_000)

    sync(api, order)
    response = sync(api, order)

    assert len(response.json()["tickets"]) == 1
    assert actions(db).count("payment.succeeded") == 1


def test_an_auth_hold_is_captured_before_tickets_are_issued(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    start(api, order)
    halyk.paid(1_500_000, status_name="AUTH")

    assert sync(api, order).json()["status"] == "confirmed"
    assert halyk.captures == ["tx-1"]


def test_an_undecided_invoice_leaves_the_order_pending(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    start(api, order)

    assert sync(api, order).json()["status"] == "pending"
    assert db.scalar(select(Payment.status)) == PaymentStatus.PENDING


def test_a_decline_cancels_the_order_and_frees_the_tickets(api, db, event, vip, halyk):
    order = buy(api, event, vip, 2)
    start(api, order)
    halyk.status = halyk_epay.Status("failed", reason="Insufficient funds")

    response = sync(api, order)

    assert response.json()["status"] == "cancelled"
    payment = db.scalar(select(Payment))
    assert payment.status == PaymentStatus.FAILED
    assert payment.failure_reason == "Insufficient funds"
    vip_row = db.get(TicketType, vip.id)
    db.refresh(vip_row)
    assert vip_row.quantity_reserved == 0


def test_a_late_charge_still_confirms_while_the_holds_are_unswept(api, db, event, vip, halyk):
    # The 10 minutes ran out on Halyk's page, but nobody else has the tickets
    # yet: honouring the payment beats refunding it.
    order = buy(api, event, vip)
    start(api, order)
    db.scalar(select(Order)).expires_at = utcnow() - timedelta(seconds=1)
    db.commit()
    halyk.paid(1_500_000)

    assert sync(api, order).json()["status"] == "confirmed"
    assert halyk.refunds == []


def test_a_charge_after_the_sweeper_released_the_holds_is_refunded(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    start(api, order)
    hold_service.release_expired_holds(db, utcnow() + timedelta(hours=1))
    db.commit()
    halyk.paid(1_500_000)

    response = sync(api, order)

    assert response.json()["status"] != "confirmed"
    assert response.json()["tickets"] == []
    assert halyk.refunds == [("tx-1", 1_500_000)]
    assert db.scalar(select(Payment.status)) == PaymentStatus.REFUNDED
    assert "payment.reversed" in actions(db)


def test_a_wrong_amount_is_never_ticketed(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    start(api, order)
    halyk.paid(100)

    assert sync(api, order).json()["status"] != "confirmed"
    assert halyk.refunds == [("tx-1", 1_500_000)]


def test_halyk_being_down_leaves_the_payment_pending(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    start(api, order)
    halyk.down = True

    assert sync(api, order).status_code == 502
    assert db.scalar(select(Payment.status)) == PaymentStatus.PENDING


# --- return and callback --------------------------------------------------------------


def test_the_return_link_settles_and_sends_the_buyer_back(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    token = checkout_token(start(api, order))
    halyk.paid(1_500_000)

    response = api.get("/api/v1/payments/halyk/return", params={"t": token}, follow_redirects=False)

    assert response.status_code == 303
    assert response.headers["location"] == WEB_RETURN
    assert db.scalar(select(Order.status)) == OrderStatus.CONFIRMED


def test_a_genuine_callback_settles_the_payment(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    invoice = start(api, order).json()["invoice_id"]
    halyk.paid(1_500_000)

    response = api.post(
        "/api/v1/payments/halyk/callback",
        json={
            "invoiceId": invoice,
            "secret_hash": halyk_payment.secret_hash(invoice),
            "code": "ok",
        },
    )

    assert response.status_code == 200
    assert db.scalar(select(Order.status)) == OrderStatus.CONFIRMED


def test_a_forged_callback_is_ignored(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    invoice = start(api, order).json()["invoice_id"]
    halyk.paid(1_500_000)

    response = api.post(
        "/api/v1/payments/halyk/callback",
        json={"invoiceId": invoice, "secret_hash": "guess", "code": "ok"},
    )

    assert response.status_code == 404
    assert db.scalar(select(Order.status)) == OrderStatus.PENDING


def test_a_callback_claiming_success_cannot_confirm_an_unpaid_invoice(api, db, event, vip, halyk):
    order = buy(api, event, vip)
    invoice = start(api, order).json()["invoice_id"]
    # Halyk's status API still says nothing was paid, whatever the body claims.

    api.post(
        "/api/v1/payments/halyk/callback",
        json={
            "invoiceId": invoice,
            "secret_hash": halyk_payment.secret_hash(invoice),
            "code": "ok",
        },
    )

    assert db.scalar(select(Order.status)) == OrderStatus.PENDING


# --- refunds ------------------------------------------------------------------------


def test_an_organizer_refund_goes_back_through_halyk(api, db, organizer, event, vip, halyk):
    user, _ = organizer
    order = buy(api, event, vip)
    start(api, order)
    halyk.paid(1_500_000)
    sync(api, order)

    response = api.post(
        REFUND.format(event_id=event.id, number=order["order_number"]),
        headers=auth(user),
        json={"reason": "Customer request"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "refunded"
    assert halyk.refunds == [("tx-1", 1_500_000)]
