"""Fill an empty database with the BiletFlow demonstration data set.

    uv run python scripts/seed_demo.py            # seed if the database is empty
    uv run python scripts/seed_demo.py --reset    # wipe everything, then seed

Inside Docker:  docker compose exec api python scripts/seed_demo.py --reset

This is the only demo seeder. It builds, in one run:

- the organizer scenarios: one event in every lifecycle phase (on sale,
  free, live now, completed, cancelled, draft), a reported listing for the
  admin, and an assigned-seating gala;
- the public catalog: fifteen free listings across five cities, defined in
  seed_catalog.py, so discovery and the filters have something to show;
- support cases for the attendee, organizer and platform inboxes.

Event photos come from seed_assets/events/<slug>/ (file name = position,
0 is the cover). An event without photos gets a generated poster.

Everything is created through the same service functions the API uses
(checkout, simulated payment, activation, scan, refund, cancel), so the data
obeys every rule the application enforces: counters match tickets, each
payment has its audit row, each refund voided its tickets. Nothing is
inserted "by hand" to look right.

The script refuses to run outside ENVIRONMENT=local, and --reset deletes
every row in every table. It is a demo tool, not a migration.

Demo accounts are printed at the end. Their shared password comes from the
DEMO_PASSWORD environment variable (default below); these are throwaway
accounts on a local database with simulated money.
"""

import argparse
import os
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from seed_catalog import CATALOG, Listing  # noqa: E402
from seed_media import Colours, attach_images  # noqa: E402
from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core import qr  # noqa: E402
from app.core.clock import utcnow  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.event import (  # noqa: E402
    Event,
    EventCategory,
    EventStatus,
    EventVisibility,
    SeatingMode,
)
from app.models.order import Order  # noqa: E402
from app.models.organizer import (  # noqa: E402
    AccountStatus,
    OrganizerProfile,
    PayoutAccount,
    VerificationStatus,
)
from app.models.platform import EventReport  # noqa: E402
from app.models.staff import StaffAssignment  # noqa: E402
from app.models.ticket import Ticket  # noqa: E402
from app.models.ticket_type import TicketType  # noqa: E402
from app.models.user import User  # noqa: E402
from app.schemas.campaign import CampaignCreate  # noqa: E402
from app.schemas.order import CheckoutRequest  # noqa: E402
from app.schemas.support import CaseCreate, CaseUpdate  # noqa: E402
from app.services import activation as activation_service  # noqa: E402
from app.services import audit, check_in, order_lifecycle, support  # noqa: E402
from app.services import campaign as campaign_service  # noqa: E402
from app.services import event_lifecycle as lifecycle  # noqa: E402
from app.services import order as order_service  # noqa: E402
from app.services import payment as payment_service  # noqa: E402
from app.services import seating as seating_service  # noqa: E402

PASSWORD = os.environ.get("DEMO_PASSWORD", "Demo12345!")
TZ = "Asia/Almaty"
DAY = timedelta(days=1)
# Listings go public well before their first sale, so the timeline reads in order.
PUBLISHED_BEFORE = timedelta(days=45)

# Names for generated buyers. Fictional; any resemblance is coincidence.
FIRST = ["Aigerim", "Dana", "Madina", "Aliya", "Saule", "Timur", "Yerlan", "Daniyar", "Arman"]
LAST = ["Sadykova", "Nurlanova", "Kassymova", "Abenova", "Omarov", "Zhaksybekov", "Tulegenov"]


def person(n: int) -> tuple[str, str]:
    name = f"{FIRST[n % len(FIRST)]} {LAST[(n * 3) % len(LAST)]}"
    return name, f"guest{n:02d}@example.com"


@dataclass(frozen=True)
class Cast:
    """The demo accounts and the organizer profiles they own."""

    admin: User
    owner: User
    staff: User
    attendee: User
    other_owner: User
    catalog_owner: User
    profile: OrganizerProfile
    other_profile: OrganizerProfile
    catalog_profile: OrganizerProfile


# --- building blocks -------------------------------------------------------------


def add_user(db: Session, email: str, first: str, last: str, *, admin: bool = False) -> User:
    user = User(
        email=email,
        hashed_password=get_password_hash(PASSWORD),
        first_name=first,
        last_name=last,
        is_email_verified=True,
        is_platform_admin=admin,
        locale="en",
    )
    db.add(user)
    db.flush()
    return user


