"""Checkout and confirmation: steps 1, 2, 3a and 4 of the flow in
docs/data-model/03-ordering.md#how-they-connect-the-checkout-flow.

Paid orders stop at `pending`; services/payment.py is step 3b and then calls
confirm_order() exactly as the free path does.
"""

from collections import Counter
from datetime import UTC, datetime

from jwt import InvalidTokenError
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core.security import create_order_token, decode_token
from app.models.attendee import Attendee
from app.models.event import Event, SeatingMode
from app.models.hold import Hold
from app.models.order import Order, OrderItem, OrderStatus
from app.models.payment import Payment
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import activation as activation_service
from app.services import audit, codes, notify, platform
from app.services import campaign as campaign_service
from app.services import hold as hold_service
from app.services import seating as seating_service
from app.services.hold import SoldOut


class UnknownTicketType(Exception):
    """A requested ticket type does not exist on this event."""


class EmailNotVerified(Exception):
    """An authenticated buyer must verify their email before paid checkout (UC1)."""


class SeatSelectionRequired(Exception):
    """An assigned-seating event requires an event_seat_id for every attendee."""


class OrderNotPending(Exception):
    """Confirmation found the order already confirmed, expired or cancelled."""


class HoldLapsed(Exception):
    """The order's holds were released before confirmation; its units are gone."""


def checkout(
    db: Session,
    event: Event,
    data: CheckoutRequest,
    user: User | None,
    now: datetime | None = None,
) -> Order:
    """Reserve every line, create the order, and confirm it at once if it is free.

    One transaction: either the buyer gets every line they asked for, or
    nothing is held and nothing is written. Raises the hold_service errors
    (SoldOut, NotOnSale, QuantityNotAllowed) and UnknownTicketType.
    """
    now = now or datetime.now(UTC)
    try:
        order = _checkout(db, event, data, user, now)
    except Exception:
        db.rollback()
        raise
    db.commit()
    db.refresh(order)
    return order


