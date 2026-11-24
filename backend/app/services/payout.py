"""Simulated organizer payout settlement workflow (§4.10, §4.12)."""

import secrets

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.event import Event
from app.models.organizer import AccountStatus, OrganizerProfile, PayoutAccount
from app.models.payout import Payout, PayoutStatus
from app.models.user import User
from app.schemas.payout import PayoutCreate, PayoutUpdate
from app.services import audit, notify, reporting

PAYOUT_TRANSITIONS: dict[PayoutStatus, set[PayoutStatus]] = {
    PayoutStatus.PENDING: {PayoutStatus.PROCESSING, PayoutStatus.PAID, PayoutStatus.FAILED},
    PayoutStatus.PROCESSING: {PayoutStatus.PAID, PayoutStatus.FAILED},
    PayoutStatus.FAILED: {PayoutStatus.PENDING, PayoutStatus.PROCESSING},
    PayoutStatus.PAID: set(),
}


class PayoutEventNotFound(Exception):
    """Target event does not exist."""


class PayoutAmountUnavailable(Exception):
    """No positive remaining payout amount available for this event."""


class IllegalPayoutTransition(Exception):
    def __init__(self, current: PayoutStatus, target: PayoutStatus):
        super().__init__(f"cannot transition payout from {current.value} to {target.value}")
        self.current = current
        self.target = target


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def serialize(payout: Payout, event_title: str) -> dict:
    return {
        "id": payout.id,
        "organizer_profile_id": payout.organizer_profile_id,
        "event_id": payout.event_id,
        "event_title": event_title,
        "payout_account_id": payout.payout_account_id,
        "amount_minor": payout.amount_minor,
        "currency": payout.currency,
        "status": payout.status,
        "is_simulated": payout.is_simulated,
        "reference": payout.reference,
        "failure_reason": payout.failure_reason,
        "initiated_by_user_id": payout.initiated_by_user_id,
        "paid_at": payout.paid_at,
        "created_at": payout.created_at,
        "updated_at": payout.updated_at,
    }


def list_organizer_payouts(
    db: Session,
    organizer: OrganizerProfile,
    *,
    event_id: int | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    query = (
        select(Payout, Event.title)
        .join(Event, Event.id == Payout.event_id)
        .where(Payout.organizer_profile_id == organizer.id)
    )
    if event_id is not None:
        query = query.where(Payout.event_id == event_id)
    rows = db.execute(query.order_by(Payout.id.desc()).limit(limit).offset(offset)).all()
    return [serialize(payout, title) for payout, title in rows]


def list_admin_payouts(
    db: Session,
    *,
    status: PayoutStatus | None = None,
    event_id: int | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    query = select(Payout, Event.title).join(Event, Event.id == Payout.event_id)
    if status is not None:
        query = query.where(Payout.status == status)
    if event_id is not None:
        query = query.where(Payout.event_id == event_id)
    if q:
        needle = _like(q.strip())
        query = query.where(
            or_(
                Event.title.ilike(needle, escape="\\"),
                Payout.reference.ilike(needle, escape="\\"),
            )
        )
    rows = db.execute(query.order_by(Payout.id.desc()).limit(limit).offset(offset)).all()
    return [serialize(payout, title) for payout, title in rows]


def create_payout(db: Session, admin: User, data: PayoutCreate) -> dict:
    event = db.get(Event, data.event_id)
    if event is None:
        raise PayoutEventNotFound

    amount_minor = data.amount_minor
    if amount_minor is None:
        estimated = reporting.summary(db, event)["estimated_payout_minor"]
        already_scheduled = int(
            db.scalar(
                select(func.coalesce(func.sum(Payout.amount_minor), 0)).where(
                    Payout.event_id == event.id,
                    Payout.status != PayoutStatus.FAILED,
                )
            )
            or 0
        )
        amount_minor = estimated - already_scheduled
        if amount_minor <= 0:
            raise PayoutAmountUnavailable

    account = db.scalar(
        select(PayoutAccount)
        .where(
            PayoutAccount.organizer_profile_id == event.organizer_profile_id,
            PayoutAccount.status == AccountStatus.ACTIVE,
        )
        .order_by(PayoutAccount.id.desc())
        .limit(1)
    )
    payout = Payout(
        organizer_profile_id=event.organizer_profile_id,
        event_id=event.id,
        payout_account_id=account.id if account is not None else None,
        amount_minor=amount_minor,
        currency="KZT",
        status=PayoutStatus.PENDING,
        is_simulated=True,
        reference=data.reference or f"SIM-PO-{secrets.token_hex(6).upper()}",
        initiated_by_user_id=admin.id,
    )
    db.add(payout)
    db.flush()
    audit.record(
        db,
        action="payout.created",
        entity_type="payout",
        entity_id=payout.id,
        event_id=event.id,
        actor=admin,
        summary=f"Simulated payout #{payout.id} initiated ({payout.amount_minor} {payout.currency})",
        payload={
            "amount_minor": payout.amount_minor,
            "currency": payout.currency,
            "status": payout.status.value,
            "reference": payout.reference,
            "is_simulated": True,
        },
    )
    _notify_organizer(db, event, payout)
    db.commit()
    db.refresh(payout)
    return serialize(payout, event.title)


def update_payout(db: Session, payout_id: int, admin: User, data: PayoutUpdate) -> dict | None:
    payout = db.scalar(select(Payout).where(Payout.id == payout_id).with_for_update())
    if payout is None:
        return None
    event = db.get(Event, payout.event_id)
    target = PayoutStatus(data.status)
    previous = payout.status
    if target != previous and target not in PAYOUT_TRANSITIONS[previous]:
        raise IllegalPayoutTransition(previous, target)

    payout.status = target
    if data.reference is not None:
        payout.reference = data.reference
    if target == PayoutStatus.PAID:
        payout.paid_at = utcnow()
        payout.failure_reason = None
    elif target == PayoutStatus.FAILED:
        payout.failure_reason = data.failure_reason
    elif target in (PayoutStatus.PENDING, PayoutStatus.PROCESSING):
        payout.failure_reason = None

    audit.record(
        db,
        action="payout.status_changed",
        entity_type="payout",
        entity_id=payout.id,
        event_id=payout.event_id,
        actor=admin,
        summary=f"Simulated payout #{payout.id} moved from {previous.value} to {target.value}",
        payload={
            "from": previous.value,
            "to": target.value,
            "reference": payout.reference,
            "failure_reason": payout.failure_reason,
            "is_simulated": True,
        },
    )
    if event is not None:
        _notify_organizer(db, event, payout)
    db.commit()
    db.refresh(payout)
    return serialize(payout, event.title if event is not None else "")


def _notify_organizer(db: Session, event: Event, payout: Payout) -> None:
    owner = db.scalar(
        select(User)
        .join(OrganizerProfile, OrganizerProfile.user_id == User.id)
        .where(OrganizerProfile.id == event.organizer_profile_id)
    )
    if owner is None:
        return
    notify.notify_user(
        db,
        owner,
        "payout.status",
        {
            "event_title": event.title,
            "status": payout.status.value,
            "status_key": payout.status.value,
            "payout_id": payout.id,
            "amount_minor": payout.amount_minor,
            "reference": payout.reference or "",
            "link": notify.web_link("/organizer/profile"),
        },
    )
