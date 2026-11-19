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

import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session, sessionmaker

from app.models.activation import ActivationStatus, EventActivation
from app.models.event import Event, EventStatus
from app.models.order import Order, OrderStatus
from app.models.payment import Payment
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.models.user import User
from app.services import activation as activation_service
from app.services import event_lifecycle
from app.services import order as order_service
from app.services import payment as payment_service
from tests.test_checkout_concurrency import PaidStock, paid_stock, request  # noqa: F401
from tests.test_holds_concurrency import pg  # noqa: F401 - pg is a fixture

LOCK_WAIT_TIMEOUT_SECONDS = 10


@pytest.fixture
def paid_event(pg: sessionmaker, paid_stock: PaidStock) -> dict:  # noqa: F811 - imported fixture
    """A published event with active paid sales and one pending order waiting
    to be paid. The event, users and cleanup come from paid_stock."""
    ids = paid_stock()
    with pg() as db:
        order = order_service.checkout(db, db.get(Event, ids["event_id"]), request(ids, 0), None)
        return ids | {"order_id": order.id}


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


# --- a payment racing an event cancellation ----------------------------------------


def test_a_payment_and_an_event_cancellation_do_not_deadlock(
    pg: sessionmaker,  # noqa: F811 - the imported fixture
    paid_event: dict,
    monkeypatch: pytest.MonkeyPatch,
):
    """The payment holds FOR SHARE on the event and still has to update its
    order row. Cancelling an event settles its orders and then updates the
    event row. If cancel took the order row first, each would wait for the
    other and Postgres would abort one with a deadlock (a 500 for whoever
    lost). cancel() locks the event row first, the same event-first order the
    payment uses, so it simply waits: the payment confirms, then the
    cancellation refunds it."""
    locked, go_on = threading.Event(), threading.Event()
    real_charge = payment_service.provider.charge

    def charge_after_the_cancel_has_started(amount_minor, outcome):
        # pay_order has passed _ensure_still_on_sale: the event is share-locked.
        locked.set()
        assert go_on.wait(LOCK_WAIT_TIMEOUT_SECONDS)
        return real_charge(amount_minor, outcome)

    monkeypatch.setattr(payment_service.provider, "charge", charge_after_the_cancel_has_started)

    def cancel_event() -> None:
        with pg() as db:
            event = db.get(Event, paid_event["event_id"])
            organizer = db.get(User, paid_event["organizer_id"])
            event_lifecycle.cancel(db, event, organizer, "T13 race")  # commits itself

    with pg() as pay_db, ThreadPoolExecutor(max_workers=2) as pool:
        paying = pool.submit(pay, pg, paid_event)
        assert locked.wait(LOCK_WAIT_TIMEOUT_SECONDS)
        cancelling = pool.submit(cancel_event)
        wait_until_blocked_on_a_lock(pg, pay_db)  # the cancellation is queued
        go_on.set()
        assert paying.result(timeout=LOCK_WAIT_TIMEOUT_SECONDS) == "paid"
        cancelling.result(timeout=LOCK_WAIT_TIMEOUT_SECONDS)

    with pg() as db:
        # Paid first, then refunded by the cancellation: nobody keeps a
        # ticket to a cancelled event, and nobody paid for nothing.
        assert db.get(Event, paid_event["event_id"]).status == EventStatus.CANCELLED
        assert db.get(Order, paid_event["order_id"]).status == OrderStatus.REFUNDED
        assert list(
            db.scalars(select(Ticket.status).where(Ticket.order_id == paid_event["order_id"]))
        ) == [TicketStatus.REFUNDED]
