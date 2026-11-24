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
from pathlib import PurePath
from typing import Literal

from jwt import InvalidTokenError
from sqlalchemy import ColumnElement, and_, case, false, or_, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.core.security import create_support_case_token, decode_token
from app.models.audit import AuditLog
from app.models.event import Event, EventStatus
from app.models.order import Order
from app.models.organizer import OrganizerProfile
from app.models.staff import StaffAssignment
from app.models.support import (
    CaseAudience,
    CaseCategory,
    CaseStatus,
    MessageSender,
    SupportAttachment,
    SupportCase,
    SupportMessage,
)
from app.models.ticket import Ticket
from app.models.user import User, UserStatus
from app.schemas.support import CaseContext, CaseCreate, CaseUpdate
from app.services import audit, codes, notify, storage
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


class CannotEscalate(Exception):
    """Only non-escalated attendee cases can be escalated to Platform Admins."""


class AttachmentMessageNotFound(Exception):
    """The cited support message does not belong to this case."""


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

# T02 (§4.13, §4.16): the audit action for a status change on an event-linked
# case, and the entity_type it is recorded under. The web timeline filters
# and labels by this exact string, so changing it is a frontend change too.
# Payload: {"case_number", "from", "to", "by": "staff" | "requester"}.
STATUS_CHANGED = "support.status_changed"
CASE_ENTITY = "support_case"

ChangedBy = Literal["staff", "requester"]


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
    _notify_staff(
        db,
        support_case,
        "support.opened",
        {"author": support_case.contact_email, "excerpt": data.body[:200]},
    )
    _notify_requester(
        db,
        support_case,
        "support.received",
        {},
    )
    db.commit()
    db.refresh(support_case)

    token = create_support_case_token(support_case.id) if user is None else None
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
        _set_status(db, support_case, CaseStatus.IN_PROGRESS, user, "requester")
    _touch(support_case)
    _notify_staff(
        db,
        support_case,
        "support.message",
        {"author": support_case.contact_email, "excerpt": body[:200]},
    )
    db.commit()
    db.refresh(support_case)
    return support_case


# --- the staff side -----------------------------------------------------------


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def staff_scope(user: User) -> ColumnElement[bool]:
    """The cases this user may answer, as a WHERE clause.

    - Attendee cases belong to the event's organizer AND assigned event staff
      (`StaffAssignment`), plus Platform Admins once explicitly escalated.
    - Organizer cases belong to Platform Admins.
    """
    owned_events = (
        select(Event.id)
        .join(OrganizerProfile, OrganizerProfile.id == Event.organizer_profile_id)
        .where(OrganizerProfile.user_id == user.id)
    )
    assigned_events = select(StaffAssignment.event_id).where(StaffAssignment.user_id == user.id)
    attendee_cases = and_(
        SupportCase.audience == CaseAudience.ATTENDEE,
        or_(SupportCase.event_id.in_(owned_events), SupportCase.event_id.in_(assigned_events)),
    )
    if user.is_platform_admin:
        admin_cases = or_(
            SupportCase.audience == CaseAudience.ORGANIZER,
            and_(
                SupportCase.audience == CaseAudience.ATTENDEE,
                SupportCase.is_escalated.is_(True),
            ),
        )
    else:
        admin_cases = false()
    return or_(attendee_cases, admin_cases)


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
    escalated: bool | None = None,
    audience: CaseAudience | None = None,
    q: str | None = None,
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
    if escalated is not None:
        query = query.where(SupportCase.is_escalated.is_(escalated))
    if audience is not None:
        query = query.where(SupportCase.audience == audience)
    if q:
        needle = _like(q.strip())
        query = query.where(
            or_(
                SupportCase.case_number.ilike(needle, escape="\\"),
                SupportCase.contact_email.ilike(needle, escape="\\"),
            )
        )
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
    status_changed = False
    if not internal and support_case.status == CaseStatus.OPEN:
        _set_status(db, support_case, CaseStatus.IN_PROGRESS, user, "staff")
        status_changed = True
    _touch(support_case)
    if not internal:
        _notify_requester(
            db,
            support_case,
            "support.message",
            {"author": "Support team", "excerpt": body[:200]},
        )
        if status_changed:
            _notify_requester(
                db,
                support_case,
                "support.status",
                {
                    "status": STATUS_LABELS[support_case.status],
                    "status_key": support_case.status.value,
                },
            )
    db.commit()
    db.refresh(support_case)
    return support_case


