"""What an organizer sees and does with one event's buyers: orders,
attendees, money, the activity timeline, and cancelling or refunding orders."""

from collections.abc import Sequence
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession, OwnedEvent
from app.models.audit import AuditLog
from app.models.event import Event
from app.models.order import Order
from app.models.ticket import Ticket
from app.schemas.reporting import (
    AttendeeRow,
    EventSummary,
    OrganizerOrderRow,
    RefundRequest,
    TimelineEntry,
)
from app.services import audit, order_lifecycle, reporting

router = APIRouter(tags=["organizer reports"])

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


@router.get("/organizer/events/{event_id}/orders", response_model=list[OrganizerOrderRow])
def list_orders(event: OwnedEvent, db: DbSession, limit: Limit = 50, offset: Offset = 0):
    return [
        _order_row(order, tickets)
        for order, tickets in reporting.event_orders(db, event, limit=limit, offset=offset)
    ]


@router.get("/organizer/events/{event_id}/attendees", response_model=list[AttendeeRow])
def list_attendees(event: OwnedEvent, db: DbSession, limit: Limit = 100, offset: Offset = 0):
    return [
        {
            "public_code": ticket.public_code,
            "ticket_status": ticket.status,
            "ticket_type_name": type_name,
            "order_number": order_number,
            "full_name": attendee.full_name,
            "email": attendee.email,
            "phone": attendee.phone,
        }
        for ticket, attendee, type_name, order_number in reporting.attendees(
            db, event, limit=limit, offset=offset
        )
    ]


@router.get("/organizer/events/{event_id}/summary", response_model=EventSummary)
def event_summary(event: OwnedEvent, db: DbSession) -> dict:
    """Capacity, sales, money and attendance for one event (§4.6, §4.15)."""
    return reporting.summary(db, event)


@router.get("/organizer/events/{event_id}/timeline", response_model=list[TimelineEntry])
def event_timeline(
    event: OwnedEvent,
    db: DbSession,
    since: datetime | None = None,
    until: datetime | None = None,
    action: Annotated[list[str] | None, Query(description="Repeat to filter by several")] = None,
    limit: Limit = 100,
    offset: Offset = 0,
) -> Sequence[AuditLog]:
    """§4.16: the event's history, newest first, filterable by date range and
    activity type. Read-only: no route edits or deletes an entry."""
    return audit.event_timeline(
        db, event.id, since=since, until=until, actions=action or (), limit=limit, offset=offset
    )


def _event_order(db: DbSession, event: Event, order_number: str) -> Order:
    # Scoped by event as well as number: an organizer must not cancel another
    # event's order through the URL of their own event.
    order = db.scalar(
        select(Order).where(Order.order_number == order_number, Order.event_id == event.id)
    )
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


@router.post(
    "/organizer/events/{event_id}/orders/{order_number}/cancel", response_model=OrganizerOrderRow
)
def cancel_registration(event: OwnedEvent, order_number: str, user: CurrentUser, db: DbSession):
    """Cancel a free registration (§4.9). Its tickets become invalid at once."""
    order = _event_order(db, event, order_number)
    try:
        order_lifecycle.cancel_registration(db, order, user)
    except order_lifecycle.IllegalOrderTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    db.commit()
    return _row(db, event, order)


@router.post(
    "/organizer/events/{event_id}/orders/{order_number}/refund", response_model=OrganizerOrderRow
)
def refund_order(
    event: OwnedEvent, order_number: str, data: RefundRequest, user: CurrentUser, db: DbSession
):
    """A full refund of a paid order (§4.9, UC5), through the simulated provider."""
    order = _event_order(db, event, order_number)
    try:
        order_lifecycle.refund(db, order, user, data.reason)
    except order_lifecycle.IllegalOrderTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    except order_lifecycle.RefundFailed:
        # Keep the failed refund row and its audit entry; the order is untouched.
        db.commit()
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, "The payment provider refused the refund"
        ) from None
    db.commit()
    return _row(db, event, order)


def _row(db: DbSession, event: Event, order: Order) -> dict:
    db.refresh(order)
    tickets = db.scalar(select(func.count()).where(Ticket.order_id == order.id))
    return _order_row(order, tickets)


def _order_row(order: Order, tickets: int) -> dict:
    return {
        "order_number": order.order_number,
        "status": order.status,
        "contact_name": order.contact_name,
        "contact_email": order.contact_email,
        "total_minor": order.total_minor,
        "currency": order.currency,
        "ticket_count": tickets,
        "created_at": order.created_at,
        "confirmed_at": order.confirmed_at,
    }
