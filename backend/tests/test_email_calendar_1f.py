"""Tests for Section 1F: rich HTML/PDF email ticket delivery, distinct attendee
emails, outbox retry & exponential backoff, Resend HTTP provider adapter,
activation fee failure emails, localized event-update fields, single-item
notification read, RFC 5546 ORGANIZER header, and one-click calendar links."""

import base64
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.event import EventStatus
from app.models.notification import DeliveryStatus, Notification
from app.services import calendar as calendar_service
from app.services import mailer, notify
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_ticket_types import add_ticket_type


def test_order_confirmed_and_distinct_attendee_pdf_html_delivery(api, db: Session):
    mailer.outbox.clear()
    _org_user, profile = add_organizer(db, "org-1f@example.com")
    guest_member = add_user(db, "friend-1f@example.com")
    event = add_event(
        db,
        profile,
        title="Almaty Symphony",
        venue_name="Palace Hall",
        venue_address="Dostyk 56",
        status=EventStatus.PUBLISHED,
    )
    tt = add_ticket_type(db, event.id, name="Balcony", price_minor=0, quantity_total=10)

    resp = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json={
            "contact_name": "Dana Buyer",
            "contact_email": "buyer-1f@example.com",
            "items": [
                {
                    "ticket_type_id": tt.id,
                    "quantity": 2,
                    "attendees": [
                        {"full_name": "Dana Buyer", "email": "buyer-1f@example.com"},
                        {"full_name": "Arman Friend", "email": guest_member.email},
                    ],
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    order = resp.json()
    codes = [t["public_code"] for t in order["tickets"]]
    friend_code = next(
        t["public_code"] for t in order["tickets"] if t["attendee_name"] == "Arman Friend"
    )

    attempted = notify.deliver_pending(db)
    assert attempted == 2
    assert len(mailer.outbox) == 2

    buyer_msg = next(m for m in mailer.outbox if m.to == "buyer-1f@example.com")
    friend_msg = next(m for m in mailer.outbox if m.to == guest_member.email)

    # Buyer gets order confirmation with HTML + full order PDF attachment + codes + venue.
    assert buyer_msg.html is not None
    assert "Palace Hall" in buyer_msg.body and "Palace Hall" in buyer_msg.html
    for code in codes:
        assert code in buyer_msg.body and code in buyer_msg.html
    assert len(buyer_msg.attachments) == 1
    assert buyer_msg.attachments[0].filename == f"biletflow-{order['order_number']}.pdf"
    assert buyer_msg.attachments[0].content_type == "application/pdf"
    assert buyer_msg.attachments[0].data.startswith(b"%PDF-")

    # Distinct attendee gets individual ticket email with single-ticket PDF attached.
    assert friend_msg.html is not None
    assert friend_code in friend_msg.body and friend_code in friend_msg.html
    assert len(friend_msg.attachments) == 1
    assert friend_msg.attachments[0].filename == f"biletflow-{friend_code}.pdf"
    assert friend_msg.attachments[0].data.startswith(b"%PDF-")

    # Verify MIME message builder includes text/plain, text/html, and application/pdf.
    mime = mailer._build_mime(buyer_msg)
    content_types = [part.get_content_type() for part in mime.walk()]
    assert "text/plain" in content_types
    assert "text/html" in content_types
    assert "application/pdf" in content_types


def test_outbox_retry_with_exponential_backoff(db: Session, monkeypatch):
    mailer.outbox.clear()
    now = datetime(2026, 11, 24, 12, 0, 0, tzinfo=UTC)
    notify.notify(
        db,
        "order.confirmed",
        {"order_number": "BF-RETRY-1", "event_title": "Retry Fest", "link": "https://ex/1"},
        email="retry@example.com",
    )
    db.commit()

    def always_fail(*args, **kwargs):
        raise OSError("SMTP temporarily unavailable")

    monkeypatch.setattr(mailer, "send", always_fail)

    # Attempt 1 fails -> retry_count=1, next_retry_at = now + 30s.
    assert notify.deliver_pending(db, now=now) == 1
    row = db.scalar(select(Notification).where(Notification.email == "retry@example.com"))
    assert row is not None
    assert row.status == DeliveryStatus.FAILED
    assert row.retry_count == 1
    assert row.last_error and "SMTP temporarily unavailable" in row.last_error
    assert row.next_retry_at is not None

    # Before backoff elapses -> skipped (0 attempted).
    assert notify.deliver_pending(db, now=now + timedelta(seconds=15)) == 0

    # After 30s backoff elapses -> attempt 2 runs and fails -> backoff doubles to 60s.
    t2 = now + timedelta(seconds=31)
    assert notify.deliver_pending(db, now=t2) == 1
    db.refresh(row)
    assert row.retry_count == 2
    assert row.status == DeliveryStatus.FAILED

    # After 60s backoff elapses and provider recovers -> succeeds and becomes SENT!
    sent_calls: list[str] = []
    monkeypatch.setattr(mailer, "send", lambda to, *a, **kw: sent_calls.append(to))
    t3 = t2 + timedelta(seconds=61)
    assert notify.deliver_pending(db, now=t3) == 1
    db.refresh(row)
    assert row.status == DeliveryStatus.SENT
    assert row.next_retry_at is None
    assert sent_calls == ["retry@example.com"]


def test_resend_http_provider_adapter(monkeypatch):
    captured: dict = {}

    class DummyResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    def fake_urlopen(req, timeout=10):
        captured["url"] = req.full_url
        captured["auth"] = req.get_header("Authorization")
        captured["body"] = json.loads(req.data.decode("utf-8"))
        return DummyResponse()

    monkeypatch.setattr(settings, "EMAIL_PROVIDER", "resend")
    monkeypatch.setattr(settings, "RESEND_API_KEY", "re_test_123")
    monkeypatch.setattr(mailer.urllib.request, "urlopen", fake_urlopen)

    mailer.send(
        "user@example.com",
        "Tickets",
        "Plain body",
        html="<p>HTML body</p>",
        attachments=[mailer.Attachment("ticket.pdf", "application/pdf", b"%PDF-1.4")],
    )

    assert captured["url"] == settings.RESEND_API_URL
    assert captured["auth"] == "Bearer re_test_123"
    assert captured["body"]["to"] == ["user@example.com"]
    assert captured["body"]["html"] == "<p>HTML body</p>"
    assert captured["body"]["attachments"] == [
        {
            "filename": "ticket.pdf",
            "content": base64.b64encode(b"%PDF-1.4").decode("ascii"),
            "content_type": "application/pdf",
        }
    ]


def test_activation_fee_failed_and_localized_event_updates_and_single_read(api, db: Session):
    org_user, profile = add_organizer(db, "org-act-1f@example.com")
    org_user.locale = "ru"
    db.commit()
    event = add_event(db, profile, title="Tech Summit", status=EventStatus.DRAFT)
    add_ticket_type(db, event.id, name="Paid", price_minor=50_000, quantity_total=10)

    # Trigger failed activation fee payment -> activation.fee_failed notification queued.
    fee_resp = api.post(
        f"/api/v1/organizer/events/{event.id}/activation/fee",
        json={"outcome": "fail"},
        headers=auth(org_user),
    )
    assert fee_resp.status_code == 402, fee_resp.text

    subj_ru, body_ru = notify.render(
        "activation.fee_failed",
        {"event_title": "Tech Summit", "reason": "Declined", "link": "https://ex/p"},
        "ru",
    )
    assert "сбора активации" in subj_ru and "Declined" in body_ru

    # Localized event.updated field names in en, ru, kk.
    _, upd_en = notify.render(
        "event.updated",
        {
            "event_title": "Tech",
            "changed_fields": ["title", "timezone", "refund_policy"],
            "link": "",
        },
        "en",
    )
    _, upd_ru = notify.render(
        "event.updated",
        {
            "event_title": "Tech",
            "changed_fields": ["title", "timezone", "refund_policy"],
            "link": "",
        },
        "ru",
    )
    _, upd_kk = notify.render(
        "event.updated",
        {
            "event_title": "Tech",
            "changed_fields": ["title", "timezone", "refund_policy"],
            "link": "",
        },
        "kk",
    )
    assert "time zone" in upd_en and "refund policy" in upd_en
    assert "часовой пояс" in upd_ru and "правила возврата" in upd_ru
    assert "уақыт белдеуі" in upd_kk and "қайтару шарттары" in upd_kk

    # Single-notification mark-as-read marks only the selected item and leaves others unread.
    notify.notify_user(db, org_user, "event.updated", {"event_title": "Second", "link": ""})
    db.commit()
    feed_before = api.get("/api/v1/users/me/notifications", headers=auth(org_user)).json()
    assert feed_before["unread"] == 2
    first_id = feed_before["items"][0]["id"]

    # Another user gets 404 for org_user's notification.
    stranger = add_user(db, "stranger-1f@example.com")
    assert (
        api.post(
            f"/api/v1/users/me/notifications/{first_id}/read", headers=auth(stranger)
        ).status_code
        == 404
    )

    marked = api.post(f"/api/v1/users/me/notifications/{first_id}/read", headers=auth(org_user))
    assert marked.status_code == 204
    feed_after = api.get("/api/v1/users/me/notifications", headers=auth(org_user)).json()
    assert feed_after["unread"] == 1
    first_after = next(i for i in feed_after["items"] if i["id"] == first_id)
    assert first_after["read_at"] is not None


def test_calendar_organizer_header_and_provider_links(api, db: Session):
    _org_user, profile = add_organizer(db, "org-cal@example.com")
    buyer = add_user(db, "buyer-cal@example.com")
    event = add_event(
        db,
        profile,
        title="Astana Expo",
        venue_name="Expo Center",
        venue_address="Mangilik El 55",
        venue_city="Astana",
        status=EventStatus.PUBLISHED,
    )
    tt = add_ticket_type(db, event.id, name="Free", price_minor=0, quantity_total=10)

    # Active ICS contains ORGANIZER header.
    ics_pub = api.get(f"/api/v1/events/{event.slug}/calendar.ics")
    assert ics_pub.status_code == 200
    assert "ORGANIZER;CN=" in ics_pub.text
    assert "METHOD:PUBLISH" in ics_pub.text

    # Event detail exposes calendar_links (ics, google, outlook, yahoo).
    detail = api.get(f"/api/v1/events/{event.slug}").json()
    links = detail["calendar_links"]
    assert links["ics"].endswith(f"/events/{event.slug}/calendar.ics")
    assert links["google"].startswith("https://calendar.google.com/calendar/render?")
    assert "ctz=Asia%2FAlmaty" in links["google"]
    assert links["outlook"].startswith("https://outlook.live.com/calendar/0/deeplink/compose?")
    assert links["yahoo"].startswith("https://calendar.yahoo.com/?")

    # Order & my-tickets responses also carry calendar_links on event.
    order_resp = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json={
            "contact_name": "Buyer",
            "contact_email": buyer.email,
            "items": [
                {
                    "ticket_type_id": tt.id,
                    "attendees": [{"full_name": "Buyer", "email": buyer.email}],
                }
            ],
        },
        headers=auth(buyer),
    )
    assert order_resp.status_code == 201, order_resp.text
    assert order_resp.json()["event"]["calendar_links"]["google"].startswith(
        "https://calendar.google.com/"
    )

    my_tickets = api.get("/api/v1/users/me/tickets", headers=auth(buyer)).json()
    assert my_tickets[0]["event"]["calendar_links"]["outlook"].startswith(
        "https://outlook.live.com/"
    )

    # Cancelled ICS keeps RFC 5546 ORGANIZER + METHOD:CANCEL + STATUS:CANCELLED.
    event.status = EventStatus.CANCELLED
    db.commit()
    ics_cancel = calendar_service.build(event)
    assert "METHOD:CANCEL" in ics_cancel
    assert "STATUS:CANCELLED" in ics_cancel
    assert "ORGANIZER;CN=" in ics_cancel
