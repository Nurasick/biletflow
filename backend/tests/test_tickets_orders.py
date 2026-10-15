from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.order import Order, OrderStatus
from app.models.organizer import OrganizerProfile
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from tests.test_events import add_event, add_organizer, add_user, auth

PUBLIC = "/api/v1/events/{event_id}/tickets"
ISSUE = "/api/v1/organizer/events/{event_id}/tickets"
EDIT = "/api/v1/organizer/tickets/{ticket_id}"
ORDERS = "/api/v1/orders"


def add_ticket(db: Session, event: Event, code: str, **overrides) -> Ticket:
    fields = dict(event_id=event.id, ticket_code=code, price=Decimal("5000.00")) | overrides
    ticket = Ticket(**fields)
    db.add(ticket)
    db.commit()
    return ticket


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


@pytest.fixture
def event(db: Session, organizer) -> Event:
    _, profile = organizer
    return add_event(db, profile, status=EventStatus.PUBLISHED)


@pytest.fixture
def buyer(db: Session) -> User:
    return add_user(db, "buyer@example.com")


# --- issuing tickets ----------------------------------------------------------


def test_issue_ticket_belongs_to_the_event_in_the_url(api, db, organizer, event):
    user, profile = organizer
    other = add_event(db, profile, slug="other-event")

    response = api.post(
        ISSUE.format(event_id=event.id),
        json={"ticket_code": "JAZZ-001", "price": "5000.00", "event_id": other.id},
        headers=auth(user),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["event_id"] == event.id
    assert body["status"] == "available"
    assert body["order_id"] is None


def test_issue_ticket_returns_404_for_someone_elses_event(api, db, event):
    intruder, _ = add_organizer(db, "intruder@example.com")

    response = api.post(
        ISSUE.format(event_id=event.id),
        json={"ticket_code": "JAZZ-001", "price": "5000.00"},
        headers=auth(intruder),
    )

    assert response.status_code == 404
    assert db.query(Ticket).count() == 0


def test_issue_ticket_requires_an_organizer_profile(api, event, buyer):
    response = api.post(
        ISSUE.format(event_id=event.id),
        json={"ticket_code": "JAZZ-001", "price": "5000.00"},
        headers=auth(buyer),
    )

    assert response.status_code == 403


def test_issue_ticket_rejects_a_duplicate_code(api, db, organizer, event):
    user, _ = organizer
    add_ticket(db, event, "JAZZ-001")

    response = api.post(
        ISSUE.format(event_id=event.id),
        json={"ticket_code": "JAZZ-001", "price": "5000.00"},
        headers=auth(user),
    )

    assert response.status_code == 409


@pytest.mark.parametrize("price", ["-1", "100000000.00", "10.001"])
def test_issue_ticket_rejects_a_price_the_column_cannot_hold(api, organizer, event, price):
    user, _ = organizer

    response = api.post(
        ISSUE.format(event_id=event.id),
        json={"ticket_code": "JAZZ-001", "price": price},
        headers=auth(user),
    )

    assert response.status_code == 422


# --- editing tickets ----------------------------------------------------------


def test_edit_ticket_changes_price_and_seat(api, db, organizer, event):
    user, _ = organizer
    ticket = add_ticket(db, event, "JAZZ-001")

    response = api.patch(
        EDIT.format(ticket_id=ticket.id),
        json={"price": "7500.00", "seat_number": "A-12"},
        headers=auth(user),
    )

    assert response.status_code == 200
    assert Decimal(response.json()["price"]) == Decimal("7500.00")
    assert response.json()["seat_number"] == "A-12"


def test_edit_ticket_can_withdraw_it_from_sale(api, db, organizer, event):
    user, _ = organizer
    ticket = add_ticket(db, event, "JAZZ-001")

    response = api.patch(
        EDIT.format(ticket_id=ticket.id), json={"status": "cancelled"}, headers=auth(user)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"


@pytest.mark.parametrize("status", ["sold", "reserved", "available"])
def test_edit_ticket_cannot_set_order_driven_statuses(api, db, organizer, event, status):
    user, _ = organizer
    ticket = add_ticket(db, event, "JAZZ-001")

    response = api.patch(
        EDIT.format(ticket_id=ticket.id), json={"status": status}, headers=auth(user)
    )

    assert response.status_code == 422


@pytest.mark.parametrize("field", ["price", "status"])
def test_edit_ticket_rejects_explicit_null_for_required_fields(api, db, organizer, event, field):
    user, _ = organizer
    ticket = add_ticket(db, event, "JAZZ-001")

    response = api.patch(EDIT.format(ticket_id=ticket.id), json={field: None}, headers=auth(user))

    assert response.status_code == 422


@pytest.mark.parametrize("status", [TicketStatus.RESERVED, TicketStatus.SOLD])
def test_edit_ticket_refuses_a_ticket_that_is_in_an_order(api, db, organizer, event, status):
    user, _ = organizer
    ticket = add_ticket(db, event, "JAZZ-001", status=status)

    response = api.patch(
        EDIT.format(ticket_id=ticket.id), json={"price": "1.00"}, headers=auth(user)
    )

    assert response.status_code == 409
    db.refresh(ticket)
    assert ticket.price == Decimal("5000.00")


def test_edit_ticket_returns_404_for_someone_elses_ticket(api, db, event):
    ticket = add_ticket(db, event, "JAZZ-001")
    intruder, _ = add_organizer(db, "intruder@example.com")

    response = api.patch(
        EDIT.format(ticket_id=ticket.id), json={"price": "1.00"}, headers=auth(intruder)
    )

    assert response.status_code == 404


# --- public listing -----------------------------------------------------------


def test_public_list_shows_only_available_tickets(api, db, event):
    add_ticket(db, event, "JAZZ-001")
    add_ticket(db, event, "JAZZ-002", status=TicketStatus.SOLD)
    add_ticket(db, event, "JAZZ-003", status=TicketStatus.CANCELLED)

    response = api.get(PUBLIC.format(event_id=event.id))

    assert response.status_code == 200
    assert [t["ticket_code"] for t in response.json()] == ["JAZZ-001"]


def test_public_list_hides_a_draft_events_tickets(api, db, organizer):
    _, profile = organizer
    draft = add_event(db, profile, slug="draft-event")
    add_ticket(db, draft, "DRAFT-001")

    response = api.get(PUBLIC.format(event_id=draft.id))

    assert response.status_code == 404


# --- placing orders -----------------------------------------------------------


def test_order_reserves_tickets_and_totals_their_prices(api, db, event, buyer):
    first = add_ticket(db, event, "JAZZ-001", price=Decimal("5000.00"))
    second = add_ticket(db, event, "JAZZ-002", price=Decimal("2500.50"))

    response = api.post(ORDERS, json={"ticket_ids": [first.id, second.id]}, headers=auth(buyer))

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "pending"
    assert Decimal(body["total_amount"]) == Decimal("7500.50")
    assert body["expires_at"] is not None
    assert {t["status"] for t in body["tickets"]} == {"reserved"}
    db.refresh(first)
    assert first.order_id == body["id"]


def test_order_refuses_a_ticket_someone_else_reserved(api, db, event, buyer):
    ticket = add_ticket(db, event, "JAZZ-001")
    rival = add_user(db, "rival@example.com")
    assert (
        api.post(ORDERS, json={"ticket_ids": [ticket.id]}, headers=auth(rival)).status_code == 201
    )

    response = api.post(ORDERS, json={"ticket_ids": [ticket.id]}, headers=auth(buyer))

    assert response.status_code == 409


def test_order_is_all_or_nothing(api, db, event, buyer):
    free = add_ticket(db, event, "JAZZ-001")
    sold = add_ticket(db, event, "JAZZ-002", status=TicketStatus.SOLD)

    response = api.post(ORDERS, json={"ticket_ids": [free.id, sold.id]}, headers=auth(buyer))

    assert response.status_code == 409
    db.refresh(free)
    assert free.status == TicketStatus.AVAILABLE
    assert db.query(Order).count() == 0


@pytest.mark.parametrize("status", [EventStatus.DRAFT, EventStatus.CANCELLED])
def test_order_refuses_tickets_of_an_event_not_on_sale(api, db, organizer, buyer, status):
    _, profile = organizer
    closed = add_event(db, profile, slug="closed-event", status=status)
    ticket = add_ticket(db, closed, "CLOSED-001")

    response = api.post(ORDERS, json={"ticket_ids": [ticket.id]}, headers=auth(buyer))

    assert response.status_code == 409


def test_order_rejects_duplicate_ticket_ids(api, db, event, buyer):
    ticket = add_ticket(db, event, "JAZZ-001")

    response = api.post(ORDERS, json={"ticket_ids": [ticket.id, ticket.id]}, headers=auth(buyer))

    assert response.status_code == 422


def test_order_requires_authentication(api, db, event):
    ticket = add_ticket(db, event, "JAZZ-001")

    response = api.post(ORDERS, json={"ticket_ids": [ticket.id]})

    assert response.status_code == 401


def test_an_expired_reservation_goes_back_on_sale(api, db, event, buyer):
    ticket = add_ticket(db, event, "JAZZ-001")
    rival = add_user(db, "rival@example.com")
    stale = Order(
        user_id=rival.id,
        total_amount=ticket.price,
        status=OrderStatus.PENDING,
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    db.add(stale)
    db.flush()
    ticket.order_id = stale.id
    ticket.status = TicketStatus.RESERVED
    db.commit()

    response = api.post(ORDERS, json={"ticket_ids": [ticket.id]}, headers=auth(buyer))

    assert response.status_code == 201
    db.refresh(stale)
    assert stale.status == OrderStatus.EXPIRED
    db.refresh(ticket)
    assert ticket.order_id == response.json()["id"]


# --- reading and cancelling orders --------------------------------------------


def test_list_orders_shows_only_my_own(api, db, event, buyer):
    mine = add_ticket(db, event, "JAZZ-001")
    theirs = add_ticket(db, event, "JAZZ-002")
    rival = add_user(db, "rival@example.com")
    api.post(ORDERS, json={"ticket_ids": [mine.id]}, headers=auth(buyer))
    api.post(ORDERS, json={"ticket_ids": [theirs.id]}, headers=auth(rival))

    response = api.get(ORDERS, headers=auth(buyer))

    assert response.status_code == 200
    assert [o["tickets"][0]["ticket_code"] for o in response.json()] == ["JAZZ-001"]


def test_read_order_returns_404_for_someone_elses_order(api, db, event, buyer):
    ticket = add_ticket(db, event, "JAZZ-001")
    rival = add_user(db, "rival@example.com")
    order_id = api.post(ORDERS, json={"ticket_ids": [ticket.id]}, headers=auth(rival)).json()["id"]

    assert api.get(f"{ORDERS}/{order_id}", headers=auth(buyer)).status_code == 404
    assert api.post(f"{ORDERS}/{order_id}/cancel", headers=auth(buyer)).status_code == 404


def test_cancel_order_releases_its_tickets(api, db, event, buyer):
    ticket = add_ticket(db, event, "JAZZ-001")
    order_id = api.post(ORDERS, json={"ticket_ids": [ticket.id]}, headers=auth(buyer)).json()["id"]

    response = api.post(f"{ORDERS}/{order_id}/cancel", headers=auth(buyer))

    assert response.status_code == 200
    assert response.json()["status"] == "cancelled"
    assert response.json()["cancelled_at"] is not None
    db.refresh(ticket)
    assert ticket.status == TicketStatus.AVAILABLE
    assert ticket.order_id is None


def test_cancel_order_twice_is_a_conflict(api, db, event, buyer):
    ticket = add_ticket(db, event, "JAZZ-001")
    order_id = api.post(ORDERS, json={"ticket_ids": [ticket.id]}, headers=auth(buyer)).json()["id"]
    api.post(f"{ORDERS}/{order_id}/cancel", headers=auth(buyer))

    response = api.post(f"{ORDERS}/{order_id}/cancel", headers=auth(buyer))

    assert response.status_code == 409
