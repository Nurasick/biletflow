"""Checkout and confirmation: steps 1, 2, 3a and 4 of the flow in
docs/data-model/03-ordering.md#how-they-connect-the-checkout-flow.

Paid orders stop at `pending`; services/payment.py is step 3b and then calls
confirm_order() exactly as the free path does.
"""

from collections import Counter
from datetime import UTC, datetime

from jwt import InvalidTokenError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.security import create_order_token, decode_token
from app.models.attendee import Attendee
from app.models.event import Event
from app.models.hold import Hold
from app.models.order import Order, OrderItem, OrderStatus
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import activation as activation_service
from app.services import audit, codes, notify, platform
from app.services import campaign as campaign_service
from app.services import hold as hold_service
from app.services.hold import SoldOut


class UnknownTicketType(Exception):
    """A requested ticket type does not exist on this event."""


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
    # §4.5: "Paid tickets shall not be purchasable before activation." Checked
    # here on the server, not by hiding a button. Free types on the same event
    # stay purchasable whatever the activation says (§3.1).
    if any(t.price_minor > 0 for t in ticket_types.values()) and not activation_service.is_active(
        db, event.id
    ):
        raise hold_service.NotOnSale("paid sales are not activated for this event")

    requested = sum(len(item.attendees) for item in data.items)
    if event.capacity is not None:
        _ensure_capacity(db, event, requested)

    # Lines are claimed in ticket-type id order. Two buyers each wanting
    # types A and B would otherwise lock A-then-B and B-then-A and deadlock.
    lines = sorted(data.items, key=lambda item: item.ticket_type_id)
    holds = [
        hold_service.claim(db, event, ticket_types[line.ticket_type_id], len(line.attendees), now)
        for line in lines
    ]

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
        expires_at=holds[0].expires_at,
        status=OrderStatus.PENDING,
    )
    db.add(order)
    db.flush()

    for line, hold in zip(lines, holds, strict=True):
        ticket_type = ticket_types[line.ticket_type_id]
        quantity = len(line.attendees)
        # The price is copied here, at checkout. An organizer editing the
        # ticket type later must not change what this buyer was charged.
        item = OrderItem(
            order_id=order.id,
            ticket_type_id=ticket_type.id,
            quantity=quantity,
            unit_price_minor=ticket_type.price_minor,
            discount_minor=promo.per_type.get(ticket_type.id, 0) if promo else 0,
            subtotal_minor=ticket_type.price_minor * quantity,
        )
        db.add(item)
        db.flush()
        db.add_all(
            Attendee(
                order_id=order.id,
                order_item_id=item.id,
                full_name=person.full_name,
                email=person.email,
                phone=person.phone,
            )
            for person in line.attendees
        )
        hold.order_id = order.id
    db.flush()

    if order.total_minor == 0:
        # Step 3a: free orders go straight through and never get a payments
        # row. A fake zero-value payment would pollute the revenue figures.
        confirm_order(db, order, now)
    return order


def confirm_order(db: Session, order: Order, now: datetime | None = None) -> None:
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
        .returning(Hold.ticket_type_id, Hold.quantity)
        .execution_options(synchronize_session=False)
    ).all()
    items = db.scalars(select(OrderItem).where(OrderItem.order_id == order.id)).all()
    held = Counter()
    for ticket_type_id, quantity in released:
        held[ticket_type_id] += quantity
    if held != Counter({item.ticket_type_id: item.quantity for item in items}):
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

    item_by_id = {item.id: item for item in items}
    drawn: set[str] = set()
    for attendee in db.scalars(select(Attendee).where(Attendee.order_id == order.id)):
        item = item_by_id[attendee.order_item_id]
        db.add(
            Ticket(
                public_code=codes.new_public_code(db, drawn),
                event_id=order.event_id,
                order_id=order.id,
                order_item_id=item.id,
                ticket_type_id=item.ticket_type_id,
                attendee_id=attendee.id,
                qr_nonce=codes.new_qr_nonce(),
                issued_at=now,
            )
        )
    db.flush()
    db.refresh(order)
    audit.record(
        db,
        action="order.confirmed",
        entity_type="order",
        entity_id=order.id,
        event_id=order.event_id,
        summary=f"Order {order.order_number} confirmed, {sum(held.values())} ticket(s) issued",
        payload={"total_minor": order.total_minor, "tickets": sum(held.values())},
    )
    # §4.4, §4.10: confirmation and ticket delivery. Queued, not sent: the
    # outbox row commits with the order and a worker emails it (§7).
    event_title = db.scalar(select(Event.title).where(Event.id == order.event_id))
    notify.notify(
        db,
        "order.confirmed",
        {
            "order_number": order.order_number,
            "event_title": event_title,
            "link": order_link(order),
        },
        email=order.contact_email,
        user_id=order.user_id,
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


def list_user_orders(db: Session, user: User) -> list[Order]:
    return list(
        db.scalars(
            select(Order)
            .where(Order.user_id == user.id)
            .order_by(Order.created_at.desc(), Order.id.desc())
        )
    )


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
