import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, Response, status
from sqlalchemy import select

from app.api.deps import (
    EMAIL_NOT_VERIFIED_DETAIL,
    CurrentUser,
    DbSession,
    EventAccess,
    OptionalUser,
    require_event_access,
)
from app.core import qr
from app.core.clock import as_utc, utcnow
from app.core.security import create_order_token
from app.models.campaign import Campaign
from app.models.event import Event
from app.models.order import Order, OrderStatus
from app.models.ticket import TicketStatus
from app.schemas.activation import SimulatedPayment
from app.schemas.order import CheckoutRequest, CheckoutResponse, MyTicketRead, OrderRead
from app.services import calendar as calendar_service
from app.services import campaign as campaign_service
from app.services import event as event_service
from app.services import hold as hold_service
from app.services import order as order_service
from app.services import order_lifecycle
from app.services import payment as payment_service
from app.services import seating as seating_service

router = APIRouter(tags=["orders"])

ORDER_NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")

# Tickets that can still be shown at the door get a QR. A cancelled or
# refunded ticket keeps its row and its code, but no scannable image.
_SCANNABLE = (TicketStatus.VALID, TicketStatus.CHECKED_IN)

OrderToken = Annotated[str | None, Query(description="The signed link token for guests")]


def _order_event_dict(event: Event) -> dict:
    return {
        "slug": event.slug,
        "title": event.title,
        "venue_name": event.venue_name,
        "venue_address": event.venue_address,
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "timezone": event.timezone,
        "status": event.status,
        "calendar_links": calendar_service.provider_links(event),
    }


def _read(db: DbSession, order: Order) -> dict:
    tickets = [
        {
            "public_code": ticket.public_code,
            "ticket_type_id": ticket.ticket_type_id,
            "ticket_type_name": type_name,
            "status": ticket.status,
            "attendee_name": name,
            "event_seat_id": ticket.event_seat_id,
            "section_name": ticket.section_name,
            "row_label": ticket.row_label,
            "seat_number": ticket.seat_number,
            "seat_label": seating_service.format_seat_label(
                ticket.section_name, ticket.row_label, ticket.seat_number
            ),
            "qr_payload": qr.sign(
                qr.ADMISSION, ticket.public_code, ticket.event_id, ticket.qr_nonce
            )
            if ticket.status in _SCANNABLE
            else "",
        }
        for ticket, name, type_name in order_service.order_tickets(db, order)
    ]
    event = db.get(Event, order.event_id)
    # Report the lapsed hold immediately. The sweeper still releases stock and
    # persists the transition, so order reads do not mutate inventory.
    order_status = order.status
    if order_status == OrderStatus.PENDING and order.expires_at is not None:
        if as_utc(order.expires_at) <= utcnow():
            order_status = OrderStatus.EXPIRED
    body = OrderRead.model_validate(
        {
            # There are no relationship() attributes on the models, so the
            # lists and the event are loaded separately rather than read off
            # the order.
            **{
                field: getattr(order, field)
                for field in OrderRead.model_fields
                if field
                not in ("status", "items", "tickets", "event", "promo_code", "is_simulated")
            },
            "status": order_status,
            "event": _order_event_dict(event),
            "promo_code": db.scalar(select(Campaign.code).where(Campaign.id == order.campaign_id))
            if order.campaign_id
            else None,
            "is_simulated": order_service.order_is_simulated(db, order),
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
def checkout(
    slug: str,
    data: CheckoutRequest,
    user: OptionalUser,
    db: DbSession,
    access: EventAccess,
) -> dict:
    """Reserve and order in one request. Free orders come back `confirmed`
    with tickets; paid ones come back `pending`, to be paid within
    `expires_at` through POST /orders/{order_number}/pay.
    """
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Event not found")
    require_event_access(db, event, user, access)
    try:
        order = order_service.checkout(db, event, data, user)
    except order_service.EmailNotVerified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, EMAIL_NOT_VERIFIED_DETAIL) from None
    except order_service.UnknownTicketType:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Unknown ticket type for this event"
        ) from None
    except order_service.SeatSelectionRequired:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Select an event_seat_id for every attendee on assigned-seating events",
        ) from None
    except seating_service.InvalidSeatSelection as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, exc.reason) from None
    except seating_service.SeatUnavailable:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "One or more selected seats are no longer available"
        ) from None
    except hold_service.QuantityNotAllowed:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Quantity exceeds the per-order limit"
        ) from None
    except hold_service.NotOnSale as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Not on sale: {exc.reason}") from None
    except campaign_service.PromoRejected as exc:
        # §4.14 "rejected with a clear message": the reason, not "invalid code".
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    except hold_service.SoldOut:
        # Expected even when the page said tickets were available: someone
        # else's checkout landed first. The frontend shows "sold out".
        raise HTTPException(status.HTTP_409_CONFLICT, "Sold out") from None
    return _read(db, order) | {"access_token": create_order_token(order.id)}


