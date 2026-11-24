"""Assigned seating & concurrency tests (§4.3.1, §7, §8 Bonus).

Includes both full API lifecycle tests (on SQLite) and real multi-threaded
PostgreSQL race tests verifying that two concurrent buyers picking the same seat
produce exactly one winner and zero double-holds or double-sales.
"""

import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.models.event import Event, EventStatus, SeatingMode
from app.models.hold import Hold
from app.models.order import Order, OrderStatus
from app.models.organizer import OrganizerProfile
from app.models.seat import EventSeat, EventSeatStatus
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import hold as hold_service
from app.services import order as order_service
from app.services import seating as seating_service
from tests.test_events import add_event, add_organizer, auth
from tests.test_holds_concurrency import pg, purge_event  # noqa: F401 - pg fixture
from tests.test_orders import activate_paid_sales
from tests.test_ticket_types import add_ticket_type


def _setup_assigned_event(api, db: Session):
    owner, profile = add_organizer(db, "seating-org@example.com")
    event = add_event(
        db,
        profile,
        slug="palace-gala",
        status=EventStatus.PUBLISHED,
        seating_mode=SeatingMode.ASSIGNED,
    )
    activate_paid_sales(db, event)
    vip = add_ticket_type(db, event.id, name="VIP", price_minor=2_000_000, quantity_total=10)
    prem = add_ticket_type(db, event.id, name="Premium", price_minor=1_000_000, quantity_total=10)
    std = add_ticket_type(db, event.id, name="Standard", price_minor=0, quantity_total=10)

    venues = api.get("/api/v1/venues").json()
    assert len(venues) >= 1
    venue = venues[0]
    assert venue["total_seats"] == 66 and venue["accessible_seats"] == 4

    configured = api.put(
        f"/api/v1/organizer/events/{event.id}/seating",
        headers=auth(owner),
        json={
            "venue_id": venue["id"],
            "category_ticket_type_map": {
                "VIP": vip.id,
                "Premium": prem.id,
                "Standard": std.id,
            },
            "unavailable_seat_ids": [],
        },
    )
    assert configured.status_code == 200, configured.text
    return owner, event, vip, prem, std, configured.json()


