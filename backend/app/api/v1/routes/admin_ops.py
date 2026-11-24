"""Platform administration beyond event moderation (§4.12).

routes/admin.py covers suspending events and paid sales. This module is the
rest of §4.12's list: searching users, orders and payments; suspending users;
reviewing reported events; monitoring refunds and payment failures;
configuring fees; promo-code activity; and CSV exports.

Every route requires `users.is_platform_admin` through CurrentAdmin. Nothing
here returns a password hash, a token, or card data (the platform never has
card data to begin with: §7).
"""

from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, func, or_, select

from app.api.deps import EVENT_NOT_FOUND, CurrentAdmin, DbSession, OptionalUser
from app.core.clock import utcnow
from app.models.activation import ActivationStatus, EventActivation
from app.models.campaign import Campaign
from app.models.dispute import Dispute, DisputeStatus
from app.models.event import Event, EventStatus
from app.models.order import Order, OrderStatus
from app.models.organizer import OrganizerProfile
from app.models.payment import Payment, PaymentStatus, Refund, RefundStatus
from app.models.payout import PayoutStatus
from app.models.platform import EventReport, ReportStatus
from app.models.support import CaseStatus, SupportCase
from app.models.ticket import Ticket
from app.models.user import User, UserStatus
from app.schemas.dispute import DisputeCreate, DisputeRead, DisputeUpdate
from app.schemas.payout import PayoutCreate, PayoutRead, PayoutUpdate
from app.services import audit, platform
from app.services import campaign as campaign_service
from app.services import dispute as dispute_service
from app.services import event as event_service
from app.services import payout as payout_service
from app.services.csv_export import csv_response

router = APIRouter(tags=["admin"])

Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]
Search = Annotated[str | None, Query(max_length=100)]


def _like(q: str) -> str:
    # Escape LIKE's wildcards so a search for "100%" means the text "100%".
    return "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


# --- overview ------------------------------------------------------------------


class Overview(BaseModel):
    users: int
    organizers: int
    events_published: int
    events_suspended: int
    orders_confirmed: int
    tickets_issued: int
    gross_minor: int
    refunds_minor: int
    payments_failed: int
    open_reports: int
    open_support_cases: int
    open_disputes: int = 0
    is_simulated: bool = True


@router.get("/admin/overview", response_model=Overview)
def overview(admin: CurrentAdmin, db: DbSession) -> dict:
    """The numbers on the admin portal's front page (§2.3 "view platform reports")."""

    def count(query) -> int:
        return int(db.scalar(query) or 0)

    return {
        "users": count(select(func.count(User.id))),
        "organizers": count(select(func.count(OrganizerProfile.id))),
        "events_published": count(
            select(func.count(Event.id)).where(Event.status == EventStatus.PUBLISHED)
        ),
        "events_suspended": count(
            select(func.count(Event.id)).where(Event.status == EventStatus.SUSPENDED)
        ),
        "orders_confirmed": count(
            select(func.count(Order.id)).where(Order.status == OrderStatus.CONFIRMED)
        ),
        "tickets_issued": count(select(func.count(Ticket.id))),
        "gross_minor": count(
            select(func.sum(Payment.amount_minor)).where(
                Payment.status.in_((PaymentStatus.SUCCEEDED, PaymentStatus.REFUNDED))
            )
        ),
        "refunds_minor": count(
            select(func.sum(Refund.amount_minor)).where(Refund.status == RefundStatus.SUCCEEDED)
        ),
        "payments_failed": count(
            select(func.count(Payment.id)).where(Payment.status == PaymentStatus.FAILED)
        ),
        "open_reports": count(
            select(func.count(EventReport.id)).where(EventReport.status == ReportStatus.OPEN)
        ),
        "open_support_cases": count(
            select(func.count(SupportCase.id)).where(SupportCase.status != CaseStatus.RESOLVED)
        ),
        "open_disputes": count(
            select(func.count(Dispute.id)).where(
                Dispute.status.in_((DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW))
            )
        ),
    }


# --- users ---------------------------------------------------------------------