def add_organizer(
    db: Session,
    user: User,
    name: str,
    *,
    verified: bool = True,
    description: str = "Demonstration organizer.",
    phone: str | None = "+7 700 000 00 00",
) -> OrganizerProfile:
    profile = OrganizerProfile(
        user_id=user.id,
        display_name=name,
        contact_email=user.email,
        contact_phone=phone,
        description=description,
        verification_status=(
            VerificationStatus.VERIFIED if verified else VerificationStatus.UNVERIFIED
        ),
    )
    db.add(profile)
    db.flush()
    if verified:
        db.add(
            PayoutAccount(
                organizer_profile_id=profile.id,
                provider="Demo Bank",
                external_account_ref="demo-payout-0001",
                status=AccountStatus.ACTIVE,
                is_simulated=True,
            )
        )
    return profile


def add_event(
    db: Session,
    profile: OrganizerProfile,
    *,
    slug: str,
    title: str,
    description: str,
    category: EventCategory,
    venue: tuple[str, str],
    starts_at: datetime,
    hours: float,
    status: EventStatus = EventStatus.PUBLISHED,
    capacity: int | None = None,
    refund_policy: str | None = None,
    timezone: str = TZ,
    colours: Colours | None = None,
) -> Event:
    event = Event(
        slug=slug,
        organizer_profile_id=profile.id,
        title=title,
        description=description,
        category=category,
        status=status,
        visibility=EventVisibility.PUBLIC,
        venue_name=venue[0],
        venue_address=venue[1],
        starts_at=starts_at,
        ends_at=starts_at + timedelta(hours=hours),
        timezone=timezone,
        capacity=capacity,
        refund_policy=refund_policy,
        published_at=min(utcnow(), starts_at) - PUBLISHED_BEFORE
        if status != EventStatus.DRAFT
        else None,
    )
    db.add(event)
    db.flush()
    attach_images(db, event, colours)
    if status != EventStatus.DRAFT:
        audit.record(
            db,
            action="event.published",
            entity_type="event",
            entity_id=event.id,
            event_id=event.id,
            actor=db.get(User, profile.user_id),
            summary="Event published",
        )
    db.flush()
    return event


def add_type(db: Session, event: Event, name: str, price_kzt: int, quantity: int, **extra):
    ticket_type = TicketType(
        event_id=event.id,
        name=name,
        price_minor=price_kzt * 100,
        quantity_total=quantity,
        max_per_order=extra.pop("max_per_order", 6),
        **extra,
    )
    db.add(ticket_type)
    db.flush()
    return ticket_type


def activate(db: Session, event: Event, owner: User, when: datetime) -> None:
    """Turn on paid sales the way an organizer does (§3.2): accept the terms,
    pay the simulated fee, then activate once the checklist is complete.
    Committed step by step, as the API routes do."""
    activation = activation_service.get_or_start(db, event)
    activation_service.accept_terms(db, activation, owner, when)
    db.commit()
    activation_service.pay_fee(
        db, activation, owner, "succeed", idempotency_key=f"seed-activation-{event.id}"
    )
    db.commit()
    activation_service.activate(db, event, activation, owner, when)
    db.commit()


def assign_staff(db: Session, event: Event, cast: Cast) -> None:
    db.add(
        StaffAssignment(event_id=event.id, user_id=cast.staff.id, assigned_by_user_id=cast.owner.id)
    )


def buy(
    db: Session,
    event: Event,
    ticket_type: TicketType,
    quantity: int,
    when: datetime,
    n: int,
    *,
    user: User | None = None,
    promo: str | None = None,
    outcome: str = "succeed",
) -> Order:
    """One order through the real checkout and (for paid ones) the simulator.
    outcome="fail" declines the card, which cancels the order."""
    name, email = (f"{user.first_name} {user.last_name}", user.email) if user else person(n)
    data = CheckoutRequest(
        contact_name=name,
        contact_email=email,
        items=[
            {
                "ticket_type_id": ticket_type.id,
                "attendees": [
                    {"full_name": name if i == 0 else person(n * 7 + i)[0]} for i in range(quantity)
                ],
            }
        ],
        promo_code=promo,
    )
    order = order_service.checkout(db, event, data, user, when)
    if order.total_minor > 0:
        payment_service.pay_order(db, order, outcome, f"seed-{order.id}", user, when)
        db.commit()
        db.refresh(order)
    # created_at is a server default (the moment the script ran); move it to
    # the simulated purchase time so lists sort the way the charts read.
    order.created_at = when
    db.commit()
    return order


