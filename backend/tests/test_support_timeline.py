"""T02: support status changes on the event timeline (§4.13, §4.16).

The case thread already shows each status change as a system message. §4.16
also wants them in the event's history, next to orders, refunds and
check-ins. So every status change on an event-linked case writes one audit
row, action `support.status_changed`, including the implicit ones: a staff
reply or an assignment taking a case out of `open`, and a requester's reply
reopening it.

Who sees those rows follows who may see the case, not just who may see the
event: a Platform Admin can open any event's timeline, but attendee cases
belong to the event's organizer (test_a_platform_admin_does_not_see_attendee_cases
in test_support.py), so their rows stay off the admin's timeline.
"""

# The case fixtures (api, event, attendee, organizer, admin) are imported from
# test_support.py so both files build cases the same way. Pytest finds them by
# name; ruff sees an unused import shadowed by every test parameter.
# ruff: noqa: F401, F811

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.user import User
from app.services import audit
from app.services.support import STATUS_CHANGED
from tests.test_events import auth
from tests.test_support import (
    REPLY,
    STAFF_CASE,
    STAFF_REPLY,
    admin,
    api,
    attendee,
    event,
    open_case,
    organizer,
)

ORGANIZER_TIMELINE = "/api/v1/organizer/events/{event_id}/timeline"
ADMIN_TIMELINE = "/api/v1/admin/events/{event_id}/timeline"


def staff_update(api, case: dict, user: User, **changes) -> dict:
    response = api.patch(
        STAFF_CASE.format(number=case["case_number"]), json=changes, headers=auth(user)
    )
    assert response.status_code == 200, response.text
    return response.json()


def staff_reply(api, case: dict, user: User, *, internal: bool = False) -> None:
    response = api.post(
        STAFF_REPLY.format(number=case["case_number"]),
        json={"body": "Looking into it", "is_internal_note": internal},
        headers=auth(user),
    )
    assert response.status_code == 200, response.text


def requester_reply(api, case: dict, user: User | None = None) -> None:
    response = api.post(
        REPLY.format(number=case["case_number"]),
        json={"body": "Any news?"},
        headers=auth(user) if user is not None else {},
        params={"token": case["access_token"]} if user is None else {},
    )
    assert response.status_code == 200, response.text


def status_rows(api, event_id: int, viewer: User, *, as_admin: bool = False) -> list[dict]:
    """The viewer's timeline, filtered to support status changes, oldest first."""
    url = (ADMIN_TIMELINE if as_admin else ORGANIZER_TIMELINE).format(event_id=event_id)
    response = api.get(url, params={"action": STATUS_CHANGED}, headers=auth(viewer))
    assert response.status_code == 200, response.text
    return list(reversed(response.json()))


def moves(rows: list[dict]) -> list[tuple[str, str]]:
    return [(row["payload"]["from"], row["payload"]["to"]) for row in rows]


# --- what gets recorded --------------------------------------------------------


def test_a_staff_status_change_is_on_the_event_timeline(api, event, attendee, organizer):
    case = open_case(api, attendee, event_id=event.id)

    staff_update(api, case, organizer, status="in_progress")

    [row] = status_rows(api, event.id, organizer)
    # §4.16: timestamp, acting user, action type, affected entity, description.
    assert row["created_at"]
    assert (row["actor_user_id"], row["actor_name"]) == (organizer.id, "Abai Kunanbayev")
    assert (row["action"], row["entity_type"]) == (STATUS_CHANGED, "support_case")
    assert row["payload"] == {
        "case_number": case["case_number"],
        "from": "open",
        "to": "in_progress",
        "by": "staff",
    }
    assert case["case_number"] in row["summary"]


def test_every_implicit_change_leaves_exactly_one_row(api, event, attendee, organizer):
    case = open_case(api, attendee, event_id=event.id)

    staff_reply(api, case, organizer)  # open -> in_progress, by replying
    staff_reply(api, case, organizer, internal=True)  # a note changes nothing
    staff_update(api, case, organizer, status="waiting_for_customer")
    requester_reply(api, case, attendee)  # waiting -> in_progress
    staff_update(api, case, organizer, status="resolved")
    requester_reply(api, case, attendee)  # resolved is not terminal

    rows = status_rows(api, event.id, organizer)
    assert moves(rows) == [
        ("open", "in_progress"),
        ("in_progress", "waiting_for_customer"),
        ("waiting_for_customer", "in_progress"),
        ("in_progress", "resolved"),
        ("resolved", "in_progress"),
    ]
    assert [row["payload"]["by"] for row in rows] == [
        "staff",
        "staff",
        "requester",
        "staff",
        "requester",
    ]
    assert [row["actor_user_id"] for row in rows] == [
        organizer.id,
        organizer.id,
        attendee.id,
        organizer.id,
        attendee.id,
    ]


