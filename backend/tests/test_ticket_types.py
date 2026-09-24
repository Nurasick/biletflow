from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.event import EventStatus
from app.models.organizer import OrganizerProfile
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.ticket_type import TicketTypeUpdate
from app.services import ticket_type as ticket_type_service
from tests.test_events import add_event, add_organizer, add_user, auth

PUBLIC = "/api/v1/events/{slug}/ticket-types"
MINE = "/api/v1/organizer/events/{event_id}/ticket-types"


def add_ticket_type(db: Session, event_id: int, **overrides) -> TicketType:
    fields = dict(name="General", quantity_total=100, event_id=event_id) | overrides
    ticket_type = TicketType(**fields)
    db.add(ticket_type)
    db.commit()
    return ticket_type


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


# --- create -----------------------------------------------------------------


def test_create_ticket_type_belongs_to_the_event_in_the_url(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)

    response = api.post(
        MINE.format(event_id=event.id),
        json={"name": "VIP", "quantity_total": 50, "price_minor": 1_500_000},
        headers=auth(user),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["event_id"] == event.id
    assert body["quantity_sold"] == 0
    assert body["quantity_reserved"] == 0
    assert body["currency"] == "KZT"


def test_create_ticket_type_ignores_client_supplied_counters_and_event(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    other = add_event(db, profile, slug="other-event")

    response = api.post(
        MINE.format(event_id=event.id),
        json={
            "name": "VIP",
            "quantity_total": 50,
            "quantity_sold": 49,
            "quantity_reserved": 1,
            "event_id": other.id,
        },
        headers=auth(user),
    )

    body = response.json()
    assert body["event_id"] == event.id
    assert body["quantity_sold"] == 0
    assert body["quantity_reserved"] == 0


def test_create_ticket_type_returns_404_for_someone_elses_event(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    intruder, _ = add_organizer(db, "intruder@example.com")

    response = api.post(
        MINE.format(event_id=event.id),
        json={"name": "VIP", "quantity_total": 50},
        headers=auth(intruder),
    )

    assert response.status_code == 404


def test_create_ticket_type_requires_an_organizer_profile(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    attendee = add_user(db, "attendee@example.com")

    response = api.post(
        MINE.format(event_id=event.id),
        json={"name": "VIP", "quantity_total": 50},
        headers=auth(attendee),
    )

    assert response.status_code == 403


def test_create_ticket_type_refuses_a_cancelled_event(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.CANCELLED)

    response = api.post(
        MINE.format(event_id=event.id),
        json={"name": "VIP", "quantity_total": 50},
        headers=auth(user),
    )

    assert response.status_code == 409


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"price_minor": -1}, id="negative-price"),
        pytest.param({"quantity_total": 0}, id="zero-quantity"),
        pytest.param({"max_per_order": 0}, id="zero-max-per-order"),
        pytest.param({"currency": "USD"}, id="unsupported-currency"),
        pytest.param({"name": ""}, id="empty-name"),
        pytest.param(
            {"sales_start_at": "2030-02-01T00:00:00Z", "sales_end_at": "2030-01-01T00:00:00Z"},
            id="window-reversed",
        ),
        pytest.param({"sales_start_at": "2030-02-01T00:00:00"}, id="naive-datetime"),
    ],
)
def test_create_ticket_type_rejects_invalid_input(api, db, organizer, overrides):
    user, profile = organizer
    event = add_event(db, profile)

    response = api.post(
        MINE.format(event_id=event.id),
        json={"name": "VIP", "quantity_total": 50} | overrides,
        headers=auth(user),
    )

    assert response.status_code == 422


# --- lists ------------------------------------------------------------------


