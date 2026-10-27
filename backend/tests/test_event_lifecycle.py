"""Event transitions beyond publish (state-machines.md §1) and the audit trail
they write (§4.16, 07-platform.md)."""

from datetime import timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.audit import AuditLog
from app.models.event import Event, EventStatus
from app.models.order import Order
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.services import audit
from tests.test_events import add_event, add_organizer, add_user, auth
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type

BASE = "/api/v1/organizer/events/{event_id}"


@pytest.fixture
def organizer(db: Session):
    return add_organizer(db, "organizer@example.com")


def act(api, user, event: Event, action: str, **kwargs):
    return api.post(BASE.format(event_id=event.id) + f"/{action}", headers=auth(user), **kwargs)


def buy(api, event: Event, ticket_type: TicketType, count: int = 1) -> dict:
    return api.post(
        f"/api/v1/events/{event.slug}/orders", json=payload((ticket_type.id, count))
    ).json()


# --- preview -------------------------------------------------------------------


def test_preview_lists_unmet_requirements_and_only_cancel(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)

    body = api.get(BASE.format(event_id=event.id) + "/preview", headers=auth(user)).json()

    unmet = [r["code"] for r in body["publish_requirements"] if not r["met"]]
    assert unmet == ["visible_ticket_type"]
    assert body["allowed_actions"] == ["cancel"]
    assert body["event"]["phase"] == "draft"