def _checkout(
    db: Session, event: Event, data: CheckoutRequest, user: User | None, now: datetime
) -> Order:
    ids = [item.ticket_type_id for item in data.items]
    ticket_types = {
        ticket_type.id: ticket_type
        for ticket_type in db.scalars(
            select(TicketType).where(TicketType.id.in_(ids), TicketType.event_id == event.id)
        )
    }
    if len(ticket_types) != len(ids):
        raise UnknownTicketType
    # §4.1, UC1: authenticated paid checkout requires a verified email address.
    has_paid = any(t.price_minor > 0 for t in ticket_types.values())
    if has_paid and user is not None and not user.is_email_verified:
        raise EmailNotVerified
    # §4.5: "Paid tickets shall not be purchasable before activation." Checked
    # here on the server, not by hiding a button. Free types on the same event
    # stay purchasable whatever the activation says (§3.1).
    if has_paid and not activation_service.is_active(db, event.id):
        raise hold_service.NotOnSale("paid sales are not activated for this event")

    requested = sum(len(item.attendees) for item in data.items)
    if event.capacity is not None:
        _ensure_capacity(db, event, requested)

    lines = sorted(data.items, key=lambda item: item.ticket_type_id)
    assigned_mode = event.seating_mode == SeatingMode.ASSIGNED
    seat_snapshots: dict[int, tuple[str, str, str]] = {}
    holds_by_line: list[list[Hold]] = []

    if assigned_mode:
        # Every attendee must specify an event_seat_id, and line quantities still respect max_per_order.
        for line in lines:
            tt = ticket_types[line.ticket_type_id]
            if tt.max_per_order and len(line.attendees) > tt.max_per_order:
                raise hold_service.QuantityNotAllowed
            if any(person.event_seat_id is None for person in line.attendees):
                raise SeatSelectionRequired

        # Claim seats in deterministic event_seat_id order to prevent cross-seat deadlocks.
        seat_requests = sorted(
            [
                (person.event_seat_id, line.ticket_type_id)
                for line in lines
                for person in line.attendees
            ],
            key=lambda pair: pair[0],
        )
        hold_by_seat: dict[int, Hold] = {}
        for event_seat_id, ticket_type_id in seat_requests:
            _, section_name, row_label, seat_number = seating_service.claim_seat(
                db, event, event_seat_id, ticket_type_id
            )
            seat_snapshots[event_seat_id] = (section_name, row_label, seat_number)
            hold_by_seat[event_seat_id] = hold_service.claim(
                db, event, ticket_types[ticket_type_id], 1, now, event_seat_id=event_seat_id
            )
        holds_by_line = [
            [hold_by_seat[person.event_seat_id] for person in line.attendees] for line in lines
        ]
        all_holds = [h for group in holds_by_line for h in group]
    else:
        if any(person.event_seat_id is not None for line in lines for person in line.attendees):
            raise seating_service.InvalidSeatSelection(
                "seat selection is only supported for assigned-seating events"
            )
        # Lines are claimed in ticket-type id order. Two buyers each wanting
        # types A and B would otherwise lock A-then-B and B-then-A and deadlock.
        all_holds = [
            hold_service.claim(
                db, event, ticket_types[line.ticket_type_id], len(line.attendees), now
            )
            for line in lines
        ]
        holds_by_line = [[h] for h in all_holds]

    subtotal = sum(
        ticket_types[line.ticket_type_id].price_minor * len(line.attendees) for line in lines
    )
    # §4.14: the client sends a code or a QR token and the server works out
    # the discount. Raises PromoRejected with the specific reason; the route
    # turns that into a 409 the buyer can read.
    promo = None
    if data.promo_code or data.campaign_token:
        campaign = campaign_service.find(db, event, code=data.promo_code, token=data.campaign_token)
        promo = campaign_service.quote(
            db,
            campaign,
            [(ticket_types[line.ticket_type_id], len(line.attendees)) for line in lines],
            now,
        )
    discount = promo.total if promo else 0
    total = subtotal - discount
    order = Order(
        order_number=codes.new_order_number(db, now),
        event_id=event.id,
        user_id=user.id if user else None,
        contact_name=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        subtotal_minor=subtotal,
        discount_minor=discount,
        # §3.3: processing charges are "deducted from each transaction". The
        # buyer pays `total`; the fee is recorded here and comes out of the
        # organizer's payout (services/reporting.py).
        fee_minor=platform.processing_fee(db, total),
        total_minor=total,
        campaign_id=promo.campaign.id if promo else None,
        currency="KZT",
        # The order lives exactly as long as its holds; the sweeper expires both.
        expires_at=all_holds[0].expires_at,
        status=OrderStatus.PENDING,
    )
    db.add(order)
    db.flush()

    # Resolve registered user accounts for any attendee emails so gifted/group
    # tickets automatically appear in those attendees' accounts (§4.7).
    attendee_emails = {
        person.email.lower() for line in lines for person in line.attendees if person.email
    }
    user_id_by_email: dict[str, int] = {}
    if attendee_emails:
        user_id_by_email = {
            email.lower(): uid
            for uid, email in db.execute(
                select(User.id, User.email).where(func.lower(User.email).in_(attendee_emails))
            )
        }

    for line, line_holds in zip(lines, holds_by_line, strict=True):
        ticket_type = ticket_types[line.ticket_type_id]
        quantity = len(line.attendees)
        line_discount = promo.per_type.get(ticket_type.id, 0) if promo else 0
        if assigned_mode:
            # One OrderItem per assigned seat (quantity=1), distributing any
            # per-type promo discount evenly so item discounts sum exactly to line_discount.
            base_disc, rem = divmod(line_discount, quantity)
            for idx, (person, seat_hold) in enumerate(zip(line.attendees, line_holds, strict=True)):
                section_name, row_label, seat_number = seat_snapshots[person.event_seat_id]
                seat_disc = base_disc + (1 if idx < rem else 0)
                item = OrderItem(
                    order_id=order.id,
                    ticket_type_id=ticket_type.id,
                    event_seat_id=person.event_seat_id,
                    section_name=section_name,
                    row_label=row_label,
                    seat_number=seat_number,
                    quantity=1,
                    unit_price_minor=ticket_type.price_minor,
                    discount_minor=seat_disc,
                    subtotal_minor=ticket_type.price_minor,
                )
                db.add(item)
                db.flush()
                db.add(
                    Attendee(
                        order_id=order.id,
                        order_item_id=item.id,
                        user_id=user_id_by_email.get(person.email.lower())
                        if person.email
                        else None,
                        full_name=person.full_name,
                        email=person.email.lower() if person.email else None,
                        phone=person.phone,
                    )
                )
                seat_hold.order_id = order.id
        else:
            # The price is copied here, at checkout. An organizer editing the
            # ticket type later must not change what this buyer was charged.
            item = OrderItem(
                order_id=order.id,
                ticket_type_id=ticket_type.id,
                quantity=quantity,
                unit_price_minor=ticket_type.price_minor,
                discount_minor=line_discount,
                subtotal_minor=ticket_type.price_minor * quantity,
            )
            db.add(item)
            db.flush()
            db.add_all(
                Attendee(
                    order_id=order.id,
                    order_item_id=item.id,
                    user_id=user_id_by_email.get(person.email.lower()) if person.email else None,
                    full_name=person.full_name,
                    email=person.email.lower() if person.email else None,
                    phone=person.phone,
                )
                for person in line.attendees
            )
            line_holds[0].order_id = order.id
    db.flush()

    if order.total_minor == 0:
        # Step 3a: free orders go straight through and never get a payments
        # row. A fake zero-value payment would pollute the revenue figures.
        confirm_order(db, order, now, actor=user)
    return order


