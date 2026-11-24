"""Refunds in organizer analytics, filtered by ticket type (§4.6, §4.15; audit T01).

A refund is of a whole order. With a mixed order, each ticket type must carry
only its own share of it, and the shares must add up to the full refund.
"""

import pytest
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.organizer import OrganizerProfile
from app.models.user import User
from app.services.analytics import split_refund
from tests.test_events import add_event, add_organizer, auth
from tests.test_orders import activate_paid_sales, payload
from tests.test_ticket_types import add_ticket_type

CAMPAIGNS = "/api/v1/organizer/events/{event_id}/campaigns"
CHECKOUT = "/api/v1/events/{slug}/orders"
PAY = "/api/v1/orders/{number}/pay"
REFUND = "/api/v1/organizer/events/{event_id}/orders/{number}/refund"
ANALYTICS = "/api/v1/organizer/events/{event_id}/analytics"
SUMMARY = "/api/v1/organizer/events/{event_id}/summary"


@pytest.fixture
def organizer(db: Session) -> tuple[User, OrganizerProfile]:
    return add_organizer(db, "organizer@example.com")


@pytest.fixture
def event(db: Session, organizer) -> Event:
    event = add_event(db, organizer[1], status=EventStatus.PUBLISHED)
    activate_paid_sales(db, event)
    return event


def paid_order(api, event: Event, *lines: tuple[int, int], **extra) -> dict:
    response = api.post(CHECKOUT.format(slug=event.slug), json=payload(*lines, **extra))
    assert response.status_code == 201, response.text
    order = response.json()
    paid = api.post(
        PAY.format(number=order["order_number"]),
        params={"token": order["access_token"]},
        json={"outcome": "succeed"},
    )
    assert paid.status_code == 200, paid.text
    return paid.json()


