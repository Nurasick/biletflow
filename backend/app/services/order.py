from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.order import Order, OrderStatus
from app.models.ticket import Ticket, TicketStatus
from app.models.user import User
from app.schemas.order import OrderCreate


class TicketsNotAvailable(Exception):
    """One or more requested tickets are missing or no longer available."""


class OrderNotCancellable(Exception):
    """The order status does not allow cancellation."""


def create_order(db: Session, user: User, data: OrderCreate) -> Order:
    tickets = db.scalars(
        select(Ticket).where(
            Ticket.id.in_(data.ticket_ids), Ticket.status == TicketStatus.AVAILABLE
        )
    ).all()

    if len(tickets) != len(data.ticket_ids):
        raise TicketsNotAvailable

    total_amount = sum(t.price for t in tickets)
    order = Order(
        user_id=user.id,
        total_amount=total_amount,
        status=OrderStatus.PENDING,
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

    # Возвращаем связанные билеты обратно в доступные
    tickets = db.scalars(select(Ticket).where(Ticket.order_id == order.id)).all()
    for ticket in tickets:
        ticket.order_id = None
        ticket.status = TicketStatus.AVAILABLE

    db.commit()
    db.refresh(order)
    return order