def test_organizer_list_includes_hidden_types_in_display_order(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    add_ticket_type(db, event.id, name="Late", position=2)
    add_ticket_type(db, event.id, name="Hidden", position=1, is_hidden=True)
    add_ticket_type(db, event.id, name="Early", position=0)

    response = api.get(MINE.format(event_id=event.id), headers=auth(user))

    assert response.status_code == 200
    assert [t["name"] for t in response.json()] == ["Early", "Hidden", "Late"]


def test_organizer_list_returns_404_for_someone_elses_event(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    intruder, _ = add_organizer(db, "intruder@example.com")

    response = api.get(MINE.format(event_id=event.id), headers=auth(intruder))

    assert response.status_code == 404


def test_public_list_hides_hidden_types_and_raw_counters(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    add_ticket_type(
        db, event.id, name="GA", quantity_total=100, quantity_sold=90, quantity_reserved=5
    )
    add_ticket_type(db, event.id, name="Comps", is_hidden=True)

    response = api.get(PUBLIC.format(slug=event.slug))

    assert response.status_code == 200
    [ticket_type] = response.json()
    assert ticket_type["name"] == "GA"
    assert ticket_type["available"] == 5
    assert "quantity_sold" not in ticket_type
    assert "is_hidden" not in ticket_type


def test_public_list_returns_404_for_a_draft_event(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    add_ticket_type(db, event.id)

    assert api.get(PUBLIC.format(slug=event.slug)).status_code == 404


# --- update -----------------------------------------------------------------


def patch(api, user, event_id, ticket_type_id, body):
    url = f"{MINE.format(event_id=event_id)}/{ticket_type_id}"
    return api.patch(url, json=body, headers=auth(user))


def test_update_ticket_type_changes_only_the_fields_sent(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    ticket_type = add_ticket_type(db, event.id, description="Standing")

    response = patch(api, user, event.id, ticket_type.id, {"price_minor": 500_000})

    assert response.status_code == 200
    assert response.json()["price_minor"] == 500_000
    assert response.json()["description"] == "Standing"


def test_update_ticket_type_returns_404_through_another_events_url(api, db, organizer):
    user, profile = organizer
    mine = add_event(db, profile)
    _, other_profile = add_organizer(db, "other@example.com")
    theirs = add_event(db, other_profile, slug="their-event")
    their_ticket_type = add_ticket_type(db, theirs.id)

    response = patch(api, user, mine.id, their_ticket_type.id, {"quantity_total": 1})

    assert response.status_code == 404


def test_update_ticket_type_refuses_a_total_below_tickets_taken(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    ticket_type = add_ticket_type(db, event.id, quantity_sold=30, quantity_reserved=10)

    response = patch(api, user, event.id, ticket_type.id, {"quantity_total": 39})

    assert response.status_code == 409
    assert "40" in response.json()["detail"]


def test_update_ticket_type_allows_a_total_equal_to_tickets_taken(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    ticket_type = add_ticket_type(db, event.id, quantity_sold=30, quantity_reserved=10)

    response = patch(api, user, event.id, ticket_type.id, {"quantity_total": 40})

    assert response.status_code == 200
    assert response.json()["quantity_total"] == 40


def test_update_ticket_type_checks_the_window_against_the_stored_start(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    ticket_type = add_ticket_type(
        db,
        event.id,
        sales_start_at=datetime(2030, 2, 1, tzinfo=UTC),
    )

    response = patch(api, user, event.id, ticket_type.id, {"sales_end_at": "2030-01-01T00:00:00Z"})

    assert response.status_code == 422


def test_update_ticket_type_rejects_null_for_a_required_field(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    ticket_type = add_ticket_type(db, event.id)

    response = patch(api, user, event.id, ticket_type.id, {"quantity_total": None})

    assert response.status_code == 422


def test_update_ticket_type_refuses_a_cancelled_event(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.CANCELLED)
    ticket_type = add_ticket_type(db, event.id)

    response = patch(api, user, event.id, ticket_type.id, {"name": "Back"})

    assert response.status_code == 409


def test_update_ticket_type_falls_back_to_the_check_constraint_when_a_sale_races_it(db, organizer):
    # The service checks the counters it loaded. A checkout that commits after
    # that load makes the check stale; the CHECK constraint must still refuse.
    _, profile = organizer
    event = add_event(db, profile)
    ticket_type = add_ticket_type(db, event.id, quantity_total=100, quantity_sold=10)
    db.execute(
        text("UPDATE ticket_types SET quantity_sold = 90 WHERE id = :id"), {"id": ticket_type.id}
    )

    with pytest.raises(ticket_type_service.ConcurrentInventoryChange):
        ticket_type_service.update_ticket_type(
            db, event, ticket_type, TicketTypeUpdate(quantity_total=50)
        )