def confirm_order(
    db: Session,
    order: Order,
    now: datetime | None = None,
    *,
    actor: User | None = None,
) -> None:
    """Step 4. Runs inside the caller's transaction and does not commit.

    Everything here must land together: tickets without the counter move
    give inventory away, and the counter move without tickets sells nothing.
    """
    now = now or datetime.now(UTC)

    # Conditional on 'pending', so a duplicate call (a retried request, a
    # payment webhook delivered twice) finds no row and issues nothing.
    flipped = db.execute(
        update(Order)
        .where(Order.id == order.id, Order.status == OrderStatus.PENDING)
        .values(status=OrderStatus.CONFIRMED, confirmed_at=now)
        .execution_options(synchronize_session=False)
    )
    if flipped.rowcount == 0:
        raise OrderNotPending

    # The promo redemption is counted here, in the confirming transaction
    # (§7). If the code ran out while the buyer was paying, this raises and
    # everything above and below rolls back with it.
    campaign_service.redeem(db, order, now)

    # Releasing the holds and reading what they held is one statement, so
    # the sweeper cannot release the same holds between a read and a write.
    released = db.execute(
        update(Hold)
        .where(Hold.order_id == order.id, Hold.released_at.is_(None), Hold.expires_at > now)
        .values(released_at=now)
        .returning(Hold.ticket_type_id, Hold.quantity, Hold.event_seat_id)
        .execution_options(synchronize_session=False)
    ).all()
    items = db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    held = Counter()
    seat_ids: list[int] = []
    for ticket_type_id, quantity, event_seat_id in released:
        held[ticket_type_id] += quantity
        if event_seat_id is not None:
            seat_ids.append(event_seat_id)
    expected = Counter()
    for item in items:
        expected[item.ticket_type_id] += item.quantity
    if held != expected:
        # Some hold expired first. Its units may already be someone else's.
        raise HoldLapsed

    for ticket_type_id in sorted(held):
        db.execute(
            update(TicketType)
            .where(TicketType.id == ticket_type_id)
            .values(
                quantity_reserved=TicketType.quantity_reserved - held[ticket_type_id],
                quantity_sold=TicketType.quantity_sold + held[ticket_type_id],
            )
            .execution_options(synchronize_session=False)
        )

    if seat_ids:
        sold_count = seating_service.mark_seats_sold(db, seat_ids)
        if sold_count != len(set(seat_ids)):
            raise HoldLapsed

    item_by_id = {item.id: item for item in items}
    drawn: set[str] = set()
    issued_pairs: list[tuple[Ticket, Attendee]] = []
    for attendee in db.scalars(select(Attendee).where(Attendee.order_id == order.id)):
        item = item_by_id[attendee.order_item_id]
        ticket = Ticket(
            public_code=codes.new_public_code(db, drawn),
            event_id=order.event_id,
            order_id=order.id,
            order_item_id=item.id,
            ticket_type_id=item.ticket_type_id,
            attendee_id=attendee.id,
            event_seat_id=item.event_seat_id,
            section_name=item.section_name,
            row_label=item.row_label,
            seat_number=item.seat_number,
            qr_nonce=codes.new_qr_nonce(),
            issued_at=now,
        )
        db.add(ticket)
        issued_pairs.append((ticket, attendee))
    db.flush()
    db.refresh(order)
    audit_actor = actor or (db.get(User, order.user_id) if order.user_id is not None else None)
    audit.record(
        db,
        action="order.confirmed",
        entity_type="order",
        entity_id=order.id,
        event_id=order.event_id,
        actor=audit_actor,
        summary=f"Order {order.order_number} confirmed, {sum(held.values())} ticket(s) issued",
        payload={"total_minor": order.total_minor, "tickets": sum(held.values())},
    )
    # §4.4, §4.10: confirmation and ticket delivery. Queued, not sent: the
    # outbox row commits with the order and a worker emails it with the
    # server-generated ticket PDF attached (§7).
    event = db.get(Event, order.event_id)
    link = order_link(order)
    base_event_info = {
        "order_id": order.id,
        "order_number": order.order_number,
        "event_title": event.title if event is not None else "",
        "venue_name": event.venue_name if event is not None else "",
        "venue_address": event.venue_address if event is not None else "",
        "starts_at": event.starts_at.isoformat() if event is not None else "",
        "timezone": event.timezone if event is not None else "",
        "link": link,
    }
    notify.notify(
        db,
        "order.confirmed",
        base_event_info | {"ticket_codes": [t.public_code for t, _ in issued_pairs]},
        email=order.contact_email,
        user_id=order.user_id,
    )

    # Deliver individual ticket emails when an attendee has a distinct email
    # address from the buyer (gifted / group orders, §4.4).
    buyer_email = order.contact_email.strip().lower()
    type_names = {
        tt_id: name
        for tt_id, name in db.execute(
            select(TicketType.id, TicketType.name).where(
                TicketType.id.in_({item.ticket_type_id for item in items})
            )
        )
    }
    for ticket, attendee in issued_pairs:
        if not attendee.email:
            continue
        attendee_email = attendee.email.strip().lower()
        if attendee_email == buyer_email:
            continue
        seat_label = seating_service.format_seat_label(
            ticket.section_name, ticket.row_label, ticket.seat_number
        )
        notify.notify(
            db,
            "ticket.assigned",
            base_event_info
            | {
                "ticket_code": ticket.public_code,
                "attendee_name": attendee.full_name,
                "ticket_type_name": type_names.get(ticket.ticket_type_id, ""),
                "seat_label": seat_label,
                "buyer_name": order.contact_name,
            },
            email=attendee.email,
            user_id=attendee.user_id,
        )


