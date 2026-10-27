from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.user import User
from app.schemas.user import MeRead, UserUpdate
from app.services import account_tokens
from app.services import event as event_service

router = APIRouter(tags=["users"])


def _me(db: DbSession, user: User) -> dict:
    return MeRead.model_validate(
        {
            **{
                field: getattr(user, field)
                for field in MeRead.model_fields
                if field != "is_organizer"
            },
            "is_organizer": event_service.get_organizer_profile(db, user) is not None,
        }
    ).model_dump()


@router.get("/users/me", response_model=MeRead)
def read_current_user(user: CurrentUser, db: DbSession) -> dict:
    return _me(db, user)


@router.patch("/users/me", response_model=MeRead)
def update_current_user(data: UserUpdate, user: CurrentUser, db: DbSession) -> dict:
    """Change name, phone or locale. Omitted fields are left alone."""
    for field, value in data.model_dump(exclude_unset=True).items():
        if value is None and field != "phone":
            continue  # first_name, last_name and locale are NOT NULL
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return _me(db, user)


@router.post("/users/me/verify-email", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(user: CurrentUser, db: DbSession) -> dict:
    """Email a fresh verification link (§4.1). Earlier links stop working."""
    if not user.is_email_verified:
        account_tokens.send_verification(db, user)
    return {"detail": "If the address is unverified, a link is on its way"}
