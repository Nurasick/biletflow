"""Organizer profiles, payout accounts and event staff (01-identity.md).

Being an organizer is having a profile row, not a role flag. Saving a profile
for the first time is therefore how an ordinary account becomes an organizer.
"""

from collections.abc import Sequence

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.crypto import decrypt_field, encrypt_field
from app.models.activation import ActivationStatus, EventActivation
from app.models.event import Event
from app.models.organizer import AccountStatus, OrganizerProfile, PayoutAccount, VerificationStatus
from app.models.staff import StaffAssignment
from app.models.user import User
from app.schemas.organizer import OrganizerProfileWrite
from app.services import audit, notify
from app.services import user as user_service


class UserNotFound(Exception):
    """No account has this email, so it cannot be assigned as staff."""


class AlreadyAssigned(Exception):
    """This user is already staff for this event."""


def get_profile(db: Session, user: User) -> OrganizerProfile | None:
    return db.scalar(select(OrganizerProfile).where(OrganizerProfile.user_id == user.id))


def active_payout_account(db: Session, profile: OrganizerProfile) -> PayoutAccount | None:
    return db.scalar(
        select(PayoutAccount)
        .where(
            PayoutAccount.organizer_profile_id == profile.id,
            PayoutAccount.status != AccountStatus.INACTIVE,
            PayoutAccount.deactivated_at.is_(None),
        )
        .order_by(PayoutAccount.id.desc())
    )


def save_profile(db: Session, user: User, data: OrganizerProfileWrite) -> OrganizerProfile:
    """Create or update the caller's profile, and its payout account. Commits."""
    profile = get_profile(db, user)
    is_new = profile is None
    fields = data.model_dump(exclude={"payout_provider", "payout_reference"})
    if profile is None:
        profile = OrganizerProfile(user_id=user.id, **fields)
        db.add(profile)
    else:
        for field, value in fields.items():
            setattr(profile, field, value)
    db.flush()
    payout_cleared = _sync_payout(db, profile, data.payout_provider, data.payout_reference)
    if payout_cleared:
        _pause_active_activations(db, profile, user)
    audit.record(
        db,
        action="organizer.profile_created" if is_new else "organizer.profile_updated",
        entity_type="organizer_profile",
        entity_id=profile.id,
        actor=user,
        summary="Organizer profile created" if is_new else "Organizer profile updated",
        payload={
            "has_payout_account": data.payout_provider is not None,
            "payout_provider": data.payout_provider,
            "payout_cleared": payout_cleared,
        },
    )
    db.commit()
    db.refresh(profile)
    return profile


def _sync_payout(
    db: Session, profile: OrganizerProfile, provider: str | None, reference: str | None
) -> bool:
    """Keep one active payout account per organizer, soft-deactivating replaced rows.

    Returns True when an existing active payout account was cleared without a replacement.

    §1.2 / §4.5: sandbox only. No bank details exist here, just a provider name
    and an opaque demo reference, and every row is is_simulated. A simulated
    account is accepted on the spot; a real provider would start it pending.
    """
    current = active_payout_account(db, profile)
    if provider is None:
        if current is not None:
            current.status = AccountStatus.INACTIVE
            current.deactivated_at = utcnow()
            return True
        return False
    if current is not None and (current.provider, decrypt_field(current.external_account_ref)) == (
        provider,
        reference,
    ):
        return False
    if current is not None:
        current.status = AccountStatus.INACTIVE
        current.deactivated_at = utcnow()
    db.add(
        PayoutAccount(
            organizer_profile_id=profile.id,
            provider=provider,
            external_account_ref=encrypt_field(reference) or reference,
            status=AccountStatus.ACTIVE,
            is_simulated=True,
        )
    )
    return False


