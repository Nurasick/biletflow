"""The event admin's mobile app (§4.8): assigned events, scanning, manual
check-in, reversal, live counts. Every route below /staff/events/{event_id}
goes through StaffEvent, which is step 4 of the scanner order."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.api.deps import CurrentUser, DbSession, StaffEvent
from app.core import qr
from app.models.check_in import CheckInAction, CheckInRecord
from app.models.event import Event, EventStatus
from app.models.organizer import OrganizerProfile
from app.models.staff import StaffAssignment
from app.schemas.check_in import (
    AttendanceRead,
    DeviceInfo,
    OfflineSnapshotTicket,
    OfflineSyncRequest,
    OfflineSyncResult,
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


@router.get("/staff/events/{event_id}/offline-snapshot", response_model=list[OfflineSnapshotTicket])
def offline_snapshot(
    event: StaffEvent,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, str]]:
    """Download current valid signed QR payloads for a secure offline event cache."""
    return check_in.offline_snapshot(db, event, limit, offset)


@router.post("/staff/events/{event_id}/offline-sync", response_model=list[OfflineSyncResult])
def offline_sync(
    event: StaffEvent, data: OfflineSyncRequest, user: CurrentUser, db: DbSession
) -> list[dict]:
    """Revalidate queued offline codes sequentially; every admission decision remains server-side."""
    ids = [item.client_scan_id for item in data.scans]
    if len(ids) != len(set(ids)):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "client_scan_id values must be unique")
    results = []
    for item in data.scans:
        sync_marker = f"offline:{item.client_scan_id}:{item.scanned_at.isoformat()}"
        claims = qr.verify(item.qr_payload)
        if claims is None or claims.typ != qr.ADMISSION or claims.event_id != event.id or claims.public_code != item.public_code:
            results.append({"client_scan_id": item.client_scan_id, "outcome": "invalid", "ticket": None})
            continue
        try:
            ticket = check_in.find_ticket(db, event, item.public_code)
        except check_in.TicketNotFound:
            results.append({"client_scan_id": item.client_scan_id, "outcome": "invalid", "ticket": None})
            continue
        previously_synced = db.scalar(
            select(CheckInRecord).where(
                CheckInRecord.event_id == event.id,
                CheckInRecord.performed_by_user_id == user.id,
                CheckInRecord.action == CheckInAction.CHECK_IN,
                CheckInRecord.device_info == sync_marker,
            )
        )
        if previously_synced and previously_synced.ticket_id != ticket.id:
            result = check_in.describe(db, check_in.Outcome.INVALID, ticket)
        elif previously_synced:
            result = check_in.describe(db, check_in.Outcome.VALID, ticket)
        else:
            result = check_in.scan(db, event, user, item.qr_payload, sync_marker)
        results.append({"client_scan_id": item.client_scan_id, **_response(result)})
    return results


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
    """Undo an accidental check-in (§4.8). Requires organizer role or
    `can_reverse_check_in` permission on StaffAssignment."""
    if not check_in.can_reverse(db, event, user):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "You do not have permission to reverse check-ins"
        )
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
