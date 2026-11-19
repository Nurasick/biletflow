"""T03: the paid checkout path under concurrency, on real Postgres.

test_holds_concurrency.py proves the hold layer on its own (reserve() and a
free checkout). These drive the whole paid path the way the API does:

    checkout -> pay_order -> confirm_order (redeem promo, release holds, issue tickets)

from many threads at once, and check the four guarantees SRS §§4.3, 4.5-4.6,
4.9, 4.14 and §7 depend on:

1. the final ticket has exactly one winner, even through payment;
2. the final promo redemption has exactly one winner;
3. holds come back on a declined payment and on expiry, with no drift;
4. no ticket exists before its payment is confirmed, and a refunded ticket
   is turned away at every door.

Like the other *_concurrency tests these need DATABASE_URL pointing at a
migrated Postgres (the compose `db` locally, the service container in CI) and
skip without it. Each test creates its own rows under a unique suffix and
deletes them afterwards, so a shared dev database is left as it was.
"""

import threading
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session, sessionmaker

from app.models.activation import ActivationStatus, EventActivation
from app.models.campaign import Campaign, DiscountType, PromoRedemption
from app.models.check_in import CheckInRecord
from app.models.event import Event, EventStatus
from app.models.hold import Hold
from app.models.notification import Notification
from app.models.order import Order, OrderStatus
from app.models.organizer import OrganizerProfile
from app.models.payment import Payment, PaymentStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import check_in, order_lifecycle
from app.services import hold as hold_service
from app.services import order as order_service
from app.services import payment as payment_service
from app.services.campaign import PromoRejected
from tests.test_holds_concurrency import counters, pg, purge_event  # noqa: F401 - pg is a fixture

BUYERS = 12
PRICE_MINOR = 500_000  # 5 000 KZT

PaidStock = Callable[..., dict]


# --- fixtures ----------------------------------------------------------------