def order_link(order: Order) -> str:
    """The web page for an order, carrying the signed token so it opens for a
    guest too. This is the "ticket delivery" link in every order email."""
    return notify.web_link(f"/orders/{order.order_number}?token={create_order_token(order.id)}")


def get_order_by_number(db: Session, order_number: str) -> Order | None:
    return db.scalar(select(Order).where(Order.order_number == order_number))


def can_view(order: Order, user: User | None, token: str | None) -> bool:
    """The two ways in: you own the order, or you hold its signed link.

    Everything else is refused, and the route answers 404 either way so an
    order number cannot be confirmed to exist by probing.
    """
    if user is not None and order.user_id == user.id:
        return True
    return token is not None and _order_id_from_token(token) == order.id


def order_is_simulated(db: Session, order: Order) -> bool:
    """Derive simulation flag from actual payment records; free orders are never simulated."""
    flag = db.scalar(
        select(Payment.is_simulated)
        .where(Payment.order_id == order.id)
        .order_by(Payment.id.desc())
        .limit(1)
    )
    return bool(flag)


def can_view_ticket(
    db: Session, order: Order, ticket: Ticket, user: User | None, token: str | None
) -> bool:
    """Order owners, guest order-link holders, or the linked attendee themselves."""
    if can_view(order, user, token):
        return True
    if user is None:
        return False
    attendee_user_id = db.scalar(select(Attendee.user_id).where(Attendee.id == ticket.attendee_id))
    return attendee_user_id == user.id