def scan_some(db: Session, event: Event, staff: User, share: float) -> None:
    tickets = db.scalars(
        select(Ticket).where(Ticket.event_id == event.id).order_by(Ticket.id)
    ).all()
    for ticket in tickets[: int(len(tickets) * share)]:
        payload = qr.sign(qr.ADMISSION, ticket.public_code, ticket.event_id, ticket.qr_nonce)
        check_in.scan(db, event, staff, payload, "Seed script")


# --- the data set ------------------------------------------------------------------


def seed_people(db: Session) -> Cast:
    admin = add_user(db, "admin@example.com", "Aisha", "Admin", admin=True)
    owner = add_user(db, "organizer@example.com", "Olzhas", "Organizer")
    staff = add_user(db, "staff@example.com", "Sanzhar", "Staff")
    attendee = add_user(db, "attendee@example.com", "Aru", "Attendee")
    other_owner = add_user(db, "other@example.com", "Bolat", "Other")
    catalog_owner = add_user(db, "catalog-demo@example.com", "Catalog", "Demo")
    cast = Cast(
        admin=admin,
        owner=owner,
        staff=staff,
        attendee=attendee,
        other_owner=other_owner,
        catalog_owner=catalog_owner,
        profile=add_organizer(db, owner, "Steppe Stage Collective"),
        other_profile=add_organizer(db, other_owner, "Courtyard Events", verified=False),
        catalog_profile=add_organizer(
            db,
            catalog_owner,
            "BiletFlow Demo Events",
            verified=False,
            description="Fictional listings for the local BiletFlow demonstration.",
            phone=None,
        ),
    )
    db.commit()
    return cast


def seed_jazz(db: Session, cast: Cast, now: datetime) -> tuple[Event, Order]:
    """The headline event: paid, activated, two campaigns, two weeks out."""
    jazz = add_event(
        db,
        cast.profile,
        slug="almaty-jazz-night",
        title="Almaty Jazz Night",
        description=(
            "An evening of live jazz with three bands from Almaty and Astana.\n\n"
            "Doors open one hour before the start. Seating is general admission."
        ),
        category=EventCategory.CONCERT,
        venue=("Almaty Arena", "Momyshuly Ave 1, Almaty"),
        starts_at=now + 14 * DAY,
        hours=3,
        refund_policy="Full refund up to 48 hours before the event. Contact the organizer.",
    )
    standard = add_type(db, jazz, "Standard", 8_000, 200)
    vip = add_type(db, jazz, "VIP", 20_000, 40, description="Front rows and a welcome drink")
    add_type(db, jazz, "Backstage (hidden)", 50_000, 5, is_hidden=True)
    assign_staff(db, jazz, cast)
    activate(db, jazz, cast.owner, now - 12 * DAY)
    for campaign in (
        CampaignCreate(
            name="Student week",
            code="STUDENT20",
            discount_type="percent",
            discount_value=20,
            max_redemptions=100,
        ),
        CampaignCreate(
            name="Early birds (VIP)",
            code="EARLYVIP",
            discount_type="fixed",
            discount_value=300_000,
            max_redemptions=10,
            ticket_type_ids=[vip.id],
        ),
    ):
        campaign_service.create(db, jazz, campaign, cast.owner)
    # Sales spread over ten days, so the sales-over-time chart has a shape.
    plan = [(10, 2), (9, 1), (8, 3), (7, 2), (6, 4), (5, 3), (4, 5), (3, 4), (2, 6), (1, 5), (0, 3)]
    n = 0
    for days_ago, orders in plan:
        for i in range(orders):
            n += 1
            when = now - days_ago * DAY - timedelta(hours=1 + i * 2)
            if n % 5 == 0:
                promo = "EARLYVIP" if n % 10 == 0 else None
                buy(db, jazz, vip, 1 + n % 2, when, n, promo=promo)
            else:
                promo = "STUDENT20" if n % 3 == 0 else None
                buy(db, jazz, standard, 1 + n % 3, when, n, promo=promo)
    mine = buy(db, jazz, standard, 2, now - 2 * DAY, 99, user=cast.attendee, promo="STUDENT20")
    # A declined card: the order is cancelled and its seats go back on sale.
    buy(db, jazz, standard, 1, now - timedelta(hours=2), 97, user=cast.attendee, outcome="fail")
    return jazz, mine


