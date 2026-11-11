"""Promo codes and Campaign QR codes (§4.14, UC10; 05-campaigns.md checklist)."""

from datetime import timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import qr
from app.core.clock import utcnow
from app.models.audit import AuditLog
from app.models.campaign import Campaign, PromoRedemption
from app.models.event import Event, EventStatus
from app.models.order import Order
from app.models.organizer import OrganizerProfile
from app.models.user import User
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type

CAMPAIGNS = "/api/v1/organizer/events/{event_id}/campaigns"
PROMO = "/api/v1/events/{slug}/promo"
CHECKOUT = "/api/v1/events/{slug}/orders"
PAY = "/api/v1/orders/{number}/pay"
SCAN = "/api/v1/staff/events/{event_id}/scan"


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


@pytest.fixture
def event(db: Session, organizer) -> Event:
    event = add_event(db, organizer[1], status=EventStatus.PUBLISHED)
    activate_paid_sales(db, event)
    return event


def create(api, organizer, event, **overrides) -> dict:
    body = {
        "name": "Student week",
        "code": "STUDENT20",
        "discount_type": "percent",
        "discount_value": 20,
    } | overrides
    response = api.post(CAMPAIGNS.format(event_id=event.id), json=body, headers=auth(organizer[0]))
    assert response.status_code == 201, response.text
    return response.json()


def buy(api, event, *lines, **extra):
    return api.post(CHECKOUT.format(slug=event.slug), json=payload(*lines, **extra))


def pay(api, order: dict):
    return api.post(
        PAY.format(number=order["order_number"]),
        params={"token": order["access_token"]},
        json={"outcome": "succeed"},
    )


# --- creating ----------------------------------------------------------------


def test_creating_a_campaign_generates_a_code_a_token_and_a_link(api, db, organizer, event):
    body = create(api, organizer, event, code=None)

    campaign = db.scalar(select(Campaign))
    assert body["code"] == campaign.code and len(body["code"]) >= 6
    # The link carries the opaque token, never the discount (§4.14).
    assert body["link"].endswith(f"/events/{event.slug}?c={campaign.qr_token}")
    assert "20" not in campaign.qr_token and len(campaign.qr_token) >= 32
    assert body["ticket_type_ids"] == []
    assert db.scalar(select(AuditLog.action).where(AuditLog.action == "campaign.created"))


def test_a_code_is_unique_per_event_but_reusable_across_events(api, db, organizer, event):
    create(api, organizer, event)
    other = add_event(db, organizer[1], slug="other-event", status=EventStatus.PUBLISHED)

    duplicate = api.post(
        CAMPAIGNS.format(event_id=event.id),
        json={"name": "x", "code": "student20", "discount_type": "fixed", "discount_value": 100},
        headers=auth(organizer[0]),
    )

    assert duplicate.status_code == 409
    assert create(api, organizer, other)["code"] == "STUDENT20"


def test_a_percent_discount_above_100_is_rejected(api, organizer, event):
    response = api.post(
        CAMPAIGNS.format(event_id=event.id),
        json={"name": "x", "code": "FREE", "discount_type": "percent", "discount_value": 5000},
        headers=auth(organizer[0]),
    )

    assert response.status_code == 422


def test_another_organizer_cannot_see_or_create_campaigns(api, db, organizer, event):
    create(api, organizer, event)
    stranger, _ = add_organizer(db, "stranger@example.com")

    assert api.get(CAMPAIGNS.format(event_id=event.id), headers=auth(stranger)).status_code == 404


# --- applying ----------------------------------------------------------------


