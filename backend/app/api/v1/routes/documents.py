"""Files an attendee takes away: printable PDF tickets (§4.7, UC7) and the
calendar file (§4.11, UC6)."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select

from app.api.deps import EVENT_NOT_FOUND, DbSession, OptionalUser
from app.core import qr
from app.models.attendee import Attendee
from app.models.event import Event
from app.models.order import Order
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.services import calendar as calendar_service
from app.services import event as event_service
from app.services import order as order_service
from app.services import ticket_pdf

router = APIRouter(tags=["documents"])

OrderToken = Annotated[str | None, Query(description="The signed link token for guests")]

# A cancelled or refunded ticket admits nobody, so it is not printable.
_PRINTABLE = (TicketStatus.VALID, TicketStatus.CHECKED_IN)

_PDF = {200: {"content": {"application/pdf": {}}}}


def _printable(db: DbSession, order: Order, public_code: str | None) -> list:
    query = (
        select(Ticket, Attendee.full_name, TicketType.name)
        .join(Attendee, Attendee.id == Ticket.attendee_id)
        .join(TicketType, TicketType.id == Ticket.ticket_type_id)
        .where(Ticket.order_id == order.id, Ticket.status.in_(_PRINTABLE))
        .order_by(Ticket.id)
    )
    if public_code is not None:
        query = query.where(Ticket.public_code == public_code.upper())
    event = db.get(Event, order.event_id)
    return [
        ticket_pdf.PrintableTicket(
            public_code=ticket.public_code,
            # The same signed payload the order page draws: paper and screen
            # are one ticket and one admission (§4.7).
            qr_payload=qr.sign(qr.ADMISSION, ticket.public_code, ticket.event_id, ticket.qr_nonce),
            event_title=event.title,
            starts_at=event.starts_at,
            ends_at=event.ends_at,
            timezone=event.timezone,
            venue_name=event.venue_name,
            venue_address=event.venue_address,
            ticket_type_name=type_name,
            attendee_name=attendee_name,
            order_number=order.order_number,
        )
        for ticket, attendee_name, type_name in db.execute(query)
    ]


def _pdf(db: DbSession, order_number: str, user, token: str | None, code: str | None) -> Response:
    order = order_service.get_order_by_number(db, order_number)
    # Same rule and same 404 as reading the order: owner or signed link.
    if order is None or not order_service.can_view(order, user, token):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    tickets = _printable(db, order, code)
    if not tickets:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No valid ticket to print")
    name = code.upper() if code else order.order_number
    return Response(
        ticket_pdf.render(tickets),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="biletflow-{name}.pdf"'},
    )


@router.get("/orders/{order_number}/tickets.pdf", response_class=Response, responses=_PDF)
def order_tickets_pdf(
    order_number: str, db: DbSession, user: OptionalUser, token: OrderToken = None
) -> Response:
    """Every valid ticket of the order, one A4 page each."""
    return _pdf(db, order_number, user, token, None)


@router.get(
    "/orders/{order_number}/tickets/{public_code}.pdf", response_class=Response, responses=_PDF
)
def ticket_pdf_download(
    order_number: str, public_code: str, db: DbSession, user: OptionalUser, token: OrderToken = None
) -> Response:
    """One ticket as a print-optimized PDF (§4.7)."""
    return _pdf(db, order_number, user, token, public_code)


@router.get(
    "/events/{slug}/calendar.ics",
    response_class=Response,
    responses={200: {"content": {"text/calendar": {}}}},
)
def event_calendar(slug: str, db: DbSession) -> Response:
    """The event as an iCalendar file (§4.11). Public, like the event page;
    for a cancelled event it is the cancellation that replaces the entry."""
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise EVENT_NOT_FOUND
    return Response(
        calendar_service.build(event),
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{event.slug}.ics"'},
    )