@router.get("/orders/{order_number}", response_model=OrderRead)
def read_order(order_number: str, db: DbSession, user: OptionalUser, token: OrderToken = None):
    return _read(db, _viewable(db, order_number, user, token))


@router.get(
    "/orders/{order_number}/calendar.ics",
    response_class=Response,
    responses={200: {"content": {"text/calendar": {}}}},
)
def order_calendar(
    order_number: str, db: DbSession, user: OptionalUser, token: OrderToken = None
) -> Response:
    """Download the same event calendar as an order owner or signed-link holder."""
    order = _viewable(db, order_number, user, token)
    event = db.get(Event, order.event_id)
    if event is None:
        raise ORDER_NOT_FOUND
    return Response(
        calendar_service.build(event),
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{event.slug}.ics"',
            "Cache-Control": "private, no-store",
        },
    )


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
    except campaign_service.PromoRejected as exc:
        # The code ran out or was disabled while the buyer was paying. The
        # charge rolled back with everything else; the order is cancelled so
        # its tickets go back on sale rather than waiting out the hold.
        db.rollback()
        order_lifecycle.cancel_pending(db, order, user)
        db.commit()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{exc.reason}. Nothing was charged; please order again."
        ) from None
    except payment_service.SalesSuspended as exc:
        # T13: an admin stopped sales between reservation and payment. Nothing
        # was charged. Cancel the order so its holds return to inventory now
        # rather than when the sweeper finds them in ten minutes.
        db.rollback()
        try:
            order_lifecycle.cancel_pending(db, order, user)
            db.commit()
        except order_lifecycle.IllegalOrderTransition:
            # A double-click: the first request already cancelled it. The
            # buyer should still read "suspended", not a 500.
            db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"{exc.reason}. Nothing was charged."
        ) from None
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
    """Cancel a pending order (abandoning checkout) OR self-cancel a confirmed
    free registration (§4.9). Confirmed paid orders are refunded by the organizer."""
    order = _viewable(db, order_number, user, token)
    try:
        if order.status == OrderStatus.CONFIRMED and order.total_minor == 0:
            order_lifecycle.cancel_registration(db, order, user, self_cancelled=True)
        else:
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


@router.get("/users/me/tickets", response_model=list[MyTicketRead])
def list_my_tickets(user: CurrentUser, db: DbSession) -> list[dict]:
    """Every ticket belonging to the signed-in user, including gifted/group tickets."""
    return [
        MyTicketRead.model_validate(
            {
                "public_code": ticket.public_code,
                "ticket_type_id": ticket.ticket_type_id,
                "ticket_type_name": tt.name,
                "status": ticket.status,
                "attendee_name": attendee.full_name,
                "event_seat_id": ticket.event_seat_id,
                "section_name": ticket.section_name,
                "row_label": ticket.row_label,
                "seat_number": ticket.seat_number,
                "seat_label": seating_service.format_seat_label(
                    ticket.section_name, ticket.row_label, ticket.seat_number
                ),
                "qr_payload": qr.sign(
                    qr.ADMISSION, ticket.public_code, ticket.event_id, ticket.qr_nonce
                )
                if ticket.status in _SCANNABLE
                else "",
                "order_number": order.order_number,
                "event_id": ticket.event_id,
                "event": _order_event_dict(event),
                "issued_at": ticket.issued_at,
            }
        ).model_dump()
        for ticket, attendee, tt, order, event in order_service.list_user_tickets(db, user)
    ]
