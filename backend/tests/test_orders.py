from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.security import create_access_token, create_order_token
from app.models.activation import ActivationStatus, EventActivation
from app.models.event import Event, EventStatus
from app.models.hold import Hold
from app.models.order import Order, OrderStatus
from app.models.payment import Payment
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.services import codes
from app.services import hold as hold_service
from app.services import order as order_service
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_ticket_types import add_ticket_type

CHECKOUT = "/api/v1/events/{slug}/orders"
ORDER = "/api/v1/orders/{number}"


@pytest.fixture
def event(db: Session) -> Event:
    _, profile = add_organizer(db, "organizer@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    # Paid sales are activated, so the paid-path tests here exercise ordering
    # rather than §4.5. test_paid_checkout.py covers the unactivated case.
    activate_paid_sales(db, event)
    return event


def activate_paid_sales(db: Session, event: Event) -> EventActivation:
    activation = EventActivation(
        event_id=event.id, status=ActivationStatus.ACTIVE, activation_fee_minor=0
    )
    db.add(activation)
    db.commit()
    return activation


def payload(*lines: tuple[int, int], **overrides) -> dict:
    """`lines` are (ticket_type_id, how many attendees)."""
    items = [
        {
            "ticket_type_id": ticket_type_id,
            "attendees": [{"full_name": f"Guest {n}"} for n in range(count)],
        }
        for ticket_type_id, count in lines
    ]
    return {
        "contact_name": "Aru Sadykova",
        "contact_email": "aru@example.com",
        "items": items,
    } | overrides


def count(db: Session, model) -> int:
    return db.scalar(select(func.count()).select_from(model))


# --- free path end to end ---------------------------------------------------


def test_free_order_is_confirmed_with_one_ticket_per_attendee_and_no_payment(api, db, event):
    general = add_ticket_type(db, event.id, quantity_total=10)
    workshop = add_ticket_type(db, event.id, name="Workshop", quantity_total=5)

    response = api.post(
        CHECKOUT.format(slug=event.slug), json=payload((general.id, 2), (workshop.id, 1))
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "confirmed"
    assert body["total_minor"] == 0
    assert body["access_token"]
    assert len(body["tickets"]) == 3
    assert {t["status"] for t in body["tickets"]} == {"valid"}
    assert sorted(t["ticket_type_id"] for t in body["tickets"]) == sorted(
        [general.id, general.id, workshop.id]
    )
    assert count(db, Payment) == 0
    db.refresh(general)
    db.refresh(workshop)
    assert (general.quantity_sold, general.quantity_reserved) == (2, 0)
    assert (workshop.quantity_sold, workshop.quantity_reserved) == (1, 0)
    assert db.scalar(select(func.count()).where(Hold.released_at.is_(None))) == 0
    assert hold_service.find_reserved_drift(db) == []


def test_ticket_codes_are_unique_and_formatted(api, db, event):
    general = add_ticket_type(db, event.id)

    body = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 5))).json()

    ticket_codes = [t["public_code"] for t in body["tickets"]]
    assert len(set(ticket_codes)) == 5
    assert all(len(code) == 12 and code.startswith("BF-") for code in ticket_codes)
    assert body["order_number"].startswith("BF-")


# --- paid path stops at pending -----------------------------------------------


def test_paid_order_stays_pending_holds_inventory_and_issues_no_tickets(api, db, event):
    vip = add_ticket_type(db, event.id, price_minor=1_500_000, quantity_total=10)

    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((vip.id, 2)))

    body = response.json()
    assert response.status_code == 201
    assert body["status"] == "pending"
    assert body["subtotal_minor"] == body["total_minor"] == 3_000_000
    assert body["tickets"] == []
    assert body["expires_at"] is not None
    db.refresh(vip)
    assert (vip.quantity_sold, vip.quantity_reserved) == (0, 2)


def test_price_change_after_purchase_does_not_alter_the_order(api, db, event):
    vip = add_ticket_type(db, event.id, price_minor=1_000)
    body = api.post(CHECKOUT.format(slug=event.slug), json=payload((vip.id, 1))).json()

    vip.price_minor = 9_999
    db.commit()

    again = api.get(
        ORDER.format(number=body["order_number"]), params={"token": body["access_token"]}
    )
    assert again.json()["total_minor"] == 1_000
    assert again.json()["items"][0]["unit_price_minor"] == 1_000


