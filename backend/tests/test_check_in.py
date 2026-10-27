"""Door scanning (§4.8, §11). The cases are qr-codes.md#what-to-test and the
04-checkin.md checklist, one test each."""

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import qr
from app.models.check_in import CheckInRecord
from app.models.event import Event, EventStatus
from app.models.organizer import OrganizerProfile
from app.models.staff import StaffAssignment
from app.models.ticket import Ticket
from app.models.user import User
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import payload
from tests.test_ticket_types import add_ticket_type

SCAN = "/api/v1/staff/events/{event_id}/scan"
MANUAL = "/api/v1/staff/events/{event_id}/tickets/{code}/check-in"
REVERSE = "/api/v1/staff/events/{event_id}/tickets/{code}/reverse"


@pytest.fixture
def setup(api, db: Session):
    """A published event, an assigned admin, and one order of two free tickets."""
    organizer, profile = add_organizer(db, "organizer@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    general = add_ticket_type(db, event.id)
    admin = add_user(db, "door@example.com")
    db.add(StaffAssignment(event_id=event.id, user_id=admin.id, assigned_by_user_id=organizer.id))
    db.commit()
    order = api.post(f"/api/v1/events/{event.slug}/orders", json=payload((general.id, 2))).json()
    return event, admin, organizer, order


def scan(api, event: Event, user: User, text: str):
    return api.post(SCAN.format(event_id=event.id), headers=auth(user), json={"qr": text})


def test_a_valid_ticket_checks_in_once_then_reports_already_used(api, db, setup):
    event, admin, _, order = setup
    ticket = order["tickets"][0]

    first = scan(api, event, admin, ticket["qr_payload"])
    second = scan(api, event, admin, ticket["qr_payload"])

    assert first.json()["outcome"] == "valid"
    assert first.json()["ticket"]["attendee_name"] == "Guest 0"
    assert second.json()["outcome"] == "already_used"
    assert db.scalar(select(func.count()).select_from(CheckInRecord)) == 1


def test_a_campaign_qr_is_rejected_by_the_admission_endpoint(api, db, setup):
    """§11 success criterion. Genuinely signed, right event, real ticket code:
    only the type is wrong, and that alone must be enough to refuse it."""
    event, admin, _, order = setup
    ticket = db.scalar(
        select(Ticket).where(Ticket.public_code == order["tickets"][0]["public_code"])
    )
    campaign = qr.sign(qr.CAMPAIGN, ticket.public_code, event.id, ticket.qr_nonce)

    response = scan(api, event, admin, campaign)

    assert response.json() == {"outcome": "invalid", "ticket": None}
    db.refresh(ticket)
    assert ticket.status == "valid"


def test_a_campaign_link_is_rejected(api, setup):
    event, admin, _, _ = setup

    response = scan(api, event, admin, f"https://biletflow.kz/e/{event.slug}?c=abc123")

    assert response.json()["outcome"] == "invalid"


@pytest.mark.parametrize("field", [2, 3, 4, 5])
def test_altering_any_field_of_the_payload_invalidates_it(api, setup, field):
    event, admin, _, order = setup
    parts = order["tickets"][0]["qr_payload"].split(".")
    parts[field] = parts[field][:-1] + ("A" if parts[field][-1] != "A" else "B")

    assert scan(api, event, admin, ".".join(parts)).json()["outcome"] == "invalid"


def test_a_ticket_for_another_event_reports_wrong_event(api, db, setup):
    event, admin, organizer, order = setup
    profile = db.get(OrganizerProfile, event.organizer_profile_id)
    other = add_event(db, profile, slug="other-event", status=EventStatus.PUBLISHED)
    db.add(StaffAssignment(event_id=other.id, user_id=admin.id, assigned_by_user_id=organizer.id))
    db.commit()

    response = scan(api, other, admin, order["tickets"][0]["qr_payload"])

    assert response.json()["outcome"] == "wrong_event"


@pytest.mark.parametrize("status", ["refunded", "cancelled"])
def test_a_voided_ticket_reports_its_own_status(api, db, setup, status):
    event, admin, _, order = setup
    ticket = db.scalar(
        select(Ticket).where(Ticket.public_code == order["tickets"][0]["public_code"])
    )
    ticket.status = status
    db.commit()

    response = scan(api, event, admin, order["tickets"][0]["qr_payload"])

    assert response.json()["outcome"] == status


def test_a_rotated_nonce_voids_the_old_qr(api, db, setup):
    event, admin, _, order = setup
    ticket = db.scalar(
        select(Ticket).where(Ticket.public_code == order["tickets"][0]["public_code"])
    )
    ticket.qr_nonce = "rotated"
    db.commit()

    assert scan(api, event, admin, order["tickets"][0]["qr_payload"]).json()["outcome"] == "invalid"


def test_an_unassigned_admin_gets_403(api, db, setup):
    event, _, _, order = setup
    stranger = add_user(db, "stranger@example.com")

    response = scan(api, event, stranger, order["tickets"][0]["qr_payload"])

    assert response.status_code == 403


def test_the_organizer_may_scan_their_own_event(api, setup):
    event, _, organizer, order = setup

    assert (
        scan(api, event, organizer, order["tickets"][0]["qr_payload"]).json()["outcome"] == "valid"
    )


def test_reverse_then_check_in_again_leaves_three_records(api, db, setup):
    event, admin, _, order = setup
    code = order["tickets"][0]["public_code"]

    api.post(MANUAL.format(event_id=event.id, code=code), headers=auth(admin))
    undone = api.post(REVERSE.format(event_id=event.id, code=code), headers=auth(admin))
    again = api.post(MANUAL.format(event_id=event.id, code=code), headers=auth(admin))

    assert undone.json()["status"] == "valid"
    assert again.json()["outcome"] == "valid"
    actions = list(db.scalars(select(CheckInRecord.action).order_by(CheckInRecord.id)))
    assert actions == ["check_in", "reverse", "check_in"]


def test_reversing_a_ticket_that_is_not_checked_in_is_409(api, setup):
    event, admin, _, order = setup

    response = api.post(
        REVERSE.format(event_id=event.id, code=order["tickets"][0]["public_code"]),
        headers=auth(admin),
    )

    assert response.status_code == 409


def test_attendance_counts_exclude_cancelled_and_refunded(api, db, setup):
    event, admin, _, order = setup
    scan(api, event, admin, order["tickets"][0]["qr_payload"])
    extra = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json=payload((db.scalar(select(Ticket.ticket_type_id)), 2)),
    ).json()
    voided = db.scalar(
        select(Ticket).where(Ticket.public_code == extra["tickets"][0]["public_code"])
    )
    voided.status = "refunded"
    db.commit()

    body = api.get(f"/api/v1/staff/events/{event.id}/attendance", headers=auth(admin)).json()

    assert body == {"registered": 3, "checked_in": 1, "absent": 2, "checked_in_percent": 33.3}


def test_search_finds_tickets_by_name_and_by_code(api, setup):
    event, admin, _, order = setup
    code = order["tickets"][1]["public_code"]
    url = f"/api/v1/staff/events/{event.id}/search"

    by_name = api.get(url, params={"q": "guest 1"}, headers=auth(admin)).json()
    by_code = api.get(url, params={"q": code[-4:]}, headers=auth(admin)).json()

    assert [t["public_code"] for t in by_name] == [code]
    assert code in [t["public_code"] for t in by_code]


def test_staff_events_lists_assigned_and_organized_events_only(api, db, setup):
    event, admin, organizer, _ = setup
    _, someone_else = add_organizer(db, "else@example.com")
    add_event(db, someone_else, slug="not-mine", status=EventStatus.PUBLISHED)

    mine = api.get("/api/v1/staff/events", headers=auth(admin)).json()
    theirs = api.get("/api/v1/staff/events", headers=auth(organizer)).json()

    assert [(e["id"], e["role"]) for e in mine] == [(event.id, "event_admin")]
    assert [(e["id"], e["role"]) for e in theirs] == [(event.id, "organizer")]
