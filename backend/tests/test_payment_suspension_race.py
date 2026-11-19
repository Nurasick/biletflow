"""T13: a payment racing an admin suspension, on real Postgres.

The SQLite tests in test_paid_checkout.py show that a payment arriving *after*
a suspension is refused. That alone does not prove the race is closed: under
Postgres's READ COMMITTED a plain SELECT never waits for an uncommitted UPDATE,
it reads the last committed row. So a payment could read "active" while the
suspension is half-done, then charge and issue tickets after the admin was
told sales had stopped.

These tests force exactly that interleaving instead of hoping threads hit it:

1. The "admin" session runs the suspension's UPDATE and does NOT commit yet,
   so it holds the row lock.
2. A second thread calls pay_order.
3. We wait until Postgres reports that thread as blocked on a lock. Without
   the FOR SHARE lock in payment._ensure_still_on_sale it never blocks: it
   reads the old row, pays and confirms, and the test fails.
4. The admin commits. The payment wakes up, re-reads the row (Postgres does
   that for a locking read), sees "suspended" and refuses.

Like test_holds_concurrency.py, this needs DATABASE_URL migrated to head and
skips without Postgres.
"""

import time
import uuid
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from app.models.activation import ActivationStatus, EventActivation
from app.models.event import Event, EventStatus
from app.models.notification import Notification
from app.models.order import Order, OrderStatus
from app.models.organizer import OrganizerProfile
from app.models.payment import Payment
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import activation as activation_service
from app.services import order as order_service
from app.services import payment as payment_service
from tests.test_holds_concurrency import pg, purge_event  # noqa: F401 - pg is a fixture

LOCK_WAIT_TIMEOUT_SECONDS = 10


