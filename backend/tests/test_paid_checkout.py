"""Paid sales end to end: activation (§3.2, §4.5), simulated payment (§4.6),
cancellation and refunds (§4.9). state-machines.md §2, §4, §5, §6."""

from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.activation import EventActivation
from app.models.audit import AuditLog
from app.models.event import Event, EventStatus
from app.models.order import Order, OrderStatus
from app.models.organizer import OrganizerProfile, VerificationStatus
from app.models.payment import Payment, PaymentStatus, Refund
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.models.user import User
from app.services import activation as activation_service
from app.services import event_lifecycle
from app.services import hold as hold_service
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type

CHECKOUT = "/api/v1/events/{slug}/orders"
PAY = "/api/v1/orders/{number}/pay"
CANCEL = "/api/v1/orders/{number}/cancel"
ACTIVATION = "/api/v1/organizer/events/{event_id}/activation"
REFUND = "/api/v1/organizer/events/{event_id}/orders/{number}/refund"
CANCEL_REG = "/api/v1/organizer/events/{event_id}/orders/{number}/cancel"


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


@pytest.fixture
def event(db: Session, organizer) -> Event:
    return add_event(db, organizer[1], status=EventStatus.PUBLISHED)


def buy(api, event: Event, ticket_type: TicketType, count: int = 1) -> dict:
    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((ticket_type.id, count)))
    assert response.status_code == 201, response.text
    return response.json()


def pay(api, order: dict, outcome: str = "succeed", key: str | None = None):
    headers = {"Idempotency-Key": key} if key else {}
    return api.post(
        PAY.format(number=order["order_number"]),
        params={"token": order["access_token"]},
        json={"outcome": outcome},
        headers=headers,
    )


def actions(db: Session) -> list[str]:
    return list(db.scalars(select(AuditLog.action).order_by(AuditLog.id)))


# --- §4.5: paid tickets are not purchasable before activation ---------------


def test_paid_checkout_is_refused_until_paid_sales_are_activated(api, db, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)

    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((vip.id, 1)))

    assert response.status_code == 409
    assert "not activated" in response.json()["detail"]
    db.refresh(vip)
    assert vip.quantity_reserved == 0


def test_free_tickets_stay_purchasable_on_an_unactivated_event(api, db, event):
    free = add_ticket_type(db, event.id, price_minor=0)

    assert buy(api, event, free)["status"] == "confirmed"


def test_activation_checklist_lists_what_is_missing(api, db, organizer, event):
    user, _ = organizer

    body = api.get(ACTIVATION.format(event_id=event.id), headers=auth(user)).json()

    assert body["status"] == "pending"
    assert body["is_simulated"] is True
    assert set(body["checklist"].values()) == {False}
    refused = api.post(ACTIVATION.format(event_id=event.id) + "/activate", headers=auth(user))
    assert refused.status_code == 409
    assert set(refused.json()["detail"]["missing"]) == set(body["checklist"])


def test_activation_completes_once_all_five_requirements_hold(api, db, organizer, event):
    user, profile = organizer
    add_ticket_type(db, event.id, price_minor=500_000)
    api.put(
        "/api/v1/organizer/profile",
        headers=auth(user),
        json={
            "display_name": "Jazz KZ",
            "contact_email": "organizer@example.com",
            "payout_provider": "sandbox_bank",
            "payout_reference": "demo_kaspi_01",
        },
    )
    api.post("/api/v1/organizer/profile/verify", headers=auth(user))
    base = ACTIVATION.format(event_id=event.id)
    api.post(base + "/terms", headers=auth(user))
    fee = api.post(base + "/fee", headers=auth(user), json={"outcome": "succeed"})

    response = api.post(base + "/activate", headers=auth(user))

    assert fee.status_code == 200
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "active"
    assert set(response.json()["checklist"].values()) == {True}
    fee_payment = db.scalar(select(Payment).where(Payment.event_id == event.id))
    assert fee_payment.is_simulated and fee_payment.status == PaymentStatus.SUCCEEDED
    assert {"activation.fee_paid", "activation.activated"} <= set(actions(db))


def test_a_declined_activation_fee_is_recorded_and_can_be_retried(api, db, organizer, event):
    user, _ = organizer
    base = ACTIVATION.format(event_id=event.id)

    declined = api.post(base + "/fee", headers=auth(user), json={"outcome": "fail"})
    retried = api.post(base + "/fee", headers=auth(user), json={"outcome": "succeed"})
    twice = api.post(base + "/fee", headers=auth(user), json={"outcome": "succeed"})

    assert declined.status_code == 402
    assert retried.json()["checklist"]["fee_paid"] is True
    assert twice.status_code == 409


def test_suspended_paid_sales_stop_paid_checkout_but_not_free(api, db, event):
    activation = activate_paid_sales(db, event)
    vip = add_ticket_type(db, event.id, price_minor=1_000)
    free = add_ticket_type(db, event.id, name="Free", price_minor=0)
    activation.status = "suspended"
    db.commit()

    paid = api.post(CHECKOUT.format(slug=event.slug), json=payload((vip.id, 1)))

    assert paid.status_code == 409
    assert buy(api, event, free)["status"] == "confirmed"