def _pause_active_activations(db: Session, profile: OrganizerProfile, actor: User) -> None:
    """Pause any ACTIVE paid-sales activations when an organizer removes their payout account."""
    rows = db.execute(
        select(EventActivation, Event)
        .join(Event, Event.id == EventActivation.event_id)
        .where(
            Event.organizer_profile_id == profile.id,
            EventActivation.status == ActivationStatus.ACTIVE,
        )
    ).all()
    for activation, event in rows:
        activation.status = ActivationStatus.PENDING
        activation.activated_at = None
        audit.record(
            db,
            action="activation.paused",
            entity_type="event_activation",
            entity_id=activation.id,
            event_id=event.id,
            actor=actor,
            summary="Paid sales paused because organizer payout account was removed",
        )
        notify.notify_user(
            db,
            actor,
            "payout.status",
            {
                "event_title": event.title,
                "status": "pending",
                "status_key": "pending",
                "link": notify.web_link(f"/organizer/events/{event.id}/preview"),
            },
        )


def verify_identity(
    db: Session, profile: OrganizerProfile, actor: User | None = None
) -> OrganizerProfile:
    """Simulated identity verification (§3.2 step 2, §8 excludes real KYC).

    Accepts at once and says so: the response and the UI both carry
    `verification_is_simulated`, so it is never mistaken for a real check.
    """
    profile.verification_status = VerificationStatus.VERIFIED
    audit.record(
        db,
        action="organizer.verified",
        entity_type="organizer_profile",
        entity_id=profile.id,
        actor=actor,
        summary="Organizer identity verified (simulated)",
        payload={
            "verification_status": VerificationStatus.VERIFIED.value,
            "is_simulated": True,
        },
    )
    db.commit()
    db.refresh(profile)
    return profile


# --- staff -----------------------------------------------------------------


def list_staff(db: Session, event: Event) -> Sequence[tuple[StaffAssignment, User]]:
    return db.execute(
        select(StaffAssignment, User)
        .join(User, User.id == StaffAssignment.user_id)
        .where(StaffAssignment.event_id == event.id)
        .order_by(StaffAssignment.id)
    ).all()


def assign_staff(
    db: Session,
    event: Event,
    email: str,
    by: User,
    *,
    can_reverse_check_in: bool = True,
) -> StaffAssignment:
    user = user_service.get_user_by_email(db, email)
    if user is None:
        raise UserNotFound
    assignment = StaffAssignment(
        event_id=event.id,
        user_id=user.id,
        assigned_by_user_id=by.id,
        can_reverse_check_in=can_reverse_check_in,
    )
    db.add(assignment)
    try:
        db.flush()
    except IntegrityError:
        # The (event_id, user_id) UNIQUE constraint decides, not a prior SELECT.
        db.rollback()
        raise AlreadyAssigned from None
    audit.record(
        db,
        action="staff.assigned",
        entity_type="staff_assignment",
        entity_id=assignment.id,
        event_id=event.id,
        actor=by,
        # The user id, not the email: no personal data in the audit log.
        summary="Event admin assigned",
        payload={"user_id": user.id, "can_reverse_check_in": can_reverse_check_in},
    )
    db.commit()
    db.refresh(assignment)
    return assignment


def update_staff_permissions(
    db: Session,
    event: Event,
    user_id: int,
    *,
    can_reverse_check_in: bool,
    by: User,
) -> StaffAssignment | None:
    assignment = db.scalar(
        select(StaffAssignment).where(
            StaffAssignment.event_id == event.id, StaffAssignment.user_id == user_id
        )
    )
    if assignment is None:
        return None
    assignment.can_reverse_check_in = can_reverse_check_in
    audit.record(
        db,
        action="staff.updated",
        entity_type="staff_assignment",
        entity_id=assignment.id,
        event_id=event.id,
        actor=by,
        summary="Event admin permissions updated",
        payload={"user_id": user_id, "can_reverse_check_in": can_reverse_check_in},
    )
    db.commit()
    db.refresh(assignment)
    return assignment


def remove_staff(db: Session, event: Event, user_id: int, by: User) -> bool:
    removed = db.execute(
        delete(StaffAssignment)
        .where(StaffAssignment.event_id == event.id, StaffAssignment.user_id == user_id)
        .returning(StaffAssignment.id)
    ).scalar()
    if removed is None:
        return False
    audit.record(
        db,
        action="staff.removed",
        entity_type="staff_assignment",
        entity_id=removed,
        event_id=event.id,
        actor=by,
        summary="Event admin removed",
        payload={"user_id": user_id},
    )
    db.commit()
    return True