def update_case(
    db: Session, support_case: SupportCase, user: User, data: CaseUpdate
) -> SupportCase:
    changes = data.model_dump(exclude_unset=True)
    assignee: User | None = None
    old_assignee_id = support_case.assigned_to_user_id
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
            _set_status(db, support_case, CaseStatus.IN_PROGRESS, user, "staff")

    target = changes.get("status")
    if target is not None and target != support_case.status:
        target = CaseStatus(target)
        if target not in STAFF_TRANSITIONS[support_case.status]:
            db.rollback()
            raise InvalidTransition(support_case.status, target)
        _set_status(db, support_case, target, user, "staff")

    _touch(support_case)

    if assignee is not None and assignee.id != user.id and assignee.id != old_assignee_id:
        # assigned_to_user_id is already the new assignee, so _notify_staff
        # picks exactly them.
        _notify_staff(db, support_case, "support.assigned", {})
    if support_case.status != old_status:
        _notify_requester(
            db,
            support_case,
            "support.status",
            {
                "status": STATUS_LABELS[support_case.status],
                "status_key": support_case.status.value,
            },
        )

    db.commit()
    db.refresh(support_case)
    return support_case


def escalate_case(db: Session, support_case: SupportCase, user: User, reason: str) -> SupportCase:
    """Escalate an attendee support case so Platform Admins can assist (§4.13)."""
    if support_case.audience != CaseAudience.ATTENDEE:
        raise CannotEscalate("Only attendee support cases can be escalated to Platform Admins")
    if support_case.is_escalated:
        raise CannotEscalate("This support case is already escalated")

    now = utcnow()
    support_case.is_escalated = True
    support_case.escalated_at = now
    support_case.escalated_by_user_id = user.id
    support_case.escalation_reason = reason
    db.add(
        SupportMessage(
            support_case_id=support_case.id,
            sender=MessageSender.SYSTEM,
            body=f"Case escalated to Platform Admins: {reason}",
        )
    )
    if support_case.event_id is not None:
        audit.record(
            db,
            action="support.escalated",
            entity_type=CASE_ENTITY,
            entity_id=support_case.id,
            event_id=support_case.event_id,
            actor=user,
            summary=f"Support case {support_case.case_number} escalated to Platform Admins",
            payload={"case_number": support_case.case_number, "reason": reason},
        )
    _touch(support_case)
    _notify_admins(
        db,
        support_case,
        "support.escalated",
        {"author": user.email, "reason": reason},
    )
    db.commit()
    db.refresh(support_case)
    return support_case


# --- attachments (Bonus §4.13) -----------------------------------------------


def add_attachment(
    db: Session,
    support_case: SupportCase,
    uploader: User | None,
    filename: str,
    data_url: str,
    *,
    support_message_id: int | None = None,
    is_staff: bool = False,
) -> SupportAttachment:
    if support_message_id is not None:
        msg = db.scalar(
            select(SupportMessage).where(
                SupportMessage.id == support_message_id,
                SupportMessage.support_case_id == support_case.id,
            )
        )
        if msg is None or (not is_staff and msg.is_internal_note):
            raise AttachmentMessageNotFound

    content, content_type = storage.decode_attachment_data_url(data_url)
    clean_name = PurePath(filename.replace("\\", "/")).name.strip() or "attachment"
    clean_name = clean_name[:255]
    key, _url = storage.save(f"support/{support_case.id}", content, content_type)

    attachment = SupportAttachment(
        support_case_id=support_case.id,
        support_message_id=support_message_id,
        uploaded_by_user_id=uploader.id if uploader is not None else None,
        filename=clean_name,
        content_type=content_type,
        size_bytes=len(content),
        storage_key=key,
    )
    db.add(attachment)
    _touch(support_case)
    try:
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(key)
        raise
    db.refresh(attachment)
    return attachment


def list_attachments(
    db: Session, support_case: SupportCase, *, include_internal: bool = False
) -> Sequence[SupportAttachment]:
    query = select(SupportAttachment).where(SupportAttachment.support_case_id == support_case.id)
    if not include_internal:
        internal_msg_ids = select(SupportMessage.id).where(
            SupportMessage.support_case_id == support_case.id,
            SupportMessage.is_internal_note.is_(True),
        )
        query = query.where(
            or_(
                SupportAttachment.support_message_id.is_(None),
                SupportAttachment.support_message_id.notin_(internal_msg_ids),
            )
        )
    return db.scalars(query.order_by(SupportAttachment.created_at, SupportAttachment.id)).all()


def get_attachment(
    db: Session, support_case: SupportCase, attachment_id: int, *, include_internal: bool = False
) -> SupportAttachment | None:
    query = select(SupportAttachment).where(
        SupportAttachment.id == attachment_id,
        SupportAttachment.support_case_id == support_case.id,
    )
    if not include_internal:
        internal_msg_ids = select(SupportMessage.id).where(
            SupportMessage.support_case_id == support_case.id,
            SupportMessage.is_internal_note.is_(True),
        )
        query = query.where(
            or_(
                SupportAttachment.support_message_id.is_(None),
                SupportAttachment.support_message_id.notin_(internal_msg_ids),
            )
        )
    return db.scalar(query)


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


