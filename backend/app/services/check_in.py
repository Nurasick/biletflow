"""Ticket verification at the door (§4.8; docs/data-model/04-checkin.md).

The scan follows qr-codes.md#verification-order-at-the-scanner step by step.
Authorization (step 4, is this admin assigned to the event) happens in the
route dependency before any of this runs.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from app.core import qr
from app.models.attendee import Attendee
from app.models.check_in import CheckInAction, CheckInRecord
from app.models.event import Event
from app.models.staff import StaffAssignment
from app.models.ticket import Ticket, TicketStatus
from app.models.ticket_type import TicketType
from app.models.user import User
from app.services import audit


class Outcome(StrEnum):
    """§4.8: "a clear valid, invalid, cancelled, refunded, or already-used result".
    Five answers, not a boolean, because each sends the door staff somewhere
    different. wrong_event is invalid with a reason the operator can act on."""

    VALID = "valid"
    INVALID = "invalid"
    WRONG_EVENT = "wrong_event"
    CANCELLED = "cancelled"
    REFUNDED = "refunded"
    ALREADY_USED = "already_used"


_BY_STATUS = {
    TicketStatus.CANCELLED: Outcome.CANCELLED,
    TicketStatus.REFUNDED: Outcome.REFUNDED,
    TicketStatus.CHECKED_IN: Outcome.ALREADY_USED,
}


@dataclass(frozen=True)
class ScanResult:
    outcome: Outcome
    ticket: Ticket | None = None
    attendee_name: str | None = None
    ticket_type_name: str | None = None


class TicketNotFound(Exception):
    """No ticket with this code on this event."""


class NotCheckedIn(Exception):
    """Only a checked-in ticket can have its check-in reversed."""


def can_staff(db: Session, event: Event, user: User, organizer_user_id: int | None) -> bool:
    """§4.8 "view only assigned events": a staff_assignments row for this event.

    The event's own organizer counts as staff too. Making them assign
    themselves before they can open their own door would be ceremony, and
    the permission matrix already lets them do far more to this event.
    """
    if organizer_user_id == user.id:
        return True
    return (
        db.scalar(
            select(StaffAssignment.id).where(
                StaffAssignment.event_id == event.id, StaffAssignment.user_id == user.id
            )
        )
        is not None
    )


def scan(db: Session, event: Event, admin: User, payload: str, device: str | None) -> ScanResult:
    claims = qr.verify(payload)
    # Step 1, signature. Anything forged, altered or not ours ends here.
    if claims is None:
        return ScanResult(Outcome.INVALID)
    # Step 2, type. A campaign QR is genuinely signed and still never admits
    # anyone: this line is the §11 success criterion.
    if claims.typ != qr.ADMISSION:
        return ScanResult(Outcome.INVALID)
    # Step 3, event, still without touching the database.
    if claims.event_id != event.id:
        return ScanResult(Outcome.WRONG_EVENT)
    ticket = db.scalar(
        select(Ticket).where(Ticket.public_code == claims.public_code, Ticket.event_id == event.id)
    )
    # A rotated nonce voids the old QR while the ticket keeps its identity.
    if ticket is None or ticket.qr_nonce != claims.nonce:
        return ScanResult(Outcome.INVALID)
    return admit(db, event, ticket, admin, device)


def admit(db: Session, event: Event, ticket: Ticket, admin: User, device: str | None) -> ScanResult:
    """Step 5. Also the manual path, after a search by name or code (§4.8)."""
    # Conditional UPDATE, never read-then-write: the same ticket scanned at two
    # doors at once must admit one person (concurrency.md, check-in).
    flipped = db.execute(
        update(Ticket)
        .where(Ticket.id == ticket.id, Ticket.status == TicketStatus.VALID)
        .values(status=TicketStatus.CHECKED_IN)
        .execution_options(synchronize_session=False)
    )
    db.refresh(ticket)
    if flipped.rowcount == 0:
        # Nothing changed, so nothing is written (04-checkin.md: rejected scans
        # stay out of check_in_records). Report precisely why.
        return describe(db, _BY_STATUS.get(ticket.status, Outcome.INVALID), ticket)
    _write(db, event, ticket, admin, CheckInAction.CHECK_IN, device)
    db.commit()
    db.refresh(ticket)
    return describe(db, Outcome.VALID, ticket)


def reverse(db: Session, event: Event, ticket: Ticket, admin: User, device: str | None) -> Ticket:
    """Undo an accidental check-in (§4.8). A new row, never a deletion."""
    flipped = db.execute(
        update(Ticket)
        .where(Ticket.id == ticket.id, Ticket.status == TicketStatus.CHECKED_IN)
        .values(status=TicketStatus.VALID)
        .execution_options(synchronize_session=False)
    )
    if flipped.rowcount == 0:
        raise NotCheckedIn
    _write(db, event, ticket, admin, CheckInAction.REVERSE, device)
    db.commit()
    db.refresh(ticket)
    return ticket


def find_ticket(db: Session, event: Event, public_code: str) -> Ticket:
    ticket = db.scalar(
        select(Ticket).where(Ticket.public_code == public_code.upper(), Ticket.event_id == event.id)
    )
    if ticket is None:
        raise TicketNotFound
    return ticket


def counts(db: Session, event: Event) -> dict[str, int | float]:
    """§4.8 registered and checked-in; §4.15 absent and percentage. All derived
    from tickets.status and never stored. Cancelled and refunded tickets are
    not people anyone expects, so they are not "registered"."""
    rows = dict(
        db.execute(
            select(Ticket.status, func.count())
            .where(Ticket.event_id == event.id)
            .group_by(Ticket.status)
        ).all()
    )
    checked_in = rows.get(TicketStatus.CHECKED_IN, 0)
    registered = rows.get(TicketStatus.VALID, 0) + checked_in
    return {
        "registered": registered,
        "checked_in": checked_in,
        "absent": registered - checked_in,
        "checked_in_percent": round(100 * checked_in / registered, 1) if registered else 0.0,
    }


def search(db: Session, event: Event, q: str, limit: int = 25) -> Sequence[tuple]:
    """Manual lookup by attendee name or ticket code (§4.8 "search manually")."""
    needle = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    return db.execute(
        select(Ticket, Attendee.full_name, TicketType.name)
        .join(Attendee, Attendee.id == Ticket.attendee_id)
        .join(TicketType, TicketType.id == Ticket.ticket_type_id)
        .where(
            Ticket.event_id == event.id,
            or_(
                Attendee.full_name.ilike(needle, escape="\\"),
                Ticket.public_code.ilike(needle, escape="\\"),
            ),
        )
        .order_by(Attendee.full_name, Ticket.id)
        .limit(limit)
    ).all()


def describe(db: Session, outcome: Outcome, ticket: Ticket) -> ScanResult:
    name, type_name = db.execute(
        select(Attendee.full_name, TicketType.name)
        .join(TicketType, TicketType.id == ticket.ticket_type_id)
        .where(Attendee.id == ticket.attendee_id)
    ).one()
    return ScanResult(outcome, ticket, name, type_name)


def _write(
    db: Session,
    event: Event,
    ticket: Ticket,
    admin: User,
    action: CheckInAction,
    device: str | None,
) -> None:
    db.add(
        CheckInRecord(
            ticket_id=ticket.id,
            event_id=event.id,
            action=action,
            performed_by_user_id=admin.id,
            device_info=(device or None) and device[:200],
        )
    )
    audit.record(
        db,
        action="ticket.checked_in"
        if action == CheckInAction.CHECK_IN
        else "ticket.check_in_reversed",
        entity_type="ticket",
        entity_id=ticket.id,
        event_id=event.id,
        actor=admin,
        summary=(
            f"Ticket {ticket.public_code} checked in"
            if action == CheckInAction.CHECK_IN
            else f"Check-in of ticket {ticket.public_code} reversed"
        ),
    )
