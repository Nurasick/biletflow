"""Support cases (§4.13, 06-support.md).

Authorization lives in the WHERE clause of every query here, never in Python
after a fetch (06-support.md, "Authorization"). A case the caller may not see
is simply not returned, and the route answers 404 for it as for a missing one.

Who sees what:

| audience    | requester side            | staff side                        |
|-------------|---------------------------|-----------------------------------|
| `attendee`  | the opener, or the signed | the owner of the case's event     |
|             | link holder (guests)      |                                   |
| `organizer` | the opening organizer     | Platform Admins                   |
"""

from collections.abc import Sequence

from jwt import InvalidTokenError
from sqlalchemy import ColumnElement, and_, case, false, or_, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.security import create_support_case_token, decode_token
from app.models.event import Event, EventStatus
from app.models.order import Order
from app.models.organizer import OrganizerProfile
from app.models.support import (
    CaseAudience,
    CaseCategory,
    CaseStatus,
    MessageSender,
    SupportCase,
    SupportMessage,
)
from app.models.ticket import Ticket
from app.models.user import User
from app.schemas.support import CaseContext, CaseCreate, CaseUpdate
from app.services import codes, mailer
from app.services import order as order_service


class ContextNotFound(Exception):
    """The event, order or ticket is missing, or not the requester's to cite."""


class ContextMismatch(Exception):
    """The event, order and ticket sent together do not belong to each other."""


class ContactEmailRequired(Exception):
    """A guest opened a case without saying where to reply."""


class OrganizerProfileRequired(Exception):
    """Only organizers open cases addressed to the platform."""


class InvalidTransition(Exception):
    def __init__(self, current: CaseStatus, target: CaseStatus):
        super().__init__(current, target)
        self.current = current
        self.target = target


class InvalidAssignee(Exception):
    """The user to assign could not see the case, so could not work on it."""


# Staff moves, from state-machines.md §8. The requester's own move (a reply
# reopening the case) is in add_requester_message, not here.
STAFF_TRANSITIONS: dict[CaseStatus, set[CaseStatus]] = {
    CaseStatus.OPEN: {CaseStatus.IN_PROGRESS},
    CaseStatus.IN_PROGRESS: {CaseStatus.WAITING_FOR_CUSTOMER, CaseStatus.RESOLVED},
    CaseStatus.WAITING_FOR_CUSTOMER: {CaseStatus.RESOLVED},
    CaseStatus.RESOLVED: set(),
}

STATUS_LABELS = {
    CaseStatus.OPEN: "Open",
    CaseStatus.IN_PROGRESS: "In progress",
    CaseStatus.WAITING_FOR_CUSTOMER: "Waiting for customer",
    CaseStatus.RESOLVED: "Resolved",
}


# --- opening ------------------------------------------------------------------


def open_case(db: Session, user: User | None, data: CaseCreate) -> tuple[SupportCase, str | None]:
    """Open a case with its first message. Returns the case and, for a guest,
    the token for their signed link."""
    if user is None and data.contact_email is None:
        raise ContactEmailRequired

    if data.audience == CaseAudience.ORGANIZER:
        event_id, order_id, ticket_id = _organizer_context(db, user, data), None, None
    else:
        event_id, order_id, ticket_id = _attendee_context(db, user, data)

    now = utcnow()
    support_case = SupportCase(
        case_number=codes.new_case_number(db, now),
        audience=data.audience,
        opened_by_user_id=user.id if user is not None else None,
        contact_email=user.email if user is not None else data.contact_email,
        event_id=event_id,
        order_id=order_id,
        ticket_id=ticket_id,
        category=data.category,
        status=CaseStatus.OPEN,
    )
    db.add(support_case)
    db.flush()
    db.add(
        SupportMessage(
            support_case_id=support_case.id,
            sender=MessageSender.REQUESTER,
            author_user_id=user.id if user is not None else None,
            body=data.body,
        )
    )
    db.commit()
    db.refresh(support_case)

    token = create_support_case_token(support_case.id) if user is None else None
    _notify_requester(
        support_case,
        f"We received your support request {support_case.case_number}",
        "We will reply here and by email.",
        token,
    )
    _notify_staff(db, support_case, f"New support case {support_case.case_number}")
    return support_case, token