def test_assigned_seating_full_checkout_pdf_and_release_lifecycle(api, db: Session):
    owner, event, vip, prem, std, seat_map = _setup_assigned_event(api, db)
    assert seat_map["counts"]["available"] == 66

    # Mark one seat unavailable and confirm sellable count drops to 65.
    balcony_seat = seat_map["sections"][2]["rows"][0]["seats"][0]
    toggled = api.patch(
        f"/api/v1/organizer/events/{event.id}/seats/{balcony_seat['event_seat_id']}",
        headers=auth(owner),
        json={"status": "unavailable"},
    )
    assert toggled.status_code == 200
    assert toggled.json()["counts"]["unavailable"] == 1
    assert toggled.json()["counts"]["sellable"] == 65

    # Public seat map exposes prices, statuses, and accessible seat indicators.
    public_map = api.get(f"/api/v1/events/{event.slug}/seats").json()
    vip_seat_1 = public_map["sections"][0]["rows"][0]["seats"][0]
    assert vip_seat_1["is_accessible"] is True
    assert "accessible seat" in vip_seat_1["accessible_label"]
    assert vip_seat_1["price_minor"] == 2_000_000

    # Checkout without event_seat_id on an assigned-seating event is 422.
    missing_seat = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json={
            "contact_name": "Aru",
            "contact_email": "aru@example.com",
            "items": [{"ticket_type_id": vip.id, "attendees": [{"full_name": "Aru"}]}],
        },
    )
    assert missing_seat.status_code == 422

    # Paid seat checkout holds the seat, prevents second buyer, confirms to sold, prints PDF.
    order_res = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json={
            "contact_name": "Aru",
            "contact_email": "aru@example.com",
            "items": [
                {
                    "ticket_type_id": vip.id,
                    "attendees": [
                        {"full_name": "Aru Sadykova", "event_seat_id": vip_seat_1["event_seat_id"]}
                    ],
                }
            ],
        },
    )
    assert order_res.status_code == 201, order_res.text
    order = order_res.json()
    assert order["status"] == "pending"
    assert order["items"][0]["section_name"] == "VIP Parterre"
    assert order["items"][0]["row_label"] == "A"
    assert order["items"][0]["seat_number"] == "1"

    # Seat map shows the seat as held with hold_expires_at.
    held_map = api.get(f"/api/v1/events/{event.slug}/seats").json()
    held_seat = held_map["sections"][0]["rows"][0]["seats"][0]
    assert held_seat["status"] == "held" and held_seat["hold_expires_at"] is not None

    # Second buyer trying to claim the same held seat gets 409 Conflict.
    conflict = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json={
            "contact_name": "Other",
            "contact_email": "other@example.com",
            "items": [
                {
                    "ticket_type_id": vip.id,
                    "attendees": [
                        {"full_name": "Other", "event_seat_id": vip_seat_1["event_seat_id"]}
                    ],
                }
            ],
        },
    )
    assert conflict.status_code == 409

    # Pay and confirm -> seat transitions to sold and appears on ticket + PDF.
    paid = api.post(
        f"/api/v1/orders/{order['order_number']}/pay",
        params={"token": order["access_token"]},
        json={"outcome": "succeed"},
    )
    assert paid.status_code == 200, paid.text
    ticket = paid.json()["tickets"][0]
    assert ticket["section_name"] == "VIP Parterre"
    assert ticket["row_label"] == "A"
    assert ticket["seat_number"] == "1"
    assert "VIP Parterre" in ticket["seat_label"]

    pdf = api.get(
        f"/api/v1/orders/{order['order_number']}/tickets.pdf",
        params={"token": order["access_token"]},
    )
    assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

    # Refunding the order releases the sold seat back to available.
    refunded = api.post(
        f"/api/v1/organizer/events/{event.id}/orders/{order['order_number']}/refund",
        headers=auth(owner),
        json={"reason": "Buyer cancelled"},
    )
    assert refunded.status_code == 200
    after_refund = api.get(f"/api/v1/events/{event.slug}/seats").json()
    assert after_refund["sections"][0]["rows"][0]["seats"][0]["status"] == "available"

    # Expired seat hold returns seat to available via sweeper.
    std_seat = after_refund["sections"][1]["rows"][0]["seats"][0]
    hold_order = api.post(
        f"/api/v1/events/{event.slug}/orders",
        json={
            "contact_name": "Ghost",
            "contact_email": "ghost@example.com",
            "items": [
                {
                    "ticket_type_id": prem.id,
                    "attendees": [
                        {"full_name": "Ghost", "event_seat_id": std_seat["event_seat_id"]}
                    ],
                }
            ],
        },
    ).json()
    assert hold_order["status"] == "pending"
    hold_service.release_expired_holds(
        db, now=datetime.now(UTC) + hold_service.HOLD_TTL + timedelta(seconds=5)
    )
    after_sweep = api.get(f"/api/v1/events/{event.slug}/seats").json()
    assert after_sweep["sections"][1]["rows"][0]["seats"][0]["status"] == "available"


def test_unique_event_seat_constraint_refuses_duplicate_row(db: Session):
    _, profile = add_organizer(db, "dup-seat@example.com")
    event = add_event(db, profile, status=EventStatus.PUBLISHED, seating_mode=SeatingMode.ASSIGNED)
    tt = add_ticket_type(db, event.id, price_minor=0, quantity_total=10)
    venue = seating_service.ensure_predefined_venues(db)
    db.commit()
    seat_id = db.scalar(select(EventSeat.seat_id))  # none yet
    assert seat_id is None
    from app.models.venue import Seat

    physical_seat_id = db.scalar(select(Seat.id).limit(1))
    db.add(EventSeat(event_id=event.id, seat_id=physical_seat_id, ticket_type_id=tt.id))
    db.commit()

    db.add(EventSeat(event_id=event.id, seat_id=physical_seat_id, ticket_type_id=tt.id))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    assert venue.id > 0