def seed_open_mic(db: Session, cast: Cast, now: datetime) -> None:
    """A free event next week (UC1): no payment, no activation."""
    mic = add_event(
        db,
        cast.profile,
        slug="open-mic-abai-library",
        title="Open Mic at Abai Library",
        description="Poetry, stand-up and acoustic sets. Free entry with registration.",
        category=EventCategory.THEATER,
        venue=("Abai Library", "Abai Ave 14, Almaty"),
        starts_at=now + 5 * DAY,
        hours=2,
        capacity=120,
    )
    seat = add_type(db, mic, "Free entry", 0, 120, max_per_order=4)
    assign_staff(db, mic, cast)
    db.commit()
    for i in range(18):
        buy(db, mic, seat, 1 + i % 2, now - timedelta(hours=5 + i * 7), 200 + i)


def seed_meetup(db: Session, cast: Cast, now: datetime) -> Order:
    """Happening right now: the event to scan tickets at during the demo."""
    meetup = add_event(
        db,
        cast.profile,
        slug="startup-meetup-live",
        title="Startup Meetup: Live Check-In",
        description="Lightning talks, founder demos and networking. The check-in desk is open.",
        category=EventCategory.CONFERENCE,
        venue=("Esil Innovation Hub", "Esil District, Astana"),
        starts_at=now - timedelta(hours=1),
        hours=72,
    )
    entry = add_type(db, meetup, "Participant", 0, 150, max_per_order=4)
    pro = add_type(db, meetup, "Investor pass", 15_000, 30)
    assign_staff(db, meetup, cast)
    activate(db, meetup, cast.owner, now - 8 * DAY)
    campaign_service.create(
        db,
        meetup,
        CampaignCreate(
            name="Meetup investor passes",
            code="MEETUP10",
            discount_type="percent",
            discount_value=10,
            max_redemptions=20,
            ticket_type_ids=[pro.id],
        ),
        cast.owner,
    )
    for i in range(24):
        buy(db, meetup, entry, 1, now - timedelta(days=1 + i % 6, hours=i), 300 + i)
    for i in range(6):
        when = now - timedelta(days=2 + i % 4, hours=i)
        buy(db, meetup, pro, 1, when, 340 + i, promo="MEETUP10")
    mine = buy(db, meetup, entry, 2, now - 3 * DAY, 98, user=cast.attendee)
    scan_some(db, meetup, cast.staff, 0.4)
    return mine


def seed_nauryz(db: Session, cast: Cast, now: datetime) -> Event:
    """Completed last month: history, attendance, one refund (UC12)."""
    past = add_event(
        db,
        cast.profile,
        slug="nauryz-concert",
        title="Nauryz Spring Concert",
        description="A spring program of Kazakh folk music and orchestral arrangements.",
        category=EventCategory.CONCERT,
        venue=("Palace of the Republic", "Dostyk Ave 56, Almaty"),
        starts_at=now - 30 * DAY,
        hours=3,
        refund_policy="Refunds until the day of the event.",
    )
    floor = add_type(db, past, "Parterre", 12_000, 100)
    balcony = add_type(db, past, "Balcony", 6_000, 150)
    activate(db, past, cast.owner, now - 61 * DAY)
    # Every sale lands between activation and the concert itself.
    past_orders = []
    for i in range(30):
        when = now - (60 - i) * DAY - timedelta(hours=i % 9 + 1)
        ticket_type = floor if i % 3 == 0 else balcony
        past_orders.append(buy(db, past, ticket_type, 1 + i % 2, when, 400 + i))
    scan_some(db, past, cast.owner, 0.8)
    order_lifecycle.refund(
        db, past_orders[4], cast.owner, "Attendee could not attend", now - 31 * DAY
    )
    db.commit()
    return past


def seed_hackathon(db: Session, cast: Cast, now: datetime) -> None:
    """Cancelled: every paid order refunded, in one transaction."""
    hack = add_event(
        db,
        cast.profile,
        slug="winter-hackathon",
        title="Winter Hackathon",
        description="A two-day sprint for small teams to prototype community technology.",
        category=EventCategory.CONFERENCE,
        venue=("Astana Hub", "Mangilik El Ave 55/8, Astana"),
        starts_at=now + 20 * DAY,
        hours=24,
    )
    team = add_type(db, hack, "Team ticket", 10_000, 50)
    activate(db, hack, cast.owner, now - 9 * DAY)
    for i in range(5):
        buy(db, hack, team, 1, now - (6 - i) * DAY, 500 + i)
    lifecycle.cancel(db, hack, cast.owner, "The venue became unavailable", now - 1 * DAY)