# --- refusals leave nothing behind --------------------------------------------


def test_sold_out_line_fails_the_whole_order_and_holds_nothing(api, db, event):
    plenty = add_ticket_type(db, event.id, quantity_total=10)
    scarce = add_ticket_type(db, event.id, name="Scarce", quantity_total=1)

    response = api.post(
        CHECKOUT.format(slug=event.slug), json=payload((plenty.id, 2), (scarce.id, 2))
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Sold out"
    db.refresh(plenty)
    assert plenty.quantity_reserved == 0
    assert count(db, Order) == 0
    assert count(db, Hold) == 0


def test_event_capacity_caps_the_sum_across_ticket_types(api, db, event):
    event.capacity = 3
    db.commit()
    first = add_ticket_type(db, event.id, quantity_total=10)
    second = add_ticket_type(db, event.id, name="Second", quantity_total=10)
    assert (
        api.post(CHECKOUT.format(slug=event.slug), json=payload((first.id, 2))).status_code == 201
    )

    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((second.id, 2)))

    assert response.status_code == 409
    assert (
        api.post(CHECKOUT.format(slug=event.slug), json=payload((second.id, 1))).status_code == 201
    )


def test_ticket_type_of_another_event_is_rejected(api, db, event):
    _, profile = add_organizer(db, "other@example.com")
    other = add_event(db, profile, slug="other", status=EventStatus.PUBLISHED)
    foreign = add_ticket_type(db, other.id)

    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((foreign.id, 1)))

    assert response.status_code == 422
    db.refresh(foreign)
    assert foreign.quantity_reserved == 0


def test_draft_event_has_no_checkout(api, db, event):
    event.status = EventStatus.DRAFT
    db.commit()
    general = add_ticket_type(db, event.id)

    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 1)))

    assert response.status_code == 404


def test_cancelled_event_is_not_on_sale(api, db, event):
    event.status = EventStatus.CANCELLED
    db.commit()
    general = add_ticket_type(db, event.id)

    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 1)))

    assert response.status_code == 409
    assert "not published" in response.json()["detail"]


def test_over_max_per_order_is_422(api, db, event):
    general = add_ticket_type(db, event.id, max_per_order=2)

    response = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 3)))

    assert response.status_code == 422


def test_same_ticket_type_twice_is_rejected_by_the_schema(api, db, event):
    general = add_ticket_type(db, event.id)

    response = api.post(
        CHECKOUT.format(slug=event.slug), json=payload((general.id, 1), (general.id, 1))
    )

    assert response.status_code == 422


def test_client_cannot_set_prices_or_status(api, db, event):
    vip = add_ticket_type(db, event.id, price_minor=5_000)

    body = api.post(
        CHECKOUT.format(slug=event.slug),
        json=payload((vip.id, 1), total_minor=0, status="confirmed"),
    ).json()

    assert body["total_minor"] == 5_000
    assert body["status"] == "pending"


# --- who can read an order ----------------------------------------------------


def test_guest_reads_their_order_with_the_signed_link(api, db, event):
    general = add_ticket_type(db, event.id)
    body = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 1))).json()

    response = api.get(
        ORDER.format(number=body["order_number"]), params={"token": body["access_token"]}
    )

    assert response.status_code == 200
    assert response.json()["tickets"][0]["attendee_name"] == "Guest 0"


def test_a_guest_cannot_read_another_guests_order(api, db, event):
    general = add_ticket_type(db, event.id)
    mine = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 1))).json()
    theirs = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 1))).json()

    with_my_token = api.get(
        ORDER.format(number=theirs["order_number"]), params={"token": mine["access_token"]}
    )
    without_token = api.get(ORDER.format(number=theirs["order_number"]))

    assert with_my_token.status_code == 404
    assert without_token.status_code == 404


def test_an_access_token_is_not_an_order_link(api, db, event):
    general = add_ticket_type(db, event.id)
    body = api.post(CHECKOUT.format(slug=event.slug), json=payload((general.id, 1))).json()
    order = db.scalar(select(Order))
    # A login token whose subject happens to equal the order id.
    forged = create_access_token(order.id)

    response = api.get(ORDER.format(number=body["order_number"]), params={"token": forged})

    assert response.status_code == 404


def test_an_order_link_is_not_an_access_token(api, db, event):
    user = add_user(db, "buyer@example.com")
    link = create_order_token(user.id)

    response = api.get("/api/v1/users/me/orders", headers={"Authorization": f"Bearer {link}"})

    assert response.status_code == 401