def test_concurrent_seat_checkout_on_postgres_admits_exactly_one(pg: sessionmaker):  # noqa: F811
    """Real multi-threaded Postgres race: 15 buyers pick the exact same seat."""
    suffix = uuid.uuid4().hex[:12]
    with pg() as db:
        owner = User(
            email=f"seat-race-{suffix}@example.com",
            hashed_password="$argon2id$fake",
            first_name="Seat",
            last_name="Race",
            is_email_verified=True,
        )
        db.add(owner)
        db.flush()
        profile = OrganizerProfile(
            user_id=owner.id, display_name="Seat Race", contact_email=owner.email
        )
        db.add(profile)
        db.flush()
        starts = datetime.now(UTC) + timedelta(days=30)
        event = Event(
            slug=f"seat-race-{suffix}",
            title="Seat Race",
            venue_name="Palace",
            venue_address="Dostyk 56",
            starts_at=starts,
            ends_at=starts + timedelta(hours=2),
            timezone="Asia/Almaty",
            organizer_profile_id=profile.id,
            status=EventStatus.PUBLISHED,
            seating_mode=SeatingMode.ASSIGNED,
        )
        db.add(event)
        db.flush()
        tt = TicketType(event_id=event.id, name="Standard", price_minor=0, quantity_total=66)
        db.add(tt)
        db.flush()
        venue = seating_service.ensure_predefined_venues(db)
        db.commit()
        seat_map = seating_service.configure_event_seating(
            db,
            event,
            venue_id=venue.id,
            category_ticket_type_map={"VIP": tt.id, "Premium": tt.id, "Standard": tt.id},
            unavailable_seat_ids=[],
            actor=owner,
        )
        target_seat_id = seat_map["sections"][0]["rows"][0]["seats"][0]["event_seat_id"]
        ids = (owner.id, profile.id, event.id, tt.id, target_seat_id)

    owner_id, profile_id, event_id, tt_id, target_seat_id = ids
    try:
        buyers = 15
        barrier = threading.Barrier(buyers)

        def pick(n: int) -> bool:
            data = CheckoutRequest(
                contact_name=f"Buyer {n}",
                contact_email=f"seat-buyer-{n}-{suffix}@example.com",
                items=[
                    {
                        "ticket_type_id": tt_id,
                        "attendees": [{"full_name": f"Buyer {n}", "event_seat_id": target_seat_id}],
                    }
                ],
            )
            with pg() as db:
                ev = db.get(Event, event_id)
                barrier.wait()
                try:
                    order_service.checkout(db, ev, data, None)
                    return True
                except (seating_service.SeatUnavailable, hold_service.SoldOut, IntegrityError):
                    return False

        with ThreadPoolExecutor(max_workers=buyers) as pool:
            winners = sum(pool.map(pick, range(buyers)))

        assert winners == 1
        with pg() as db:
            seat = db.get(EventSeat, target_seat_id)
            assert seat.status == EventSeatStatus.SOLD
            live_tickets = db.scalar(
                select(func.count(Ticket.id)).where(Ticket.event_seat_id == target_seat_id)
            )
            assert live_tickets == 1
            confirmed_orders = db.scalar(
                select(func.count(Order.id)).where(
                    Order.event_id == event_id, Order.status == OrderStatus.CONFIRMED
                )
            )
            assert confirmed_orders == 1
            active_holds = db.scalar(
                select(func.count(Hold.id)).where(
                    Hold.event_seat_id == target_seat_id, Hold.released_at.is_(None)
                )
            )
            assert active_holds == 0
    finally:
        with pg() as db:
            purge_event(db, event_id)
            db.execute(delete(OrganizerProfile).where(OrganizerProfile.id == profile_id))
            db.execute(delete(User).where(User.id == owner_id))
            db.commit()