def _set_status(
    db: Session,
    support_case: SupportCase,
    status: CaseStatus,
    actor: User | None,
    by: ChangedBy,
) -> None:
    """Change status and record it twice, for two audiences.

    - A system message in the thread (§4.13 "retain the case history"), for
      whoever reads the case.
    - An audit row on the event's timeline (§4.16, T02), when the case is
      about an event, so the organizer sees support activity next to orders
      and refunds. Cases with no event have no timeline to appear on.

    Every status change in this module goes through here, the explicit staff
    moves and the implicit ones (reply, assignment, requester reopening), so
    each change writes exactly one row. Both land in the caller's transaction:
    a change that rolls back leaves neither behind.

    `actor` is None for a guest requester (signed link, no account); `by` still
    says which side moved it.
    """
    previous = support_case.status
    support_case.status = status
    support_case.resolved_at = utcnow() if status == CaseStatus.RESOLVED else None
    db.add(
        SupportMessage(
            support_case_id=support_case.id,
            sender=MessageSender.SYSTEM,
            body=f"Status changed to {STATUS_LABELS[status]}.",
        )
    )
    if support_case.event_id is not None:
        audit.record(
            db,
            action=STATUS_CHANGED,
            entity_type=CASE_ENTITY,
            entity_id=support_case.id,
            event_id=support_case.event_id,
            actor=actor,
            summary=(
                f"Support case {support_case.case_number} moved from "
                f"{STATUS_LABELS[previous]} to {STATUS_LABELS[status]}"
            ),
            # Values, not labels: the frontend translates them (EN/KK/RU).
            payload={
                "case_number": support_case.case_number,
                "from": previous.value,
                "to": status.value,
                "by": by,
            },
        )


def timeline_scope(user: User) -> ColumnElement[bool]:
    """Which event-timeline rows `user` may see, as a WHERE clause on AuditLog.

    Seeing an event's timeline is not the same as seeing its support cases. A
    Platform Admin may open any timeline (§4.16 "moderation or support"), yet
    attendee cases belong to the event's organizer, not to the platform. So a
    support row shows only to someone who could open that case: as staff
    (staff_scope) or as the person who opened it. Every other row passes.
    """
    visible_cases = select(SupportCase.id).where(
        or_(staff_scope(user), SupportCase.opened_by_user_id == user.id)
    )
    return or_(AuditLog.entity_type != CASE_ENTITY, AuditLog.entity_id.in_(visible_cases))


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
    db: Session, support_case: SupportCase, template_key: str, payload: dict
) -> None:
    """A guest (no opened_by_user_id) gets only the email, no in-app notification."""
    notify.notify(
        db,
        template_key=template_key,
        payload={
            "case_number": support_case.case_number,
            "subject": support_case.category,
            "link": _requester_link(support_case, _guest_token(support_case)),
        }
        | payload,
        email=support_case.contact_email,
        user_id=support_case.opened_by_user_id,
    )


def _active_platform_admins(db: Session) -> Sequence[User]:
    return db.scalars(
        select(User).where(
            User.is_platform_admin.is_(True),
            User.status == UserStatus.ACTIVE,
        )
    ).all()


def _notify_admins(
    db: Session, support_case: SupportCase, template_key: str, payload: dict
) -> None:
    for admin_user in _active_platform_admins(db):
        notify.notify(
            db,
            template_key=template_key,
            payload={
                "case_number": support_case.case_number,
                "subject": support_case.category,
                "link": _staff_link(support_case),
            }
            | payload,
            email=admin_user.email,
            user_id=admin_user.id,
        )


def _notify_staff(db: Session, support_case: SupportCase, template_key: str, payload: dict) -> None:
    """Notify the assignee if there is one; otherwise:
    - Unassigned organizer cases fan out to all active Platform Admins.
    - Unassigned attendee cases notify the event's owner (plus active Platform
      Admins if the case has been escalated).
    """
    recipients: dict[int, User] = {}
    if support_case.assigned_to_user_id is not None:
        assignee = db.get(User, support_case.assigned_to_user_id)
        if assignee is not None:
            recipients[assignee.id] = assignee
    elif support_case.audience == CaseAudience.ORGANIZER:
        for admin_user in _active_platform_admins(db):
            recipients[admin_user.id] = admin_user
    else:
        owner_id = db.scalar(
            select(OrganizerProfile.user_id)
            .join(Event, Event.organizer_profile_id == OrganizerProfile.id)
            .where(Event.id == support_case.event_id)
        )
        if owner_id is not None:
            owner = db.get(User, owner_id)
            if owner is not None:
                recipients[owner.id] = owner
        if support_case.is_escalated:
            for admin_user in _active_platform_admins(db):
                recipients[admin_user.id] = admin_user

    for recipient in recipients.values():
        notify.notify(
            db,
            template_key=template_key,
            payload={
                "case_number": support_case.case_number,
                "subject": support_case.category,
                "link": _staff_link(support_case),
            }
            | payload,
            email=recipient.email,
            user_id=recipient.id,
        )
