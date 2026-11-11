"""Fill an empty database with a believable demonstration data set.

    uv run python scripts/seed_demo.py            # seed if the database is empty
    uv run python scripts/seed_demo.py --reset    # wipe everything, then seed

Inside Docker:  docker compose exec api python scripts/seed_demo.py --reset

Everything is created through the same service functions the API uses
(checkout, simulated payment, scan, refund, cancel), so the data obeys every
rule the application enforces: counters match tickets, each payment has its
audit row, each refund voided its tickets. Nothing is inserted "by hand" to
look right.

The script refuses to run outside ENVIRONMENT=local, and --reset deletes
every row in every table. It is a demo tool, not a migration.

Demo accounts are printed at the end. Their shared password comes from the
DEMO_PASSWORD environment variable (default below); these are throwaway
accounts on a local database with simulated money.
"""

import argparse
import io
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image, ImageDraw  # noqa: E402
from sqlalchemy import select, text  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.core import qr  # noqa: E402
from app.core.clock import utcnow  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.security import get_password_hash  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402
from app.models.activation import ActivationStatus, EventActivation  # noqa: E402
from app.models.event import Event, EventCategory, EventStatus, EventVisibility  # noqa: E402
from app.models.event_image import EventImage  # noqa: E402
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
from app.services import audit, check_in, order_lifecycle, storage, support  # noqa: E402
from app.services import campaign as campaign_service  # noqa: E402
from app.services import event_lifecycle as lifecycle  # noqa: E402
from app.services import order as order_service  # noqa: E402
from app.services import payment as payment_service  # noqa: E402

PASSWORD = os.environ.get("DEMO_PASSWORD", "Demo12345!")
TZ = "Asia/Almaty"

# Names for generated buyers. Fictional; any resemblance is coincidence.
FIRST = ["Aigerim", "Dana", "Madina", "Aliya", "Saule", "Timur", "Yerlan", "Daniyar", "Arman"]
LAST = ["Sadykova", "Nurlanova", "Kassymova", "Abenova", "Omarov", "Zhaksybekov", "Tulegenov"]


def person(n: int) -> tuple[str, str]:
    name = f"{FIRST[n % len(FIRST)]} {LAST[(n * 3) % len(LAST)]}"
    return name, f"guest{n:02d}@example.com"


# --- building blocks -------------------------------------------------------------


def add_user(db: Session, email: str, first: str, last: str, *, admin: bool = False) -> User:
    user = User(
        email=email,
        hashed_password=get_password_hash(PASSWORD),
        first_name=first,
        last_name=last,
        is_email_verified=True,
        is_platform_admin=admin,
        locale="ru",
    )
    db.add(user)
    db.flush()
    return user


def add_organizer(db: Session, user: User, name: str, *, verified: bool = True) -> OrganizerProfile:
    profile = OrganizerProfile(
        user_id=user.id,
        display_name=name,
        contact_email=user.email,
        contact_phone="+7 700 000 00 00",
        description="Demonstration organizer.",
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


def poster(colour_a: tuple[int, int, int], colour_b: tuple[int, int, int], seed: int) -> bytes:
    """A 600x900 abstract poster: a two-colour gradient with a few circles.
    No text, so it needs no font and never spells a title wrong."""
    width, height = 600, 900
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for y in range(height):
        t = y / height
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(int(a + (b - a) * t) for a, b in zip(colour_a, colour_b, strict=True)),
        )
    for i in range(5):
        radius = 60 + ((seed * 37 + i * 53) % 140)
        cx = (seed * 97 + i * 151) % width
        cy = (seed * 61 + i * 211) % height
        shade = tuple(min(255, c + 28) for c in (colour_a if i % 2 else colour_b))
        draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=shade, width=6)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


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
    colours: tuple[tuple[int, int, int], tuple[int, int, int]],
    status: EventStatus = EventStatus.PUBLISHED,
    capacity: int | None = None,
    refund_policy: str | None = None,
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
        timezone=TZ,
        capacity=capacity,
        refund_policy=refund_policy,
        published_at=min(utcnow(), starts_at) - timedelta(days=20)
        if status != EventStatus.DRAFT
        else None,
    )
    db.add(event)
    db.flush()
    content = poster(*colours, seed=event.id)
    key, url = storage.save(f"events/{event.id}", content, "image/png")
    db.add(
        EventImage(
            event_id=event.id,
            storage_key=key,
            url=url,
            content_type="image/png",
            size_bytes=len(content),
            position=0,
        )
    )
    event.cover_image_url = url
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


def activate(db: Session, event: Event, when: datetime) -> None:
    db.add(
        EventActivation(
            event_id=event.id,
            status=ActivationStatus.ACTIVE,
            activation_fee_minor=settings.ACTIVATION_FEE_MINOR,
            terms_accepted_at=when,
            activated_at=when,
        )
    )
    audit.record(
        db,
        action="activation.activated",
        entity_type="event_activation",
        entity_id=event.id,
        event_id=event.id,
        summary="Paid sales activated",
    )
    db.flush()


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
) -> Order:
    """One order through the real checkout and (for paid ones) the simulator."""
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
        payment_service.pay_order(db, order, "succeed", f"seed-{order.id}", user, when)
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


