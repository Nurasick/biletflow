import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import create_order_token, create_support_case_token
from app.models.event import Event, EventStatus
from app.models.support import CaseStatus, MessageSender, SupportCase, SupportMessage
from app.models.user import User
from app.services import mailer
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_ticket_types import add_ticket_type

CASES = "/api/v1/support/cases"
CASE = "/api/v1/support/cases/{number}"
REPLY = "/api/v1/support/cases/{number}/messages"
QUEUE = "/api/v1/staff/support/cases"
STAFF_CASE = "/api/v1/staff/support/cases/{number}"
STAFF_REPLY = "/api/v1/staff/support/cases/{number}/messages"
CHECKOUT = "/api/v1/events/{slug}/orders"


@pytest.fixture
def organizer(db: Session) -> User:
    user, _ = add_organizer(db, "organizer@example.com")
    return user


@pytest.fixture
def event(db: Session, organizer: User) -> Event:
    profile = organizer_profile(db, organizer)
    return add_event(db, profile, status=EventStatus.PUBLISHED)


@pytest.fixture
def attendee(db: Session) -> User:
    return add_user(db, "aru@example.com")


@pytest.fixture
def admin(db: Session) -> User:
    user = add_user(db, "admin@example.com")
    user.is_platform_admin = True
    db.commit()
    return user


def organizer_profile(db: Session, user: User):
    from app.models.organizer import OrganizerProfile

    return db.scalar(select(OrganizerProfile).where(OrganizerProfile.user_id == user.id))