def _attendee_context(
    db: Session, user: User | None, data: CaseCreate
) -> tuple[int, int | None, int | None]:
    """Resolve the cited event, order and ticket, and check they are the
    requester's to cite. Deeper context fills in the shallower: a ticket
    implies its order, an order implies its event."""
    ticket: Ticket | None = None
    order: Order | None = None

    if data.ticket_code is not None:
        ticket = db.scalar(select(Ticket).where(Ticket.public_code == data.ticket_code))
        if ticket is None:
            raise ContextNotFound
        order = db.get(Order, ticket.order_id)
        if data.order_number is not None and order.order_number != data.order_number:
            raise ContextMismatch
    elif data.order_number is not None:
        order = order_service.get_order_by_number(db, data.order_number)
        if order is None:
            raise ContextNotFound

    if order is not None:
        # The same two ways in as viewing the order: owning it, or holding its
        # signed link. Anything else is the same "not found" as a bad number,
        # so cases cannot be used to probe order numbers.
        if not order_service.can_view(order, user, data.order_token):
            raise ContextNotFound
        if data.event_id is not None and data.event_id != order.event_id:
            raise ContextMismatch
        return order.event_id, order.id, ticket.id if ticket is not None else None

    # Event only: any event an attendee can open, i.e. anything but a draft.
    event = db.scalar(
        select(Event).where(Event.id == data.event_id, Event.status != EventStatus.DRAFT)
    )
    if event is None:
        raise ContextNotFound
    return event.id, None, None


def _organizer_context(db: Session, user: User | None, data: CaseCreate) -> int | None:
    if user is None:
        raise OrganizerProfileRequired
    profile = db.scalar(select(OrganizerProfile).where(OrganizerProfile.user_id == user.id))
    if profile is None:
        raise OrganizerProfileRequired
    if data.event_id is None:
        return None
    owned = db.scalar(
        select(Event.id).where(Event.id == data.event_id, Event.organizer_profile_id == profile.id)
    )
    if owned is None:
        raise ContextNotFound
    return owned


# --- the requester's side -----------------------------------------------------


def get_requester_case(
    db: Session, case_number: str, user: User | None, token: str | None, *, lock: bool = False
) -> SupportCase | None:
    """The case, if the caller opened it or holds its signed link."""
    ways_in = []
    if user is not None:
        ways_in.append(SupportCase.opened_by_user_id == user.id)
    case_id = _case_id_from_token(token)
    if case_id is not None:
        ways_in.append(SupportCase.id == case_id)
    if not ways_in:
        return None
    query = select(SupportCase).where(SupportCase.case_number == case_number, or_(*ways_in))
    return db.scalar(query.with_for_update() if lock else query)


def list_requester_cases(db: Session, user: User) -> Sequence[SupportCase]:
    return db.scalars(
        select(SupportCase)
        .where(SupportCase.opened_by_user_id == user.id)
        .order_by(SupportCase.updated_at.desc(), SupportCase.id.desc())
    ).all()


def requester_thread(db: Session, support_case: SupportCase) -> Sequence[SupportMessage]:
    # Notes are excluded here, in the query, as well as by the serializer.
    return db.scalars(
        select(SupportMessage)
        .where(
            SupportMessage.support_case_id == support_case.id,
            SupportMessage.is_internal_note.is_(False),
        )
        .order_by(SupportMessage.created_at, SupportMessage.id)
    ).all()


def add_requester_message(
    db: Session, support_case: SupportCase, user: User | None, body: str
) -> SupportCase:
    """The requester replies. Waiting on them, or already resolved, the case
    goes back to in_progress: `resolved` is not terminal (§8)."""
    db.add(
        SupportMessage(
            support_case_id=support_case.id,
            sender=MessageSender.REQUESTER,
            author_user_id=user.id if user is not None else None,
            body=body,
        )
    )
    if support_case.status in (CaseStatus.WAITING_FOR_CUSTOMER, CaseStatus.RESOLVED):
        _set_status(db, support_case, CaseStatus.IN_PROGRESS)
    _touch(support_case)
    db.commit()
    db.refresh(support_case)
    _notify_staff(db, support_case, f"New reply on support case {support_case.case_number}")
    return support_case