# --- §4.6: simulated payment -------------------------------------------------


@pytest.fixture
def vip(db: Session, event: Event) -> TicketType:
    activate_paid_sales(db, event)
    return add_ticket_type(db, event.id, price_minor=1_500_000, quantity_total=10)


def test_successful_payment_confirms_the_order_and_issues_tickets(api, db, event, vip):
    order = buy(api, event, vip, 2)

    response = pay(api, order)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "confirmed"
    assert len(body["tickets"]) == 2
    assert all(t["qr_payload"].startswith("BF1.adm.") for t in body["tickets"])
    payment = db.scalar(select(Payment))
    assert payment.is_simulated and payment.amount_minor == 3_000_000
    db.refresh(vip)
    assert (vip.quantity_sold, vip.quantity_reserved) == (2, 0)
    assert actions(db)[-2:] == ["payment.succeeded", "order.confirmed"]


def test_declined_payment_cancels_the_order_and_frees_the_tickets(api, db, event, vip):
    order = buy(api, event, vip, 2)

    response = pay(api, order, "fail")

    assert response.status_code == 402
    assert (
        api.get(
            f"/api/v1/orders/{order['order_number']}", params={"token": order["access_token"]}
        ).json()["status"]
        == "cancelled"
    )
    assert db.scalar(select(Payment.status)) == PaymentStatus.FAILED
    assert db.scalar(select(func.count()).select_from(Ticket)) == 0
    db.refresh(vip)
    assert (vip.quantity_sold, vip.quantity_reserved) == (0, 0)
    assert hold_service.find_reserved_drift(db) == []


def test_the_same_idempotency_key_charges_once_and_issues_one_set(api, db, event, vip):
    """state-machines.md §10.6: a payment delivered twice issues one set of tickets."""
    order = buy(api, event, vip, 2)

    first = pay(api, order, key="checkout-abc-1")
    second = pay(api, order, key="checkout-abc-1")

    assert first.status_code == second.status_code == 200
    assert db.scalar(select(func.count()).select_from(Payment)) == 1
    assert db.scalar(select(func.count()).select_from(Ticket)) == 2


def test_an_idempotency_key_cannot_be_reused_for_another_order(api, db, event, vip):
    first, second = buy(api, event, vip), buy(api, event, vip)
    pay(api, first, key="shared-key")

    response = pay(api, second, key="shared-key")

    assert response.status_code == 409


def test_an_expired_reservation_cannot_be_paid(api, db, event, vip):
    order = buy(api, event, vip)
    row = db.scalar(select(Order))
    row.expires_at = utcnow() - timedelta(seconds=1)
    db.commit()

    response = pay(api, order)

    assert response.status_code == 409
    assert db.scalar(select(func.count()).select_from(Payment)) == 0


def test_a_free_order_cannot_be_paid(api, db, event):
    free = add_ticket_type(db, event.id)
    order = buy(api, event, free)

    assert pay(api, order).status_code == 409


def test_the_buyer_can_abandon_a_pending_order(api, db, event, vip):
    order = buy(api, event, vip, 3)

    response = api.post(
        CANCEL.format(number=order["order_number"]), params={"token": order["access_token"]}
    )

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    db.refresh(vip)
    assert vip.quantity_reserved == 0


def test_a_stranger_cannot_pay_or_cancel_someone_elses_order(api, db, event, vip):
    order = buy(api, event, vip)

    assert api.post(PAY.format(number=order["order_number"]), json={}).status_code == 404
    assert api.post(CANCEL.format(number=order["order_number"])).status_code == 404


# --- T13: a suspension also stops checkouts that are already pending --------
#
# Checkout refuses new paid reservations once an admin suspends (see
# test_suspended_paid_sales_stop_paid_checkout_but_not_free above). These cover
# the buyer who reserved *before* the suspension and pays *after* it. The race
# itself (pay and suspend at the same moment) needs real row locks, so it
# lives in test_payment_suspension_race.py against Postgres.


@pytest.fixture
def platform_admin(db: Session) -> User:
    user = add_user(db, "platform-admin@example.com")
    user.is_platform_admin = True
    db.commit()
    return user


def suspend_paid_sales(db: Session, event: Event, admin: User) -> None:
    activation = db.scalar(select(EventActivation).where(EventActivation.event_id == event.id))
    activation_service.suspend(db, activation, admin, "fraud review")
    db.commit()


def suspend_event(db: Session, event: Event, admin: User) -> None:
    event_lifecycle.suspend(db, event, admin, "policy review")  # commits itself


