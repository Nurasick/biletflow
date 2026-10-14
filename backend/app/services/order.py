"""Checkout and confirmation: steps 1, 2, 3a and 4 of the flow in
docs/data-model/03-ordering.md#how-they-connect-the-checkout-flow.

Paid orders stop at `pending` for now; the payments slice adds step 3b and
then calls confirm_order() exactly as the free path does.
"""

from collections import Counter
from datetime import UTC, datetime

from jwt import InvalidTokenError
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.models.attendee import Attendee
from app.models.event import Event
from app.models.hold import Hold
from app.models.order import Order, OrderItem, OrderStatus
from app.models.ticket import Ticket
from app.models.ticket_type import TicketType
from app.models.user import User
from app.schemas.order import CheckoutRequest
from app.services import codes
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
    order = Order(
        order_number=codes.new_order_number(db, now),
        event_id=event.id,
        user_id=user.id if user else None,
        contact_name=data.contact_name,
        contact_email=data.contact_email,
        contact_phone=data.contact_phone,
        subtotal_minor=subtotal,
        discount_minor=0,
        fee_minor=0,
        # Fee policy is open question #3, so total = subtotal until it is decided.
        total_minor=subtotal,
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
            discount_minor=0,
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


def order_tickets(db: Session, order: Order) -> list[tuple[Ticket, str]]:
    """Each ticket with its attendee's name, which the ticket itself displays."""
    rows = db.execute(
        select(Ticket, Attendee.full_name)
        .join(Attendee, Attendee.id == Ticket.attendee_id)
        .where(Ticket.order_id == order.id)
        .order_by(Ticket.id)
    ).all()
    return [(ticket, name) for ticket, name in rows]


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