def seed_cinema(db: Session, cast: Cast, now: datetime) -> None:
    """A draft with a paid ticket and no activation: the UC2 walkthrough."""
    cinema = add_event(
        db,
        cast.profile,
        slug="kazakh-cinema-evening",
        title="Kazakh Cinema Evening",
        description="A screening of Kazakh short films with a discussion after the program.",
        category=EventCategory.OTHER,
        venue=("Arman Cinema", "Dostyk Ave 104, Almaty"),
        starts_at=now + 30 * DAY,
        hours=2.5,
        status=EventStatus.DRAFT,
    )
    add_type(db, cinema, "Seat", 3_500, 80)
    db.commit()


def seed_reported_listing(db: Session, cast: Cast, now: datetime) -> None:
    """Another organizer's listing, reported by the attendee: the admin's
    review-and-suspend demo."""
    market = add_event(
        db,
        cast.other_profile,
        slug="night-market-sessions",
        title="Night Market Sessions",
        description="An evening of live courtyard music and stalls from local makers.",
        category=EventCategory.CONCERT,
        venue=("Market Courtyard", "Market Courtyard, Almaty"),
        starts_at=now + 9 * DAY,
        hours=2,
    )
    add_type(db, market, "Market entry", 0, 150)
    db.add(
        EventReport(
            event_id=market.id,
            reporter_user_id=cast.attendee.id,
            reason="misleading",
            details="The venue's schedule shows a different organizer for the same slot.",
        )
    )
    db.commit()


def seed_gala(db: Session, cast: Cast, now: datetime) -> None:
    """Assigned seating at the predefined Kazakhstan venue (§4.3.1, §8 Bonus)."""
    venue = seating_service.ensure_predefined_venues(db)
    db.commit()
    gala = add_event(
        db,
        cast.profile,
        slug="palace-symphony-gala",
        title="Palace Symphony Gala (Assigned Seating)",
        description=(
            "Classical symphony evening at the Palace of the Republic with full "
            "assigned seating across VIP Parterre, Main Parterre, and Balcony."
        ),
        category=EventCategory.CONCERT,
        venue=(venue.name, venue.address),
        starts_at=now + 18 * DAY,
        hours=2.5,
        refund_policy="Refunds available up to 24 hours before the concert.",
        colours=((34, 48, 92), (217, 165, 32)),
    )
    gala.seating_mode = SeatingMode.ASSIGNED
    gala.venue_city = venue.city
    gala.refund_cutoff_hours_before_start = 24
    gala_vip = add_type(db, gala, "VIP Parterre", 25_000, 16)
    gala_prem = add_type(db, gala, "Main Parterre", 15_000, 30)
    gala_std = add_type(db, gala, "Balcony", 8_000, 20)
    assign_staff(db, gala, cast)
    activate(db, gala, cast.owner, now - 5 * DAY)
    seat_map = seating_service.configure_event_seating(
        db,
        gala,
        venue_id=venue.id,
        category_ticket_type_map={
            "VIP": gala_vip.id,
            "Premium": gala_prem.id,
            "Standard": gala_std.id,
        },
        unavailable_seat_ids=[],
        actor=cast.owner,
    )
    # Sell two seats so the map shows available, sold and accessible states.
    vip_seats = seat_map["sections"][0]["rows"][0]["seats"]
    prem_seats = seat_map["sections"][1]["rows"][0]["seats"]
    attendee = cast.attendee
    full_name = f"{attendee.first_name} {attendee.last_name}"
    gala_order = order_service.checkout(
        db,
        gala,
        CheckoutRequest(
            contact_name=full_name,
            contact_email=attendee.email,
            items=[
                {
                    "ticket_type_id": gala_vip.id,
                    "attendees": [
                        {
                            "full_name": full_name,
                            "email": attendee.email,
                            "event_seat_id": vip_seats[1]["event_seat_id"],
                        }
                    ],
                },
                {
                    "ticket_type_id": gala_prem.id,
                    "attendees": [
                        {
                            "full_name": "Dana Nurlanova",
                            "event_seat_id": prem_seats[2]["event_seat_id"],
                        }
                    ],
                },
            ],
        ),
        attendee,
        now - 1 * DAY,
    )
    payment_service.pay_order(
        db, gala_order, "succeed", f"seed-{gala_order.id}", attendee, now - 1 * DAY
    )
    db.commit()