def buy(api, event: Event, user: User | None = None) -> dict:
    """A confirmed free order with one ticket, bought through the API."""
    ticket_type = add_ticket_type(api.db, event.id, quantity_total=10)
    response = api.post(
        CHECKOUT.format(slug=event.slug),
        json={
            "contact_name": "Aru Sadykova",
            "contact_email": "aru@example.com",
            "items": [{"ticket_type_id": ticket_type.id, "attendees": [{"full_name": "Aru"}]}],
        },
        headers=auth(user) if user is not None else {},
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture
def api(api, db):
    # buy() needs the session to add a ticket type; hang it on the client.
    api.db = db
    return api


def open_case(api, user: User | None = None, **fields) -> dict:
    body = {"category": "ticket_delivery", "body": "My ticket never arrived"} | fields
    response = api.post(CASES, json=body, headers=auth(user) if user is not None else {})
    assert response.status_code == 201, response.text
    return response.json()


# --- opening a case -----------------------------------------------------------


def test_context_is_populated_from_the_ticket_the_case_was_opened_on(api, event, attendee):
    order = buy(api, event, attendee)
    ticket_code = order["tickets"][0]["public_code"]

    case = open_case(api, attendee, ticket_code=ticket_code)

    assert case["status"] == "open"
    assert case["context"] == {
        "event_id": event.id,
        "event_title": event.title,
        "order_number": order["order_number"],
        "ticket_code": ticket_code,
    }
    assert [m["sender"] for m in case["messages"]] == ["requester"]
    assert case["case_number"].startswith("SC-")
    assert case["access_token"] is None


def test_context_from_an_event_page_has_only_the_event(api, event, attendee):
    case = open_case(api, attendee, event_id=event.id, category="event_info")

    assert case["context"]["event_id"] == event.id
    assert case["context"]["order_number"] is None
    assert case["context"]["ticket_code"] is None


def test_an_attendee_case_needs_some_context(api, attendee):
    response = api.post(CASES, json={"category": "payment", "body": "Help"}, headers=auth(attendee))

    assert response.status_code == 422


@pytest.mark.parametrize("category", ["refund_request", "other", ""])
def test_category_must_be_one_of_the_eight_from_the_spec(api, event, attendee, category):
    response = api.post(
        CASES,
        json={"category": category, "body": "Help", "event_id": event.id},
        headers=auth(attendee),
    )

    assert response.status_code == 422


def test_a_case_cannot_cite_someone_elses_order(api, db, event, attendee):
    victim = add_user(db, "victim@example.com")
    order = buy(api, event, victim)

    response = api.post(
        CASES,
        json={"category": "refund", "body": "Refund me", "order_number": order["order_number"]},
        headers=auth(attendee),
    )

    assert response.status_code == 404
    assert db.scalar(select(SupportCase)) is None


def test_a_case_cannot_cite_a_draft_event(api, db, organizer, attendee):
    draft = add_event(db, organizer_profile(db, organizer), slug="draft-event")

    response = api.post(
        CASES,
        json={"category": "event_info", "body": "When?", "event_id": draft.id},
        headers=auth(attendee),
    )

    assert response.status_code == 404


def test_event_and_order_must_belong_together(api, db, organizer, event, attendee):
    other = add_event(db, organizer_profile(db, organizer), slug="other", status="published")
    order = buy(api, event, attendee)

    response = api.post(
        CASES,
        json={
            "category": "refund",
            "body": "Refund",
            "order_number": order["order_number"],
            "event_id": other.id,
        },
        headers=auth(attendee),
    )

    assert response.status_code == 422


# --- guests -------------------------------------------------------------------


def test_a_guest_can_open_and_read_a_case_with_no_account(api, event):
    order = buy(api, event)

    created = open_case(
        api,
        contact_email="guest@example.com",
        order_number=order["order_number"],
        order_token=order["access_token"],
    )
    number, token = created["case_number"], created["access_token"]

    assert token
    response = api.get(CASE.format(number=number), params={"token": token})
    assert response.status_code == 200
    assert response.json()["context"]["order_number"] == order["order_number"]
    assert mailer.outbox[-2].to == "guest@example.com"
    assert f"token={token}" in mailer.outbox[-2].body


def test_a_guest_can_reply_with_the_link(api, event):
    created = open_case(api, contact_email="guest@example.com", event_id=event.id)

    response = api.post(
        REPLY.format(number=created["case_number"]),
        params={"token": created["access_token"]},
        json={"body": "Any news?"},
    )

    assert response.status_code == 200
    assert [m["sender"] for m in response.json()["messages"]] == ["requester", "requester"]


def test_a_guest_needs_a_contact_email(api, event):
    response = api.post(CASES, json={"category": "payment", "body": "Help", "event_id": event.id})

    assert response.status_code == 422


def test_a_guest_cannot_cite_an_order_without_its_link(api, event):
    order = buy(api, event)

    response = api.post(
        CASES,
        json={
            "category": "refund",
            "body": "Refund",
            "contact_email": "guest@example.com",
            "order_number": order["order_number"],
        },
    )

    assert response.status_code == 404


def test_one_cases_link_does_not_open_another(api, event):
    first = open_case(api, contact_email="a@example.com", event_id=event.id)
    second = open_case(api, contact_email="b@example.com", event_id=event.id)

    response = api.get(
        CASE.format(number=second["case_number"]), params={"token": first["access_token"]}
    )

    assert response.status_code == 404


def test_an_order_link_does_not_open_a_case(api, db, event):
    created = open_case(api, contact_email="a@example.com", event_id=event.id)
    case_id = db.scalar(select(SupportCase.id))
    # Same subject id, wrong token type.
    forged = create_order_token(case_id)

    response = api.get(CASE.format(number=created["case_number"]), params={"token": forged})

    assert response.status_code == 404


# --- who may read -------------------------------------------------------------


def test_attendee_a_cannot_read_attendee_bs_case(api, db, event, attendee):
    case = open_case(api, attendee, event_id=event.id)
    other = add_user(db, "other@example.com")

    number = case["case_number"]
    assert api.get(CASE.format(number=number), headers=auth(other)).status_code == 404
    assert (
        api.post(REPLY.format(number=number), json={"body": "hi"}, headers=auth(other)).status_code
        == 404
    )
    assert api.get(CASES, headers=auth(other)).json() == []


def test_an_unrelated_organizer_cannot_read_a_case_for_someone_elses_event(
    api, db, event, attendee
):
    case = open_case(api, attendee, event_id=event.id)
    stranger, _ = add_organizer(db, "stranger@example.com")

    number = case["case_number"]
    assert api.get(STAFF_CASE.format(number=number), headers=auth(stranger)).status_code == 404
    assert api.get(QUEUE, headers=auth(stranger)).json() == []
    response = api.post(
        STAFF_REPLY.format(number=number), json={"body": "hi"}, headers=auth(stranger)
    )
    assert response.status_code == 404


def test_the_events_organizer_sees_the_case_in_their_queue(api, event, attendee, organizer):
    case = open_case(api, attendee, event_id=event.id)

    queue = api.get(QUEUE, headers=auth(organizer)).json()

    assert [c["case_number"] for c in queue] == [case["case_number"]]
    assert queue[0]["contact_email"] == "aru@example.com"


def test_a_platform_admin_does_not_see_attendee_cases(api, event, attendee, admin):
    case = open_case(api, attendee, event_id=event.id)

    assert api.get(QUEUE, headers=auth(admin)).json() == []
    assert (
        api.get(STAFF_CASE.format(number=case["case_number"]), headers=auth(admin)).status_code
        == 404
    )


def test_an_organizer_case_goes_to_admins_and_not_to_other_organizers(
    api, db, organizer, event, admin
):
    case = open_case(api, organizer, audience="organizer", category="account", event_id=event.id)
    other, _ = add_organizer(db, "other-org@example.com")

    assert [c["case_number"] for c in api.get(QUEUE, headers=auth(admin)).json()] == [
        case["case_number"]
    ]
    assert api.get(QUEUE, headers=auth(other)).json() == []
    # The organizer is the requester here, not the staff.
    assert api.get(QUEUE, headers=auth(organizer)).json() == []


def test_only_organizers_open_cases_for_the_platform(api, attendee):
    response = api.post(
        CASES,
        json={"audience": "organizer", "category": "account", "body": "Help"},
        headers=auth(attendee),
    )

    assert response.status_code == 403


def test_an_organizer_case_cannot_cite_someone_elses_event(api, db, event):
    other, _ = add_organizer(db, "other-org@example.com")

    response = api.post(
        CASES,
        json={"audience": "organizer", "category": "payment", "body": "?", "event_id": event.id},
        headers=auth(other),
    )

    assert response.status_code == 404


# --- internal notes -----------------------------------------------------------


def test_an_attendee_never_receives_internal_notes(api, event, attendee, organizer):
    case = open_case(api, attendee, event_id=event.id)
    number = case["case_number"]
    api.post(
        STAFF_REPLY.format(number=number),
        json={"body": "Checked with the provider", "is_internal_note": True},
        headers=auth(organizer),
    )
    api.post(STAFF_REPLY.format(number=number), json={"body": "On it"}, headers=auth(organizer))

    requester_view = api.get(CASE.format(number=number), headers=auth(attendee)).json()
    staff_view = api.get(STAFF_CASE.format(number=number), headers=auth(organizer)).json()

    bodies = [m["body"] for m in requester_view["messages"]]
    assert "Checked with the provider" not in bodies
    assert "On it" in bodies
    assert all("is_internal_note" not in m for m in requester_view["messages"])
    assert any(m["is_internal_note"] for m in staff_view["messages"])


def test_an_internal_note_does_not_claim_the_case_or_email_the_requester(
    api, event, attendee, organizer
):
    case = open_case(api, attendee, event_id=event.id)
    sent = len(mailer.outbox)

    response = api.post(
        STAFF_REPLY.format(number=case["case_number"]),
        json={"body": "note", "is_internal_note": True},
        headers=auth(organizer),
    )

    assert response.json()["status"] == "open"
    assert len(mailer.outbox) == sent


def test_the_database_refuses_an_internal_note_from_the_requester(db, event, attendee):
    support_case = SupportCase(
        case_number="SC-TEST-1",
        audience="attendee",
        contact_email="aru@example.com",
        event_id=event.id,
        category="payment",
    )
    db.add(support_case)
    db.flush()
    db.add(
        SupportMessage(
            support_case_id=support_case.id,
            sender=MessageSender.REQUESTER,
            author_user_id=attendee.id,
            body="hidden",
            is_internal_note=True,
        )
    )

    with pytest.raises(IntegrityError):
        db.commit()


# --- status -------------------------------------------------------------------


def staff_patch(api, user, number, **fields):
    return api.patch(STAFF_CASE.format(number=number), json=fields, headers=auth(user))


def test_first_staff_reply_moves_open_to_in_progress(api, event, attendee, organizer):
    case = open_case(api, attendee, event_id=event.id)

    response = api.post(
        STAFF_REPLY.format(number=case["case_number"]),
        json={"body": "Looking"},
        headers=auth(organizer),
    )

    assert response.json()["status"] == "in_progress"
    assert mailer.outbox[-1].to == "aru@example.com"
    assert "Looking" in mailer.outbox[-1].body


def test_resolved_then_reply_goes_back_to_in_progress(api, event, attendee, organizer):
    number = open_case(api, attendee, event_id=event.id)["case_number"]
    api.post(
        STAFF_REPLY.format(number=number), json={"body": "Sent again"}, headers=auth(organizer)
    )
    resolved = staff_patch(api, organizer, number, status="resolved").json()
    assert resolved["status"] == "resolved"
    assert resolved["resolved_at"] is not None

    response = api.post(
        REPLY.format(number=number), json={"body": "Still nothing"}, headers=auth(attendee)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "in_progress"
    assert response.json()["resolved_at"] is None


def test_requester_reply_ends_waiting_for_customer(api, event, attendee, organizer):
    number = open_case(api, attendee, event_id=event.id)["case_number"]
    staff_patch(api, organizer, number, status="in_progress")
    staff_patch(api, organizer, number, status="waiting_for_customer")

    response = api.post(REPLY.format(number=number), json={"body": "Here"}, headers=auth(attendee))

    assert response.json()["status"] == "in_progress"


def test_a_requester_reply_to_an_open_case_keeps_it_open(api, event, attendee):
    number = open_case(api, attendee, event_id=event.id)["case_number"]

    response = api.post(REPLY.format(number=number), json={"body": "+1"}, headers=auth(attendee))

    assert response.json()["status"] == "open"


@pytest.mark.parametrize(
    ("steps", "target"),
    [
        ([], "waiting_for_customer"),
        ([], "resolved"),
        (["in_progress", "resolved"], "waiting_for_customer"),
    ],
)
def test_staff_cannot_skip_the_state_machine(api, event, attendee, organizer, steps, target):
    number = open_case(api, attendee, event_id=event.id)["case_number"]
    for step in steps:
        assert staff_patch(api, organizer, number, status=step).status_code == 200

    response = staff_patch(api, organizer, number, status=target)

    assert response.status_code == 409


def test_staff_cannot_set_open(api, event, attendee, organizer):
    number = open_case(api, attendee, event_id=event.id)["case_number"]

    assert staff_patch(api, organizer, number, status="open").status_code == 422


def test_status_changes_leave_system_messages_and_email_the_requester(
    api, event, attendee, organizer
):
    number = open_case(api, attendee, event_id=event.id)["case_number"]

    staff_patch(api, organizer, number, status="in_progress")
    view = staff_patch(api, organizer, number, status="waiting_for_customer").json()

    system = [m for m in view["messages"] if m["sender"] == "system"]
    assert [m["author_user_id"] for m in system] == [None, None]
    assert mailer.outbox[-1].to == "aru@example.com"
    assert "Waiting for customer" in mailer.outbox[-1].subject


# --- assignment ---------------------------------------------------------------


def test_assigning_claims_the_case_and_emails_the_assignee(api, db, organizer, event, admin):
    number = open_case(api, organizer, audience="organizer", category="payment")["case_number"]
    colleague = add_user(db, "colleague@example.com")
    colleague.is_platform_admin = True
    db.commit()

    response = staff_patch(api, admin, number, assigned_to_user_id=colleague.id)

    assert response.status_code == 200
    assert response.json()["assigned_to_user_id"] == colleague.id
    assert response.json()["status"] == "in_progress"
    assert mailer.outbox[-2].to == "colleague@example.com"
    # Assignment moved it out of `open`, and the requester hears about that.
    assert mailer.outbox[-1].to == "organizer@example.com"
    assert "In progress" in mailer.outbox[-1].subject


def test_cannot_assign_someone_who_could_not_see_the_case(api, db, event, attendee, organizer):
    number = open_case(api, attendee, event_id=event.id)["case_number"]

    response = staff_patch(api, organizer, number, assigned_to_user_id=attendee.id)

    assert response.status_code == 422
    assert db.scalar(select(SupportCase.status)) == CaseStatus.OPEN


# --- the queue ----------------------------------------------------------------


def test_queue_puts_open_cases_first_and_filters(api, event, attendee, organizer):
    handled = open_case(api, attendee, event_id=event.id, category="payment")["case_number"]
    fresh = open_case(api, attendee, event_id=event.id, category="refund")["case_number"]
    # The handled case is now the most recently updated, but not open.
    api.post(STAFF_REPLY.format(number=handled), json={"body": "Hi"}, headers=auth(organizer))

    queue = api.get(QUEUE, headers=auth(organizer)).json()
    by_category = api.get(QUEUE, params={"category": "payment"}, headers=auth(organizer)).json()
    by_status = api.get(QUEUE, params={"status": "open"}, headers=auth(organizer)).json()

    assert [c["case_number"] for c in queue] == [fresh, handled]
    assert [c["case_number"] for c in by_category] == [handled]
    assert [c["case_number"] for c in by_status] == [fresh]


def test_my_cases_lists_only_my_own(api, db, event, attendee):
    mine = open_case(api, attendee, event_id=event.id)["case_number"]
    open_case(api, add_user(db, "other@example.com"), event_id=event.id)

    response = api.get(CASES, headers=auth(attendee))

    assert [c["case_number"] for c in response.json()] == [mine]


def test_a_signed_link_for_a_member_case_also_works(api, db, event, attendee):
    number = open_case(api, attendee, event_id=event.id)["case_number"]
    token = create_support_case_token(db.scalar(select(SupportCase.id)))

    assert api.get(CASE.format(number=number), params={"token": token}).status_code == 200