@pytest.fixture
def paid_event(pg: sessionmaker) -> Iterator[dict]:  # noqa: F811 - the imported fixture
    """A published event with active paid sales, one paid ticket type, a
    platform admin, and one pending order waiting to be paid."""
    suffix = uuid.uuid4().hex[:12]
    with pg() as db:
        organizer = User(
            email=f"susp-org-{suffix}@example.com",
            hashed_password="$argon2id$fake",
            first_name="Org",
            last_name="Race",
        )
        admin = User(
            email=f"susp-admin-{suffix}@example.com",
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
            slug=f"susp-{suffix}",
            title="Suspension race",
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
        vip = TicketType(event_id=event.id, name="VIP", price_minor=500_000, quantity_total=10)
        db.add(vip)
        db.commit()
        order = order_service.checkout(
            db,
            event,
            CheckoutRequest(
                contact_name="Race",
                contact_email=f"buyer-{suffix}@example.com",
                items=[{"ticket_type_id": vip.id, "attendees": [{"full_name": "A"}]}],
            ),
            None,
        )
        ids = {
            "organizer_id": organizer.id,
            "admin_id": admin.id,
            "profile_id": profile.id,
            "event_id": event.id,
            "ticket_type_id": vip.id,
            "order_id": order.id,
        }

    yield ids

    users = [ids["organizer_id"], ids["admin_id"]]
    with pg() as db:
        purge_event(db, ids["event_id"])
        # activation_service.suspend tells the organizer (§4.10 payout status).
        db.execute(delete(Notification).where(Notification.user_id.in_(users)))
        db.execute(delete(OrganizerProfile).where(OrganizerProfile.id == ids["profile_id"]))
        db.execute(delete(User).where(User.id.in_(users)))
        db.commit()


def suspend_paid_sales_uncommitted(db: Session, ids: dict) -> None:
    """The real service call. It flips the row and does not commit."""
    activation = db.scalar(
        select(EventActivation).where(EventActivation.event_id == ids["event_id"])
    )
    activation_service.suspend(db, activation, db.get(User, ids["admin_id"]), "race")


def suspend_event_uncommitted(db: Session, ids: dict) -> None:
    """event_lifecycle.suspend commits inside, so it cannot be held open.
    This is the same conditional UPDATE its _flip issues."""
    db.execute(
        update(Event)
        .where(Event.id == ids["event_id"], Event.status == EventStatus.PUBLISHED)
        .values(status=EventStatus.SUSPENDED)
    )


def pay(sessions: sessionmaker, ids: dict) -> str:
    """Pay the pending order in its own session. Returns the outcome's name."""
    with sessions() as db:
        order = db.get(Order, ids["order_id"])
        try:
            payment_service.pay_order(db, order, "succeed", f"race-{uuid.uuid4().hex}", None)
        except payment_service.SalesSuspended:
            db.rollback()
            return "refused"
        db.commit()
        return "paid"


def wait_until_blocked_on_a_lock(sessions: sessionmaker, other_db: Session) -> None:
    """Poll pg_stat_activity until a backend other than `other_db` waits on a lock.

    Deterministic, unlike sleep-and-hope: it returns the moment the payment
    thread is parked behind the admin's row lock, and fails if that never
    happens (which is exactly the bug: the payment did not wait).
    """
    own_pid = other_db.scalar(text("select pg_backend_pid()"))
    deadline = time.monotonic() + LOCK_WAIT_TIMEOUT_SECONDS
    with sessions() as probe:
        while time.monotonic() < deadline:
            waiting = probe.scalar(
                text(
                    "select count(*) from pg_stat_activity "
                    "where wait_event_type = 'Lock' and datname = current_database() "
                    "and pid <> :own"
                ),
                {"own": own_pid},
            )
            if waiting:
                return
            time.sleep(0.05)
    pytest.fail("the payment never waited for the suspension's row lock")


@pytest.mark.parametrize("suspend", [suspend_paid_sales_uncommitted, suspend_event_uncommitted])
def test_a_payment_racing_a_suspension_waits_for_it_and_is_refused(
    pg: sessionmaker,  # noqa: F811 - the imported fixture
    paid_event: dict,
    suspend: Callable[[Session, dict], None],
):
    with pg() as admin_db, ThreadPoolExecutor(max_workers=1) as pool:
        suspend(admin_db, paid_event)  # row now locked, change not yet visible
        outcome = pool.submit(pay, pg, paid_event)
        # Without the fix the payment never blocks: it reads the old row,
        # pays, and this times out with "never waited".
        wait_until_blocked_on_a_lock(pg, admin_db)
        admin_db.commit()
        result = outcome.result(timeout=LOCK_WAIT_TIMEOUT_SECONDS)

    assert result == "refused"
    with pg() as db:
        order_id = paid_event["order_id"]
        assert db.scalar(select(func.count()).where(Payment.order_id == order_id)) == 0
        assert db.scalar(select(func.count()).where(Ticket.order_id == order_id)) == 0
        assert db.get(Order, order_id).status == OrderStatus.PENDING  # route cancels it
        ticket_type = db.get(TicketType, paid_event["ticket_type_id"])
        assert ticket_type.quantity_sold == 0


def test_a_payment_that_wins_the_race_completes_and_the_suspension_waits(
    pg: sessionmaker,  # noqa: F811 - the imported fixture
    paid_event: dict,
):
    """The other order of events: the payment took its lock first, so it
    finishes, and the suspension applies to everything after it. Neither side
    deadlocks, and the buyer who paid keeps a ticket."""
    with pg() as pay_db:
        order = pay_db.get(Order, paid_event["order_id"])
        payment_service.pay_order(pay_db, order, "succeed", f"race-{uuid.uuid4().hex}", None)
        # The payment is not committed yet and still holds FOR SHARE.
        with pg() as admin_db, ThreadPoolExecutor(max_workers=1) as pool:

            def suspend_and_commit() -> None:
                suspend_paid_sales_uncommitted(admin_db, paid_event)
                admin_db.commit()

            suspension = pool.submit(suspend_and_commit)
            wait_until_blocked_on_a_lock(pg, pay_db)
            pay_db.commit()
            suspension.result(timeout=LOCK_WAIT_TIMEOUT_SECONDS)

    with pg() as db:
        assert db.get(Order, paid_event["order_id"]).status == OrderStatus.CONFIRMED
        assert db.scalar(select(func.count()).where(Ticket.order_id == paid_event["order_id"])) == 1
        assert (
            db.scalar(
                select(EventActivation.status).where(
                    EventActivation.event_id == paid_event["event_id"]
                )
            )
            == ActivationStatus.SUSPENDED
        )
