"""Real threads, real connections, real Postgres.

The rest of the suite runs on SQLite, which serializes every write and so can
never show a race. These tests use DATABASE_URL (the docker-compose database
locally, the service container in CI), so it must be migrated to head. They
create their own rows under a unique suffix and delete them afterwards.
"""

import threading
import uuid
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, delete, select, update
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.models.attendee import Attendee
from app.models.event import Event, EventStatus
from app.models.hold import Hold
from app.models.order import Order, OrderItem
from app.models.organizer import OrganizerProfile
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import hold as hold_service
from app.services import order as order_service


@pytest.fixture(scope="module")
def pg() -> Iterator[sessionmaker]:
    if not settings.DATABASE_URL.startswith("postgresql"):
        pytest.skip("needs Postgres")
    engine = create_engine(settings.DATABASE_URL, pool_size=25, max_overflow=0)
    try:
        engine.connect().close()
    except OperationalError:
        pytest.skip("Postgres is not reachable (docker compose up -d db)")
    yield sessionmaker(bind=engine, autoflush=False)
    engine.dispose()


@pytest.fixture
def stock(pg: sessionmaker) -> Iterator[tuple[int, int]]:
    """A published event with one ticket type. Yields (event_id, ticket_type_id)."""
    suffix = uuid.uuid4().hex[:12]
    with pg() as db:
        user = User(
            email=f"race-{suffix}@example.com",
            hashed_password="$argon2id$fake",
            first_name="Race",
            last_name="Test",
        )
        db.add(user)
        db.flush()
        profile = OrganizerProfile(user_id=user.id, display_name="Race", contact_email=user.email)
        db.add(profile)
        db.flush()
        starts = datetime.now(UTC) + timedelta(days=30)
        event = Event(
            slug=f"race-{suffix}",
            title="Race",
            venue_name="Nowhere",
            venue_address="Nowhere 1",
            starts_at=starts,
            ends_at=starts + timedelta(hours=2),
            timezone="Asia/Almaty",
            organizer_profile_id=profile.id,
            status=EventStatus.PUBLISHED,
        )
        db.add(event)
        db.flush()
        ticket_type = TicketType(event_id=event.id, name="General", quantity_total=100)
        db.add(ticket_type)
        db.commit()
        ids = (user.id, profile.id, event.id, ticket_type.id)

    yield ids[2], ids[3]

    user_id, profile_id, event_id, _ = ids
    with pg() as db:
        # Everything hanging off the event, children first.
        types = select(TicketType.id).where(TicketType.event_id == event_id)
        orders = select(Order.id).where(Order.event_id == event_id)
        db.execute(delete(Ticket).where(Ticket.event_id == event_id))
        db.execute(delete(Attendee).where(Attendee.order_id.in_(orders)))
        db.execute(delete(Hold).where(Hold.ticket_type_id.in_(types)))
        db.execute(delete(OrderItem).where(OrderItem.order_id.in_(orders)))
        db.execute(delete(Order).where(Order.event_id == event_id))
        db.execute(delete(TicketType).where(TicketType.event_id == event_id))
        db.execute(delete(Event).where(Event.id == event_id))
        db.execute(delete(OrganizerProfile).where(OrganizerProfile.id == profile_id))
        db.execute(delete(User).where(User.id == user_id))
        db.commit()


def race(pg: sessionmaker, event_id: int, ticket_type_id: int, buyers: int, each: int) -> int:
    """Release `buyers` threads at once, each reserving `each`. Returns how many won."""
    start = threading.Barrier(buyers)

    def buy() -> bool:
        with pg() as db:
            event = db.get(Event, event_id)
            ticket_type = db.get(TicketType, ticket_type_id)
            start.wait()
            try:
                hold_service.reserve(db, event, ticket_type, each)
                return True
            except hold_service.SoldOut:
                return False

    with ThreadPoolExecutor(max_workers=buyers) as pool:
        return sum(pool.map(lambda _: buy(), range(buyers)))


def set_sold(pg: sessionmaker, ticket_type_id: int, sold: int) -> None:
    with pg() as db:
        db.get(TicketType, ticket_type_id).quantity_sold = sold
        db.commit()


def counters(pg: sessionmaker, ticket_type_id: int) -> tuple[int, int]:
    with pg() as db:
        ticket_type = db.get(TicketType, ticket_type_id)
        return ticket_type.quantity_sold, ticket_type.quantity_reserved


def hold_units(pg: sessionmaker, ticket_type_id: int) -> int:
    with pg() as db:
        return sum(db.scalars(select(Hold.quantity).where(Hold.ticket_type_id == ticket_type_id)))


def test_concurrent_buyers_for_the_last_ticket_exactly_one_wins(pg, stock):
    event_id, ticket_type_id = stock
    set_sold(pg, ticket_type_id, 99)

    winners = race(pg, event_id, ticket_type_id, buyers=20, each=1)

    assert winners == 1
    assert counters(pg, ticket_type_id) == (99, 1)
    assert hold_units(pg, ticket_type_id) == 1


def test_twenty_buyers_for_the_last_five_sells_exactly_five(pg, stock):
    # The scenario measured in concurrency.md: naive code granted all 20.
    event_id, ticket_type_id = stock
    set_sold(pg, ticket_type_id, 95)

    winners = race(pg, event_id, ticket_type_id, buyers=20, each=1)

    assert winners == 5
    assert counters(pg, ticket_type_id) == (95, 5)
    assert hold_units(pg, ticket_type_id) == 5


def test_no_drift_after_a_checkout_storm_and_a_sweep(pg, stock):
    event_id, ticket_type_id = stock
    race(pg, event_id, ticket_type_id, buyers=20, each=3)

    with pg() as db:
        # Expire only our holds and sweep at the real time, so a shared dev
        # database keeps anyone else's live holds.
        db.execute(
            update(Hold)
            .where(Hold.ticket_type_id == ticket_type_id)
            .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        db.commit()
        hold_service.release_expired_holds(db)
        drift = [row for row in hold_service.find_reserved_drift(db) if row[0] == ticket_type_id]

    assert drift == []
    assert counters(pg, ticket_type_id) == (0, 0)


def test_checkout_race_respects_event_capacity_without_deadlocking(pg, stock):
    # Every buyer wants one General and one VIP, half of them listing the
    # lines in the opposite order. Without the sorted claim order in
    # checkout() that is the textbook deadlock; capacity 5 admits exactly 2.
    event_id, general_id = stock
    with pg() as db:
        db.get(Event, event_id).capacity = 5
        vip = TicketType(event_id=event_id, name="VIP", quantity_total=100)
        db.add(vip)
        db.commit()
        vip_id = vip.id

    buyers = 20
    start = threading.Barrier(buyers)

    def buy(n: int) -> bool:
        lines = [general_id, vip_id] if n % 2 else [vip_id, general_id]
        data = CheckoutRequest(
            contact_name="Race",
            contact_email=f"buyer{n}@example.com",
            items=[{"ticket_type_id": i, "attendees": [{"full_name": "A"}]} for i in lines],
        )
        with pg() as db:
            event = db.get(Event, event_id)
            start.wait()
            try:
                order_service.checkout(db, event, data, None)
                return True
            except hold_service.SoldOut:
                return False

    with ThreadPoolExecutor(max_workers=buyers) as pool:
        winners = sum(pool.map(buy, range(buyers)))

    assert winners == 2
    assert counters(pg, general_id) == (2, 0)
    assert counters(pg, vip_id) == (2, 0)
    with pg() as db:
        assert len(db.scalars(select(Ticket).where(Ticket.event_id == event_id)).all()) == 4
