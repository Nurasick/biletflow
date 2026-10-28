"""Paid-sales activation (§3.2, §4.5; docs/state-machines.md §2).

pending -> active once all five preconditions hold; active <-> suspended by a
Platform Admin. The checklist is computed, never stored: storing "fee paid"
next to the payment that proves it is how the two end up disagreeing.
"""

from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import settings
from app.models.activation import ActivationStatus, EventActivation
from app.models.event import Event
from app.models.organizer import AccountStatus, OrganizerProfile, PayoutAccount, VerificationStatus
from app.models.payment import Payment, PaymentPurpose, PaymentStatus
from app.models.ticket_type import TicketType
from app.models.user import User
from app.services import audit
from app.services import payment_provider as provider


class ActivationIncomplete(Exception):
    """A §3.2 precondition is unmet. `missing` lists which, by checklist key."""

    def __init__(self, missing: list[str]):
        super().__init__(", ".join(missing))
        self.missing = missing


class IllegalActivationTransition(Exception):
    """Not a legal move from the current status. `reason` says why."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass(frozen=True)
class Checklist:
    """§4.5 "The organizer shall see an activation checklist." Keys are stable
    identifiers the frontend translates; they are also what ActivationIncomplete
    reports as missing."""

    paid_ticket_type: bool
    organizer_verified: bool
    fee_paid: bool
    payout_account_active: bool
    terms_accepted: bool

    def missing(self) -> list[str]:
        return [key for key, met in asdict(self).items() if not met]


def is_active(db: Session, event_id: int) -> bool:
    status = db.scalar(select(EventActivation.status).where(EventActivation.event_id == event_id))
    return status == ActivationStatus.ACTIVE


def get_or_start(db: Session, event: Event) -> EventActivation:
    """The event's activation row, created as pending on first visit. Does not commit."""
    activation = db.scalar(select(EventActivation).where(EventActivation.event_id == event.id))
    if activation is None:
        activation = EventActivation(
            event_id=event.id,
            status=ActivationStatus.PENDING,
            activation_fee_minor=settings.ACTIVATION_FEE_MINOR,
            currency="KZT",
        )
        db.add(activation)
        db.flush()
    return activation


def checklist(db: Session, event: Event, activation: EventActivation) -> Checklist:
    profile = db.get(OrganizerProfile, event.organizer_profile_id)
    return Checklist(
        paid_ticket_type=db.scalar(
            select(TicketType.id).where(TicketType.event_id == event.id, TicketType.price_minor > 0)
        )
        is not None,
        organizer_verified=profile is not None
        and profile.verification_status == VerificationStatus.VERIFIED,
        fee_paid=activation.payment_id is not None,
        payout_account_active=db.scalar(
            select(PayoutAccount.id).where(
                PayoutAccount.organizer_profile_id == event.organizer_profile_id,
                PayoutAccount.status == AccountStatus.ACTIVE,
            )
        )
        is not None,
        terms_accepted=activation.terms_accepted_at is not None,
    )


def accept_terms(
    db: Session, activation: EventActivation, actor: User, now: datetime | None = None
):
    if activation.terms_accepted_at is None:
        activation.terms_accepted_at = now or utcnow()
        audit.record(
            db,
            action="activation.terms_accepted",
            entity_type="event_activation",
            entity_id=activation.id,
            event_id=activation.event_id,
            actor=actor,
            summary="Paid-event terms accepted",
        )


def pay_fee(
    db: Session, activation: EventActivation, actor: User, outcome: provider.Outcome
) -> Payment:
    """Charge the activation fee through the simulator. Paying twice is refused."""
    if activation.payment_id is not None:
        raise IllegalActivationTransition("the activation fee is already paid")
    result = provider.charge(activation.activation_fee_minor, outcome)
    payment = Payment(
        purpose=PaymentPurpose.ACTIVATION_FEE,
        event_id=activation.event_id,
        provider=provider.NAME,
        provider_ref=result.provider_ref,
        amount_minor=activation.activation_fee_minor,
        currency=activation.currency,
        status=PaymentStatus.SUCCEEDED if result.succeeded else PaymentStatus.FAILED,
        is_simulated=provider.IS_SIMULATED,
        failure_reason=result.failure_reason,
    )
    db.add(payment)
    db.flush()
    if result.succeeded:
        activation.payment_id = payment.id
    # §3.2 step 3 / §4.5 "The system shall record payment of the activation fee."
    audit.record(
        db,
        action="activation.fee_paid" if result.succeeded else "activation.fee_failed",
        entity_type="payment",
        entity_id=payment.id,
        event_id=activation.event_id,
        actor=actor,
        summary="Simulated activation fee "
        + ("paid" if result.succeeded else "payment was declined"),
        payload={"amount_minor": payment.amount_minor, "is_simulated": True},
    )
    return payment


def activate(db: Session, event: Event, activation: EventActivation, actor: User, now=None):
    """pending -> active, only when every §3.2 precondition holds."""
    missing = checklist(db, event, activation).missing()
    if missing:
        raise ActivationIncomplete(missing)
    now = now or utcnow()
    _flip(db, activation, ActivationStatus.PENDING, ActivationStatus.ACTIVE, activated_at=now)
    audit.record(
        db,
        action="activation.activated",
        entity_type="event_activation",
        entity_id=activation.id,
        event_id=event.id,
        actor=actor,
        summary="Paid sales activated",
    )


def suspend(db: Session, activation: EventActivation, admin: User, reason: str, now=None):
    """active -> suspended (§4.5: fraud or policy). Paid checkout stops at once,
    because checkout re-reads the status on every order."""
    now = now or utcnow()
    _flip(
        db,
        activation,
        ActivationStatus.ACTIVE,
        ActivationStatus.SUSPENDED,
        suspended_at=now,
        suspended_by_user_id=admin.id,
        suspension_reason=reason,
    )
    audit.record(
        db,
        action="activation.suspended",
        entity_type="event_activation",
        entity_id=activation.id,
        event_id=activation.event_id,
        actor=admin,
        summary="Paid sales suspended by a platform admin",
        payload={"reason": reason},
    )


def reinstate(db: Session, activation: EventActivation, admin: User):
    _flip(db, activation, ActivationStatus.SUSPENDED, ActivationStatus.ACTIVE)
    audit.record(
        db,
        action="activation.reinstated",
        entity_type="event_activation",
        entity_id=activation.id,
        event_id=activation.event_id,
        actor=admin,
        summary="Paid sales reinstated by a platform admin",
    )


def _flip(db: Session, activation: EventActivation, frm, to, **values) -> None:
    flipped = db.execute(
        update(EventActivation)
        .where(EventActivation.id == activation.id, EventActivation.status == frm)
        .values(status=to, **values)
        .execution_options(synchronize_session=False)
    )
    db.refresh(activation)
    if flipped.rowcount == 0:
        raise IllegalActivationTransition(
            f"expected a {frm} activation; this one is {activation.status}"
        )
