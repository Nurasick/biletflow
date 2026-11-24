"""Tests for 1B: private-event access control, lifecycle guards, concurrency/idempotency,
attendee free-order self-cancellation, refund policy cutoffs, attendee linking & is_simulated."""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.activation import ActivationStatus, EventActivation
from app.models.attendee import Attendee
from app.models.audit import AuditLog
from app.models.event import EventStatus
from app.models.order import OrderStatus
from app.models.payment import Payment
from app.models.ticket import TicketStatus
from app.services import payment_provider
from tests.test_event_images import PNG, data_url
from tests.test_events import add_event, add_organizer, add_user, auth, event_payload
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type


def test_private_event_access_control_across_all_public_routes(api, db: Session):
    owner, profile = add_organizer(db, "owner@example.com")
    admin = add_user(db, "admin@example.com")
    admin.is_platform_admin = True
    stranger = add_user(db, "stranger@example.com")
    db.commit()

    created = api.post(
        "/api/v1/events",
        headers=auth(owner),
        json=event_payload(
            slug="secret-gala",
            visibility="private",
            access_code="VIP2026",
        ),
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    assert created.json()["has_access_code"] is True
    assert "access_code" not in created.json()

    tt = add_ticket_type(db, event_id, price_minor=0, quantity_total=20)
    pub = api.post(f"/api/v1/organizer/events/{event_id}/publish", headers=auth(owner))
    assert pub.status_code == 200

    # Without credentials, all public endpoints reject with 403.
    for method, url, kwargs in (
        ("get", "/api/v1/events/secret-gala", {}),
        ("get", "/api/v1/events/secret-gala/ticket-types", {}),
        ("post", "/api/v1/events/secret-gala/orders", {"json": payload((tt.id, 1))}),
        (
            "post",
            "/api/v1/events/secret-gala/promo",
            {"json": {"code": "NOPE", "items": [{"ticket_type_id": tt.id, "quantity": 1}]}},
        ),
        ("get", "/api/v1/events/secret-gala/calendar.ics", {}),
    ):
        res = getattr(api, method)(url, headers=auth(stranger), **kwargs)
        assert res.status_code == 403, f"{method} {url} -> {res.status_code}"
        assert res.json()["detail"]["code"] == "private_event_access_required"

    # Owner & Platform Admin bypass private-event restrictions.
    assert api.get("/api/v1/events/secret-gala", headers=auth(owner)).status_code == 200
    assert api.get("/api/v1/events/secret-gala", headers=auth(admin)).status_code == 200

    # Wrong code fails unlock; right code mints a working access token.
    bad = api.post("/api/v1/events/secret-gala/unlock", json={"access_code": "WRONG"})
    assert bad.status_code == 403
    unlocked = api.post("/api/v1/events/secret-gala/unlock", json={"access_code": "VIP2026"})
    assert unlocked.status_code == 200
    token = unlocked.json()["access_token"]

    headers = {"X-Event-Access-Token": token}
    assert api.get("/api/v1/events/secret-gala", headers=headers).status_code == 200
    assert api.get("/api/v1/events/secret-gala/ticket-types", headers=headers).status_code == 200
    assert api.get("/api/v1/events/secret-gala/calendar.ics", headers=headers).status_code == 200
    checkout = api.post(
        "/api/v1/events/secret-gala/orders", headers=headers, json=payload((tt.id, 1))
    )
    assert checkout.status_code == 201
    guest_order = checkout.json()
    calendar_url = f"/api/v1/orders/{guest_order['order_number']}/calendar.ics"
    assert api.get(calendar_url).status_code == 404
    assert api.get(calendar_url, headers=auth(stranger)).status_code == 404
    guest_calendar = api.get(calendar_url, params={"token": guest_order["access_token"]})
    assert guest_calendar.status_code == 200
    assert guest_calendar.headers["cache-control"] == "private, no-store"
    assert f"UID:event-{event_id}@biletflow" in guest_calendar.text

    signed_checkout = api.post(
        "/api/v1/events/secret-gala/orders",
        headers={**headers, **auth(stranger)},
        json=payload((tt.id, 1)),
    )
    assert signed_checkout.status_code == 201, signed_checkout.text
    signed_order = signed_checkout.json()
    signed_calendar = api.get(
        f"/api/v1/orders/{signed_order['order_number']}/calendar.ics", headers=auth(stranger)
    )
    assert signed_calendar.status_code == 200
    assert f"UID:event-{event_id}@biletflow" in signed_calendar.text

    # Organizer-generated signed invite link also unlocks access.
    invite = api.post(
        f"/api/v1/organizer/events/{event_id}/invite-link", headers=auth(owner)
    ).json()
    assert "?invite=" in invite["invite_url"]
    assert (
        api.get("/api/v1/events/secret-gala", params={"invite": invite["invite_token"]}).status_code
        == 200
    )


def test_past_event_cannot_be_purchased_even_without_sales_end_at(api, db: Session):
    _, profile = add_organizer(db, "org@example.com")
    now = utcnow()
    ended = add_event(
        db,
        profile,
        slug="past-show",
        status=EventStatus.PUBLISHED,
        starts_at=now - timedelta(hours=5),
        ends_at=now - timedelta(hours=1),
        registration_closes_at=None,
    )
    tt = add_ticket_type(db, ended.id, price_minor=0, sales_end_at=None)

    res = api.post(f"/api/v1/events/{ended.slug}/orders", json=payload((tt.id, 1)))
    assert res.status_code == 409
    assert "ended" in res.json()["detail"].lower()


def test_capacity_floor_and_suspended_event_guards(api, db: Session, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "MEDIA_ROOT", str(tmp_path))
    monkeypatch.setattr(settings, "AWS_S3_BUCKET", "")

    owner, profile = add_organizer(db, "org@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED, capacity=10)
    tt = add_ticket_type(db, event.id, price_minor=0, quantity_total=10)
    assert (
        api.post(f"/api/v1/events/{event.slug}/orders", json=payload((tt.id, 3))).status_code == 201
    )

    # Lowering capacity below 3 committed tickets is refused.
    low = api.patch(
        f"/api/v1/organizer/events/{event.id}", headers=auth(owner), json={"capacity": 2}
    )
    assert low.status_code == 409
    ok = api.patch(
        f"/api/v1/organizer/events/{event.id}", headers=auth(owner), json={"capacity": 3}
    )
    assert ok.status_code == 200

    # Upload one image before suspending so we can test delete guard too.
    img = api.post(
        f"/api/v1/organizer/events/{event.id}/images",
        headers=auth(owner),
        json={"data_url": data_url(PNG)},
    ).json()

    # Suspend the event: ticket types, images, activation mutations, and check-in are all blocked.
    event.status = EventStatus.SUSPENDED
    db.commit()

    assert (
        api.post(
            f"/api/v1/organizer/events/{event.id}/ticket-types",
            headers=auth(owner),
            json={"name": "New", "price_minor": 0, "quantity_total": 5},
        ).status_code
        == 409
    )
    assert (
        api.patch(
            f"/api/v1/organizer/events/{event.id}/ticket-types/{tt.id}",
            headers=auth(owner),
            json={"name": "Edited"},
        ).status_code
        == 409
    )
    assert (
        api.post(
            f"/api/v1/organizer/events/{event.id}/images",
            headers=auth(owner),
            json={"data_url": data_url(PNG)},
        ).status_code
        == 409
    )
    assert (
        api.delete(
            f"/api/v1/organizer/events/{event.id}/images/{img['id']}", headers=auth(owner)
        ).status_code
        == 409
    )
    assert (
        api.post(
            f"/api/v1/organizer/events/{event.id}/activation/terms", headers=auth(owner)
        ).status_code
        == 409
    )
    assert (
        api.post(
            f"/api/v1/organizer/events/{event.id}/activation/fee",
            headers=auth(owner),
            json={"outcome": "succeed"},
        ).status_code
        == 409
    )
    assert (
        api.post(
            f"/api/v1/organizer/events/{event.id}/activation/activate", headers=auth(owner)
        ).status_code
        == 409
    )
    assert (
        api.post(
            f"/api/v1/staff/events/{event.id}/scan",
            headers=auth(owner),
            json={"qr": "fake"},
        ).status_code
        == 409
    )

    # Draft events also block check-in.
    draft = add_event(db, profile, slug="draft-door", status=EventStatus.DRAFT)
    assert (
        api.get(f"/api/v1/staff/events/{draft.id}/attendance", headers=auth(owner)).status_code
        == 409
    )


def test_clearing_payout_account_pauses_active_activation(api, db: Session):
    owner, profile = add_organizer(db, "org@example.com")
    api.put(
        "/api/v1/organizer/profile",
        headers=auth(owner),
        json={
            "display_name": "Jazz KZ",
            "contact_email": "org@example.com",
            "payout_provider": "sandbox_bank",
            "payout_reference": "demo_acc_1",
        },
    )
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    activation = activate_paid_sales(db, event)
    assert activation.status == ActivationStatus.ACTIVE

    # Clearing payout details pauses paid-sales activation immediately.
    cleared = api.put(
        "/api/v1/organizer/profile",
        headers=auth(owner),
        json={
            "display_name": "Jazz KZ",
            "contact_email": "org@example.com",
            "payout_provider": None,
            "payout_reference": "",
        },
    )
    assert cleared.status_code == 200
    db.refresh(activation)
    assert activation.status == ActivationStatus.PENDING
    assert activation.activated_at is None
    assert "activation.paused" in list(db.scalars(select(AuditLog.action)))


def test_activation_fee_idempotency_key_and_refund_failure_audit(api, db: Session, monkeypatch):
    owner, profile = add_organizer(db, "org@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    fee_url = f"/api/v1/organizer/events/{event.id}/activation/fee"

    # Replaying with the same Idempotency-Key returns 200 without charging twice.
    first = api.post(
        fee_url,
        headers=auth(owner) | {"Idempotency-Key": "act-key-1"},
        json={"outcome": "succeed"},
    )
    second = api.post(
        fee_url,
        headers=auth(owner) | {"Idempotency-Key": "act-key-1"},
        json={"outcome": "succeed"},
    )
    assert first.status_code == 200 and second.status_code == 200
    assert len(db.scalars(select(Payment)).all()) == 1

    # Reusing the same Idempotency-Key on a different event is 409.
    other = add_event(db, profile, slug="other-act", status=EventStatus.PUBLISHED)
    reuse = api.post(
        f"/api/v1/organizer/events/{other.id}/activation/fee",
        headers=auth(owner) | {"Idempotency-Key": "act-key-1"},
        json={"outcome": "succeed"},
    )
    assert reuse.status_code == 409

    # Failed refund records refund.failed audit entry.
    act = db.scalar(select(EventActivation).where(EventActivation.event_id == event.id))
    act.status = ActivationStatus.ACTIVE
    db.commit()
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = api.post(f"/api/v1/events/{event.slug}/orders", json=payload((vip.id, 1))).json()
    paid = api.post(
        f"/api/v1/orders/{order['order_number']}/pay",
        params={"token": order["access_token"]},
        json={"outcome": "succeed"},
    )
    assert paid.status_code == 200

    monkeypatch.setattr(
        payment_provider,
        "refund",
        lambda payment, amount: payment_provider.Result(False, "sim_re_fail", "Gateway down"),
    )
    failed = api.post(
        f"/api/v1/organizer/events/{event.id}/orders/{order['order_number']}/refund",
        headers=auth(owner),
        json={"reason": "Customer requested"},
    )
    assert failed.status_code == 502
    assert "refund.failed" in list(db.scalars(select(AuditLog.action)))


def test_buyer_free_order_self_cancellation_and_is_simulated_flag(api, db: Session):
    _, profile = add_organizer(db, "org@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    free = add_ticket_type(db, event.id, price_minor=0, quantity_total=10)
    buyer = add_user(db, "buyer@example.com")

    order = api.post(
        f"/api/v1/events/{event.slug}/orders",
        headers=auth(buyer),
        json=payload((free.id, 2)),
    ).json()
    assert order["status"] == "confirmed"
    assert order["is_simulated"] is False

    # Buyer self-cancels their confirmed free registration.
    cancelled = api.post(
        f"/api/v1/orders/{order['order_number']}/cancel",
        headers=auth(buyer),
    )
    assert cancelled.status_code == 200
    body = cancelled.json()
    assert body["status"] == "cancelled"
    assert {t["status"] for t in body["tickets"]} == {TicketStatus.CANCELLED.value}
    db.refresh(free)
    assert free.quantity_sold == 0

    # Guest can also self-cancel a confirmed free order using their access token.
    guest_order = api.post(f"/api/v1/events/{event.slug}/orders", json=payload((free.id, 1))).json()
    guest_cancel = api.post(
        f"/api/v1/orders/{guest_order['order_number']}/cancel",
        params={"token": guest_order["access_token"]},
    )
    assert guest_cancel.status_code == 200
    assert guest_cancel.json()["status"] == OrderStatus.CANCELLED.value


def test_refund_policy_structured_cutoff_enforcement(api, db: Session):
    owner, profile = add_organizer(db, "org@example.com")
    now = utcnow()
    event = add_event(
        db,
        profile,
        slug="strict-refunds",
        status=EventStatus.PUBLISHED,
        starts_at=now + timedelta(hours=12),
        ends_at=now + timedelta(hours=15),
        refunds_allowed=True,
        refund_cutoff_hours_before_start=24,
    )
    activate_paid_sales(db, event)
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = api.post(f"/api/v1/events/{event.slug}/orders", json=payload((vip.id, 1))).json()
    api.post(
        f"/api/v1/orders/{order['order_number']}/pay",
        params={"token": order["access_token"]},
        json={"outcome": "succeed"},
    )

    # Inside the 24h cutoff -> 409 unless override_policy=True.
    blocked = api.post(
        f"/api/v1/organizer/events/{event.id}/orders/{order['order_number']}/refund",
        headers=auth(owner),
        json={"reason": "Late request"},
    )
    assert blocked.status_code == 409
    assert "deadline" in blocked.json()["detail"].lower()

    overridden = api.post(
        f"/api/v1/organizer/events/{event.id}/orders/{order['order_number']}/refund",
        headers=auth(owner),
        json={"reason": "Organizer exception", "override_policy": True},
    )
    assert overridden.status_code == 200
    assert overridden.json()["status"] == "refunded"


def test_gifted_ticket_links_attendee_user_id_and_lists_in_my_tickets(api, db: Session):
    _, profile = add_organizer(db, "org@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    free = add_ticket_type(db, event.id, price_minor=0, quantity_total=10)
    buyer = add_user(db, "buyer@example.com")
    friend = add_user(db, "friend@example.com")

    order = api.post(
        f"/api/v1/events/{event.slug}/orders",
        headers=auth(buyer),
        json={
            "contact_name": "Buyer",
            "contact_email": "buyer@example.com",
            "items": [
                {
                    "ticket_type_id": free.id,
                    "attendees": [
                        {"full_name": "Buyer Self", "email": "buyer@example.com"},
                        {"full_name": "Gifted Friend", "email": "FRIEND@example.com"},
                    ],
                }
            ],
        },
    ).json()

    attendees = db.scalars(select(Attendee).order_by(Attendee.id)).all()
    assert [a.user_id for a in attendees] == [buyer.id, friend.id]

    friend_tickets = api.get("/api/v1/users/me/tickets", headers=auth(friend)).json()
    assert len(friend_tickets) == 1
    assert friend_tickets[0]["attendee_name"] == "Gifted Friend"
    assert friend_tickets[0]["order_number"] == order["order_number"]

    # Friend can download their own single-ticket PDF without owning the order.
    pdf = api.get(
        f"/api/v1/orders/{order['order_number']}/tickets/{friend_tickets[0]['public_code']}.pdf",
        headers=auth(friend),
    )
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")