def test_signed_in_buyer_owns_the_order_and_lists_it(api, db, event):
    buyer = add_user(db, "buyer@example.com")
    stranger = add_user(db, "stranger@example.com")
    general = add_ticket_type(db, event.id)
    body = api.post(
        CHECKOUT.format(slug=event.slug), json=payload((general.id, 1)), headers=auth(buyer)
    ).json()
    number = body["order_number"]

    assert api.get(ORDER.format(number=number), headers=auth(buyer)).status_code == 200
    assert api.get(ORDER.format(number=number), headers=auth(stranger)).status_code == 404
    mine = api.get("/api/v1/users/me/orders", headers=auth(buyer)).json()
    assert [o["order_number"] for o in mine] == [number]
    assert api.get("/api/v1/users/me/orders", headers=auth(stranger)).json() == []


def test_invalid_bearer_on_checkout_is_401_not_a_silent_guest(api, db, event):
    general = add_ticket_type(db, event.id)

    response = api.post(
        CHECKOUT.format(slug=event.slug),
        json=payload((general.id, 1)),
        headers={"Authorization": "Bearer not-a-token"},
    )

    assert response.status_code == 401
    assert count(db, Order) == 0


# --- confirmation edge cases (service level) -----------------------------------


def _pending_order(api, db: Session, event: Event, ticket_type: TicketType) -> Order:
    body = api.post(CHECKOUT.format(slug=event.slug), json=payload((ticket_type.id, 2))).json()
    return order_service.get_order_by_number(db, body["order_number"])


def test_confirming_twice_issues_one_set_of_tickets(api, db, event):
    vip = add_ticket_type(db, event.id, price_minor=1_000, quantity_total=10)
    order = _pending_order(api, db, event, vip)

    order_service.confirm_order(db, order)
    db.commit()
    with pytest.raises(order_service.OrderNotPending):
        order_service.confirm_order(db, order)
    db.rollback()

    assert count(db, Ticket) == 2
    db.refresh(vip)
    assert (vip.quantity_sold, vip.quantity_reserved) == (2, 0)


def test_expired_hold_cannot_be_confirmed_and_issues_no_tickets(api, db, event):
    vip = add_ticket_type(db, event.id, price_minor=1_000, quantity_total=10)
    order = _pending_order(api, db, event, vip)
    later = datetime.now(UTC) + hold_service.HOLD_TTL + timedelta(seconds=1)

    with pytest.raises(order_service.HoldLapsed):
        order_service.confirm_order(db, order, now=later)
    db.rollback()

    assert count(db, Ticket) == 0
    db.refresh(order)
    assert order.status == OrderStatus.PENDING


def test_sweeper_expires_the_pending_order_and_returns_its_units(api, db, event):
    vip = add_ticket_type(db, event.id, price_minor=1_000, quantity_total=10)
    order = _pending_order(api, db, event, vip)
    later = datetime.now(UTC) + hold_service.HOLD_TTL + timedelta(seconds=1)

    hold_service.release_expired_holds(db, now=later)

    db.refresh(order)
    db.refresh(vip)
    assert order.status == OrderStatus.EXPIRED
    assert vip.quantity_reserved == 0
    assert count(db, Ticket) == 0
    with pytest.raises(order_service.OrderNotPending):
        order_service.confirm_order(db, order, now=later)
    db.rollback()


# --- codes --------------------------------------------------------------------


def test_public_code_retries_past_a_collision(db, monkeypatch):
    draws = iter(["AAAA", "AAAA", "BBBB", "CCCC"])
    monkeypatch.setattr(codes, "_random", lambda length: next(draws))
    drawn: set[str] = set()

    first = codes.new_public_code(db, drawn)
    second = codes.new_public_code(db, drawn)

    assert first == "BF-AAAA-AAAA"
    assert second == "BF-BBBB-CCCC"


def test_code_generator_gives_up_instead_of_looping_forever(db, monkeypatch):
    monkeypatch.setattr(codes, "_random", lambda length: "A" * length)
    drawn = {"BF-AAAA-AAAA"}

    with pytest.raises(codes.CodeSpaceExhausted):
        codes.new_public_code(db, drawn)


def test_codes_avoid_ambiguous_characters():
    assert not set("ILOU") & set(codes.ALPHABET)