def test_assigning_and_resolving_in_one_request_is_two_rows(api, event, attendee, organizer):
    """Assignment moves the case out of `open` first (§8), then the explicit
    status applies. Two changes, two rows, in that order."""
    case = open_case(api, attendee, event_id=event.id)

    staff_update(api, case, organizer, assigned_to_user_id=organizer.id, status="resolved")

    assert moves(status_rows(api, event.id, organizer)) == [
        ("open", "in_progress"),
        ("in_progress", "resolved"),
    ]


def test_a_guest_reply_is_recorded_with_no_acting_user(api, event, organizer):
    case = open_case(api, contact_email="guest@example.com", event_id=event.id)
    staff_update(api, case, organizer, status="in_progress")
    staff_update(api, case, organizer, status="waiting_for_customer")

    requester_reply(api, case)

    last = status_rows(api, event.id, organizer)[-1]
    assert (last["actor_user_id"], last["actor_name"]) == (None, None)
    assert last["payload"]["by"] == "requester"


def test_a_case_with_no_event_writes_no_timeline_row(api, db: Session, organizer, admin):
    """No event, no event timeline to put it on. The thread still has it."""
    case = open_case(api, organizer, audience="organizer", category="account")

    staff_update(api, case, admin, status="in_progress")

    assert (
        db.scalar(
            select(func.count()).select_from(AuditLog).where(AuditLog.action == STATUS_CHANGED)
        )
        == 0
    )


def test_a_rolled_back_transition_writes_no_row(api, event, attendee, organizer):
    """open -> waiting_for_customer is not a legal staff move (§8): nothing
    changes, so nothing may appear on the timeline either."""
    case = open_case(api, attendee, event_id=event.id)

    response = api.patch(
        STAFF_CASE.format(number=case["case_number"]),
        json={"status": "waiting_for_customer"},
        headers=auth(organizer),
    )

    assert response.status_code == 409
    assert status_rows(api, event.id, organizer) == []


# --- who sees it -----------------------------------------------------------------


@pytest.fixture
def both_audiences(api, event, attendee, organizer, admin) -> tuple[dict, dict]:
    """On one event: an attendee case worked by the organizer, and the
    organizer's own case to the platform worked by an admin."""
    attendee_case = open_case(api, attendee, event_id=event.id)
    staff_update(api, attendee_case, organizer, status="in_progress")
    organizer_case = open_case(
        api, organizer, audience="organizer", category="payment", event_id=event.id
    )
    staff_update(api, organizer_case, admin, status="in_progress")
    return attendee_case, organizer_case


def test_the_organizer_sees_both_kinds_of_case_on_their_timeline(
    api, event, organizer, both_audiences
):
    attendee_case, organizer_case = both_audiences

    rows = status_rows(api, event.id, organizer)

    # Staff on the attendee case, requester on their own case to the platform.
    assert [row["payload"]["case_number"] for row in rows] == [
        attendee_case["case_number"],
        organizer_case["case_number"],
    ]


def test_the_admin_timeline_leaves_out_cases_the_admin_cannot_open(
    api, event, admin, both_audiences
):
    _, organizer_case = both_audiences

    rows = status_rows(api, event.id, admin, as_admin=True)

    assert [row["payload"]["case_number"] for row in rows] == [organizer_case["case_number"]]


def test_the_admin_timeline_still_shows_everything_else(
    api, db: Session, event, admin, both_audiences
):
    """Hiding attendee cases must not hide the rest of the history."""
    audit.record(
        db,
        action="event.published",
        entity_type="event",
        entity_id=event.id,
        event_id=event.id,
        summary="Event published",
    )
    db.commit()

    response = api.get(ADMIN_TIMELINE.format(event_id=event.id), headers=auth(admin))

    assert response.status_code == 200
    assert {row["action"] for row in response.json()} == {"event.published", STATUS_CHANGED}
