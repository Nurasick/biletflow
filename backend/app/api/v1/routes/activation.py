from dataclasses import asdict

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentUser, DbSession, OwnedEvent
from app.models.activation import EventActivation
from app.models.event import Event
from app.schemas.activation import ActivationRead, SimulatedPayment
from app.services import activation as activation_service
from app.services import payment_provider

router = APIRouter(tags=["paid sales activation"])


def activation_body(db: DbSession, event: Event, activation: EventActivation) -> dict:
    return {
        "status": activation.status,
        "activation_fee_minor": activation.activation_fee_minor,
        "currency": activation.currency,
        "is_simulated": payment_provider.IS_SIMULATED,
        "terms_accepted_at": activation.terms_accepted_at,
        "activated_at": activation.activated_at,
        "suspended_at": activation.suspended_at,
        "suspension_reason": activation.suspension_reason,
        "checklist": asdict(activation_service.checklist(db, event, activation)),
    }


@router.get("/organizer/events/{event_id}/activation", response_model=ActivationRead)
def read_activation(event: OwnedEvent, db: DbSession) -> dict:
    """The activation checklist (§4.5). Starts a pending activation on first view."""
    activation = activation_service.get_or_start(db, event)
    db.commit()
    return activation_body(db, event, activation)


@router.post("/organizer/events/{event_id}/activation/terms", response_model=ActivationRead)
def accept_terms(event: OwnedEvent, user: CurrentUser, db: DbSession) -> dict:
    """§3.2 step 5: accept the paid-event terms."""
    activation = activation_service.get_or_start(db, event)
    activation_service.accept_terms(db, activation, user)
    db.commit()
    return activation_body(db, event, activation)


@router.post("/organizer/events/{event_id}/activation/fee", response_model=ActivationRead)
def pay_fee(event: OwnedEvent, data: SimulatedPayment, user: CurrentUser, db: DbSession) -> dict:
    """§3.2 step 3: pay the activation fee, simulated. A decline answers 402."""
    activation = activation_service.get_or_start(db, event)
    try:
        payment = activation_service.pay_fee(db, activation, user, data.outcome)
    except activation_service.IllegalActivationTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    db.commit()
    if payment.failure_reason:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, payment.failure_reason)
    return activation_body(db, event, activation)


@router.post("/organizer/events/{event_id}/activation/activate", response_model=ActivationRead)
def activate(event: OwnedEvent, user: CurrentUser, db: DbSession) -> dict:
    """pending -> active once every checklist item holds. Paid checkout opens
    for this event only (§4.5)."""
    activation = activation_service.get_or_start(db, event)
    try:
        activation_service.activate(db, event, activation, user)
    except activation_service.ActivationIncomplete as exc:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, {"message": "Activation incomplete", "missing": exc.missing}
        ) from None
    except activation_service.IllegalActivationTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    db.commit()
    return activation_body(db, event, activation)
