"""Printable tickets (§4.7), calendar export (§4.11), notifications (§4.10),
analytics (§4.15) and platform administration (§4.12)."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.event import Event, EventStatus
from app.models.notification import Channel, DeliveryStatus, Notification
from app.models.organizer import OrganizerProfile
from app.models.user import User
from app.services import calendar, mailer, notify, ticket_pdf
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type

CHECKOUT = "/api/v1/events/{slug}/orders"
PAY = "/api/v1/orders/{number}/pay"


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


@pytest.fixture
def event(db: Session, organizer) -> Event:
    event = add_event(
        db,
        organizer[1],
        status=EventStatus.PUBLISHED,
        title="Абай оқулары: джаз кеші",
        description="Line one; with, punctuation\nLine two",
    )
    activate_paid_sales(db, event)
    return event


@pytest.fixture
def admin(db: Session) -> User:
    user = add_user(db, "admin@example.com")
    user.is_platform_admin = True
    db.commit()
    return user


def buy(api, event, ticket_type, count=1, user=None, **extra) -> dict:
    response = api.post(
        CHECKOUT.format(slug=event.slug),
        json=payload((ticket_type.id, count), **extra),
        headers=auth(user) if user else {},
    )
    assert response.status_code == 201, response.text
    order = response.json()
    if order["status"] == "pending":
        paid = api.post(
            PAY.format(number=order["order_number"]),
            params={"token": order["access_token"]},
            json={"outcome": "succeed"},
        )
        assert paid.status_code == 200, paid.text
        order = paid.json() | {"access_token": order["access_token"]}
    return order


# --- printable PDF tickets (§4.7, UC7) -------------------------------------------


def test_a_guest_downloads_the_order_pdf_with_the_signed_link(api, db, event):
    free = add_ticket_type(db, event.id, price_minor=0)
    order = buy(api, event, free, 2)
    url = f"/api/v1/orders/{order['order_number']}/tickets.pdf"

    refused = api.get(url)
    response = api.get(url, params={"token": order["access_token"]})

    assert refused.status_code == 404
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    # One page per ticket.
    assert response.content.count(b"/Type /Page\n") + response.content.count(b"/Type /Page ") >= 2


def test_a_single_ticket_pdf_and_an_unknown_code(api, db, event):
    free = add_ticket_type(db, event.id, price_minor=0)
    order = buy(api, event, free)
    code = order["tickets"][0]["public_code"]
    base = f"/api/v1/orders/{order['order_number']}/tickets"

    one = api.get(f"{base}/{code}.pdf", params={"token": order["access_token"]})
    missing = api.get(f"{base}/BF-0000-0000.pdf", params={"token": order["access_token"]})

    assert one.status_code == 200 and code in one.headers["content-disposition"]
    assert missing.status_code == 404


def test_a_cancelled_ticket_is_not_printable(api, db, organizer, event):
    free = add_ticket_type(db, event.id, price_minor=0)
    order = buy(api, event, free)
    api.post(
        f"/api/v1/organizer/events/{event.id}/orders/{order['order_number']}/cancel",
        headers=auth(organizer[0]),
    )

    response = api.get(
        f"/api/v1/orders/{order['order_number']}/tickets.pdf",
        params={"token": order["access_token"]},
    )

    assert response.status_code == 404


def test_the_pdf_renderer_handles_cyrillic_and_long_titles():
    ticket = ticket_pdf.PrintableTicket(
        public_code="BF-3K9P-22XM",
        qr_payload="BF1.adm.BF-3K9P-22XM.42.nonce.signature",
        event_title="Өте ұзақ атауы бар іс-шара " * 6,
        starts_at=datetime(2030, 5, 1, 14, tzinfo=UTC),
        ends_at=datetime(2030, 5, 1, 17, tzinfo=UTC),
        timezone="Asia/Almaty",
        venue_name="Алматы Арена",
        venue_address="Момышұлы көшесі, 1",
        ticket_type_name="VIP",
        attendee_name="Әсел Нұрланқызы",
        order_number="BF-300501-7KQ2MX",
    )

    assert ticket_pdf.render([ticket]).startswith(b"%PDF")


# --- calendar export (§4.11, UC6) --------------------------------------------------


def test_the_calendar_file_keeps_the_timezone_and_a_stable_uid(api, db, event):
    response = api.get(f"/api/v1/events/{event.slug}/calendar.ics")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/calendar")
    text = response.text
    assert f"UID:event-{event.id}@biletflow" in text
    assert "DTSTART;TZID=Asia/Almaty:" in text and "BEGIN:VTIMEZONE" in text
    assert "STATUS:CONFIRMED" in text and "METHOD:PUBLISH" in text
    assert f"/events/{event.slug}" in text
    assert "Almaty Arena" in text
    # RFC 5545: CRLF line endings, text escaped, no line over 75 octets.
    assert "\r\n" in text and "Line one\\; with\\, punctuation\\nLine two" in text.replace(
        "\r\n ", ""
    )
    assert all(len(line.encode()) <= 75 for line in text.split("\r\n"))


def test_a_cancelled_event_yields_a_cancellation_with_the_same_uid(api, db, organizer, event):
    api.post(f"/api/v1/organizer/events/{event.id}/cancel", headers=auth(organizer[0]))

    text = api.get(f"/api/v1/events/{event.slug}/calendar.ics").text

    assert f"UID:event-{event.id}@biletflow" in text
    assert "STATUS:CANCELLED" in text and "METHOD:CANCEL" in text


def test_the_sequence_grows_when_the_event_is_edited(db, event):
    before = calendar.build(event)
    event.updated_at = datetime(2031, 1, 1, tzinfo=UTC)

    after = calendar.build(event)

    def sequence(text: str) -> int:
        return int(next(line for line in text.split("\r\n") if line.startswith("SEQUENCE:"))[9:])

    assert sequence(after) > sequence(before)


# --- notifications (§4.10) ---------------------------------------------------------


def test_a_confirmed_order_queues_an_email_and_an_in_app_notice(api, db, event):
    buyer = add_user(db, "aru@example.com")
    free = add_ticket_type(db, event.id, price_minor=0)

    order = buy(api, event, free, user=buyer)

    rows = db.scalars(
        select(Notification).where(Notification.template_key == "order.confirmed")
    ).all()
    assert {row.channel for row in rows} == {Channel.EMAIL, Channel.IN_APP}
    assert order["order_number"] in rows[0].payload["link"]
    feed = api.get("/api/v1/users/me/notifications", headers=auth(buyer)).json()
    assert feed["unread"] == 1 and feed["items"][0]["template_key"] == "order.confirmed"

    api.post("/api/v1/users/me/notifications/read", headers=auth(buyer))

    assert api.get("/api/v1/users/me/notifications", headers=auth(buyer)).json()["unread"] == 0


def test_the_outbox_worker_sends_each_pending_email_once(api, db, event):
    free = add_ticket_type(db, event.id, price_minor=0)
    buy(api, event, free)
    mailer.outbox.clear()

    first = notify.deliver_pending(db)
    second = notify.deliver_pending(db)

    assert (first, second) == (1, 0)
    assert len(mailer.outbox) == 1
    assert mailer.outbox[0].to == "aru@example.com"
    assert "/orders/BF-" in mailer.outbox[0].body
    assert db.scalar(select(Notification.status)) == DeliveryStatus.SENT


def test_a_guest_gets_email_but_no_in_app_row(api, db, event):
    free = add_ticket_type(db, event.id, price_minor=0)

    buy(api, event, free)

    assert db.scalars(select(Notification.channel)).all() == [Channel.EMAIL]


def test_payment_failure_refund_and_event_cancellation_notify_the_buyer(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    declined = api.post(CHECKOUT.format(slug=event.slug), json=payload((vip.id, 1))).json()
    api.post(
        PAY.format(number=declined["order_number"]),
        params={"token": declined["access_token"]},
        json={"outcome": "fail"},
    )
    kept = buy(api, event, vip)
    refunded = buy(api, event, vip)
    api.post(
        f"/api/v1/organizer/events/{event.id}/orders/{refunded['order_number']}/refund",
        json={"reason": "Requested"},
        headers=auth(organizer[0]),
    )
    api.post(f"/api/v1/organizer/events/{event.id}/cancel", headers=auth(organizer[0]))

    keys = db.scalars(select(Notification.template_key)).all()

    assert keys.count("payment.failed") == 1
    # One explicit refund, plus the refund the cancellation made of `kept`.
    assert keys.count("refund.completed") == 2
    assert keys.count("event.cancelled") == 1
    assert kept["order_number"]


def test_an_unknown_template_renders_instead_of_raising():
    subject, body = notify.render("no.such.template", {"link": "http://x"})

    assert "no.such.template" in subject and body == "http://x"


# --- processing fee (§4.6, §3.3) ----------------------------------------------------


def test_the_processing_fee_is_recorded_and_deducted_from_the_payout(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, price_minor=1_000_000)

    order = buy(api, event, vip)
    summary = api.get(
        f"/api/v1/organizer/events/{event.id}/summary", headers=auth(organizer[0])
    ).json()

    # 2.5 % of 10 000 KZT. The buyer still pays exactly the ticket price.
    assert (order["total_minor"], order["fee_minor"]) == (1_000_000, 25_000)
    assert summary["gross_minor"] == 1_000_000
    assert summary["fees_minor"] == 25_000
    assert summary["estimated_payout_minor"] == 975_000


# --- analytics (§4.15, UC11) ---------------------------------------------------------


def test_analytics_are_computed_from_orders_and_filter_by_ticket_type(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, name="VIP", price_minor=500_000, quantity_total=10)
    free = add_ticket_type(db, event.id, name="Free", price_minor=0, quantity_total=30)
    buy(api, event, vip, 2)
    order = buy(api, event, free, 3)
    api.post(
        f"/api/v1/staff/events/{event.id}/scan",
        json={"qr": order["tickets"][0]["qr_payload"]},
        headers=auth(organizer[0]),
    )
    url = f"/api/v1/organizer/events/{event.id}/analytics"

    everything = api.get(url, headers=auth(organizer[0])).json()
    vip_only = api.get(url, params={"ticket_type_id": vip.id}, headers=auth(organizer[0])).json()
    future = api.get(
        url, params={"since": "2099-01-01T00:00:00Z"}, headers=auth(organizer[0])
    ).json()

    assert everything["capacity"] == 40 and everything["tickets_sold"] == 5
    assert everything["percent_sold"] == 12.5
    assert everything["gross_minor"] == 1_000_000 and everything["is_simulated"] is True
    assert sum(point["tickets"] for point in everything["sales_over_time"]) == 5
    assert everything["attendance"] == {
        "registered": 5,
        "checked_in": 1,
        "absent": 4,
        "checked_in_percent": 20.0,
    }
    assert [t["name"] for t in vip_only["by_ticket_type"]] == ["VIP"]
    assert vip_only["tickets_sold"] == 2 and vip_only["attendance"]["registered"] == 2
    assert future["sales_over_time"] == [] and future["gross_minor"] == 0


def test_analytics_belong_to_the_events_organizer_only(api, db, event):
    stranger, _ = add_organizer(db, "stranger@example.com")

    response = api.get(f"/api/v1/organizer/events/{event.id}/analytics", headers=auth(stranger))

    assert response.status_code == 404


def test_the_timeline_names_the_acting_user_and_filters_by_action(api, db, organizer, event):
    free = add_ticket_type(db, event.id, price_minor=0)
    order = buy(api, event, free)
    api.post(
        f"/api/v1/staff/events/{event.id}/scan",
        json={"qr": order["tickets"][0]["qr_payload"]},
        headers=auth(organizer[0]),
    )
    url = f"/api/v1/organizer/events/{event.id}/timeline"

    checked_in = api.get(
        url, params={"action": "ticket.checked_in"}, headers=auth(organizer[0])
    ).json()

    assert [entry["action"] for entry in checked_in] == ["ticket.checked_in"]
    assert checked_in[0]["actor_name"] == "Abai Kunanbayev"


def test_the_attendee_export_is_csv_and_defuses_formulas(api, db, organizer, event):
    free = add_ticket_type(db, event.id, price_minor=0)
    api.post(
        CHECKOUT.format(slug=event.slug),
        json={
            "contact_name": "Aru",
            "contact_email": "aru@example.com",
            "items": [{"ticket_type_id": free.id, "attendees": [{"full_name": "=SUM(A1:A9)"}]}],
        },
    )

    response = api.get(
        f"/api/v1/organizer/events/{event.id}/attendees.csv", headers=auth(organizer[0])
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "'=SUM(A1:A9)" in response.text


# --- platform administration (§4.12) --------------------------------------------------


def test_admin_routes_refuse_everyone_else(api, organizer):
    for path in (
        "/api/v1/admin/overview",
        "/api/v1/admin/users",
        "/api/v1/admin/orders",
        "/api/v1/admin/payments",
        "/api/v1/admin/settings",
        "/api/v1/admin/reports",
        "/api/v1/admin/exports/orders.csv",
    ):
        assert api.get(path, headers=auth(organizer[0])).status_code == 403, path
        assert api.get(path).status_code in (401, 403), path


def test_admin_searches_users_orders_and_payments(api, db, admin, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = buy(api, event, vip)

    users = api.get("/api/v1/admin/users", params={"q": "organizer"}, headers=auth(admin)).json()
    orders = api.get(
        "/api/v1/admin/orders", params={"q": order["order_number"]}, headers=auth(admin)
    ).json()
    payments = api.get(
        "/api/v1/admin/payments", params={"status": "succeeded"}, headers=auth(admin)
    ).json()
    overview = api.get("/api/v1/admin/overview", headers=auth(admin)).json()

    assert [u["email"] for u in users] == ["organizer@example.com"]
    assert "hashed_password" not in users[0]
    assert orders[0]["order_number"] == order["order_number"]
    assert payments[0]["is_simulated"] is True and payments[0]["amount_minor"] == 500_000
    assert overview["orders_confirmed"] == 1 and overview["gross_minor"] == 500_000


def test_a_suspended_user_is_locked_out_and_can_be_reinstated(api, db, admin, organizer):
    user = organizer[0]

    suspended = api.post(
        f"/api/v1/admin/users/{user.id}/suspend", json={"reason": "Fraud"}, headers=auth(admin)
    )

    assert suspended.json()["status"] == "suspended"
    assert api.get("/api/v1/users/me", headers=auth(user)).status_code == 403
    assert db.scalar(select(AuditLog.action).where(AuditLog.action == "user.suspended"))

    api.post(f"/api/v1/admin/users/{user.id}/unsuspend", headers=auth(admin))

    assert api.get("/api/v1/users/me", headers=auth(user)).status_code == 200


def test_an_admin_cannot_suspend_themselves(api, admin):
    response = api.post(
        f"/api/v1/admin/users/{admin.id}/suspend", json={"reason": "x"}, headers=auth(admin)
    )

    assert response.status_code == 409


def test_changing_the_activation_fee_applies_to_new_activations(api, db, admin, organizer):
    event = add_event(db, organizer[1], slug="fresh-event", status=EventStatus.PUBLISHED)

    updated = api.put(
        "/api/v1/admin/settings", json={"activation_fee_minor": 750_000}, headers=auth(admin)
    )
    activation = api.get(
        f"/api/v1/organizer/events/{event.id}/activation", headers=auth(organizer[0])
    ).json()
    out_of_range = api.put(
        "/api/v1/admin/settings", json={"processing_fee_bps": 9_999}, headers=auth(admin)
    )

    assert updated.json()["activation_fee_minor"] == 750_000
    assert activation["activation_fee_minor"] == 750_000
    assert out_of_range.status_code == 422
    assert db.scalar(select(AuditLog.action).where(AuditLog.action == "platform.setting_changed"))


def test_a_reported_event_reaches_the_admin_who_resolves_it(api, db, admin, event):
    reported = api.post(
        f"/api/v1/events/{event.slug}/report",
        json={"reason": "fraud", "details": "Sells tickets to a venue that is closed"},
    )

    assert reported.status_code == 202
    reports = api.get("/api/v1/admin/reports", params={"status": "open"}, headers=auth(admin))
    report = reports.json()[0]
    assert report["event_slug"] == event.slug and report["reason"] == "fraud"

    resolved = api.post(
        f"/api/v1/admin/reports/{report['id']}/resolve",
        json={"status": "actioned"},
        headers=auth(admin),
    )

    assert resolved.json()["status"] == "actioned" and resolved.json()["resolved_at"]


def test_admin_exports_are_csv(api, db, admin, event):
    vip = add_ticket_type(db, event.id, price_minor=500_000)
    order = buy(api, event, vip)

    orders = api.get("/api/v1/admin/exports/orders.csv", headers=auth(admin))
    payments = api.get("/api/v1/admin/exports/payments.csv", headers=auth(admin))

    assert order["order_number"] in orders.text and orders.text.startswith("﻿")
    assert "succeeded" in payments.text and "yes" in payments.text
