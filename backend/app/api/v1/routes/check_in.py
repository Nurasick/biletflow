"""The event admin's mobile app (§4.8): assigned events, scanning, manual
check-in, reversal, live counts. Every route below /staff/events/{event_id}
goes through StaffEvent, which is step 4 of the scanner order."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, DbSession, StaffEvent
from app.models.event import Event, EventStatus
from app.models.organizer import OrganizerProfile
from app.models.staff import StaffAssignment
from app.schemas.check_in import (
    AttendanceRead,
    DeviceInfo,
    ScannedTicket,
    ScanRequest,
    ScanResponse,
    StaffEventRead,
)
from app.services import check_in

router = APIRouter(tags=["check-in"])


def _response(result: check_in.ScanResult) -> dict:
    ticket = None
    if result.ticket is not None:
        ticket = ScannedTicket(
            public_code=result.ticket.public_code,
            status=result.ticket.status,
            attendee_name=result.attendee_name,
            ticket_type_name=result.ticket_type_name,
        )
    return {"outcome": result.outcome, "ticket": ticket}


@router.get("/staff/events", response_model=list[StaffEventRead])
def my_staff_events(user: CurrentUser, db: DbSession) -> list[dict]:
    """§4.8 "view only assigned events": those assigned to the caller, plus the
    ones they organize. Drafts are left out; nobody checks in to a draft."""
    rows = db.execute(
        select(Event, OrganizerProfile.user_id)
        .join(OrganizerProfile, OrganizerProfile.id == Event.organizer_profile_id)
        .outerjoin(
            StaffAssignment,
            (StaffAssignment.event_id == Event.id) & (StaffAssignment.user_id == user.id),
        )
        .where(
            or_(OrganizerProfile.user_id == user.id, StaffAssignment.id.is_not(None)),
            Event.status != EventStatus.DRAFT,
        )
        .order_by(Event.starts_at.desc(), Event.id.desc())
    ).all()
    return [
        {
            "id": event.id,
            "slug": event.slug,
            "title": event.title,
            "venue_name": event.venue_name,
            "starts_at": event.starts_at,
            "ends_at": event.ends_at,
            "timezone": event.timezone,
            "status": event.status,
            "role": "organizer" if owner_id == user.id else "event_admin",
        }
        for event, owner_id in rows
    ]


@router.post("/staff/events/{event_id}/scan", response_model=ScanResponse)
def scan(event: StaffEvent, data: ScanRequest, user: CurrentUser, db: DbSession) -> dict:
    """Validate a scanned QR and check the ticket in if it is valid.

    Always 200 with an `outcome`; a rejected ticket is a normal answer at a
    door, not an error. Campaign QR codes come back `invalid` (§11).
    """
    return _response(check_in.scan(db, event, user, data.qr, data.device_info))


@router.post("/staff/events/{event_id}/tickets/{public_code}/check-in", response_model=ScanResponse)
def manual_check_in(
    event: StaffEvent,
    public_code: str,
    user: CurrentUser,
    db: DbSession,
    data: DeviceInfo | None = None,
) -> dict:
    """Check in by ticket code, after a manual search (§4.8). Same rules as a scan."""
    try:
        ticket = check_in.find_ticket(db, event, public_code)
    except check_in.TicketNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found for this event") from None
    return _response(check_in.admit(db, event, ticket, user, data.device_info if data else None))


@router.post("/staff/events/{event_id}/tickets/{public_code}/reverse", response_model=ScannedTicket)
def reverse_check_in(
    event: StaffEvent,
    public_code: str,
    user: CurrentUser,
    db: DbSession,
    data: DeviceInfo | None = None,
) -> dict:
    """Undo an accidental check-in (§4.8). For the MVP every event admin who
    may check in may also reverse; the record says who did."""
    try:
        ticket = check_in.find_ticket(db, event, public_code)
        check_in.reverse(db, event, ticket, user, data.device_info if data else None)
    except check_in.TicketNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ticket not found for this event") from None
    except check_in.NotCheckedIn:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "This ticket is not checked in") from None
    return _response(check_in.describe(db, check_in.Outcome.VALID, ticket))["ticket"]


@router.get("/staff/events/{event_id}/attendance", response_model=AttendanceRead)
def attendance(event: StaffEvent, db: DbSession) -> dict:
    """§4.8 "the total number of registered and checked-in attendees"."""
    return check_in.counts(db, event)


@router.get("/staff/events/{event_id}/search", response_model=list[ScannedTicket])
def search(
    event: StaffEvent, db: DbSession, q: Annotated[str, Query(min_length=2, max_length=100)]
) -> list[dict]:
    """Find a ticket by attendee name or ticket code (§4.8 "search manually")."""
    return [
        {
            "public_code": ticket.public_code,
            "status": ticket.status,
            "attendee_name": name,
            "ticket_type_name": type_name,
        }
        for ticket, name, type_name in check_in.search(db, event, q)
    ]
