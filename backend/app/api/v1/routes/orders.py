import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, status

from app.api.deps import CurrentUser, DbSession, OptionalUser
from app.core import qr
from app.core.security import create_order_token
from app.models.event import Event
from app.models.order import Order
from app.models.ticket import TicketStatus
from app.schemas.activation import SimulatedPayment
from app.schemas.order import CheckoutRequest, CheckoutResponse, OrderRead
from app.services import event as event_service
from app.services import hold as hold_service
from app.services import order as order_service
from app.services import order_lifecycle
from app.services import payment as payment_service

router = APIRouter(tags=["orders"])

ORDER_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")

# Tickets that can still be shown at the door get a QR. A cancelled or
# refunded ticket keeps its row and its code, but no scannable image.
_SCANNABLE = (TicketStatus.VALID, TicketStatus.CHECKED_IN)

OrderToken = Annotated[str | None, Query(description="The signed link token for guests")]


def _read(db: DbSession, order: Order) -> dict:
    tickets = [
        {
            "public_code": ticket.public_code,
            "ticket_type_id": ticket.ticket_type_id,
            "ticket_type_name": type_name,
            "status": ticket.status,
            "attendee_name": name,
            "qr_payload": qr.sign(
                qr.ADMISSION, ticket.public_code, ticket.event_id, ticket.qr_nonce
            )
            if ticket.status in _SCANNABLE
            else "",
        }
        for ticket, name, type_name in order_service.order_tickets(db, order)
    ]
    body = OrderRead.model_validate(
        {
            # There are no relationship() attributes on the models, so the
            # lists and the event are loaded separately rather than read off
            # the order.
            **{
                field: getattr(order, field)
                for field in OrderRead.model_fields
                if field not in ("items", "tickets", "event")
            },
            "event": db.get(Event, order.event_id),
            "items": order_service.order_items(db, order),
            "tickets": tickets,
        }
    )
    return body.model_dump()


def _viewable(db: DbSession, order_number: str, user, token: str | None) -> Order:
    order = order_service.get_order_by_number(db, order_number)
    # Missing and not-yours are the same 404, so order numbers cannot be probed.
    if order is None or not order_service.can_view(order, user, token):
        raise ORDER_NOT_FOUND
    return order


@router.post(
    "/events/{slug}/orders",
    response_model=CheckoutResponse,
    status_code=status.HTTP_201_CREATED,
)
def checkout(slug: str, data: CheckoutRequest, user: OptionalUser, db: DbSession) -> dict:
    """Reserve and order in one request. Free orders come back `confirmed`
    with tickets; paid ones come back `pending`, to be paid within
    `expires_at` through POST /orders/{order_number}/pay.
    """
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    try:
        order = order_service.checkout(db, event, data, user)
    except order_service.UnknownTicketType:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown ticket type for this event"
        ) from None
    except hold_service.QuantityNotAllowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Quantity exceeds the per-order limit"
        ) from None
    except hold_service.NotOnSale as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Not on sale: {exc.reason}") from None
    except hold_service.SoldOut:
        # Expected even when the page said tickets were available: someone
        # else's checkout landed first. The frontend shows "sold out".
        raise HTTPException(status.HTTP_409_CONFLICT, "Sold out") from None
    return _read(db, order) | {"access_token": create_order_token(order.id)}


@router.get("/orders/{order_number}", response_model=OrderRead)
def read_order(order_number: str, db: DbSession, user: OptionalUser, token: OrderToken = None):
    return _read(db, _viewable(db, order_number, user, token))


@router.post("/orders/{order_number}/pay", response_model=OrderRead)
def pay_order(
    order_number: str,
    data: SimulatedPayment,
    db: DbSession,
    user: OptionalUser,
    token: OrderToken = None,
    idempotency_key: Annotated[str | None, Header(max_length=64)] = None,
) -> dict:
    """Pay a pending order through the simulated provider (§4.6).

    Send the same `Idempotency-Key` header when retrying: a repeated request
    returns the first result and charges nothing (state-machines.md §4).
    A declined payment answers 402 and cancels the order, releasing its tickets.
    """
    order = _viewable(db, order_number, user, token)
    key = idempotency_key or f"order-{order.id}-{uuid.uuid4().hex}"
    try:
        payment = payment_service.pay_order(db, order, data.outcome, key, user)
    except payment_service.IdempotencyKeyReused:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This Idempotency-Key was used for another order"
        ) from None
    except order_lifecycle.IllegalOrderTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    except order_service.OrderNotPending:
        # A concurrent request confirmed or cancelled it first.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "The order is no longer pending") from None
    except (payment_service.ReservationExpired, order_service.HoldLapsed):
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, "The reservation expired before payment; nothing was charged"
        ) from None
    db.commit()
    db.refresh(order)
    if payment.failure_reason:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, payment.failure_reason)
    return _read(db, order)


@router.post("/orders/{order_number}/cancel", response_model=OrderRead)
def cancel_order(
    order_number: str, db: DbSession, user: OptionalUser, token: OrderToken = None
) -> dict:
    """The buyer abandons a pending order; its tickets go back on sale now
    instead of when the hold times out. Confirmed orders are cancelled or
    refunded by the organizer (§4.9), not here."""
    order = _viewable(db, order_number, user, token)
    try:
        order_lifecycle.cancel_pending(db, order, user)
    except order_lifecycle.IllegalOrderTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    db.commit()
    db.refresh(order)
    return _read(db, order)


@router.get("/users/me/orders", response_model=list[OrderRead])
def list_my_orders(user: CurrentUser, db: DbSession) -> list[dict]:
    return [_read(db, order) for order in order_service.list_user_orders(db, user)]