# --- the staff side -----------------------------------------------------------


def staff_scope(user: User) -> ColumnElement[bool]:
    """The cases this user may answer, as a WHERE clause.

    Attendee cases belong to the owner of their event: the relationship walk
    event_id -> events.organizer_profile_id -> organizer_profiles.user_id. Not
    any organizer, not anyone with a profile. Organizer cases belong to
    Platform Admins.
    """
    owned_events = (
        select(Event.id)
        .join(OrganizerProfile, OrganizerProfile.id == Event.organizer_profile_id)
        .where(OrganizerProfile.user_id == user.id)
    )
    attendee_cases = and_(
        SupportCase.audience == CaseAudience.ATTENDEE, SupportCase.event_id.in_(owned_events)
    )
    organizer_cases = (
        SupportCase.audience == CaseAudience.ORGANIZER if user.is_platform_admin else false()
    )
    return or_(attendee_cases, organizer_cases)


def get_staff_case(
    db: Session, user: User, case_number: str, *, lock: bool = False
) -> SupportCase | None:
    query = select(SupportCase).where(SupportCase.case_number == case_number, staff_scope(user))
    return db.scalar(query.with_for_update() if lock else query)


def list_staff_cases(
    db: Session,
    user: User,
    *,
    status: CaseStatus | None,
    category: CaseCategory | None,
    event_id: int | None,
    limit: int,
    offset: int,
) -> Sequence[SupportCase]:
    """The staff queue: unclaimed (`open`) cases first, then most recently
    active (06-support.md, "Staff queue")."""
    query = select(SupportCase).where(staff_scope(user))
    if status is not None:
        query = query.where(SupportCase.status == status)
    if category is not None:
        query = query.where(SupportCase.category == category)
    if event_id is not None:
        query = query.where(SupportCase.event_id == event_id)
    unclaimed_first = case((SupportCase.status == CaseStatus.OPEN, 0), else_=1)
    return db.scalars(
        query.order_by(unclaimed_first, SupportCase.updated_at.desc(), SupportCase.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()


def staff_thread(db: Session, support_case: SupportCase) -> Sequence[SupportMessage]:
    return db.scalars(
        select(SupportMessage)
        .where(SupportMessage.support_case_id == support_case.id)
        .order_by(SupportMessage.created_at, SupportMessage.id)
    ).all()


def add_staff_message(
    db: Session, support_case: SupportCase, user: User, body: str, *, internal: bool
) -> SupportCase:
    db.add(
        SupportMessage(
            support_case_id=support_case.id,
            sender=MessageSender.STAFF,
            author_user_id=user.id,
            body=body,
            is_internal_note=internal,
        )
    )
    # A note is staff talking to staff: it neither claims the case nor
    # reaches the requester.
    if not internal and support_case.status == CaseStatus.OPEN:
        _set_status(db, support_case, CaseStatus.IN_PROGRESS)
    _touch(support_case)
    db.commit()
    db.refresh(support_case)
    if not internal:
        _notify_requester(
            support_case,
            f"New reply on your support case {support_case.case_number}",
            body,
            _guest_token(support_case),
        )
    return support_case


def update_case(
    db: Session, support_case: SupportCase, user: User, data: CaseUpdate
) -> SupportCase:
    changes = data.model_dump(exclude_unset=True)
    assignee: User | None = None
    old_status = support_case.status

    if "assigned_to_user_id" in changes:
        assignee_id = changes["assigned_to_user_id"]
        if assignee_id is not None:
            assignee = db.get(User, assignee_id)
            # Assignable means able to see the case: the same scope, applied
            # to the assignee instead of the caller.
            if assignee is None or get_staff_case(db, assignee, support_case.case_number) is None:
                raise InvalidAssignee
        support_case.assigned_to_user_id = assignee_id
        # Being assigned is one of the two ways a case leaves `open` (§8).
        if assignee_id is not None and support_case.status == CaseStatus.OPEN:
            _set_status(db, support_case, CaseStatus.IN_PROGRESS)

    target = changes.get("status")
    if target is not None and target != support_case.status:
        target = CaseStatus(target)
        if target not in STAFF_TRANSITIONS[support_case.status]:
            db.rollback()
            raise InvalidTransition(support_case.status, target)
        _set_status(db, support_case, target)

    _touch(support_case)
    db.commit()
    db.refresh(support_case)

    if assignee is not None and assignee.id != user.id:
        mailer.send(
            assignee.email,
            f"Support case {support_case.case_number} was assigned to you",
            _staff_link(support_case),
        )
    if support_case.status != old_status:
        _notify_requester(
            support_case,
            f"Support case {support_case.case_number}: {STATUS_LABELS[support_case.status]}",
            f"The status of your case is now: {STATUS_LABELS[support_case.status]}.",
            _guest_token(support_case),
        )
    return support_case


# --- shared -------------------------------------------------------------------


def context(db: Session, support_case: SupportCase) -> CaseContext:
    event = db.get(Event, support_case.event_id) if support_case.event_id is not None else None
    order = db.get(Order, support_case.order_id) if support_case.order_id is not None else None
    ticket = db.get(Ticket, support_case.ticket_id) if support_case.ticket_id is not None else None
    return CaseContext(
        event_id=event.id if event is not None else None,
        event_title=event.title if event is not None else None,
        order_number=order.order_number if order is not None else None,
        ticket_code=ticket.public_code if ticket is not None else None,
    )


def _set_status(db: Session, support_case: SupportCase, status: CaseStatus) -> None:
    """Change status and leave a system message, so the history shows when
    and how it moved (§4.13 "retain the case history")."""
    support_case.status = status
    support_case.resolved_at = utcnow() if status == CaseStatus.RESOLVED else None
    db.add(
        SupportMessage(
            support_case_id=support_case.id,
            sender=MessageSender.SYSTEM,
            body=f"Status changed to {STATUS_LABELS[status]}.",
        )
    )


def _touch(support_case: SupportCase) -> None:
    # A new message changes no column of the case, so onupdate would not
    # fire. The queue sorts by updated_at, so activity has to bump it.
    support_case.updated_at = utcnow()


def _case_id_from_token(token: str | None) -> int | None:
    if token is None:
        return None
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        return None
    if payload.get("type") != "support_case":
        return None
    try:
        return int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        return None


# --- notifications (§4.10) ----------------------------------------------------
# Sent inline through the mailer, like the account emails. The notifications
# slice (07) will put its queue in front of these calls.


def _guest_token(support_case: SupportCase) -> str | None:
    if support_case.opened_by_user_id is not None:
        return None
    return create_support_case_token(support_case.id)


def _requester_link(support_case: SupportCase, token: str | None) -> str:
    link = f"{settings.PUBLIC_WEB_URL}/support/{support_case.case_number}"
    return f"{link}?token={token}" if token is not None else link


def _staff_link(support_case: SupportCase) -> str:
    return f"{settings.PUBLIC_WEB_URL}/staff/support/{support_case.case_number}"


def _notify_requester(
    support_case: SupportCase, subject: str, text: str, token: str | None
) -> None:
    mailer.send(
        support_case.contact_email, subject, f"{text}\n\n{_requester_link(support_case, token)}"
    )


def _notify_staff(db: Session, support_case: SupportCase, subject: str) -> None:
    """The assignee if there is one, else the event's owner. An unassigned
    organizer case has no single recipient: it waits in the admins' queue."""
    recipient_id = support_case.assigned_to_user_id
    if recipient_id is None and support_case.audience == CaseAudience.ATTENDEE:
        recipient_id = db.scalar(
            select(OrganizerProfile.user_id)
            .join(Event, Event.organizer_profile_id == OrganizerProfile.id)
            .where(Event.id == support_case.event_id)
        )
    if recipient_id is None:
        return
    recipient = db.get(User, recipient_id)
    if recipient is not None:
        mailer.send(recipient.email, subject, _staff_link(support_case))