def test_quote_shows_the_discount_and_new_total_before_checkout(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    create(api, organizer, event)

    response = api.post(
        PROMO.format(slug=event.slug),
        json={"code": "student20", "items": [{"ticket_type_id": vip.id, "quantity": 2}]},
    )

    assert response.status_code == 200
    assert response.json() | {"name": "", "ticket_type_ids": []} == {
        "code": "STUDENT20",
        "name": "",
        "discount_type": "percent",
        "discount_value": 20,
        "ticket_type_ids": [],
        "subtotal_minor": 1_000_000,
        "discount_minor": 200_000,
        "total_minor": 800_000,
    }


def test_the_campaign_token_applies_the_same_code(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    create(api, organizer, event)
    token = db.scalar(select(Campaign.qr_token))

    response = api.post(
        PROMO.format(slug=event.slug),
        json={"token": token, "items": [{"ticket_type_id": vip.id, "quantity": 1}]},
    )

    assert response.json()["code"] == "STUDENT20"
    assert response.json()["discount_minor"] == 100_000


def test_each_rejection_has_its_own_message(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    general = add_ticket_type(db, event.id, name="General", price_minor=100_000)
    now = utcnow()
    create(api, organizer, event, code="DISABLED")
    create(api, organizer, event, code="EXPIRED", ends_at=(now - timedelta(days=1)).isoformat())
    create(api, organizer, event, code="LATER", starts_at=(now + timedelta(days=1)).isoformat())
    create(api, organizer, event, code="USEDUP", max_redemptions=1)
    create(api, organizer, event, code="VIPONLY", ticket_type_ids=[vip.id])
    db.execute(
        Campaign.__table__.update().where(Campaign.code == "DISABLED").values(is_active=False)
    )
    db.execute(
        Campaign.__table__.update().where(Campaign.code == "USEDUP").values(redemption_count=1)
    )
    db.commit()

    def reason(code: str) -> str:
        response = api.post(
            PROMO.format(slug=event.slug),
            json={"code": code, "items": [{"ticket_type_id": general.id, "quantity": 1}]},
        )
        assert response.status_code == 409, code
        return response.json()["detail"]

    messages = {
        code: reason(code) for code in ("NOPE", "DISABLED", "EXPIRED", "LATER", "USEDUP", "VIPONLY")
    }

    assert "does not exist" in messages["NOPE"]
    assert "disabled" in messages["DISABLED"]
    assert "expired" in messages["EXPIRED"]
    assert "not active yet" in messages["LATER"]
    assert "fully redeemed" in messages["USEDUP"]
    assert "does not apply" in messages["VIPONLY"]
    assert len(set(messages.values())) == 6


def test_an_unrestricted_campaign_covers_a_ticket_type_added_later(api, db, organizer, event):
    create(api, organizer, event)
    later = add_ticket_type(db, event.id, name="Late bird", price_minor=200_000)

    response = api.post(
        PROMO.format(slug=event.slug),
        json={"code": "STUDENT20", "items": [{"ticket_type_id": later.id, "quantity": 1}]},
    )

    assert response.json()["discount_minor"] == 40_000


def test_a_fixed_discount_never_exceeds_what_the_tickets_cost(api, db, organizer, event):
    cheap = add_ticket_type(db, event.id, price_minor=30_000)
    create(api, organizer, event, code="BIG", discount_type="fixed", discount_value=100_000)

    response = api.post(
        PROMO.format(slug=event.slug),
        json={"code": "BIG", "items": [{"ticket_type_id": cheap.id, "quantity": 1}]},
    )

    assert response.json()["discount_minor"] == 30_000
    assert response.json()["total_minor"] == 0


# --- checkout and redemption ---------------------------------------------------


def test_checkout_computes_the_discount_and_records_the_redemption(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    create(api, organizer, event)

    order = buy(api, event, (vip.id, 2), promo_code="STUDENT20").json()

    assert (order["subtotal_minor"], order["discount_minor"], order["total_minor"]) == (
        1_000_000,
        200_000,
        800_000,
    )
    assert order["promo_code"] == "STUDENT20"
    # Not redeemed until the order is actually confirmed (§7).
    assert db.scalar(select(Campaign.redemption_count)) == 0

    assert pay(api, order).status_code == 200
    db.expire_all()
    redemption = db.scalar(select(PromoRedemption))
    assert redemption.discount_minor == 200_000
    assert db.scalar(select(Campaign.redemption_count)) == 1
    assert db.scalar(select(Order.campaign_id)) == redemption.campaign_id


def test_a_client_sent_discount_amount_is_ignored(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)

    order = buy(api, event, (vip.id, 1), discount_minor=499_999, total_minor=1).json()

    assert order["discount_minor"] == 0
    assert order["total_minor"] == 500_000


def test_checkout_with_a_bad_code_fails_with_the_reason_and_holds_nothing(
    api, db, organizer, event
):
    vip = add_ticket_type(db, event.id, price_minor=500_000)

    response = buy(api, event, (vip.id, 1), promo_code="NOPE")

    assert response.status_code == 409
    assert "does not exist" in response.json()["detail"]
    db.refresh(vip)
    assert vip.quantity_reserved == 0


def test_the_last_redemption_cannot_be_taken_twice(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    create(api, organizer, event, max_redemptions=1)
    first = buy(api, event, (vip.id, 1), promo_code="STUDENT20").json()
    second = buy(api, event, (vip.id, 1), promo_code="STUDENT20").json()

    assert pay(api, first).status_code == 200
    refused = pay(api, second)

    assert refused.status_code == 409
    assert "fully redeemed" in refused.json()["detail"]
    assert "Nothing was charged" in refused.json()["detail"]
    db.expire_all()
    assert db.scalar(select(Campaign.redemption_count)) == 1
    # The refused order was cancelled and its ticket went back on sale.
    assert db.scalar(select(Order.status).where(Order.order_number == second["order_number"])) == (
        "cancelled"
    )
    db.refresh(vip)
    assert (vip.quantity_sold, vip.quantity_reserved) == (1, 0)


def test_editing_a_campaign_does_not_change_past_redemptions(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    campaign = create(api, organizer, event)
    pay(api, buy(api, event, (vip.id, 1), promo_code="STUDENT20").json())

    edited = api.patch(
        CAMPAIGNS.format(event_id=event.id) + f"/{campaign['id']}",
        json={"discount_value": 50},
        headers=auth(organizer[0]),
    )

    assert edited.status_code == 200
    db.expire_all()
    assert db.scalar(select(PromoRedemption.discount_minor)) == 100_000
    assert edited.json()["stats"]["discount_minor"] == 100_000


def test_disabling_a_campaign_rejects_its_code_and_is_on_the_timeline(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    campaign = create(api, organizer, event)

    api.patch(
        CAMPAIGNS.format(event_id=event.id) + f"/{campaign['id']}",
        json={"is_active": False},
        headers=auth(organizer[0]),
    )

    response = buy(api, event, (vip.id, 1), promo_code="STUDENT20")
    assert response.status_code == 409 and "disabled" in response.json()["detail"]
    assert db.scalar(select(AuditLog.action).where(AuditLog.action == "campaign.disabled"))


def test_campaign_stats_report_orders_tickets_and_revenue(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    create(api, organizer, event)
    pay(api, buy(api, event, (vip.id, 2), promo_code="STUDENT20").json())

    stats = api.get(CAMPAIGNS.format(event_id=event.id), headers=auth(organizer[0])).json()[0][
        "stats"
    ]

    assert stats == {
        "redemptions": 1,
        "orders": 1,
        "tickets_sold": 2,
        "gross_minor": 1_000_000,
        "discount_minor": 200_000,
        "refunds_minor": 0,
        "net_minor": 800_000,
    }


# --- the Campaign QR is not a ticket (§11) --------------------------------------


def test_the_qr_image_is_labelled_as_not_a_ticket(api, organizer, event):
    campaign = create(api, organizer, event)

    response = api.get(
        CAMPAIGNS.format(event_id=event.id) + f"/{campaign['id']}/qr.svg",
        headers=auth(organizer[0]),
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("image/svg+xml")
    assert "NOT A TICKET" in response.text and "STUDENT20" in response.text


def test_the_admission_scanner_rejects_a_campaign_qr_and_accepts_a_ticket(
    api, db, organizer, event
):
    free = add_ticket_type(db, event.id, price_minor=0)
    campaign = create(api, organizer, event)
    order = buy(api, event, (free.id, 1)).json()
    staff = organizer[0]
    scan_url = SCAN.format(event_id=event.id)

    # The link the Campaign QR encodes, and a correctly signed "cmp" payload.
    link = api.post(scan_url, json={"qr": campaign["link"]}, headers=auth(staff))
    signed = api.post(
        scan_url,
        json={"qr": qr.sign(qr.CAMPAIGN, "STUDENT20", event.id, "nonce")},
        headers=auth(staff),
    )
    ticket = api.post(scan_url, json={"qr": order["tickets"][0]["qr_payload"]}, headers=auth(staff))

    assert link.json()["outcome"] == "invalid"
    assert signed.json()["outcome"] == "invalid"
    assert ticket.json()["outcome"] == "valid"


def test_an_attendee_cannot_manage_campaigns(api, db, event):
    attendee = add_user(db, "attendee@example.com")

    response = api.get(CAMPAIGNS.format(event_id=event.id), headers=auth(attendee))

    assert response.status_code == 403
