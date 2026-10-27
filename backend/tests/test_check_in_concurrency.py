"""Two doors, one ticket, the same instant (state-machines.md §9, §10.3).

Real Postgres, like test_holds_concurrency.py: SQLite serializes writes and
so can never show this race.
"""

import threading
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import func, select

from app.models.check_in import CheckInRecord
from app.models.event import Event
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import check_in
from app.services import order as order_service
from tests.test_holds_concurrency import pg, stock  # noqa: F401 - fixtures


def test_one_ticket_scanned_at_ten_doors_admits_exactly_one(pg, stock):  # noqa: F811
    event_id, ticket_type_id = stock
    with pg() as db:
        event = db.get(Event, event_id)
        data = CheckoutRequest(
            contact_name="Race",
            contact_email="race@example.com",
            items=[{"ticket_type_id": ticket_type_id, "attendees": [{"full_name": "A"}]}],
        )
        order = order_service.checkout(db, event, data, None)
        ticket_id = db.scalar(select(Ticket.id).where(Ticket.order_id == order.id))
        # The organizer of the stock event scans; no staff row is needed.
        admin_id = db.scalar(
            select(User.id).where(User.email.like("race-%")).order_by(User.id.desc())
        )

    doors = 10
    start = threading.Barrier(doors)

    def scan(_: int) -> str:
        with pg() as db:
            event, ticket, admin = (
                db.get(Event, event_id),
                db.get(Ticket, ticket_id),
                db.get(User, admin_id),
            )
            start.wait()
            return check_in.admit(db, event, ticket, admin, "door").outcome

    with ThreadPoolExecutor(max_workers=doors) as pool:
        outcomes = list(pool.map(scan, range(doors)))

    assert sorted(outcomes).count("valid") == 1
    assert outcomes.count("already_used") == doors - 1
    with pg() as db:
        records = db.scalar(
            select(func.count())
            .select_from(CheckInRecord)
            .where(CheckInRecord.ticket_id == ticket_id)
        )
    assert records == 1
