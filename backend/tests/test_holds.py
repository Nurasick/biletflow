from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.hold import Hold
from app.models.ticket_type import TicketType
from app.services import hold as hold_service
from tests.test_events import add_event, add_organizer
from tests.test_ticket_types import add_ticket_type

NOW = datetime(2026, 10, 14, 12, 0, tzinfo=UTC)


@pytest.fixture
def event(db: Session) -> Event:
    _, profile = add_organizer(db, "organizer@example.com")
    return add_event(db, profile, status=EventStatus.PUBLISHED)


def reserve(db: Session, event: Event, ticket_type: TicketType, quantity: int, now=NOW) -> Hold:
    return hold_service.reserve(db, event, ticket_type, quantity, now=now)


# --- reserve ----------------------------------------------------------------


def test_reserve_moves_units_into_reserved_and_creates_an_unattached_hold(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=10)

    hold = reserve(db, event, ticket_type, 3)

    assert ticket_type.quantity_reserved == 3
    assert ticket_type.quantity_sold == 0
    assert hold.quantity == 3
    assert hold.order_id is None
    assert hold.released_at is None
    assert hold.expires_at.replace(tzinfo=UTC) == NOW + hold_service.HOLD_TTL


def test_reserve_can_take_exactly_the_last_units(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=5, quantity_sold=3)

    reserve(db, event, ticket_type, 2)

    assert ticket_type.quantity_reserved == 2


def test_reserve_raises_sold_out_and_leaves_no_trace(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=5, quantity_sold=3)
    reserve(db, event, ticket_type, 1)

    with pytest.raises(hold_service.SoldOut):
        reserve(db, event, ticket_type, 2)

    db.refresh(ticket_type)
    assert ticket_type.quantity_reserved == 1
    assert db.scalar(select(text("count(*)")).select_from(Hold)) == 1


@pytest.mark.parametrize("quantity", [0, -1, 5])
def test_reserve_rejects_quantity_outside_1_to_max_per_order(db, event, quantity):
    ticket_type = add_ticket_type(db, event.id, max_per_order=4)

    with pytest.raises(hold_service.QuantityNotAllowed):
        reserve(db, event, ticket_type, quantity)


def test_reserve_refuses_unpublished_event(db, event):
    event.status = EventStatus.DRAFT
    db.commit()
    ticket_type = add_ticket_type(db, event.id)

    with pytest.raises(hold_service.NotOnSale, match="not published"):
        reserve(db, event, ticket_type, 1)


def test_reserve_refuses_hidden_ticket_type(db, event):
    ticket_type = add_ticket_type(db, event.id, is_hidden=True)

    with pytest.raises(hold_service.NotOnSale, match="hidden"):
        reserve(db, event, ticket_type, 1)


def test_reserve_refuses_another_events_ticket_type(db, event):
    _, profile = add_organizer(db, "other@example.com")
    other = add_event(db, profile, slug="other", status=EventStatus.PUBLISHED)
    ticket_type = add_ticket_type(db, other.id)

    with pytest.raises(hold_service.NotOnSale, match="does not belong"):
        reserve(db, event, ticket_type, 1)


@pytest.mark.parametrize(
    ("fields", "reason"),
    [
        (dict(sales_start_at=NOW + timedelta(minutes=1)), "not started"),
        (dict(sales_end_at=NOW), "ended"),
    ],
)
def test_reserve_respects_ticket_type_sales_window(db, event, fields, reason):
    ticket_type = add_ticket_type(db, event.id, **fields)

    with pytest.raises(hold_service.NotOnSale, match=reason):
        reserve(db, event, ticket_type, 1)


def test_reserve_respects_event_registration_window(db, event):
    event.registration_closes_at = NOW - timedelta(seconds=1)
    db.commit()
    ticket_type = add_ticket_type(db, event.id)

    with pytest.raises(hold_service.NotOnSale, match="ended"):
        reserve(db, event, ticket_type, 1)


# --- sweeper ----------------------------------------------------------------


def test_sweeper_releases_expired_holds_and_returns_their_units(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=10)
    hold = reserve(db, event, ticket_type, 4)

    released = hold_service.release_expired_holds(db, now=NOW + hold_service.HOLD_TTL)

    assert released == 1
    db.refresh(ticket_type)
    db.refresh(hold)
    assert ticket_type.quantity_reserved == 0
    assert hold.released_at is not None


def test_sweeper_leaves_live_holds_alone(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=10)
    reserve(db, event, ticket_type, 4)

    released = hold_service.release_expired_holds(db, now=NOW + timedelta(minutes=9))

    assert released == 0
    db.refresh(ticket_type)
    assert ticket_type.quantity_reserved == 4


def test_sweeper_never_releases_a_hold_twice(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=10)
    reserve(db, event, ticket_type, 4)
    reserve(db, event, ticket_type, 1)
    later = NOW + timedelta(hours=1)

    assert hold_service.release_expired_holds(db, now=later) == 2
    assert hold_service.release_expired_holds(db, now=later) == 0

    db.refresh(ticket_type)
    assert ticket_type.quantity_reserved == 0


def test_released_units_can_be_reserved_again(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=2)
    reserve(db, event, ticket_type, 2)
    later = NOW + timedelta(hours=1)
    hold_service.release_expired_holds(db, now=later)

    reserve(db, event, ticket_type, 2, now=later)

    assert ticket_type.quantity_reserved == 2


# --- drift ------------------------------------------------------------------


def test_no_drift_after_reserving_and_sweeping(db, event):
    first = add_ticket_type(db, event.id, quantity_total=10)
    second = add_ticket_type(db, event.id, name="VIP", quantity_total=10)
    reserve(db, event, first, 3)
    reserve(db, event, second, 2)
    reserve(db, event, first, 1, now=NOW + timedelta(minutes=30))
    hold_service.release_expired_holds(db, now=NOW + timedelta(minutes=15))

    assert hold_service.find_reserved_drift(db) == []


def test_drift_query_reports_a_counter_moved_by_hand(db, event):
    ticket_type = add_ticket_type(db, event.id, quantity_total=10)
    reserve(db, event, ticket_type, 3)
    db.execute(text("UPDATE ticket_types SET quantity_reserved = 5"))
    db.commit()

    assert hold_service.find_reserved_drift(db) == [(ticket_type.id, 5, 3)]
