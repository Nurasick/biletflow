from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.order import Order, OrderStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.schemas.order import OrderCreate

# How long a pending order holds its tickets before they go back on sale.
RESERVATION_TTL = timedelta(minutes=15)


class TicketsNotAvailable(Exception):
    """One or more requested tickets are missing or no longer available."""


class OrderNotCancellable(Exception):
    """The order status does not allow cancellation."""


def create_order(db: Session, user: User, data: OrderCreate) -> Order:
    now = datetime.now(UTC)
    release_expired_orders(db, now)

    # FOR UPDATE: two checkouts for the same ticket serialise here on Postgres,
    # and the second one sees it reserved. Locking in id order keeps two
    # overlapping checkouts from deadlocking each other.
    tickets = db.scalars(
        select(Ticket)
        .join(Event, Ticket.event_id == Event.id)
        .where(
            Ticket.id.in_(data.ticket_ids),
            Ticket.status == TicketStatus.AVAILABLE,
            Event.status == EventStatus.PUBLISHED,
        )
        .order_by(Ticket.id)
        .with_for_update(of=Ticket)
    ).all()

    if len(tickets) != len(data.ticket_ids):
        db.rollback()
        raise TicketsNotAvailable

    order = Order(
        user_id=user.id,
        total_amount=sum(t.price for t in tickets),
        status=OrderStatus.PENDING,
        expires_at=now + RESERVATION_TTL,
    )
    db.add(order)
    db.flush()  # Получаем order.id без коммита

    for ticket in tickets:
        ticket.order_id = order.id
        ticket.status = TicketStatus.RESERVED

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise TicketsNotAvailable from None

    db.refresh(order)
    return order


def release_expired_orders(db: Session, now: datetime) -> None:
    """Expire pending orders past their deadline and put their tickets back on sale.

    There is no background sweeper yet, so this runs lazily before every
    checkout. It flushes but does not commit: the caller's commit covers it.
    """
    expired = db.scalars(
        select(Order)
        .where(Order.status == OrderStatus.PENDING, Order.expires_at <= now)
        .with_for_update()
    ).all()
    for order in expired:
        order.status = OrderStatus.EXPIRED
        _release_tickets(db, order)
    db.flush()


def get_user_order(db: Session, user: User, order_id: int) -> Order | None:
    return db.scalar(select(Order).where(Order.id == order_id, Order.user_id == user.id))


def list_user_orders(db: Session, *, user: User, limit: int, offset: int) -> Sequence[Order]:
    return db.scalars(
        select(Order)
        .where(Order.user_id == user.id)
        .order_by(Order.created_at.desc(), Order.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()


def cancel_order(db: Session, order: Order) -> Order:
    if order.status != OrderStatus.PENDING:
        raise OrderNotCancellable

    order.status = OrderStatus.CANCELLED
    order.cancelled_at = datetime.now(UTC)
    _release_tickets(db, order)

    db.commit()
    db.refresh(order)
    return order


def _release_tickets(db: Session, order: Order) -> None:
    # Возвращаем связанные билеты обратно в доступные
    tickets = db.scalars(select(Ticket).where(Ticket.order_id == order.id)).all()
    for ticket in tickets:
        ticket.order_id = None
        ticket.status = TicketStatus.AVAILABLE
