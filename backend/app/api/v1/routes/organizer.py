from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentOrganizer, CurrentUser, DbSession, OwnedEvent, VerifiedUser
from app.models.organizer import OrganizerProfile
from app.schemas.organizer import (
    OrganizerProfileRead,
    OrganizerProfileWrite,
    StaffAssign,
    StaffRead,
    StaffUpdate,
)
from app.schemas.payout import PayoutRead
from app.services import organizer as organizer_service
from app.services import payout as payout_service

router = APIRouter(tags=["organizer"])


def _profile(db: DbSession, profile: OrganizerProfile) -> dict:
    # No relationship() on the models, so the payout account is looked up
    # rather than read off the profile.
    fields = {
        f: getattr(profile, f)
        for f in OrganizerProfileRead.model_fields
        if f not in ("payout_account", "verification_is_simulated")
    }
    return OrganizerProfileRead.model_validate(
        fields
        | {
            "payout_account": organizer_service.active_payout_account(db, profile),
            "verification_is_simulated": True,
        }
    ).model_dump()


@router.get("/organizer/profile", response_model=OrganizerProfileRead)
def read_profile(user: CurrentUser, db: DbSession) -> dict:
    """404 until the user has saved a profile: that is what "not an organizer
    yet" looks like (01-identity.md, roles are relationships)."""
    profile = organizer_service.get_profile(db, user)
    if profile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No organizer profile yet")
    return _profile(db, profile)


@router.put("/organizer/profile", response_model=OrganizerProfileRead)
def save_profile(data: OrganizerProfileWrite, user: VerifiedUser, db: DbSession) -> dict:
    """Create or replace the caller's organizer profile and sandbox payout
    account (§4.1 "a profile containing contact and payout information").
    The first save is what makes an account an organizer."""
    return _profile(db, organizer_service.save_profile(db, user, data))


@router.post("/organizer/profile/verify", response_model=OrganizerProfileRead)
def verify_profile(organizer: CurrentOrganizer, user: VerifiedUser, db: DbSession) -> dict:
    """Simulated identity verification (§3.2 step 2). Real KYC is out of
    scope (§8); this accepts immediately and the payout account it pairs with
    is marked is_simulated."""
    return _profile(db, organizer_service.verify_identity(db, organizer, actor=user))


@router.get("/organizer/payouts", response_model=list[PayoutRead])
def list_my_payouts(
    organizer: CurrentOrganizer,
    db: DbSession,
    event_id: int | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict]:
    """Simulated payout settlement history for the organizer's events (§4.10)."""
    return payout_service.list_organizer_payouts(
        db, organizer, event_id=event_id, limit=limit, offset=offset
    )


# --- staff -----------------------------------------------------------------


@router.get("/organizer/events/{event_id}/staff", response_model=list[StaffRead])
def list_staff(event: OwnedEvent, db: DbSession) -> list[dict]:
    return [
        {
            "user_id": user.id,
            "email": user.email,
            "first_name": user.first_name,
            "last_name": user.last_name,
            "role": assignment.role,
            "can_reverse_check_in": assignment.can_reverse_check_in,
            "created_at": assignment.created_at,
        }
        for assignment, user in organizer_service.list_staff(db, event)
    ]


@router.post(
    "/organizer/events/{event_id}/staff",
    response_model=list[StaffRead],
    status_code=status.HTTP_201_CREATED,
)
def assign_staff(event: OwnedEvent, data: StaffAssign, user: CurrentUser, db: DbSession):
    """Make an existing account an event admin for this event (§2.3 "assign
    check-in staff"). They then see it in the mobile app's event list."""
    try:
        organizer_service.assign_staff(
            db, event, data.email, user, can_reverse_check_in=data.can_reverse_check_in
        )
    except organizer_service.UserNotFound:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "No account uses this email; ask them to sign up first"
        ) from None
    except organizer_service.AlreadyAssigned:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already assigned to this event") from None
    return list_staff(event, db)


@router.patch("/organizer/events/{event_id}/staff/{user_id}", response_model=list[StaffRead])
def update_staff(
    event: OwnedEvent, user_id: int, data: StaffUpdate, user: CurrentUser, db: DbSession
):
    updated = organizer_service.update_staff_permissions(
        db, event, user_id, can_reverse_check_in=data.can_reverse_check_in, by=user
    )
    if updated is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not assigned to this event")
    return list_staff(event, db)


@router.delete(
    "/organizer/events/{event_id}/staff/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
def remove_staff(event: OwnedEvent, user_id: int, user: CurrentUser, db: DbSession) -> Response:
    if not organizer_service.remove_staff(db, event, user_id, user):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not assigned to this event")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
