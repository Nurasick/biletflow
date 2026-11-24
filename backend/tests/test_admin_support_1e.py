"""Tests for Section 1E: disputes, support escalation & activation category,
multi-staff support scope, notification bug fixes, bonus support attachments,
simulated payouts, localized payout statuses, and missing admin filters/exports."""

import base64
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.event import EventStatus
from app.models.notification import Channel, Notification
from app.models.user import UserStatus
from app.services import notify
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"


def _data_url(mime: str, raw: bytes) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def _make_admin(db: Session, email: str, *, active: bool = True):
    user = add_user(db, email)
    user.is_platform_admin = True
    user.status = UserStatus.ACTIVE if active else UserStatus.SUSPENDED
    db.commit()
    return user


def _paid_order(api, slug: str, ticket_type_id: int) -> dict:
    created = api.post(f"/api/v1/events/{slug}/orders", json=payload((ticket_type_id, 1)))
    assert created.status_code == 201, created.text
    order = created.json()
    paid = api.post(
        f"/api/v1/orders/{order['order_number']}/pay",
        params={"token": order["access_token"]},
        json={"outcome": "succeed"},
    )
    assert paid.status_code == 200, paid.text
    return paid.json()


def test_disputes_lifecycle_and_admin_overview(api, db: Session):
    admin = _make_admin(db, "admin-disp@example.com")
    _org_user, profile = add_organizer(db, "org-disp@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    activate_paid_sales(db, event)
    tt = add_ticket_type(db, event.id, name="VIP", price_minor=100_000, quantity_total=10)
    order = _paid_order(api, event.slug, tt.id)

    created = api.post(
        "/api/v1/admin/disputes",
        json={
            "order_number": order["order_number"],
            "reason": "Cardholder disputed charge",
            "evidence_notes": "Ticket scanned at gate",
        },
        headers=auth(admin),
    )
    assert created.status_code == 201, created.text
    dispute = created.json()
    assert dispute["status"] == "open"
    assert dispute["amount_minor"] == order["total_minor"]
    assert dispute["order_number"] == order["order_number"]

    # Overview reflects open_disputes = 1.
    ov = api.get("/api/v1/admin/overview", headers=auth(admin)).json()
    assert ov["open_disputes"] == 1

    # List & search disputes.
    listed = api.get(
        "/api/v1/admin/disputes",
        params={"status": "open", "q": order["order_number"]},
        headers=auth(admin),
    )
    assert listed.status_code == 200
    assert [d["id"] for d in listed.json()] == [dispute["id"]]

    # Resolve dispute in favor of organizer -> open_disputes drops to 0.
    resolved = api.patch(
        f"/api/v1/admin/disputes/{dispute['id']}",
        json={
            "status": "resolved_organizer",
            "resolution_notes": "Scan log proved attendance",
        },
        headers=auth(admin),
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["status"] == "resolved_organizer"
    assert resolved.json()["resolved_at"] is not None

    ov_after = api.get("/api/v1/admin/overview", headers=auth(admin)).json()
    assert ov_after["open_disputes"] == 0

    actions = list(
        db.scalars(select(AuditLog.action).where(AuditLog.entity_type == "dispute")).all()
    )
    assert actions == ["dispute.opened", "dispute.updated"]


def test_support_activation_category_staff_scope_escalation_and_notification_fixes(
    api, db: Session
):
    admin1 = _make_admin(db, "admin1-sup@example.com")
    _make_admin(db, "admin2-sup@example.com")
    _suspended_admin = _make_admin(db, "admin-susp@example.com", active=False)
    org_user, profile = add_organizer(db, "org-sup@example.com")
    staff_user = add_user(db, "staff-sup@example.com")
    attendee = add_user(db, "att-sup@example.com")

    event = add_event(db, profile, status=EventStatus.PUBLISHED)

    # Assign event staff.
    assign_resp = api.post(
        f"/api/v1/organizer/events/{event.id}/staff",
        json={"email": staff_user.email},
        headers=auth(org_user),
    )
    assert assign_resp.status_code == 201, assign_resp.text

    # 1) Organizer opens an "activation" case -> fans out support.opened to all active admins!
    org_case = api.post(
        "/api/v1/support/cases",
        json={
            "audience": "organizer",
            "category": "activation",
            "body": "Need help activating paid sales",
            "event_id": event.id,
        },
        headers=auth(org_user),
    )
    assert org_case.status_code == 201, org_case.text
    assert org_case.json()["category"] == "activation"

    opened_emails = sorted(
        db.scalars(
            select(Notification.email).where(
                Notification.template_key == "support.opened",
                Notification.channel == Channel.EMAIL,
            )
        ).all()
    )
    assert opened_emails == ["admin1-sup@example.com", "admin2-sup@example.com"]

    # Localized category label check for activation across en/ru/kk.
    assert "Активация" in notify.render("support.opened", {"subject": "activation"}, "ru")[0]
    assert "Paid-sales" in notify.render("support.opened", {"subject": "activation"}, "en")[0]
    assert "Ақылы" in notify.render("support.opened", {"subject": "activation"}, "kk")[0]

    # 2) Attendee opens an attendee case -> assigned event staff can see, reply, and be assigned!
    att_case = api.post(
        "/api/v1/support/cases",
        json={
            "category": "check_in",
            "body": "My QR won't scan",
            "event_id": event.id,
        },
        headers=auth(attendee),
    )
    assert att_case.status_code == 201, att_case.text
    num = att_case.json()["case_number"]

    # Assigned event staff sees it; Platform Admin does NOT yet see it.
    assert [
        c["case_number"]
        for c in api.get("/api/v1/staff/support/cases", headers=auth(staff_user)).json()
    ] == [num]
    assert api.get(f"/api/v1/staff/support/cases/{num}", headers=auth(admin1)).status_code == 404

    # Staff reply moves open -> in_progress AND emits support.status to requester!
    reply = api.post(
        f"/api/v1/staff/support/cases/{num}/messages",
        json={"body": "Checking your ticket now"},
        headers=auth(staff_user),
    )
    assert reply.status_code == 200, reply.text
    assert reply.json()["status"] == "in_progress"
    status_notifs = list(
        db.scalars(
            select(Notification).where(
                Notification.template_key == "support.status",
                Notification.channel == Channel.EMAIL,
                Notification.email == attendee.email,
            )
        ).all()
    )
    assert len(status_notifs) == 1
    assert status_notifs[0].payload["status_key"] == "in_progress"

    # Assigning staff_user once sends 1 support.assigned email; patching again with same assignee skips duplicate!
    patch1 = api.patch(
        f"/api/v1/staff/support/cases/{num}",
        json={"assigned_to_user_id": staff_user.id},
        headers=auth(org_user),
    )
    assert patch1.status_code == 200
    patch2 = api.patch(
        f"/api/v1/staff/support/cases/{num}",
        json={"assigned_to_user_id": staff_user.id, "status": "waiting_for_customer"},
        headers=auth(org_user),
    )
    assert patch2.status_code == 200
    assigned_notifs = list(
        db.scalars(
            select(Notification).where(
                Notification.template_key == "support.assigned",
                Notification.channel == Channel.EMAIL,
            )
        ).all()
    )
    assert len(assigned_notifs) == 1

    # 3) Escalate attendee case -> Platform Admins now see it, filter ?escalated=true works,
    #    and active admins are notified via support.escalated!
    esc = api.post(
        f"/api/v1/staff/support/cases/{num}/escalate",
        json={"reason": "Suspected duplicate payment gateway error"},
        headers=auth(org_user),
    )
    assert esc.status_code == 200, esc.text
    assert esc.json()["is_escalated"] is True
    assert esc.json()["escalation_reason"] == "Suspected duplicate payment gateway error"

    # Re-escalating fails with 409.
    esc_dup = api.post(
        f"/api/v1/staff/support/cases/{num}/escalate",
        json={"reason": "Again"},
        headers=auth(org_user),
    )
    assert esc_dup.status_code == 409

    # Admin can now view and filter escalated cases, and search by case_number / audience.
    admin_esc = api.get(
        "/api/v1/staff/support/cases",
        params={"escalated": "true", "audience": "attendee", "q": num},
        headers=auth(admin1),
    )
    assert admin_esc.status_code == 200
    assert [c["case_number"] for c in admin_esc.json()] == [num]
    assert api.get(f"/api/v1/staff/support/cases/{num}", headers=auth(admin1)).status_code == 200

    esc_emails = sorted(
        db.scalars(
            select(Notification.email).where(
                Notification.template_key == "support.escalated",
                Notification.channel == Channel.EMAIL,
            )
        ).all()
    )
    assert esc_emails == ["admin1-sup@example.com", "admin2-sup@example.com"]


def test_support_attachments_bonus_security_and_isolation(api, db: Session, tmp_path, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "MEDIA_ROOT", str(tmp_path))
    monkeypatch.setattr(settings, "AWS_S3_BUCKET", "")
    org_user, profile = add_organizer(db, "org-att@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)

    # Guest opens a case.
    created = api.post(
        "/api/v1/support/cases",
        json={
            "category": "payment",
            "body": "Here is my receipt",
            "contact_email": "guest-att@example.com",
            "event_id": event.id,
        },
    )
    assert created.status_code == 201, created.text
    num = created.json()["case_number"]
    token = created.json()["access_token"]

    # Reject HTML disguised as PDF (magic bytes check).
    bad = api.post(
        f"/api/v1/support/cases/{num}/attachments",
        params={"token": token},
        json={
            "filename": "evil.pdf",
            "data_url": _data_url("application/pdf", b"<html>xss</html>"),
        },
    )
    assert bad.status_code == 422

    # Guest uploads valid PDF attachment.
    up = api.post(
        f"/api/v1/support/cases/{num}/attachments",
        params={"token": token},
        json={"filename": "../../receipt.pdf", "data_url": _data_url("application/pdf", PDF_BYTES)},
    )
    assert up.status_code == 201, up.text
    att = up.json()
    assert att["filename"] == "receipt.pdf"
    assert att["content_type"] == "application/pdf"
    assert att["size_bytes"] == len(PDF_BYTES)

    # Guest downloads attachment with token; unauthorized caller gets 404.
    dl = api.get(f"/api/v1/support/cases/{num}/attachments/{att['id']}", params={"token": token})
    assert dl.status_code == 200
    assert dl.content == PDF_BYTES
    assert dl.headers["x-content-type-options"] == "nosniff"
    assert "attachment;" in dl.headers["content-disposition"]
    assert api.get(f"/api/v1/support/cases/{num}/attachments/{att['id']}").status_code == 404

    # Staff posts an internal note and attaches a PNG to that internal note.
    note = api.post(
        f"/api/v1/staff/support/cases/{num}/messages",
        json={"body": "Internal screenshot", "is_internal_note": True},
        headers=auth(org_user),
    ).json()
    note_id = [m["id"] for m in note["messages"] if m["is_internal_note"]][0]

    staff_up = api.post(
        f"/api/v1/staff/support/cases/{num}/attachments",
        json={
            "filename": "internal.png",
            "data_url": _data_url("image/png", PNG_BYTES),
            "support_message_id": note_id,
        },
        headers=auth(org_user),
    )
    assert staff_up.status_code == 201, staff_up.text
    internal_att_id = staff_up.json()["id"]

    # Staff sees both attachments and can download the internal one.
    staff_case = api.get(f"/api/v1/staff/support/cases/{num}", headers=auth(org_user)).json()
    assert len(staff_case["attachments"]) == 2
    assert (
        api.get(
            f"/api/v1/staff/support/cases/{num}/attachments/{internal_att_id}",
            headers=auth(org_user),
        ).content
        == PNG_BYTES
    )

    # Requester MUST NOT see or download the internal note's attachment!
    req_case = api.get(f"/api/v1/support/cases/{num}", params={"token": token}).json()
    assert [a["id"] for a in req_case["attachments"]] == [att["id"]]
    assert (
        api.get(
            f"/api/v1/support/cases/{num}/attachments/{internal_att_id}", params={"token": token}
        ).status_code
        == 404
    )


def test_simulated_payouts_and_localized_status_notifications(api, db: Session):
    admin = _make_admin(db, "admin-po@example.com")
    org_user, profile = add_organizer(db, "org-po@example.com")
    org_user.locale = "ru"
    db.commit()
    event = add_event(db, profile, title="Almaty Jazz", status=EventStatus.PUBLISHED)
    activate_paid_sales(db, event)
    tt = add_ticket_type(db, event.id, name="Standard", price_minor=100_000, quantity_total=10)
    _paid_order(api, event.slug, tt.id)

    # Admin triggers simulated payout without amount -> auto-computes estimated_payout_minor.
    created = api.post(
        "/api/v1/admin/payouts",
        json={"event_id": event.id},
        headers=auth(admin),
    )
    assert created.status_code == 201, created.text
    po = created.json()
    assert po["status"] == "pending"
    assert po["is_simulated"] is True
    assert po["amount_minor"] > 0

    # Triggering a second auto-computed payout with 0 remaining balance fails with 409.
    dup = api.post("/api/v1/admin/payouts", json={"event_id": event.id}, headers=auth(admin))
    assert dup.status_code == 409

    # Transition pending -> processing -> paid.
    proc = api.patch(
        f"/api/v1/admin/payouts/{po['id']}",
        json={"status": "processing"},
        headers=auth(admin),
    )
    assert proc.status_code == 200 and proc.json()["status"] == "processing"

    paid = api.patch(
        f"/api/v1/admin/payouts/{po['id']}",
        json={"status": "paid", "reference": "SIM-BANK-001"},
        headers=auth(admin),
    )
    assert paid.status_code == 200
    assert paid.json()["status"] == "paid"
    assert paid.json()["paid_at"] is not None

    # Cannot transition out of terminal paid state.
    illegal = api.patch(
        f"/api/v1/admin/payouts/{po['id']}",
        json={"status": "failed"},
        headers=auth(admin),
    )
    assert illegal.status_code == 409

    # Organizer reads their payout history.
    org_list = api.get("/api/v1/organizer/payouts", headers=auth(org_user))
    assert org_list.status_code == 200
    assert [p["id"] for p in org_list.json()] == [po["id"]]

    # Verify localized payout.status templates have no raw English "active"/"suspended"/"paid" in ru/kk!
    ru_active, _ = notify.render("payout.status", {"event_title": "Jazz", "status": "active"}, "ru")
    kk_susp, _ = notify.render(
        "payout.status", {"event_title": "Jazz", "status": "suspended"}, "kk"
    )
    ru_paid, _ = notify.render(
        "payout.status", {"event_title": "Jazz", "status": "paid", "status_key": "paid"}, "ru"
    )
    assert "активны" in ru_active and "active" not in ru_active
    assert "уақытша тоқтатылды" in kk_susp and "suspended" not in kk_susp
    assert "выплачено" in ru_paid


def test_missing_admin_filters_reports_guard_and_csv_exports(api, db: Session):
    admin = _make_admin(db, "admin-flt@example.com")
    org_user, profile = add_organizer(db, "org-flt@example.com")
    pub = add_event(
        db, profile, title="Open Concert", slug="open-concert", status=EventStatus.PUBLISHED
    )
    draft = add_event(
        db, profile, title="Secret Draft", slug="secret-draft", status=EventStatus.DRAFT
    )
    activate_paid_sales(db, pub)
    tt = add_ticket_type(db, pub.id, name="Pass", price_minor=50_000, quantity_total=10)
    order = _paid_order(api, pub.slug, tt.id)

    # Create a refund and a campaign.
    api.post(
        f"/api/v1/organizer/events/{pub.id}/orders/{order['order_number']}/refund",
        json={"reason": "Plan changed"},
        headers=auth(org_user),
    )
    api.post(
        f"/api/v1/organizer/events/{pub.id}/campaigns",
        json={
            "name": "Summer Promo",
            "code": "SUM10",
            "discount_type": "percent",
            "discount_value": 10,
        },
        headers=auth(org_user),
    )

    # 1) GET /admin/events?status=draft
    drafts = api.get("/api/v1/admin/events", params={"status": "draft"}, headers=auth(admin)).json()
    assert [e["id"] for e in drafts] == [draft.id]

    # 2) GET /admin/orders?status=partially_refunded is accepted (200, not 422).
    pr = api.get(
        "/api/v1/admin/orders", params={"status": "partially_refunded"}, headers=auth(admin)
    )
    assert pr.status_code == 200 and pr.json() == []

    # 3) GET /admin/events/{id}/timeline?since=&until=
    future = (datetime.now(UTC) + timedelta(days=1)).isoformat()
    tl_empty = api.get(
        f"/api/v1/admin/events/{pub.id}/timeline", params={"since": future}, headers=auth(admin)
    )
    assert tl_empty.status_code == 200 and tl_empty.json() == []

    # 4) GET /admin/campaigns?q=&is_active=
    camps = api.get(
        "/api/v1/admin/campaigns", params={"q": "SUM10", "is_active": "true"}, headers=auth(admin)
    ).json()
    assert len(camps) == 1 and camps[0]["code"] == "SUM10"

    # 5) Reports open-first & 409 guard on re-resolving.
    api.post(f"/api/v1/events/{pub.slug}/report", json={"reason": "fraud", "details": "first"})
    api.post(
        f"/api/v1/events/{pub.slug}/report", json={"reason": "misleading", "details": "second"}
    )
    reports = api.get("/api/v1/admin/reports", headers=auth(admin)).json()
    newest_id, older_id = reports[0]["id"], reports[1]["id"]
    # Resolve the newer one -> older (still open) MUST now sort ahead of newer (dismissed)!
    r1 = api.post(
        f"/api/v1/admin/reports/{newest_id}/resolve",
        json={"status": "dismissed"},
        headers=auth(admin),
    )
    assert r1.status_code == 200
    re_resolve = api.post(
        f"/api/v1/admin/reports/{newest_id}/resolve",
        json={"status": "actioned"},
        headers=auth(admin),
    )
    assert re_resolve.status_code == 409
    sorted_reports = api.get("/api/v1/admin/reports", headers=auth(admin)).json()
    assert [r["id"] for r in sorted_reports] == [older_id, newest_id]

    # 6) Filtered refunds / activations / users + CSV exports.
    assert (
        len(api.get("/api/v1/admin/refunds", params={"q": "Plan"}, headers=auth(admin)).json()) == 1
    )
    assert (
        len(
            api.get(
                "/api/v1/admin/activations", params={"status": "active"}, headers=auth(admin)
            ).json()
        )
        == 1
    )
    assert (
        len(
            api.get(
                "/api/v1/admin/users",
                params={"status": "active", "q": "org-flt"},
                headers=auth(admin),
            ).json()
        )
        == 1
    )

    for path, expected_col in [
        ("/api/v1/admin/exports/refunds.csv", "amount_kzt"),
        ("/api/v1/admin/exports/users.csv", "email_verified"),
        ("/api/v1/admin/exports/events.csv", "visibility"),
        ("/api/v1/admin/exports/activations.csv", "activation_fee_kzt"),
    ]:
        res = api.get(path, headers=auth(admin))
        assert res.status_code == 200, f"{path}: {res.text}"
        assert "text/csv" in res.headers["content-type"]
        assert expected_col in res.text
