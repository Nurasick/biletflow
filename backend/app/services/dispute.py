"""Payment & order dispute management for Platform Admins (§4.12)."""

from sqlalchemy import case, or_, select
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.models.dispute import Dispute, DisputeStatus
from app.models.event import Event
from app.models.order import Order
from app.models.payment import Payment
from app.models.user import User
from app.schemas.dispute import DisputeCreate, DisputeUpdate
from app.services import audit

RESOLVED_STATUSES = frozenset(
    {
        DisputeStatus.RESOLVED_ORGANIZER,
        DisputeStatus.RESOLVED_ATTENDEE,
        DisputeStatus.CLOSED,
    }
)


class DisputeOrderNotFound(Exception):
    """The cited order does not exist."""


class DisputePaymentMismatch(Exception):
    """The cited payment does not belong to the cited order."""


class DisputeAmountRequired(Exception):
    """Free orders require an explicit positive amount_minor to open a dispute."""


def _like(q: str) -> str:
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def serialize(dispute: Dispute, order: Order, event_title: str) -> dict:
    return {
        "id": dispute.id,
        "order_id": dispute.order_id,
        "order_number": order.order_number,
        "event_id": order.event_id,
        "event_title": event_title,
        "payment_id": dispute.payment_id,
        "status": dispute.status,
        "reason": dispute.reason,
        "amount_minor": dispute.amount_minor,
        "currency": dispute.currency,
        "evidence_notes": dispute.evidence_notes,
        "resolution_notes": dispute.resolution_notes,
        "opened_by_user_id": dispute.opened_by_user_id,
        "resolved_by_user_id": dispute.resolved_by_user_id,
        "resolved_at": dispute.resolved_at,
        "created_at": dispute.created_at,
        "updated_at": dispute.updated_at,
    }


def list_disputes(
    db: Session,
    *,
    status: DisputeStatus | None = None,
    q: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    query = (
        select(Dispute, Order, Event.title)
        .join(Order, Order.id == Dispute.order_id)
        .join(Event, Event.id == Order.event_id)
    )
    if status is not None:
        query = query.where(Dispute.status == status)
    if q:
        needle = _like(q.strip())
        query = query.where(
            or_(
                Order.order_number.ilike(needle, escape="\\"),
                Order.contact_email.ilike(needle, escape="\\"),
                Event.title.ilike(needle, escape="\\"),
                Dispute.reason.ilike(needle, escape="\\"),
            )
        )
    open_first = case(
        (Dispute.status == DisputeStatus.OPEN, 0),
        (Dispute.status == DisputeStatus.UNDER_REVIEW, 1),
        else_=2,
    )
    rows = db.execute(
        query.order_by(open_first, Dispute.id.desc()).limit(limit).offset(offset)
    ).all()
    return [serialize(dispute, order, title) for dispute, order, title in rows]


def get_dispute(db: Session, dispute_id: int) -> tuple[Dispute, Order, str] | None:
    return db.execute(
        select(Dispute, Order, Event.title)
        .join(Order, Order.id == Dispute.order_id)
        .join(Event, Event.id == Order.event_id)
        .where(Dispute.id == dispute_id)
    ).first()


def create_dispute(db: Session, admin: User, data: DisputeCreate) -> dict:
    row = db.execute(
        select(Order, Event.title)
        .join(Event, Event.id == Order.event_id)
        .where(Order.order_number == data.order_number)
    ).first()
    if row is None:
        raise DisputeOrderNotFound
    order, event_title = row

    payment_id = data.payment_id
    if payment_id is not None:
        payment = db.get(Payment, payment_id)
        if payment is None or payment.order_id != order.id:
            raise DisputePaymentMismatch
    else:
        latest_payment = db.scalar(
            select(Payment.id)
            .where(Payment.order_id == order.id)
            .order_by(Payment.id.desc())
            .limit(1)
        )
        payment_id = latest_payment

    amount_minor = data.amount_minor if data.amount_minor is not None else order.total_minor
    if amount_minor <= 0:
        raise DisputeAmountRequired

    dispute = Dispute(
        order_id=order.id,
        payment_id=payment_id,
        status=DisputeStatus.OPEN,
        reason=data.reason,
        amount_minor=amount_minor,
        currency=order.currency,
        evidence_notes=data.evidence_notes,
        opened_by_user_id=admin.id,
    )
    db.add(dispute)
    db.flush()
    audit.record(
        db,
        action="dispute.opened",
        entity_type="dispute",
        entity_id=dispute.id,
        event_id=order.event_id,
        actor=admin,
        summary=f"Dispute opened for order {order.order_number}",
        payload={
            "order_number": order.order_number,
            "amount_minor": amount_minor,
            "reason": data.reason,
        },
    )
    db.commit()
    db.refresh(dispute)
    return serialize(dispute, order, event_title)


def update_dispute(db: Session, dispute_id: int, admin: User, data: DisputeUpdate) -> dict | None:
    row = get_dispute(db, dispute_id)
    if row is None:
        return None
    dispute, order, event_title = row
    changes = data.model_dump(exclude_unset=True)
    previous_status = dispute.status

    if "evidence_notes" in changes:
        dispute.evidence_notes = changes["evidence_notes"]
    if "resolution_notes" in changes:
        dispute.resolution_notes = changes["resolution_notes"]
    if "status" in changes and changes["status"] is not None:
        new_status = DisputeStatus(changes["status"])
        dispute.status = new_status
        if new_status in RESOLVED_STATUSES:
            dispute.resolved_by_user_id = admin.id
            dispute.resolved_at = utcnow()
        else:
            dispute.resolved_by_user_id = None
            dispute.resolved_at = None

    audit.record(
        db,
        action="dispute.updated",
        entity_type="dispute",
        entity_id=dispute.id,
        event_id=order.event_id,
        actor=admin,
        summary=f"Dispute #{dispute.id} updated ({previous_status.value} -> {dispute.status.value})",
        payload={
            "order_number": order.order_number,
            "from": previous_status.value,
            "to": dispute.status.value,
        },
    )
    db.commit()
    db.refresh(dispute)
    return serialize(dispute, order, event_title)