def test_preview_offers_publish_once_ready(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    add_ticket_type(db, event.id)

    body = api.get(BASE.format(event_id=event.id) + "/preview", headers=auth(user)).json()

    assert body["allowed_actions"] == ["publish", "cancel"]


def test_preview_of_someone_elses_event_is_404(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    stranger, _ = add_organizer(db, "x@example.com")

    assert (
        api.get(BASE.format(event_id=event.id) + "/preview", headers=auth(stranger)).status_code
        == 404
    )


# --- unpublish ----------------------------------------------------------------


def test_unpublish_returns_an_unsold_event_to_draft(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.PUBLISHED, published_at=utcnow())

    response = act(api, user, event, "unpublish")

    assert response.status_code == 200
    assert response.json()["status"] == "draft"
    assert response.json()["published_at"] is None


def test_unpublish_is_refused_once_tickets_are_sold(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    buy(api, event, add_ticket_type(db, event.id))

    response = act(api, user, event, "unpublish")

    assert response.status_code == 409
    assert "cancel the event instead" in response.json()["detail"]


# --- cancel -------------------------------------------------------------------


def test_cancel_settles_every_order_in_one_go(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    activate_paid_sales(db, event)
    free = add_ticket_type(db, event.id, quantity_total=10)
    vip = add_ticket_type(db, event.id, name="VIP", price_minor=1_000, quantity_total=10)
    registration = buy(api, event, free, 2)
    paid = buy(api, event, vip, 1)
    api.post(
        f"/api/v1/orders/{paid['order_number']}/pay",
        params={"token": paid["access_token"]},
        json={"outcome": "succeed"},
    )
    pending = buy(api, event, vip, 3)

    response = act(api, user, event, "cancel", json={"reason": "Venue flooded"})

    assert response.status_code == 200, response.text
    assert response.json()["status"] == "cancelled"
    statuses = dict(db.execute(select(Order.order_number, Order.status)).all())
    assert statuses == {
        registration["order_number"]: "cancelled",
        paid["order_number"]: "refunded",
        pending["order_number"]: "cancelled",
    }
    assert set(db.scalars(select(Ticket.status))) == {"cancelled", "refunded"}
    for ticket_type in (free, vip):
        db.refresh(ticket_type)
        assert (ticket_type.quantity_sold, ticket_type.quantity_reserved) == (0, 0)
    entry = db.scalar(select(AuditLog).where(AuditLog.action == "event.cancelled"))
    assert entry.payload["orders_refunded"] == 1 and entry.payload["reason"] == "Venue flooded"


def test_a_cancelled_event_cannot_be_cancelled_or_edited(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.CANCELLED)

    assert act(api, user, event, "cancel").status_code == 409
    edit = api.patch(BASE.format(event_id=event.id), headers=auth(user), json={"title": "New"})
    assert edit.status_code == 409


# --- suspend (platform admin) -------------------------------------------------


def test_only_a_platform_admin_can_suspend(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    admin = add_user(db, "admin@example.com")
    admin.is_platform_admin = True
    db.commit()
    url = f"/api/v1/admin/events/{event.id}/suspend"

    refused = api.post(url, headers=auth(user), json={"reason": "fraud"})
    done = api.post(url, headers=auth(admin), json={"reason": "fraud"})

    assert refused.status_code == 403
    assert done.json()["status"] == "suspended"


def test_a_suspended_event_stops_sales_and_edits(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.SUSPENDED)
    general = add_ticket_type(db, event.id)

    sale = api.post(f"/api/v1/events/{event.slug}/orders", json=payload((general.id, 1)))
    edit = api.patch(BASE.format(event_id=event.id), headers=auth(user), json={"title": "x"})

    assert sale.status_code == 409
    assert edit.status_code == 409


# --- duplicate ----------------------------------------------------------------


def test_duplicate_copies_configuration_but_no_history(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.PUBLISHED, refund_policy="7 days")
    general = add_ticket_type(db, event.id, quantity_total=10, price_minor=0)
    buy(api, event, general, 2)

    response = act(api, user, event, "duplicate")

    assert response.status_code == 201
    copy = response.json()
    assert copy["status"] == "draft"
    assert copy["slug"] == f"{event.slug}-copy"
    assert copy["refund_policy"] == "7 days"
    copied_types = db.scalars(select(TicketType).where(TicketType.event_id == copy["id"])).all()
    assert [(t.name, t.quantity_total, t.quantity_sold) for t in copied_types] == [
        ("General", 10, 0)
    ]
    assert db.scalar(select(func.count()).where(Order.event_id == copy["id"])) == 0
    assert act(api, user, event, "duplicate").json()["slug"] == f"{event.slug}-copy-2"


# --- derived phase --------------------------------------------------------------


@pytest.mark.parametrize(
    ("start", "end", "phase"),
    [(1, 2, "upcoming"), (-1, 1, "active"), (-3, -2, "completed")],
)
def test_phase_is_derived_from_the_clock(api, db, organizer, start, end, phase):
    user, profile = organizer
    now = utcnow()
    event = add_event(
        db,
        profile,
        status=EventStatus.PUBLISHED,
        starts_at=now + timedelta(hours=start),
        ends_at=now + timedelta(hours=end),
    )

    body = api.get(BASE.format(event_id=event.id), headers=auth(user)).json()

    assert body["phase"] == phase


# --- audit trail ----------------------------------------------------------------


def test_publish_writes_one_audit_row_with_the_actor(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    add_ticket_type(db, event.id)

    act(api, user, event, "publish")

    rows = db.scalars(select(AuditLog).where(AuditLog.action == "event.published")).all()
    assert [(r.event_id, r.actor_user_id, r.entity_type) for r in rows] == [
        (event.id, user.id, "event")
    ]


def test_price_change_is_on_the_timeline_and_filterable(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile)
    vip = add_ticket_type(db, event.id, price_minor=1_000)
    api.patch(
        BASE.format(event_id=event.id) + f"/ticket-types/{vip.id}",
        headers=auth(user),
        json={"price_minor": 2_000},
    )
    api.patch(BASE.format(event_id=event.id), headers=auth(user), json={"capacity": 50})

    everything = api.get(BASE.format(event_id=event.id) + "/timeline", headers=auth(user)).json()
    prices = api.get(
        BASE.format(event_id=event.id) + "/timeline",
        params={"action": "ticket_type.price_changed"},
        headers=auth(user),
    ).json()

    assert [e["action"] for e in everything] == [
        "event.capacity_changed",
        "ticket_type.price_changed",
    ]
    assert len(prices) == 1 and prices[0]["payload"] == {"from": 1_000, "to": 2_000}


def test_another_organizer_cannot_read_the_timeline(api, db, organizer):
    _, profile = organizer
    event = add_event(db, profile)
    stranger, _ = add_organizer(db, "x@example.com")

    response = api.get(BASE.format(event_id=event.id) + "/timeline", headers=auth(stranger))

    assert response.status_code == 404


def test_the_audit_service_has_no_way_to_edit_or_delete():
    """§4.16: entries "shall not be editable or deletable". Not a promise in a
    comment: the functions do not exist."""
    public = {name for name in dir(audit) if not name.startswith("_")}

    assert not {n for n in public if any(w in n for w in ("update", "delete", "edit", "remove"))}


def test_audit_payloads_carry_no_attendee_names_or_emails(api, db, organizer):
    user, profile = organizer
    event = add_event(db, profile, status=EventStatus.PUBLISHED)
    buy(api, event, add_ticket_type(db, event.id), 2)

    dumped = " ".join(str(r.payload) + r.summary for r in db.scalars(select(AuditLog)))

    assert "Guest" not in dumped and "aru@example.com" not in dumped
