"""Tests for Section 1D: 5-metric inventory, analytics math reconciliation,
multi-event analytics, campaign filtering, audit completeness, check-in search
and reverse permission, event phase filtering, and configurable currencies."""

from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.audit import AuditLog
from app.models.event import EventStatus
from app.models.ticket import Ticket
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type


def _paid_order(api, slug: str, *lines: tuple[int, int], headers=None, **extra) -> dict:
    resp = api.post(
        f"/api/v1/events/{slug}/orders", json=payload(*lines, **extra), headers=headers or {}
    )
    assert resp.status_code == 201, resp.text
    order = resp.json()
    paid = api.post(
        f"/api/v1/orders/{order['order_number']}/pay",
        params={"token": order["access_token"]},
        json={"outcome": "succeed"},
    )
    assert paid.status_code == 200, paid.text
    return paid.json()


def test_five_metrics_and_summary_vs_analytics_reconciliation(api, db: Session):
    user, profile = add_organizer(db, "org-1d@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED, capacity=20)
    activate_paid_sales(db, event)

    vip = add_ticket_type(db, event.id, name="VIP", price_minor=100_000, quantity_total=10)
    std = add_ticket_type(db, event.id, name="Standard", price_minor=50_000, quantity_total=10)

    # Create a 20% promo campaign.
    camp = api.post(
        f"/api/v1/organizer/events/{event.id}/campaigns",
        json={
            "name": "Early Bird",
            "code": "EARLY20",
            "discount_type": "percent",
            "discount_value": 20,
        },
        headers=auth(user),
    )
    assert camp.status_code == 201, camp.text

    # 1) Paid discounted VIP x2 (gross 200k, discount 40k -> net 160k) -> check in 1 ticket.
    order_vip = _paid_order(api, event.slug, (vip.id, 2), promo_code="EARLY20")
    ticket_code = order_vip["tickets"][0]["public_code"]
    admit = api.post(
        f"/api/v1/staff/events/{event.id}/tickets/{ticket_code}/check-in",
        headers=auth(user),
    )
    assert admit.status_code == 200, admit.text
    assert admit.json()["outcome"] == "valid"

    # 2) Paid VIP x1 -> refunded.
    order_ref = _paid_order(api, event.slug, (vip.id, 1))
    ref = api.post(
        f"/api/v1/organizer/events/{event.id}/orders/{order_ref['order_number']}/refund",
        json={"reason": "Buyer asked"},
        headers=auth(user),
    )
    assert ref.status_code == 200, ref.text

    # 3) Pending unpaid hold on VIP x2 (quantity_reserved = 2).
    hold_resp = api.post(f"/api/v1/events/{event.slug}/orders", json=payload((vip.id, 2)))
    assert hold_resp.status_code == 201, hold_resp.text

    # 4) Paid Standard x1 (no promo).
    _paid_order(api, event.slug, (std.id, 1))

    # Check 5-metric inventory on organizer ticket-types endpoint.
    tt_list = api.get(
        f"/api/v1/organizer/events/{event.id}/ticket-types", headers=auth(user)
    ).json()
    by_name = {t["name"]: t for t in tt_list}
    # VIP: total=10, sold=2, reserved=2, available=6, refunded=1, checked_in=1.
    assert by_name["VIP"]["quantity_sold"] == 2
    assert by_name["VIP"]["quantity_reserved"] == 2
    assert by_name["VIP"]["available"] == 6
    assert by_name["VIP"]["quantity_refunded"] == 1
    assert by_name["VIP"]["quantity_checked_in"] == 1

    # Check summary vs analytics reconciliation.
    summary = api.get(f"/api/v1/organizer/events/{event.id}/summary", headers=auth(user)).json()
    analytics_data = api.get(
        f"/api/v1/organizer/events/{event.id}/analytics", headers=auth(user)
    ).json()

    # Both should agree on revenue, refunds, fees, estimated payout, sold, reserved, remaining.
    assert summary["fees_minor"] == analytics_data["fees_minor"]
    assert summary["estimated_payout_minor"] == analytics_data["estimated_payout_minor"]
    assert summary["tickets_sold"] == analytics_data["tickets_sold"] == 3
    assert summary["tickets_reserved"] == analytics_data["tickets_reserved"] == 2
    assert summary["tickets_remaining"] == analytics_data["tickets_remaining"] == 15

    # Summary's per-type revenue sums confirmed orders reflecting discounts (VIP = 200k - 40k = 160_000).
    sum_by_type = {row["name"]: row for row in summary["by_ticket_type"]}
    assert sum_by_type["VIP"]["revenue_minor"] == 160_000
    assert sum_by_type["VIP"]["available"] == 6
    assert sum_by_type["VIP"]["quantity_refunded"] == 1
    assert sum_by_type["VIP"]["quantity_checked_in"] == 1
    assert sum_by_type["Standard"]["revenue_minor"] == 50_000

    # Analytics per-type carries the exact same 5-metric inventory counts.
    an_by_type = {row["name"]: row for row in analytics_data["by_ticket_type"]}
    assert an_by_type["VIP"]["available"] == 6
    assert an_by_type["VIP"]["quantity_refunded"] == 1
    assert an_by_type["VIP"]["quantity_checked_in"] == 1


def test_campaign_analytics_filtering_and_multi_event_organizer_analytics(api, db: Session):
    user, profile = add_organizer(db, "multi-1d@example.com")
    e1 = add_event(db, profile, title="Event One", slug="event-one", status=EventStatus.PUBLISHED)
    e2 = add_event(db, profile, title="Event Two", slug="event-two", status=EventStatus.PUBLISHED)
    activate_paid_sales(db, e1)
    activate_paid_sales(db, e2)

    t1 = add_ticket_type(db, e1.id, name="VIP", price_minor=100_000, quantity_total=10)
    t2 = add_ticket_type(db, e1.id, name="General", price_minor=40_000, quantity_total=10)
    t3 = add_ticket_type(db, e2.id, name="Pass", price_minor=60_000, quantity_total=10)

    camp = api.post(
        f"/api/v1/organizer/events/{e1.id}/campaigns",
        json={
            "name": "VIP Promo",
            "code": "VIP10",
            "discount_type": "percent",
            "discount_value": 10,
        },
        headers=auth(user),
    ).json()

    _paid_order(api, e1.slug, (t1.id, 1), promo_code=camp["code"])
    _paid_order(api, e2.slug, (t3.id, 2))

    # Campaign stats filtered by ticket_type_id=t2 (General) should show 0 uses/orders.
    an_gen = api.get(
        f"/api/v1/organizer/events/{e1.id}/analytics",
        params={"ticket_type_id": t2.id},
        headers=auth(user),
    ).json()
    assert an_gen["campaigns"][0]["orders"] == 0
    assert an_gen["campaigns"][0]["net_minor"] == 0

    # Campaign stats filtered by ticket_type_id=t1 (VIP) should show 1 confirmed order.
    an_vip = api.get(
        f"/api/v1/organizer/events/{e1.id}/analytics",
        params={"ticket_type_id": t1.id},
        headers=auth(user),
    ).json()
    assert an_vip["campaigns"][0]["orders"] == 1
    assert an_vip["campaigns"][0]["net_minor"] == 90_000

    # Campaign stats filtered by a future date range should show 0 confirmed orders.
    an_future = api.get(
        f"/api/v1/organizer/events/{e1.id}/analytics",
        params={"since": "2099-01-01T00:00:00Z"},
        headers=auth(user),
    ).json()
    assert an_future["campaigns"][0]["orders"] == 0

    # Cross-event organizer analytics aggregates both events.
    multi = api.get("/api/v1/organizer/analytics", headers=auth(user))
    assert multi.status_code == 200, multi.text
    body = multi.json()
    assert body["event_count"] == 2
    assert body["tickets_sold"] == 3
    assert body["gross_minor"] == 220_000
    assert body["discounts_minor"] == 10_000
    assert body["net_minor"] == 210_000
    assert len(body["events"]) == 2

    # Filtering multi-event analytics to a single event works too.
    single = api.get(
        "/api/v1/organizer/analytics", params={"event_id": e2.id}, headers=auth(user)
    ).json()
    assert single["event_count"] == 1
    assert single["tickets_sold"] == 2
    assert single["net_minor"] == 120_000


def test_audit_completeness_and_phase_filter(api, db: Session):
    org_user, profile = add_organizer(db, "audit-org@example.com")
    buyer = add_user(db, "audit-buyer@example.com")

    now = datetime.now(UTC)
    created = api.post(
        "/api/v1/events",
        json={
            "title": "Audit Fest",
            "description": "Original desc",
            "category": "concert",
            "venue_name": "Hall A",
            "venue_address": "Abay 1",
            "venue_city": "Almaty",
            "starts_at": (now + timedelta(days=5)).isoformat(),
            "ends_at": (now + timedelta(days=5, hours=3)).isoformat(),
            "timezone": "Asia/Almaty",
            "capacity": 50,
            "is_paid": False,
        },
        headers=auth(org_user),
    )
    assert created.status_code == 201, created.text
    event_id = created.json()["id"]
    slug = created.json()["slug"]

    tt = api.post(
        f"/api/v1/organizer/events/{event_id}/ticket-types",
        json={"name": "Free Pass", "price_minor": 0, "quantity_total": 10},
        headers=auth(org_user),
    )
    assert tt.status_code == 201, tt.text
    tt_id = tt.json()["id"]

    pub = api.post(f"/api/v1/organizer/events/{event_id}/publish", headers=auth(org_user))
    assert pub.status_code == 200, pub.text

    # Edit published title, description, timezone -> audited.
    upd = api.patch(
        f"/api/v1/organizer/events/{event_id}",
        json={
            "title": "Audit Fest Updated",
            "description": "New desc",
            "timezone": "Asia/Qyzylorda",
        },
        headers=auth(org_user),
    )
    assert upd.status_code == 200, upd.text

    # Authenticated buyer places free order -> order.confirmed records buyer as actor.
    order_resp = api.post(
        f"/api/v1/events/{slug}/orders",
        json=payload((tt_id, 1), contact_email=buyer.email),
        headers=auth(buyer),
    )
    assert order_resp.status_code == 201, order_resp.text

    logs = db.scalars(
        select(AuditLog).where(AuditLog.event_id == event_id).order_by(AuditLog.id)
    ).all()
    actions = [log.action for log in logs]
    assert "event.created" in actions
    assert "ticket_type.created" in actions
    assert "event.updated" in actions
    assert "order.confirmed" in actions

    update_log = next(log for log in logs if log.action == "event.updated")
    assert set(update_log.payload) >= {"title", "description", "timezone"}
    confirm_log = next(log for log in logs if log.action == "order.confirmed")
    assert confirm_log.actor_user_id == buyer.id

    # Verify ?phase= filter on GET /organizer/events.
    upcoming = api.get(
        "/api/v1/organizer/events", params={"phase": "upcoming"}, headers=auth(org_user)
    ).json()
    drafts = api.get(
        "/api/v1/organizer/events", params={"phase": "draft"}, headers=auth(org_user)
    ).json()
    assert any(e["id"] == event_id for e in upcoming)
    assert all(e["id"] != event_id for e in drafts)


def test_checkin_search_by_email_and_order_and_reverse_permission(api, db: Session):
    org_user, profile = add_organizer(db, "staff-org@example.com")
    staff_user = add_user(db, "door-staff@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    tt = add_ticket_type(db, event.id, name="GA", price_minor=0, quantity_total=10)

    # Assign door staff with can_reverse_check_in=False.
    assigned = api.post(
        f"/api/v1/organizer/events/{event.id}/staff",
        json={"email": staff_user.email, "can_reverse_check_in": False},
        headers=auth(org_user),
    )
    assert assigned.status_code == 201, assigned.text
    assert assigned.json()[0]["can_reverse_check_in"] is False

    # Place a free order with a distinct attendee email.
    order_resp = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json={
            "contact_name": "Dana Buyer",
            "contact_email": "buyer@example.com",
            "items": [
                {
                    "ticket_type_id": tt.id,
                    "quantity": 1,
                    "attendees": [
                        {"full_name": "Arman Guest", "email": "arman.unique@example.com"}
                    ],
                }
            ],
        },
    )
    assert order_resp.status_code == 201, order_resp.text
    order = order_resp.json()
    public_code = order["tickets"][0]["public_code"]

    # Search by attendee email.
    by_email = api.get(
        f"/api/v1/staff/events/{event.id}/search",
        params={"q": "arman.unique"},
        headers=auth(staff_user),
    )
    assert by_email.status_code == 200
    assert [row["public_code"] for row in by_email.json()] == [public_code]

    # Search by order number.
    by_order = api.get(
        f"/api/v1/staff/events/{event.id}/search",
        params={"q": order["order_number"]},
        headers=auth(staff_user),
    )
    assert by_order.status_code == 200
    assert [row["public_code"] for row in by_order.json()] == [public_code]

    # Door staff can check in the ticket, but reversing is forbidden (403).
    admit = api.post(
        f"/api/v1/staff/events/{event.id}/tickets/{public_code}/check-in",
        headers=auth(staff_user),
    )
    assert admit.status_code == 200 and admit.json()["outcome"] == "valid"

    denied = api.post(
        f"/api/v1/staff/events/{event.id}/tickets/{public_code}/reverse",
        headers=auth(staff_user),
    )
    assert denied.status_code == 403

    # Organizer grants can_reverse_check_in=True via PATCH -> now staff can reverse.
    patched = api.patch(
        f"/api/v1/organizer/events/{event.id}/staff/{staff_user.id}",
        json={"can_reverse_check_in": True},
        headers=auth(org_user),
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()[0]["can_reverse_check_in"] is True

    allowed = api.post(
        f"/api/v1/staff/events/{event.id}/tickets/{public_code}/reverse",
        headers=auth(staff_user),
    )
    assert allowed.status_code == 200, allowed.text
    ticket = db.scalar(select(Ticket).where(Ticket.public_code == public_code))
    assert ticket is not None and ticket.status.value == "valid"


def test_configurable_supported_currencies(api, db: Session, monkeypatch):
    user, profile = add_organizer(db, "curr-org@example.com")
    event = add_event(db, profile, status=EventStatus.DRAFT)

    # Rejects USD by default (only KZT configured).
    bad = api.post(
        f"/api/v1/organizer/events/{event.id}/ticket-types",
        json={"name": "USD Pass", "price_minor": 1000, "currency": "USD", "quantity_total": 5},
        headers=auth(user),
    )
    assert bad.status_code == 422

    # When USD is enabled in settings.SUPPORTED_CURRENCIES, creation succeeds.
    monkeypatch.setattr(settings, "SUPPORTED_CURRENCIES", ["KZT", "USD"])
    ok = api.post(
        f"/api/v1/organizer/events/{event.id}/ticket-types",
        json={"name": "USD Pass", "price_minor": 1000, "currency": "usd", "quantity_total": 5},
        headers=auth(user),
    )
    assert ok.status_code == 201, ok.text
    assert ok.json()["currency"] == "USD"