def seed(db: Session) -> None:
    now = utcnow()
    day = timedelta(days=1)

    admin = add_user(db, "admin@example.com", "Aisha", "Admin", admin=True)
    owner = add_user(db, "organizer@example.com", "Olzhas", "Organizer")
    staff = add_user(db, "staff@example.com", "Sanzhar", "Staff")
    attendee = add_user(db, "attendee@example.com", "Aru", "Attendee")
    other_owner = add_user(db, "other@example.com", "Bolat", "Other")
    profile = add_organizer(db, owner, "Almaty Jazz Club")
    other_profile = add_organizer(db, other_owner, "QuickDeals Events", verified=False)
    db.commit()

    # 1. The headline event: paid, activated, two campaigns, two weeks out.
    jazz = add_event(
        db,
        profile,
        slug="almaty-jazz-night",
        title="Almaty Jazz Night",
        description=(
            "An evening of live jazz with three bands from Almaty and Astana.\n\n"
            "Doors open one hour before the start. Seating is general admission."
        ),
        category=EventCategory.CONCERT,
        venue=("Almaty Arena", "Momyshuly Ave 1, Almaty"),
        starts_at=now + 14 * day,
        hours=3,
        colours=((217, 67, 31), (16, 24, 40)),
        refund_policy="Full refund up to 48 hours before the event. Contact the organizer.",
    )
    standard = add_type(db, jazz, "Standard", 8_000, 200)
    vip = add_type(db, jazz, "VIP", 20_000, 40, description="Front rows and a welcome drink")
    add_type(db, jazz, "Backstage (hidden)", 50_000, 5, is_hidden=True)
    activate(db, jazz, now - 12 * day)
    db.add(StaffAssignment(event_id=jazz.id, user_id=staff.id, assigned_by_user_id=owner.id))
    db.commit()
    campaign_service.create(
        db,
        jazz,
        CampaignCreate(
            name="Student week",
            code="STUDENT20",
            discount_type="percent",
            discount_value=20,
            max_redemptions=100,
        ),
        owner,
    )
    campaign_service.create(
        db,
        jazz,
        CampaignCreate(
            name="Early birds (VIP)",
            code="EARLYVIP",
            discount_type="fixed",
            discount_value=300_000,
            max_redemptions=10,
            ticket_type_ids=[vip.id],
        ),
        owner,
    )
    # Sales spread over ten days, so the sales-over-time chart has a shape.
    plan = [(10, 2), (9, 1), (8, 3), (7, 2), (6, 4), (5, 3), (4, 5), (3, 4), (2, 6), (1, 5), (0, 3)]
    n = 0
    for days_ago, orders in plan:
        for i in range(orders):
            n += 1
            when = now - days_ago * day - timedelta(hours=1 + i * 2)
            if n % 5 == 0:
                buy(db, jazz, vip, 1 + n % 2, when, n, promo="EARLYVIP" if n % 10 == 0 else None)
            else:
                buy(
                    db,
                    jazz,
                    standard,
                    1 + n % 3,
                    when,
                    n,
                    promo="STUDENT20" if n % 3 == 0 else None,
                )
    mine = buy(db, jazz, standard, 2, now - 2 * day, 99, user=attendee, promo="STUDENT20")

    # 2. A free event next week (UC1): no payment, no activation.
    mic = add_event(
        db,
        profile,
        slug="open-mic-abai-library",
        title="Open Mic at Abai Library",
        description="Poetry, stand-up and acoustic sets. Free entry with registration.",
        category=EventCategory.THEATER,
        venue=("Abai Library", "Abai Ave 14, Almaty"),
        starts_at=now + 5 * day,
        hours=2,
        colours=((2, 122, 72), (245, 245, 240)),
        capacity=120,
    )
    seat = add_type(db, mic, "Free entry", 0, 120, max_per_order=4)
    db.add(StaffAssignment(event_id=mic.id, user_id=staff.id, assigned_by_user_id=owner.id))
    db.commit()
    for i in range(18):
        buy(db, mic, seat, 1 + i % 2, now - timedelta(hours=5 + i * 7), 200 + i)

    # 3. Happening right now: the event to scan tickets at during the demo.
    meetup = add_event(
        db,
        profile,
        slug="startup-meetup-live",
        title="Startup Meetup: Live Today",
        description="Founders, students and investors. This event is in progress right now.",
        category=EventCategory.CONFERENCE,
        venue=("SmArt.Point", "Baizakov St 280, Almaty"),
        starts_at=now - timedelta(hours=1),
        hours=6,
        colours=((32, 138, 239), (16, 24, 40)),
    )
    entry = add_type(db, meetup, "Participant", 0, 150, max_per_order=4)
    pro = add_type(db, meetup, "Investor pass", 15_000, 30)
    activate(db, meetup, now - 8 * day)
    db.add(StaffAssignment(event_id=meetup.id, user_id=staff.id, assigned_by_user_id=owner.id))
    db.commit()
    for i in range(24):
        buy(db, meetup, entry, 1, now - timedelta(days=1 + i % 6, hours=i), 300 + i)
    for i in range(6):
        buy(db, meetup, pro, 1, now - timedelta(days=2 + i % 4, hours=i), 340 + i)
    buy(db, meetup, entry, 2, now - 3 * day, 98, user=attendee)
    scan_some(db, meetup, staff, 0.4)

    # 4. Completed last month: history, attendance, one refund (UC12).
    past = add_event(
        db,
        profile,
        slug="nauryz-concert",
        title="Nauryz Spring Concert",
        description="A completed event, kept for its records and its timeline.",
        category=EventCategory.CONCERT,
        venue=("Palace of the Republic", "Dostyk Ave 56, Almaty"),
        starts_at=now - 30 * day,
        hours=3,
        colours=((127, 86, 217), (253, 176, 34)),
        refund_policy="Refunds until the day of the event.",
    )
    floor = add_type(db, past, "Parterre", 12_000, 100)
    balcony = add_type(db, past, "Balcony", 6_000, 150)
    activate(db, past, now - 60 * day)
    db.commit()
    past_orders = []
    for i in range(30):
        when = now - (55 - i) * day - timedelta(hours=i % 9)
        past_orders.append(
            buy(db, past, floor if i % 3 == 0 else balcony, 1 + i % 2, when, 400 + i)
        )
    scan_some(db, past, owner, 0.8)
    order_lifecycle.refund(db, past_orders[4], owner, "Attendee could not attend", now - 31 * day)
    db.commit()

    # 5. Cancelled: every paid order refunded, in one transaction.
    hack = add_event(
        db,
        profile,
        slug="winter-hackathon",
        title="Winter Hackathon",
        description="Cancelled. Kept so its refunds and timeline stay reviewable.",
        category=EventCategory.CONFERENCE,
        venue=("Astana Hub", "Mangilik El Ave 55/8, Astana"),
        starts_at=now + 20 * day,
        hours=24,
        colours=((102, 112, 133), (208, 213, 221)),
    )
    team = add_type(db, hack, "Team ticket", 10_000, 50)
    activate(db, hack, now - 9 * day)
    db.commit()
    for i in range(5):
        buy(db, hack, team, 1, now - (6 - i) * day, 500 + i)
    lifecycle.cancel(db, hack, owner, "The venue became unavailable", now - 1 * day)

    # 6. A draft with a paid ticket and no activation: the UC2 walkthrough.
    cinema = add_event(
        db,
        profile,
        slug="kazakh-cinema-evening",
        title="Kazakh Cinema Evening",
        description="A draft. Activate paid sales, preview it, then publish.",
        category=EventCategory.OTHER,
        venue=("Arman Cinema", "Dostyk Ave 104, Almaty"),
        starts_at=now + 30 * day,
        hours=2.5,
        colours=((16, 24, 40), (255, 92, 53)),
        status=EventStatus.DRAFT,
    )
    add_type(db, cinema, "Seat", 3_500, 80)
    db.commit()

    # 7. Someone else's suspicious listing, reported: the admin's suspend demo.
    scam = add_event(
        db,
        other_profile,
        slug="iphone-giveaway-concert",
        title="FREE iPhone for every ticket holder!!!",
        description="Limited offer. Pay now, prize guaranteed.",
        category=EventCategory.OTHER,
        venue=("To be announced", "Almaty"),
        starts_at=now + 9 * day,
        hours=2,
        colours=((240, 68, 56), (254, 228, 226)),
    )
    add_type(db, scam, "Lucky ticket", 0, 500)
    db.add(
        EventReport(
            event_id=scam.id,
            reporter_user_id=attendee.id,
            reason="fraud",
            details="Promises a prize to every buyer and names no venue.",
        )
    )
    db.commit()

    # Support: one unanswered, one mid-conversation, one organizer-to-platform.
    support.open_case(
        db,
        attendee,
        CaseCreate(
            category="ticket_delivery",
            body="I bought two tickets and my friend cannot come. Can her ticket be renamed?",
            order_number=mine.order_number,
        ),
    )
    case, _ = support.open_case(
        db,
        attendee,
        CaseCreate(
            category="event_info",
            body="Hello! Is there parking near the arena, and is it free?",
            event_id=jazz.id,
        ),
    )
    support.add_staff_message(
        db,
        case,
        owner,
        "Yes, there is free parking at gate B. Which gate are you arriving at?",
        internal=False,
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
    _ = admin


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
    ):
        print(f"  {email:<24} {role}")


if __name__ == "__main__":
    main()