def list_user_orders(db: Session, user: User) -> list[Order]:
    return list(
        db.scalars(
            select(Order)
            .where(Order.user_id == user.id)
            .order_by(Order.created_at.desc(), Order.id.desc())
        )
    )


def list_user_tickets(
    db: Session, user: User
) -> list[tuple[Ticket, Attendee, TicketType, Order, Event]]:
    """Every ticket belonging to `user`: from orders they bought OR gifted to their email."""
    rows = db.execute(
        select(Ticket, Attendee, TicketType, Order, Event)
        .join(Attendee, Attendee.id == Ticket.attendee_id)
        .join(TicketType, TicketType.id == Ticket.ticket_type_id)
        .join(Order, Order.id == Ticket.order_id)
        .join(Event, Event.id == Ticket.event_id)
        .where(or_(Order.user_id == user.id, Attendee.user_id == user.id))
        .order_by(Ticket.issued_at.desc(), Ticket.id.desc())
    ).all()
    return [(ticket, attendee, tt, order, event) for ticket, attendee, tt, order, event in rows]


def order_items(db: Session, order: Order) -> list[OrderItem]:
    return list(
        db.scalars(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id))
    )


def order_tickets(db: Session, order: Order) -> list[tuple[Ticket, str, str]]:
    """Each ticket with its attendee's name and its type's name, both of which
    the ticket itself displays (§4.7)."""
    rows = db.execute(
        select(Ticket, Attendee.full_name, TicketType.name)
        .join(Attendee, Attendee.id == Ticket.attendee_id)
        .join(TicketType, TicketType.id == Ticket.ticket_type_id)
        .where(Ticket.order_id == order.id)
        .order_by(Ticket.id)
    ).all()
    return [(ticket, name, type_name) for ticket, name, type_name in rows]


def _ensure_capacity(db: Session, event: Event, requested: int) -> None:
    # events.capacity caps the sum across ticket types, which the per-type
    # atomic UPDATE cannot see. Locking the event row serializes checkouts
    # for capacity-capped events only; uncapped events never take this lock.
    # (SQLite ignores FOR UPDATE; the tests that need the lock use Postgres.)
    db.execute(select(Event.id).where(Event.id == event.id).with_for_update())
    committed = db.scalar(
        select(
            func.coalesce(func.sum(TicketType.quantity_sold + TicketType.quantity_reserved), 0)
        ).where(TicketType.event_id == event.id)
    )
    if committed + requested > event.capacity:
        raise SoldOut


def _order_id_from_token(token: str) -> int | None:
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return None
    if payload.get("type") != "order":
        return None
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None