def analytics(api, organizer, event: Event, **params) -> dict:
    response = api.get(
        ANALYTICS.format(event_id=event.id), params=params, headers=auth(organizer[0])
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def refunded_mixed_order(api, db, organizer, event):
    """VIP x1 and Standard x2 with a 20% promo, refunded in full, next to a
    Standard order that is kept. Returns the two ticket types."""
    vip = add_ticket_type(db, event.id, name="VIP", price_minor=500_000, quantity_total=10)
    standard = add_ticket_type(
        db, event.id, name="Standard", price_minor=200_000, quantity_total=10
    )
    created = api.post(
        CAMPAIGNS.format(event_id=event.id),
        json={
            "name": "Students",
            "code": "STUDENT20",
            "discount_type": "percent",
            "discount_value": 20,
        },
        headers=auth(organizer[0]),
    )
    assert created.status_code == 201, created.text

    mixed = paid_order(api, event, (vip.id, 1), (standard.id, 2), promo_code="STUDENT20")
    paid_order(api, event, (standard.id, 1))
    refunded = api.post(
        REFUND.format(event_id=event.id, number=mixed["order_number"]),
        json={"reason": "Requested"},
        headers=auth(organizer[0]),
    )
    assert refunded.status_code == 200, refunded.text
    return vip, standard


# VIP paid 500 000 - 20% = 400 000; Standard 2 x 200 000 - 20% = 320 000.
VIP_SHARE = 400_000
STANDARD_SHARE = 320_000
FULL_REFUND = VIP_SHARE + STANDARD_SHARE


def test_each_type_reports_only_its_own_share_of_a_mixed_refund(
    api, organizer, event, refunded_mixed_order
):
    vip, standard = refunded_mixed_order

    vip_only = analytics(api, organizer, event, ticket_type_id=vip.id)
    standard_only = analytics(api, organizer, event, ticket_type_id=standard.id)

    assert vip_only["refunds_minor"] == VIP_SHARE
    assert standard_only["refunds_minor"] == STANDARD_SHARE
    # Before the fix, both filters reported the whole order's refund.
    assert vip_only["refunds_minor"] != FULL_REFUND


def test_type_refunds_reconcile_to_the_full_refund_and_the_event_reports(
    api, organizer, event, refunded_mixed_order
):
    everything = analytics(api, organizer, event)
    summary = api.get(SUMMARY.format(event_id=event.id), headers=auth(organizer[0])).json()

    by_type = {row["name"]: row["refunds_minor"] for row in everything["by_ticket_type"]}
    assert by_type == {"VIP": VIP_SHARE, "Standard": STANDARD_SHARE}
    assert sum(by_type.values()) == everything["refunds_minor"] == FULL_REFUND
    assert summary["refunds_minor"] == FULL_REFUND


def test_net_for_a_type_is_its_own_sales_less_its_own_refund(
    api, organizer, event, refunded_mixed_order
):
    _, standard = refunded_mixed_order

    standard_only = analytics(api, organizer, event, ticket_type_id=standard.id)

    # Standard sold 2 in the refunded order (320 000 after discount) and 1 in
    # the kept one (200 000); only the refunded 320 000 comes back out.
    assert standard_only["gross_minor"] - standard_only["discounts_minor"] == 520_000
    assert standard_only["net_minor"] == 200_000


def test_a_type_absent_from_the_refunded_order_reports_no_refund(api, db, organizer, event):
    vip = add_ticket_type(db, event.id, name="VIP", price_minor=500_000, quantity_total=10)
    standard = add_ticket_type(
        db, event.id, name="Standard", price_minor=200_000, quantity_total=10
    )
    order = paid_order(api, event, (vip.id, 1))
    api.post(
        REFUND.format(event_id=event.id, number=order["order_number"]),
        json={"reason": "Requested"},
        headers=auth(organizer[0]),
    )

    assert analytics(api, organizer, event, ticket_type_id=standard.id)["refunds_minor"] == 0
    assert analytics(api, organizer, event, ticket_type_id=vip.id)["refunds_minor"] == 500_000


def test_refunds_outside_the_date_range_are_left_out(api, organizer, event, refunded_mixed_order):
    vip, _ = refunded_mixed_order

    future = analytics(api, organizer, event, ticket_type_id=vip.id, since="2099-01-01T00:00:00Z")

    assert future["refunds_minor"] == 0
    assert all(row["refunds_minor"] == 0 for row in future["by_ticket_type"])


def test_the_response_says_which_filters_each_figure_follows(api, organizer, event):
    scope = analytics(api, organizer, event)["filter_scope"]

    assert set(scope["campaigns"]) == {"date_range", "ticket_type"}
    assert scope["inventory"] == ["ticket_type"]
    assert set(scope["money"]) == {"date_range", "ticket_type"}


# --- the split itself ---------------------------------------------------------


@pytest.mark.parametrize(
    ("amount", "lines", "expected"),
    [
        # Exact proportions.
        (720_000, [(1, 400_000), (2, 320_000)], {1: 400_000, 2: 320_000}),
        # Three equal lines and a tiyn that does not divide: the earliest
        # line takes it, and nothing is lost or invented.
        (100, [(1, 1), (2, 1), (3, 1)], {1: 34, 2: 33, 3: 33}),
        # Largest remainder wins the leftover tiyn, not the earliest line.
        (10, [(1, 1), (2, 2)], {1: 3, 2: 7}),
        # Two lines of the same type are added together.
        (90, [(1, 1), (1, 1), (2, 1)], {1: 60, 2: 30}),
        # A free line takes no share of the money.
        (500, [(1, 500), (2, 0)], {1: 500, 2: 0}),
    ],
)
def test_split_refund_is_proportional_and_exact(amount, lines, expected):
    shares = split_refund(amount, lines)

    assert shares == expected
    assert sum(shares.values()) == amount


@pytest.mark.parametrize("amount", [1, 7, 99_999, 1_000_001])
def test_split_refund_never_loses_a_tiyn(amount):
    lines = [(1, 333_333), (2, 333_333), (3, 333_334), (4, 1)]

    assert sum(split_refund(amount, lines).values()) == amount


def test_split_refund_with_nothing_paid_keeps_the_refund_on_the_books():
    assert split_refund(0, [(1, 0), (2, 0)]) == {}
    assert split_refund(50, [(1, 0), (2, 0)]) == {1: 50}