@pytest.mark.parametrize("suspend", [suspend_paid_sales, suspend_event])
def test_a_pending_order_cannot_be_paid_after_a_suspension(
    api, db, event, vip, platform_admin, suspend
):
    order = buy(api, event, vip, 2)
    suspend(db, event, platform_admin)

    response = pay(api, order)

    assert response.status_code == 409, response.text
    assert "Nothing was charged" in response.json()["detail"]
    # Nothing charged, nothing issued...
    assert db.scalar(select(func.count()).select_from(Payment)) == 0
    assert db.scalar(select(func.count()).select_from(Ticket)) == 0
    # ...and the hold went back now, not in ten minutes when the sweeper runs.
    db.expire_all()
    assert db.scalar(select(Order.status)) == OrderStatus.CANCELLED
    db.refresh(vip)
    assert (vip.quantity_sold, vip.quantity_reserved) == (0, 0)
    assert hold_service.find_reserved_drift(db) == []


@pytest.mark.parametrize("suspend", [suspend_paid_sales, suspend_event])
def test_a_suspension_leaves_already_confirmed_tickets_valid(
    api, db, event, vip, platform_admin, suspend
):
    paid_before = buy(api, event, vip)
    assert pay(api, paid_before).status_code == 200
    pending = buy(api, event, vip)
    suspend(db, event, platform_admin)

    assert pay(api, pending).status_code == 409

    # The suspension stops *new* money. Whoever already paid keeps a ticket
    # that still scans; cancelling the event (with refunds) is a separate act.
    db.expire_all()
    assert list(db.scalars(select(Ticket.status))) == [TicketStatus.VALID]
    db.refresh(vip)
    assert (vip.quantity_sold, vip.quantity_reserved) == (1, 0)


def test_paying_twice_after_a_suspension_is_refused_both_times(api, db, event, vip, platform_admin):
    """A double-click: the second request finds the order already cancelled by
    the first and must still answer 409, not 500."""
    order = buy(api, event, vip)
    suspend_paid_sales(db, event, platform_admin)

    first, second = pay(api, order), pay(api, order)

    assert first.status_code == second.status_code == 409


def test_free_registration_still_works_while_only_paid_sales_are_suspended(
    api, db, event, vip, platform_admin
):
    free = add_ticket_type(db, event.id, name="Free", price_minor=0)
    suspend_paid_sales(db, event, platform_admin)

    assert buy(api, event, free)["status"] == "confirmed"


# --- §4.9: refunds and cancelled registrations ------------------------------


def test_organizer_refund_voids_tickets_and_returns_inventory(api, db, organizer, event, vip):
    user, _ = organizer
    order = buy(api, event, vip, 2)
    pay(api, order)

    response = api.post(
        REFUND.format(event_id=event.id, number=order["order_number"]),
        headers=auth(user),
        json={"reason": "Customer request"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "refunded"
    assert set(db.scalars(select(Ticket.status))) == {"refunded"}
    refund = db.scalar(select(Refund))
    assert refund.status == "succeeded" and refund.amount_minor == 3_000_000
    assert db.scalar(select(Payment.status)) == PaymentStatus.REFUNDED
    db.refresh(vip)
    assert vip.quantity_sold == 0
    assert {"refund.initiated", "order.refunded"} <= set(actions(db))


def test_a_refund_cannot_happen_twice(api, db, organizer, event, vip):
    user, _ = organizer
    order = buy(api, event, vip)
    pay(api, order)
    url = REFUND.format(event_id=event.id, number=order["order_number"])

    api.post(url, headers=auth(user), json={"reason": "x"})
    again = api.post(url, headers=auth(user), json={"reason": "x"})

    assert again.status_code == 409
    assert db.scalar(select(func.count()).select_from(Refund)) == 1


def test_organizer_cancels_a_free_registration(api, db, organizer, event):
    user, _ = organizer
    free = add_ticket_type(db, event.id, quantity_total=5)
    order = buy(api, event, free, 2)

    response = api.post(
        CANCEL_REG.format(event_id=event.id, number=order["order_number"]), headers=auth(user)
    )

    assert response.json()["status"] == "cancelled"
    assert set(db.scalars(select(Ticket.status))) == {"cancelled"}
    db.refresh(free)
    assert free.quantity_sold == 0


def test_a_paid_order_is_refunded_not_cancelled(api, db, organizer, event, vip):
    user, _ = organizer
    order = buy(api, event, vip)
    pay(api, order)

    response = api.post(
        CANCEL_REG.format(event_id=event.id, number=order["order_number"]), headers=auth(user)
    )

    assert response.status_code == 409


def test_another_organizer_cannot_refund_this_events_orders(api, db, event, vip):
    order = buy(api, event, vip)
    pay(api, order)
    stranger, _ = add_organizer(db, "other@example.com")

    response = api.post(
        REFUND.format(event_id=event.id, number=order["order_number"]),
        headers=auth(stranger),
        json={"reason": "x"},
    )

    assert response.status_code == 404


def test_unverified_profile_blocks_activation(api, db, organizer, event):
    user, profile = organizer
    profile.verification_status = VerificationStatus.UNVERIFIED
    db.commit()

    body = api.get(ACTIVATION.format(event_id=event.id), headers=auth(user)).json()

    assert body["checklist"]["organizer_verified"] is False