@pytest.fixture
def paid_stock(pg: sessionmaker) -> Iterator[PaidStock]:  # noqa: F811 - the imported fixture
    """A factory for a published event with *active paid sales* and one paid
    ticket type. Returns a dict of ids; everything it made is deleted after
    the test. A factory rather than a plain fixture so each test picks the
    stock it needs (one last ticket, or plenty)."""
    made: list[dict] = []

    def make(quantity_total: int = 10, price_minor: int = PRICE_MINOR) -> dict:
        suffix = uuid.uuid4().hex[:12]
        with pg() as db:
            organizer = User(
                email=f"t03-org-{suffix}@example.com",
                hashed_password="$argon2id$fake",
                first_name="Org",
                last_name="Race",
            )
            admin = User(
                email=f"t03-admin-{suffix}@example.com",
                hashed_password="$argon2id$fake",
                first_name="Admin",
                last_name="Race",
                is_platform_admin=True,
            )
            db.add_all([organizer, admin])
            db.flush()
            profile = OrganizerProfile(
                user_id=organizer.id, display_name="Race", contact_email=organizer.email
            )
            db.add(profile)
            db.flush()
            starts = datetime.now(UTC) + timedelta(days=30)
            event = Event(
                slug=f"t03-{suffix}",
                title="Checkout race",
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
            db.add(
                EventActivation(
                    event_id=event.id, status=ActivationStatus.ACTIVE, activation_fee_minor=0
                )
            )
            ticket_type = TicketType(
                event_id=event.id,
                name="Standard",
                price_minor=price_minor,
                quantity_total=quantity_total,
            )
            db.add(ticket_type)
            db.commit()
            ids = {
                "suffix": suffix,
                "organizer_id": organizer.id,
                "admin_id": admin.id,
                "profile_id": profile.id,
                "event_id": event.id,
                "ticket_type_id": ticket_type.id,
            }
        made.append(ids)
        return ids

    yield make

    for ids in made:
        _delete_stock(pg, ids)


def _delete_stock(sessions: sessionmaker, ids: dict) -> None:
    """Children first. Orders point at campaigns and redemptions point at
    orders, so the campaign rows have to go between the two."""
    event_id, users = ids["event_id"], [ids["organizer_id"], ids["admin_id"]]
    campaigns = select(Campaign.id).where(Campaign.event_id == event_id)
    with sessions() as db:
        db.execute(delete(PromoRedemption).where(PromoRedemption.campaign_id.in_(campaigns)))
        db.execute(update(Order).where(Order.event_id == event_id).values(campaign_id=None))
        db.execute(delete(Campaign).where(Campaign.event_id == event_id))
        purge_event(db, event_id)
        # Confirmation, refund and suspension all queue notifications.
        db.execute(
            delete(Notification).where(
                Notification.user_id.in_(users) | Notification.email.contains(ids["suffix"])
            )
        )
        db.execute(delete(OrganizerProfile).where(OrganizerProfile.id == ids["profile_id"]))
        db.execute(delete(User).where(User.id.in_(users)))
        db.commit()


# --- helpers: what the API routes do, without HTTP ------------------------------


def request(ids: dict, buyer: int, quantity: int = 1, code: str | None = None) -> CheckoutRequest:
    return CheckoutRequest(
        contact_name="Race",
        # The suffix lets teardown find this buyer's notifications.
        contact_email=f"buyer{buyer}-{ids['suffix']}@example.com",
        items=[
            {
                "ticket_type_id": ids["ticket_type_id"],
                "attendees": [{"full_name": f"Guest {n}"} for n in range(quantity)],
            }
        ],
        promo_code=code,
    )


def tickets_for(db: Session, order_id: int) -> int:
    return db.scalar(select(func.count()).select_from(Ticket).where(Ticket.order_id == order_id))


def settle(db: Session, order: Order, outcome: str = "succeed") -> str:
    """Pay one pending order and finish the transaction the way
    routes/orders.py pay_order does. Returns what happened."""
    try:
        payment = payment_service.pay_order(db, order, outcome, uuid.uuid4().hex, None)
    except PromoRejected:
        # The route: roll the charge back, cancel so the holds return now.
        db.rollback()
        order_lifecycle.cancel_pending(db, order, None)
        db.commit()
        return "promo_rejected"
    db.commit()
    return "declined" if payment.status == PaymentStatus.FAILED else "paid"


def all_at_once(work: Callable[[int, threading.Barrier], str], threads: int) -> list[str]:
    """Run work(n, barrier) on `threads` threads. Each calls barrier.wait()
    right before the contended step, so they hit it together."""
    start = threading.Barrier(threads)
    with ThreadPoolExecutor(max_workers=threads) as pool:
        return list(pool.map(lambda n: work(n, start), range(threads)))


def count(db: Session, query) -> int:
    return db.scalar(select(func.count()).select_from(query.subquery()))


# --- 1. the final ticket -------------------------------------------------------


def test_the_final_ticket_has_one_winner_through_checkout_and_payment(
    pg: sessionmaker,  # noqa: F811 - the imported fixture
    paid_stock: PaidStock,
):
    ids = paid_stock(quantity_total=1)

    def buy_and_pay(n: int, start: threading.Barrier) -> str:
        with pg() as db:
            event = db.get(Event, ids["event_id"])
            start.wait()
            try:
                order = order_service.checkout(db, event, request(ids, n), None)
            except hold_service.SoldOut:
                return "sold_out"
            # Guarantee 4, first half: reserved is not sold. The winner holds
            # the last unit and still has no ticket until payment confirms.
            assert order.status == OrderStatus.PENDING
            assert tickets_for(db, order.id) == 0
            return settle(db, order)

    outcomes = all_at_once(buy_and_pay, BUYERS)

    assert sorted(outcomes) == ["paid"] + ["sold_out"] * (BUYERS - 1)
    with pg() as db:
        event_orders = select(Order).where(Order.event_id == ids["event_id"])
        assert count(db, event_orders) == 1
        assert count(db, select(Ticket).where(Ticket.event_id == ids["event_id"])) == 1
        assert count(db, select(Payment).where(Payment.order_id.in_(select(Order.id).where(Order.event_id == ids["event_id"])))) == 1  # fmt: skip
    assert counters(pg, ids["ticket_type_id"]) == (1, 0)


# --- 2. the final promo redemption ---------------------------------------------


def test_the_final_promo_redemption_has_one_winner(
    pg: sessionmaker,  # noqa: F811 - the imported fixture
    paid_stock: PaidStock,
):
    """Every buyer gets a discounted quote at checkout, because the code is
    only *counted* at confirmation (§7). So the race is at payment time:
    everyone pays at once for a code with one use left."""
    ids = paid_stock(quantity_total=BUYERS)
    code = f"LAST{ids['suffix'][:6]}".upper()
    with pg() as db:
        campaign = Campaign(
            event_id=ids["event_id"],
            name="Last one",
            code=code,
            qr_token=f"t03-{ids['suffix']}",
            discount_type=DiscountType.PERCENT,
            discount_value=10,
            max_redemptions=1,
        )
        db.add(campaign)
        db.commit()
        campaign_id = campaign.id

        order_ids = []
        for n in range(BUYERS):
            order = order_service.checkout(
                db, db.get(Event, ids["event_id"]), request(ids, n, code=code), None
            )
            # Still a paid order: 10% off keeps the total above zero, so it
            # goes through pay_order and confirm_order like any other.
            assert order.discount_minor > 0 and order.total_minor > 0
            order_ids.append(order.id)

    def pay(n: int, start: threading.Barrier) -> str:
        with pg() as db:
            order = db.get(Order, order_ids[n])
            start.wait()
            return settle(db, order)

    outcomes = all_at_once(pay, BUYERS)

    assert sorted(outcomes) == ["paid"] + ["promo_rejected"] * (BUYERS - 1)
    with pg() as db:
        assert db.get(Campaign, campaign_id).redemption_count == 1
        assert count(db, select(PromoRedemption).where(PromoRedemption.campaign_id == campaign_id)) == 1  # fmt: skip
        # Losers were rolled back whole: no charge recorded, no ticket.
        assert count(db, select(Payment).where(Payment.order_id.in_(order_ids))) == 1
        assert count(db, select(Ticket).where(Ticket.event_id == ids["event_id"])) == 1
        statuses = sorted(db.scalars(select(Order.status).where(Order.id.in_(order_ids))))
        assert statuses == sorted([OrderStatus.CONFIRMED] + [OrderStatus.CANCELLED] * (BUYERS - 1))
    # The losers' holds went back at once, not after ten minutes.
    assert counters(pg, ids["ticket_type_id"]) == (1, 0)


# --- 3. holds come back --------------------------------------------------------


def test_holds_return_after_declined_payments_and_expiry_without_drift(
    pg: sessionmaker,  # noqa: F811 - the imported fixture
    paid_stock: PaidStock,
):
    """Half the buyers are declined at the same moment; the other half walk
    away and their holds expire. Every unit must come back exactly once."""
    ids = paid_stock(quantity_total=100)
    each = 3

    def buy_then_decline_or_abandon(n: int, start: threading.Barrier) -> str:
        with pg() as db:
            event = db.get(Event, ids["event_id"])
            order = order_service.checkout(db, event, request(ids, n, quantity=each), None)
            start.wait()  # everyone holds; now the declines land together
            if n % 2 == 0:
                return settle(db, order, "fail")
            return "abandoned"

    outcomes = all_at_once(buy_then_decline_or_abandon, BUYERS)
    assert outcomes.count("declined") == BUYERS // 2
    # The abandoned half still hold their units at this point.
    assert counters(pg, ids["ticket_type_id"]) == (0, each * (BUYERS // 2))

    with pg() as db:
        # Expire only this test's holds and orders, then sweep at the real
        # time, so anyone else's live holds in a shared dev database survive.
        past = datetime.now(UTC) - timedelta(seconds=1)
        db.execute(
            update(Hold)
            .where(Hold.ticket_type_id == ids["ticket_type_id"], Hold.released_at.is_(None))
            .values(expires_at=past)
        )
        db.execute(
            update(Order)
            .where(Order.event_id == ids["event_id"], Order.status == OrderStatus.PENDING)
            .values(expires_at=past)
        )
        db.commit()
        hold_service.release_expired_holds(db)

        drift = [r for r in hold_service.find_reserved_drift(db) if r[0] == ids["ticket_type_id"]]
        assert drift == []
        live = select(Hold).where(
            Hold.ticket_type_id == ids["ticket_type_id"], Hold.released_at.is_(None)
        )
        assert count(db, live) == 0
        statuses = sorted(db.scalars(select(Order.status).where(Order.event_id == ids["event_id"])))
        assert statuses == sorted(
            [OrderStatus.CANCELLED] * (BUYERS // 2) + [OrderStatus.EXPIRED] * (BUYERS // 2)
        )
        assert count(db, select(Ticket).where(Ticket.event_id == ids["event_id"])) == 0
        payments = list(
            db.scalars(
                select(Payment.status).where(
                    Payment.order_id.in_(select(Order.id).where(Order.event_id == ids["event_id"]))
                )
            )
        )
        assert payments == [PaymentStatus.FAILED] * (BUYERS // 2)
    assert counters(pg, ids["ticket_type_id"]) == (0, 0)


# --- 4. a refunded ticket does not get in ------------------------------------------


def test_a_refunded_ticket_is_rejected_at_every_door(
    pg: sessionmaker,  # noqa: F811 - the imported fixture
    paid_stock: PaidStock,
):
    ids = paid_stock()
    with pg() as db:
        order = order_service.checkout(db, db.get(Event, ids["event_id"]), request(ids, 0), None)
        assert settle(db, order) == "paid"
        ticket_id = db.scalar(select(Ticket.id).where(Ticket.order_id == order.id))
        order_lifecycle.refund(
            db, db.get(Order, order.id), db.get(User, ids["organizer_id"]), "T03"
        )
        db.commit()

    doors = 8

    def scan(_: int, start: threading.Barrier) -> str:
        with pg() as db:
            event, ticket = db.get(Event, ids["event_id"]), db.get(Ticket, ticket_id)
            staff = db.get(User, ids["organizer_id"])
            start.wait()
            return check_in.admit(db, event, ticket, staff, "door").outcome

    outcomes = all_at_once(scan, doors)

    assert outcomes == [check_in.Outcome.REFUNDED] * doors
    with pg() as db:
        assert db.get(Ticket, ticket_id).status == TicketStatus.REFUNDED
        # Rejected scans write nothing (04-checkin.md).
        assert count(db, select(CheckInRecord).where(CheckInRecord.ticket_id == ticket_id)) == 0
    # The refund returned the unit to sale (§4.9).
    assert counters(pg, ids["ticket_type_id"]) == (0, 0)
