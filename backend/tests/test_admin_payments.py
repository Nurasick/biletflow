"""Admin payment lookup (§4.12, §8; audit T10).

An admin finds one simulated payment by its id, its order's number or its
provider reference, and inspects it with its order, refunds and the support
cases about that order. Cases show only their existence and state: the
conversation stays between the attendee and the event's organizer.
"""

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.organizer import OrganizerProfile
from app.models.payment import Payment, PaymentPurpose, PaymentStatus
from app.models.user import User
from tests.test_documents_and_admin import buy
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import activate_paid_sales
from tests.test_ticket_types import add_ticket_type

PAYMENTS = "/api/v1/admin/payments"
PAYMENT = "/api/v1/admin/payments/{payment_id}"
REFUND = "/api/v1/organizer/events/{event_id}/orders/{number}/refund"
CASES = "/api/v1/support/cases"


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


@pytest.fixture
def event(db: Session, organizer) -> Event:
    event = add_event(db, organizer[1], status=EventStatus.PUBLISHED)
    activate_paid_sales(db, event)
    return event


@pytest.fixture
def admin(db: Session) -> User:
    user = add_user(db, "admin@example.com")
    user.is_platform_admin = True
    db.commit()
    return user


@pytest.fixture
def buyer(db: Session) -> User:
    return add_user(db, "aru@example.com")


def payments(api, admin: User, **params) -> list[dict]:
    response = api.get(PAYMENTS, params=params, headers=auth(admin))
    assert response.status_code == 200, response.text
    return response.json()


def payment_for(api, admin: User, order_number: str) -> dict:
    [row] = payments(api, admin, q=order_number)
    return row


# --- finding a payment ----------------------------------------------------------


def test_an_admin_finds_a_payment_by_its_order_number(api, db, admin, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    wanted = buy(api, event, vip)
    buy(api, event, vip)

    rows = payments(api, admin, q=wanted["order_number"])

    assert [row["order_number"] for row in rows] == [wanted["order_number"]]
    assert rows[0]["status"] == "succeeded" and rows[0]["is_simulated"] is True


def test_an_admin_finds_a_payment_by_its_exact_id(api, db, admin, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    # Twelve payments, so ids 1 and 10-12 exist: "1" must find only id 1.
    for _ in range(12):
        buy(api, event, vip)

    rows = payments(api, admin, q="1")

    assert [row["id"] for row in rows] == [1]


def test_a_search_with_no_match_is_empty_not_an_error(api, admin):
    assert payments(api, admin, q="BF-000000-NOPE") == []


def test_search_and_status_filter_combine(api, db, admin, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = buy(api, event, vip)

    assert payments(api, admin, q=order["order_number"], status="failed") == []
    assert len(payments(api, admin, q=order["order_number"], status="succeeded")) == 1


# --- inspecting a payment -------------------------------------------------------


def test_a_payment_shows_its_order_refund_and_support_cases(
    api, db, admin, organizer, event, buyer
):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = buy(api, event, vip, user=buyer)
    case = api.post(
        CASES,
        json={
            "category": "payment",
            "body": "I was charged twice, card ending 4242",
            "order_number": order["order_number"],
        },
        headers=auth(buyer),
    ).json()
    api.post(
        REFUND.format(event_id=event.id, number=order["order_number"]),
        json={"reason": "Charged twice"},
        headers=auth(organizer[0]),
    )
    payment_id = payment_for(api, admin, order["order_number"])["id"]

    detail = api.get(PAYMENT.format(payment_id=payment_id), headers=auth(admin)).json()

    assert detail["id"] == payment_id and detail["status"] == "refunded"
    assert detail["order"]["order_number"] == order["order_number"]
    assert detail["order"]["status"] == "refunded"
    assert detail["order"]["event_title"] == event.title
    assert [(r["amount_minor"], r["reason"]) for r in detail["refunds"]] == [
        (500_000, "Charged twice")
    ]
    [summary] = detail["support_cases"]
    assert summary["case_number"] == case["case_number"]
    assert summary["category"] == "payment" and summary["status"] == "open"


def test_an_admin_never_sees_what_was_written_in_a_case(api, db, admin, event, buyer):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = buy(api, event, vip, user=buyer)
    api.post(
        CASES,
        json={
            "category": "payment",
            "body": "Secret: card ending 4242",
            "order_number": order["order_number"],
        },
        headers=auth(buyer),
    )
    payment_id = payment_for(api, admin, order["order_number"])["id"]

    response = api.get(PAYMENT.format(payment_id=payment_id), headers=auth(admin))

    assert "4242" not in response.text
    assert set(response.json()["support_cases"][0]) == {
        "case_number",
        "audience",
        "category",
        "status",
        "created_at",
        "updated_at",
        "resolved_at",
    }


def test_another_orders_cases_are_not_attached(api, db, admin, event, buyer):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    mine = buy(api, event, vip, user=buyer)
    other = buy(api, event, vip, user=buyer)
    api.post(
        CASES,
        json={"category": "payment", "body": "?", "order_number": other["order_number"]},
        headers=auth(buyer),
    )
    payment_id = payment_for(api, admin, mine["order_number"])["id"]

    detail = api.get(PAYMENT.format(payment_id=payment_id), headers=auth(admin)).json()

    assert detail["support_cases"] == []
    assert detail["refunds"] == []


def test_an_activation_fee_has_no_order_and_no_cases(api, db, admin, event):
    fee = Payment(
        purpose=PaymentPurpose.ACTIVATION_FEE,
        event_id=event.id,
        provider="simulated",
        amount_minor=500_000,
        status=PaymentStatus.SUCCEEDED,
        is_simulated=True,
    )
    db.add(fee)
    db.commit()

    detail = api.get(PAYMENT.format(payment_id=fee.id), headers=auth(admin)).json()

    assert detail["purpose"] == "activation_fee" and detail["event_id"] == event.id
    assert detail["order"] is None
    assert detail["support_cases"] == [] and detail["refunds"] == []


def test_an_unknown_payment_is_404(api, admin):
    assert api.get(PAYMENT.format(payment_id=999), headers=auth(admin)).status_code == 404


# --- who may look -----------------------------------------------------------------


def test_ordinary_accounts_cannot_look_up_payments(api, db, organizer, event, buyer):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = buy(api, event, vip, user=buyer)

    for user in (buyer, organizer[0]):
        assert (
            api.get(PAYMENTS, params={"q": order["order_number"]}, headers=auth(user)).status_code
            == 403
        )
        assert api.get(PAYMENT.format(payment_id=1), headers=auth(user)).status_code == 403
    assert api.get(PAYMENT.format(payment_id=1)).status_code in (401, 403)