def catalog_start(listing: Listing, now: datetime) -> datetime:
    """`days_ahead` days from today, at the listing's local wall-clock time."""
    zone = ZoneInfo(listing.timezone)
    day = now.astimezone(zone).date() + timedelta(days=listing.days_ahead)
    hour, minute = (int(part) for part in listing.local_time.split(":"))
    return datetime.combine(day, time(hour, minute), tzinfo=zone).astimezone(UTC)


def seed_catalog(db: Session, cast: Cast, now: datetime) -> None:
    """The public catalog (seed_catalog.py): free listings with a few
    registrations each; the attendee holds tickets to three of them."""
    for index, listing in enumerate(CATALOG):
        event = add_event(
            db,
            cast.catalog_profile,
            slug=listing.slug,
            title=listing.title,
            description=listing.description,
            category=listing.category,
            venue=(listing.venue, listing.address),
            starts_at=catalog_start(listing, now),
            hours=listing.minutes / 60,
            capacity=listing.capacity,
            timezone=listing.timezone,
        )
        admission = add_type(db, event, "Free admission", 0, listing.capacity, max_per_order=4)
        db.commit()
        for k in range(2 + index % 3):
            user = cast.attendee if k == 0 and index % 5 == 0 else None
            when = now - timedelta(hours=5 + 12 * k)
            buy(db, event, admission, 1 + k % 2, when, 700 + index * 10 + k, user=user)


def seed_support(
    db: Session, cast: Cast, jazz_order: Order, meetup_order: Order, past: Event
) -> None:
    """One unanswered, one mid-conversation, one organizer-to-platform."""
    attendee, owner = cast.attendee, cast.owner
    support.open_case(
        db,
        attendee,
        CaseCreate(
            category="ticket_delivery",
            body="I bought two tickets and my friend cannot come. Can her ticket be renamed?",
            order_number=jazz_order.order_number,
        ),
    )
    case, _ = support.open_case(
        db,
        attendee,
        CaseCreate(
            category="event_info",
            body="Is there parking near the meetup entrance, and is it free?",
            order_number=meetup_order.order_number,
        ),
    )
    support.update_case(db, case, owner, CaseUpdate(assigned_to_user_id=owner.id))
    support.add_staff_message(
        db,
        case,
        owner,
        "Yes, there is free parking by the main entrance. Do you need step-free access?",
        internal=False,
    )
    support.add_staff_message(
        db, case, owner, "Confirm the accessible entrance at briefing.", internal=True
    )
    support.update_case(db, case, owner, CaseUpdate(status="waiting_for_customer"))
    support.open_case(
        db,
        owner,
        CaseCreate(
            audience="organizer",
            category="payment",
            body="The Nauryz concert finished a month ago. When will the (demo) payout arrive?",
            event_id=past.id,
        ),
    )


def seed(db: Session) -> None:
    now = utcnow()
    cast = seed_people(db)
    _, jazz_order = seed_jazz(db, cast, now)
    seed_open_mic(db, cast, now)
    meetup_order = seed_meetup(db, cast, now)
    past = seed_nauryz(db, cast, now)
    seed_hackathon(db, cast, now)
    seed_cinema(db, cast, now)
    seed_reported_listing(db, cast, now)
    seed_gala(db, cast, now)
    seed_catalog(db, cast, now)
    seed_support(db, cast, jazz_order, meetup_order, past)


def reset(db: Session) -> None:
    """Delete every row. Tables stay, so no migration needs re-running."""
    names = ", ".join(f'"{table.name}"' for table in Base.metadata.sorted_tables)
    db.execute(text(f"TRUNCATE {names} RESTART IDENTITY CASCADE"))
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--reset", action="store_true", help="delete ALL data first")
    args = parser.parse_args()
    if settings.ENVIRONMENT != "local":
        sys.exit("seed_demo.py only runs with ENVIRONMENT=local")
    with SessionLocal() as db:
        if args.reset:
            reset(db)
        elif db.scalar(select(User.id).limit(1)) is not None:
            sys.exit("The database already has users. Use --reset to wipe it and reseed.")
        seed(db)
    print("Demo data ready. Sign in with any of these (password: %s)" % PASSWORD)
    for email, role in (
        ("admin@example.com", "Platform Admin  -> /admin"),
        ("organizer@example.com", "Organizer       -> /organizer/events"),
        ("staff@example.com", "Event Admin     -> the mobile scanner app"),
        ("attendee@example.com", "Attendee        -> /account"),
        ("catalog-demo@example.com", "Organizer       -> owns the public catalog"),
    ):
        print(f"  {email:<26} {role}")


if __name__ == "__main__":
    main()
