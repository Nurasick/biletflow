"""Platform admin moderation (§4.12). Every route requires users.is_platform_admin.

The MVP covers what §11 grades ("Administrators can suspend a suspicious
event and stop further sales") plus inspecting activations and timelines.
"""

from collections.abc import Sequence
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_, select

from app.api.deps import EVENT_NOT_FOUND, CurrentAdmin, DbSession
from app.api.v1.routes.activation import activation_body
from app.models.activation import EventActivation
from app.models.audit import AuditLog
from app.models.event import Event
from app.schemas.activation import ActivationRead
from app.schemas.event import CancelRequest, EventRead, SuspendRequest
from app.schemas.reporting import TimelineEntry
from app.services import activation as activation_service
from app.services import audit
from app.services import event_lifecycle as lifecycle

router = APIRouter(prefix="/admin", tags=["admin"])


def _event(db: DbSession, event_id: int) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise EVENT_NOT_FOUND
    return event


def _activation(db: DbSession, event: Event) -> EventActivation:
    activation = db.scalar(select(EventActivation).where(EventActivation.event_id == event.id))
    if activation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This event has no activation record")
    return activation


@router.get("/events", response_model=list[EventRead])
def search_events(
    admin: CurrentAdmin,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=100)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Sequence[Event]:
    """Every event in any status, by title or slug (§4.12 "search for events")."""
    query = select(Event)
    if q:
        needle = "%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(
            or_(Event.title.ilike(needle, escape="\\"), Event.slug.ilike(needle, escape="\\"))
        )
    return db.scalars(query.order_by(Event.id.desc()).limit(limit).offset(offset)).all()


@router.post("/events/{event_id}/suspend", response_model=EventRead)
def suspend_event(event_id: int, data: SuspendRequest, admin: CurrentAdmin, db: DbSession):
    try:
        return lifecycle.suspend(db, _event(db, event_id), admin, data.reason)
    except lifecycle.IllegalEventTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None


@router.post("/events/{event_id}/unsuspend", response_model=EventRead)
def unsuspend_event(event_id: int, admin: CurrentAdmin, db: DbSession):
    try:
        return lifecycle.lift_suspension(db, _event(db, event_id), admin)
    except lifecycle.IllegalEventTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None


@router.post("/events/{event_id}/cancel", response_model=EventRead)
def cancel_event(
    event_id: int, admin: CurrentAdmin, db: DbSession, data: CancelRequest | None = None
):
    """suspended -> cancelled (or any live event), with the same refunds as an
    organizer's cancellation."""
    try:
        return lifecycle.cancel(db, _event(db, event_id), admin, data.reason if data else None)
    except lifecycle.IllegalEventTransition as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None


@router.get("/events/{event_id}/activation", response_model=ActivationRead)
def inspect_activation(event_id: int, admin: CurrentAdmin, db: DbSession) -> dict:
    """§4.12 "Inspect paid-sales activation records"."""
    event = _event(db, event_id)
    return activation_body(db, event, _activation(db, event))


@router.post("/events/{event_id}/activation/suspend", response_model=ActivationRead)
def suspend_activation(event_id: int, data: SuspendRequest, admin: CurrentAdmin, db: DbSession):
    """§4.5: stop paid sales on suspicion of fraud. Free tickets keep working."""
    event = _event(db, event_id)
    activation = _activation(db, event)
    try:
        activation_service.suspend(db, activation, admin, data.reason)
    except activation_service.IllegalActivationTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    db.commit()
    return activation_body(db, event, activation)


@router.post("/events/{event_id}/activation/reinstate", response_model=ActivationRead)
def reinstate_activation(event_id: int, admin: CurrentAdmin, db: DbSession):
    event = _event(db, event_id)
    activation = _activation(db, event)
    try:
        activation_service.reinstate(db, activation, admin)
    except activation_service.IllegalActivationTransition as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, exc.reason) from None
    db.commit()
    return activation_body(db, event, activation)


@router.get("/events/{event_id}/timeline", response_model=list[TimelineEntry])
def event_timeline(
    event_id: int,
    admin: CurrentAdmin,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Sequence[AuditLog]:
    """§4.16: "Platform Admins may view history for moderation or support"."""
    return audit.event_timeline(db, _event(db, event_id).id, limit=limit, offset=offset)