class AdminUser(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    first_name: str
    last_name: str
    status: str
    is_email_verified: bool
    is_platform_admin: bool
    created_at: datetime


class Reason(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


def _users(db: DbSession, q: str | None, user_status: UserStatus | None, limit: int, offset: int):
    query = select(User)
    if q:
        needle = _like(q)
        query = query.where(
            or_(
                User.email.ilike(needle, escape="\\"),
                User.first_name.ilike(needle, escape="\\"),
                User.last_name.ilike(needle, escape="\\"),
            )
        )
    if user_status is not None:
        query = query.where(User.status == user_status)
    return db.scalars(query.order_by(User.id.desc()).limit(limit).offset(offset)).all()


@router.get("/admin/users", response_model=list[AdminUser])
def search_users(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    user_status: Annotated[UserStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    offset: Offset = 0,
):
    """§4.12 "Search for users": by email, name, or account status."""
    return _users(db, q, user_status, limit, offset)


def _set_user_status(
    db: DbSession, user_id: int, admin: User, to: UserStatus, reason: str | None
) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if user.id == admin.id:
        # An admin locking themselves out would need the database to undo.
        raise HTTPException(status.HTTP_409_CONFLICT, "You cannot suspend your own account")
    if user.status != to:
        user.status = to
        audit.record(
            db,
            action="user.suspended" if to == UserStatus.SUSPENDED else "user.unsuspended",
            entity_type="user",
            entity_id=user.id,
            actor=admin,
            summary=f"User {user.id} {'suspended' if to == UserStatus.SUSPENDED else 'reinstated'}",
            # The reason, never the user's name or email (audit_logs is forever).
            payload={"reason": reason} if reason else None,
        )
        db.commit()
        db.refresh(user)
    return user


@router.post("/admin/users/{user_id}/suspend", response_model=AdminUser)
def suspend_user(user_id: int, data: Reason, admin: CurrentAdmin, db: DbSession) -> User:
    """§4.12 "Suspend users". A suspended account cannot sign in or act: every
    authenticated route goes through get_current_active_user."""
    return _set_user_status(db, user_id, admin, UserStatus.SUSPENDED, data.reason)


@router.post("/admin/users/{user_id}/unsuspend", response_model=AdminUser)
def unsuspend_user(user_id: int, admin: CurrentAdmin, db: DbSession) -> User:
    return _set_user_status(db, user_id, admin, UserStatus.ACTIVE, None)


# --- orders and payments ---------------------------------------------------------


class AdminOrder(BaseModel):
    order_number: str
    event_id: int
    event_title: str
    status: str
    contact_name: str
    contact_email: str
    total_minor: int
    discount_minor: int
    currency: str
    created_at: datetime


def _orders(db: DbSession, q: str | None, order_status: str | None, limit: int, offset: int):
    query = select(Order, Event.title).join(Event, Event.id == Order.event_id)
    if q:
        needle = _like(q)
        query = query.where(
            or_(
                Order.order_number.ilike(needle, escape="\\"),
                Order.contact_email.ilike(needle, escape="\\"),
                Order.contact_name.ilike(needle, escape="\\"),
                Event.title.ilike(needle, escape="\\"),
            )
        )
    if order_status:
        query = query.where(Order.status == order_status)
    return db.execute(query.order_by(Order.id.desc()).limit(limit).offset(offset)).all()


def _order_row(order: Order, title: str) -> dict:
    return {
        **{
            field: getattr(order, field)
            for field in AdminOrder.model_fields
            if field != "event_title"
        },
        "event_title": title,
    }


@router.get("/admin/orders", response_model=list[AdminOrder])
def search_orders(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    order_status: Annotated[
        Literal[
            "pending",
            "confirmed",
            "cancelled",
            "refunded",
            "partially_refunded",
            "expired",
        ]
        | None,
        Query(alias="status"),
    ] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    """§4.12 "Search for ... orders": by number, buyer or event."""
    return [
        _order_row(order, title) for order, title in _orders(db, q, order_status, limit, offset)
    ]


class AdminPayment(BaseModel):
    id: int
    purpose: str
    status: str
    amount_minor: int
    currency: str
    provider: str
    provider_ref: str | None
    is_simulated: bool
    failure_reason: str | None
    order_number: str | None
    event_id: int | None
    created_at: datetime


def _payments(db: DbSession, q: str | None, payment_status: str | None, limit: int, offset: int):
    query = select(Payment, Order.order_number, Order.event_id).outerjoin(
        Order, Order.id == Payment.order_id
    )
    if q:
        q = q.strip()
        if q.isdigit():
            # All digits is a payment id, matched exactly. As a substring it
            # would also hit 112 and 120, and every order number (BF-YYMMDD-…)
            # carrying the digit in its date.
            query = query.where(Payment.id == int(q))
        else:
            needle = _like(q)
            query = query.where(
                or_(
                    Order.order_number.ilike(needle, escape="\\"),
                    Payment.provider_ref.ilike(needle, escape="\\"),
                )
            )
    if payment_status:
        query = query.where(Payment.status == payment_status)
    return db.execute(query.order_by(Payment.id.desc()).limit(limit).offset(offset)).all()


def _payment_row(payment: Payment, order_number: str | None, order_event_id: int | None) -> dict:
    return {
        **{
            field: getattr(payment, field)
            for field in AdminPayment.model_fields
            if field not in ("order_number", "event_id")
        },
        "order_number": order_number,
        "event_id": payment.event_id or order_event_id,
    }


@router.get("/admin/payments", response_model=list[AdminPayment])
def search_payments(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    payment_status: Annotated[
        Literal["pending", "succeeded", "failed", "refunded"] | None, Query(alias="status")
    ] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    """§4.12 "Monitor refunds, disputes, and payment failures": filter by
    `status=failed` or `status=refunded`, and find one payment with `q`: its
    id, its order's number, or its provider reference. Every row is a
    simulated payment and says so (§4.6)."""
    return [_payment_row(*row) for row in _payments(db, q, payment_status, limit, offset)]


class AdminRefund(BaseModel):
    id: int
    order_number: str
    event_id: int
    amount_minor: int
    currency: str
    status: str
    reason: str
    created_at: datetime


def _refunds(
    db: DbSession, q: str | None, refund_status: RefundStatus | None, limit: int, offset: int
):
    query = select(Refund, Order.order_number, Order.event_id).join(
        Order, Order.id == Refund.order_id
    )
    if q:
        needle = _like(q)
        query = query.where(
            or_(
                Order.order_number.ilike(needle, escape="\\"),
                Refund.reason.ilike(needle, escape="\\"),
            )
        )
    if refund_status is not None:
        query = query.where(Refund.status == refund_status)
    return db.execute(query.order_by(Refund.id.desc()).limit(limit).offset(offset)).all()


@router.get("/admin/refunds", response_model=list[AdminRefund])
def list_refunds(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    refund_status: Annotated[RefundStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    return [_refund_row(*row) for row in _refunds(db, q, refund_status, limit, offset)]


def _refund_row(refund: Refund, order_number: str, event_id: int) -> dict:
    return {
        "id": refund.id,
        "order_number": order_number,
        "event_id": event_id,
        "amount_minor": refund.amount_minor,
        "currency": refund.currency,
        "status": refund.status,
        "reason": refund.reason,
        "created_at": refund.created_at,
    }


class PaymentOrder(BaseModel):
    order_number: str
    status: str
    event_id: int
    event_title: str
    contact_name: str
    contact_email: str
    total_minor: int
    currency: str
    created_at: datetime


class PaymentCase(BaseModel):
    """A support case about the payment's order: its existence and state only.

    Attendee cases are read by the attendee and the event's organizer
    (06-support.md, "Authorization"); an admin reviewing a payment learns that
    a case exists and where it stands, never what was written in it.
    """

    model_config = ConfigDict(from_attributes=True)

    case_number: str
    audience: str
    category: str
    status: str
    created_at: datetime
    updated_at: datetime
    resolved_at: datetime | None


class AdminPaymentDetail(AdminPayment):
    order: PaymentOrder | None
    refunds: list[AdminRefund]
    support_cases: list[PaymentCase]


@router.get("/admin/payments/{payment_id}", response_model=AdminPaymentDetail)
def read_payment(payment_id: int, admin: CurrentAdmin, db: DbSession) -> dict:
    """§4.12: one simulated payment with its order, its refunds and the
    support cases about that order, to judge a payment complaint. Activation
    fees have no order, so they come back with no order and no cases."""
    row = db.execute(
        select(Payment, Order.order_number, Order.event_id)
        .outerjoin(Order, Order.id == Payment.order_id)
        .where(Payment.id == payment_id)
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    payment = row[0]

    order = None
    cases: list[SupportCase] = []
    if payment.order_id is not None:
        order_row, title = db.execute(
            select(Order, Event.title)
            .join(Event, Event.id == Order.event_id)
            .where(Order.id == payment.order_id)
        ).one()
        order = _order_row(order_row, title)
        cases = list(
            db.scalars(
                select(SupportCase)
                .where(SupportCase.order_id == payment.order_id)
                .order_by(SupportCase.created_at, SupportCase.id)
            )
        )

    refunds = db.execute(
        select(Refund, Order.order_number, Order.event_id)
        .join(Order, Order.id == Refund.order_id)
        .where(Refund.payment_id == payment.id)
        .order_by(Refund.id)
    ).all()

    return {
        **_payment_row(*row),
        "order": order,
        "refunds": [_refund_row(*refund_row) for refund_row in refunds],
        "support_cases": cases,
    }


class AdminActivation(BaseModel):
    event_id: int
    event_title: str
    status: str
    activation_fee_minor: int
    fee_paid: bool
    activated_at: datetime | None
    suspension_reason: str | None


def _activations(
    db: DbSession,
    q: str | None,
    activation_status: ActivationStatus | None,
    limit: int,
    offset: int,
):
    query = select(EventActivation, Event.title).join(Event, Event.id == EventActivation.event_id)
    if q:
        needle = _like(q)
        query = query.where(
            or_(Event.title.ilike(needle, escape="\\"), Event.slug.ilike(needle, escape="\\"))
        )
    if activation_status is not None:
        query = query.where(EventActivation.status == activation_status)
    return db.execute(query.order_by(EventActivation.id.desc()).limit(limit).offset(offset)).all()


@router.get("/admin/activations", response_model=list[AdminActivation])
def list_activations(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    activation_status: Annotated[ActivationStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    """§4.12 "Inspect paid-sales activation records", across all events."""
    rows = _activations(db, q, activation_status, limit, offset)
    return [
        {
            "event_id": activation.event_id,
            "event_title": title,
            "status": activation.status,
            "activation_fee_minor": activation.activation_fee_minor,
            "fee_paid": activation.payment_id is not None,
            "activated_at": activation.activated_at,
            "suspension_reason": activation.suspension_reason,
        }
        for activation, title in rows
    ]


class AdminCampaign(BaseModel):
    id: int
    event_id: int
    event_title: str
    name: str
    code: str
    is_active: bool
    redemptions: int
    orders: int
    discount_minor: int
    net_minor: int


@router.get("/admin/campaigns", response_model=list[AdminCampaign])
def promo_activity(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    is_active: bool | None = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    """§4.12 "Review ... promotional-code activity" across the platform."""
    query = select(Campaign, Event.title).join(Event, Event.id == Campaign.event_id)
    if q:
        needle = _like(q)
        query = query.where(
            or_(
                Campaign.name.ilike(needle, escape="\\"),
                Campaign.code.ilike(needle, escape="\\"),
                Event.title.ilike(needle, escape="\\"),
            )
        )
    if is_active is not None:
        query = query.where(Campaign.is_active.is_(is_active))
    rows = db.execute(query.order_by(Campaign.id.desc()).limit(limit).offset(offset)).all()
    result = []
    for campaign, title in rows:
        stats = campaign_service.stats(db, campaign)
        result.append(
            {
                "id": campaign.id,
                "event_id": campaign.event_id,
                "event_title": title,
                "name": campaign.name,
                "code": campaign.code,
                "is_active": campaign.is_active,
                "redemptions": stats["redemptions"],
                "orders": stats["orders"],
                "discount_minor": stats["discount_minor"],
                "net_minor": stats["net_minor"],
            }
        )
    return result


# --- disputes (§4.12) ------------------------------------------------------------


@router.get("/admin/disputes", response_model=list[DisputeRead])
def list_disputes(
    admin: CurrentAdmin,
    db: DbSession,
    dispute_status: Annotated[DisputeStatus | None, Query(alias="status")] = None,
    q: Search = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    """§4.12: monitor payment and order disputes across the platform."""
    return dispute_service.list_disputes(db, status=dispute_status, q=q, limit=limit, offset=offset)


@router.post("/admin/disputes", response_model=DisputeRead, status_code=status.HTTP_201_CREATED)
def create_dispute(data: DisputeCreate, admin: CurrentAdmin, db: DbSession) -> dict:
    try:
        return dispute_service.create_dispute(db, admin, data)
    except dispute_service.DisputeOrderNotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found") from None
    except dispute_service.DisputePaymentMismatch:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Payment does not belong to this order"
        ) from None
    except dispute_service.DisputeAmountRequired:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Provide a positive amount_minor for disputes on zero-total orders",
        ) from None


@router.get("/admin/disputes/{dispute_id}", response_model=DisputeRead)
def read_dispute(dispute_id: int, admin: CurrentAdmin, db: DbSession) -> dict:
    row = dispute_service.get_dispute(db, dispute_id)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dispute not found")
    return dispute_service.serialize(*row)


@router.patch("/admin/disputes/{dispute_id}", response_model=DisputeRead)
def update_dispute(
    dispute_id: int, data: DisputeUpdate, admin: CurrentAdmin, db: DbSession
) -> dict:
    updated = dispute_service.update_dispute(db, dispute_id, admin, data)
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dispute not found")
    return updated


# --- simulated payouts (§4.10, §4.12) -------------------------------------------


@router.get("/admin/payouts", response_model=list[PayoutRead])
def list_payouts(
    admin: CurrentAdmin,
    db: DbSession,
    payout_status: Annotated[PayoutStatus | None, Query(alias="status")] = None,
    event_id: int | None = None,
    q: Search = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    """List simulated organizer payout settlements across the platform."""
    return payout_service.list_admin_payouts(
        db, status=payout_status, event_id=event_id, q=q, limit=limit, offset=offset
    )


@router.post("/admin/payouts", response_model=PayoutRead, status_code=status.HTTP_201_CREATED)
def trigger_payout(data: PayoutCreate, admin: CurrentAdmin, db: DbSession) -> dict:
    """Initiate a simulated payout settlement for an event organizer."""
    try:
        return payout_service.create_payout(db, admin, data)
    except payout_service.PayoutEventNotFound:
        raise EVENT_NOT_FOUND from None
    except payout_service.PayoutAmountUnavailable:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "No positive remaining payout balance for this event"
        ) from None


@router.patch("/admin/payouts/{payout_id}", response_model=PayoutRead)
def update_payout(payout_id: int, data: PayoutUpdate, admin: CurrentAdmin, db: DbSession) -> dict:
    try:
        updated = payout_service.update_payout(db, payout_id, admin, data)
    except payout_service.IllegalPayoutTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payout not found")
    return updated


# --- settings --------------------------------------------------------------------


class Settings(BaseModel):
    # One-time fee to unlock paid sales for an event, KZT minor units (§3.3).
    activation_fee_minor: int
    # Processing charge in basis points: 250 = 2.5 % (§4.6).
    processing_fee_bps: int


class SettingsUpdate(BaseModel):
    activation_fee_minor: int | None = Field(default=None, ge=0)
    processing_fee_bps: int | None = Field(default=None, ge=0)


@router.get("/admin/settings", response_model=Settings)
def read_settings(admin: CurrentAdmin, db: DbSession) -> dict:
    return platform.all_settings(db)


@router.put("/admin/settings", response_model=Settings)
def update_settings(data: SettingsUpdate, admin: CurrentAdmin, db: DbSession) -> dict:
    """§4.12 "Configure activation fees and platform settings". A new fee
    applies to activations and orders started after the change; ones already
    quoted keep the amount they were quoted."""
    try:
        for key, value in data.model_dump(exclude_none=True).items():
            platform.set_int(db, key, value, admin)
    except platform.SettingOutOfRange as exc:
        db.rollback()
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"{key} {exc}") from None
    db.commit()
    return platform.all_settings(db)


# --- reported events -------------------------------------------------------------

ReportReason = Literal["fraud", "misleading", "illegal", "duplicate", "other"]


class ReportIn(BaseModel):
    reason: ReportReason
    details: str | None = Field(default=None, max_length=1000)


class ReportRead(BaseModel):
    id: int
    event_id: int
    event_title: str
    event_slug: str
    event_status: str
    reason: str
    details: str | None
    status: str
    created_at: datetime
    resolved_at: datetime | None


class ReportResolve(BaseModel):
    status: Literal["dismissed", "actioned"]


@router.post("/events/{slug}/report", status_code=status.HTTP_202_ACCEPTED)
def report_event(slug: str, data: ReportIn, user: OptionalUser, db: DbSession) -> dict:
    """Flag an event for a Platform Admin to review (§4.12). Open to guests:
    the person who spots a scam listing often has no account."""
    event = event_service.get_event_by_slug(db, slug)
    if event is None:
        raise EVENT_NOT_FOUND
    db.add(
        EventReport(
            event_id=event.id,
            reporter_user_id=user.id if user else None,
            reason=data.reason,
            details=data.details,
        )
    )
    db.commit()
    return {"detail": "Thank you. A platform administrator will review this event."}


def _report_row(report: EventReport, event: Event) -> dict:
    return {
        "id": report.id,
        "event_id": event.id,
        "event_title": event.title,
        "event_slug": event.slug,
        "event_status": event.status,
        "reason": report.reason,
        "details": report.details,
        "status": report.status,
        "created_at": report.created_at,
        "resolved_at": report.resolved_at,
    }


@router.get("/admin/reports", response_model=list[ReportRead])
def list_reports(
    admin: CurrentAdmin,
    db: DbSession,
    report_status: Annotated[
        Literal["open", "dismissed", "actioned"] | None, Query(alias="status")
    ] = None,
    limit: Limit = 50,
    offset: Offset = 0,
) -> list[dict]:
    """§4.12 "Review reported events", open ones first by default order."""
    query = select(EventReport, Event).join(Event, Event.id == EventReport.event_id)
    if report_status:
        query = query.where(EventReport.status == report_status)
    open_first = case((EventReport.status == ReportStatus.OPEN, 0), else_=1)
    rows = db.execute(
        query.order_by(open_first, EventReport.id.desc()).limit(limit).offset(offset)
    ).all()
    return [_report_row(report, event) for report, event in rows]


@router.post("/admin/reports/{report_id}/resolve", response_model=ReportRead)
def resolve_report(report_id: int, data: ReportResolve, admin: CurrentAdmin, db: DbSession) -> dict:
    """Close a report as dismissed, or as actioned after suspending the event."""
    report = db.get(EventReport, report_id)
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report not found")
    if report.status != ReportStatus.OPEN:
        raise HTTPException(status.HTTP_409_CONFLICT, "Report is already resolved")
    report.status = ReportStatus(data.status)
    report.resolved_by_user_id = admin.id
    report.resolved_at = utcnow()
    audit.record(
        db,
        action="report.resolved",
        entity_type="event_report",
        entity_id=report.id,
        event_id=report.event_id,
        actor=admin,
        summary=f"Event report {data.status} by a platform admin",
    )
    db.commit()
    db.refresh(report)
    return _report_row(report, db.get(Event, report.event_id))


# --- exports ---------------------------------------------------------------------


@router.get("/admin/exports/orders.csv", response_class=Response)
def export_orders(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    order_status: Annotated[
        Literal[
            "pending",
            "confirmed",
            "cancelled",
            "refunded",
            "partially_refunded",
            "expired",
        ]
        | None,
        Query(alias="status"),
    ] = None,
) -> Response:
    """§4.12 "Export basic operational reports". Capped at 10 000 rows."""
    return csv_response(
        "biletflow-orders",
        ["order", "event", "status", "buyer", "email", "total_kzt", "discount_kzt", "created_at"],
        (
            [
                order.order_number,
                title,
                order.status.value,
                order.contact_name,
                order.contact_email,
                order.total_minor / 100,
                order.discount_minor / 100,
                order.created_at.isoformat(),
            ]
            for order, title in _orders(db, q, order_status, 10_000, 0)
        ),
    )


@router.get("/admin/exports/payments.csv", response_class=Response)
def export_payments(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    payment_status: Annotated[
        Literal["pending", "succeeded", "failed", "refunded"] | None, Query(alias="status")
    ] = None,
) -> Response:
    return csv_response(
        "biletflow-payments",
        ["id", "purpose", "status", "amount_kzt", "simulated", "order", "failure", "created_at"],
        (
            [
                payment.id,
                payment.purpose.value,
                payment.status.value,
                payment.amount_minor / 100,
                "yes" if payment.is_simulated else "no",
                order_number or "",
                payment.failure_reason or "",
                payment.created_at.isoformat(),
            ]
            for payment, order_number, _ in _payments(db, q, payment_status, 10_000, 0)
        ),
    )


@router.get("/admin/exports/refunds.csv", response_class=Response)
def export_refunds(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    refund_status: Annotated[RefundStatus | None, Query(alias="status")] = None,
) -> Response:
    return csv_response(
        "biletflow-refunds",
        ["id", "order", "event_id", "status", "amount_kzt", "currency", "reason", "created_at"],
        (
            [
                refund.id,
                order_number,
                event_id,
                refund.status.value,
                refund.amount_minor / 100,
                refund.currency,
                refund.reason,
                refund.created_at.isoformat(),
            ]
            for refund, order_number, event_id in _refunds(db, q, refund_status, 10_000, 0)
        ),
    )


@router.get("/admin/exports/users.csv", response_class=Response)
def export_users(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    user_status: Annotated[UserStatus | None, Query(alias="status")] = None,
) -> Response:
    return csv_response(
        "biletflow-users",
        [
            "id",
            "email",
            "first_name",
            "last_name",
            "status",
            "email_verified",
            "platform_admin",
            "created_at",
        ],
        (
            [
                user.id,
                user.email,
                user.first_name,
                user.last_name,
                user.status.value,
                "yes" if user.is_email_verified else "no",
                "yes" if user.is_platform_admin else "no",
                user.created_at.isoformat(),
            ]
            for user in _users(db, q, user_status, 10_000, 0)
        ),
    )


@router.get("/admin/exports/events.csv", response_class=Response)
def export_events(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    event_status: Annotated[EventStatus | None, Query(alias="status")] = None,
) -> Response:
    query = select(Event)
    if q:
        needle = _like(q)
        query = query.where(
            or_(Event.title.ilike(needle, escape="\\"), Event.slug.ilike(needle, escape="\\"))
        )
    if event_status is not None:
        query = query.where(Event.status == event_status)
    events = db.scalars(query.order_by(Event.id.desc()).limit(10_000)).all()
    return csv_response(
        "biletflow-events",
        [
            "id",
            "slug",
            "title",
            "status",
            "visibility",
            "seating_mode",
            "venue_name",
            "capacity",
            "starts_at",
            "created_at",
        ],
        (
            [
                event.id,
                event.slug,
                event.title,
                event.status.value,
                event.visibility.value,
                event.seating_mode.value,
                event.venue_name,
                event.capacity if event.capacity is not None else "",
                event.starts_at.isoformat(),
                event.created_at.isoformat(),
            ]
            for event in events
        ),
    )


@router.get("/admin/exports/activations.csv", response_class=Response)
def export_activations(
    admin: CurrentAdmin,
    db: DbSession,
    q: Search = None,
    activation_status: Annotated[ActivationStatus | None, Query(alias="status")] = None,
) -> Response:
    return csv_response(
        "biletflow-activations",
        [
            "event_id",
            "event_title",
            "status",
            "activation_fee_kzt",
            "fee_paid",
            "activated_at",
            "suspension_reason",
        ],
        (
            [
                activation.event_id,
                title,
                activation.status.value,
                activation.activation_fee_minor / 100,
                "yes" if activation.payment_id is not None else "no",
                activation.activated_at.isoformat() if activation.activated_at else "",
                activation.suspension_reason or "",
            ]
            for activation, title in _activations(db, q, activation_status, 10_000, 0)
        ),
    )
