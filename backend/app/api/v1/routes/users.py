from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.models.user import User
from app.schemas.user import UserRead

router = APIRouter(tags=["users"])


@router.get("/users/me", response_model=UserRead)
def read_current_user(user: CurrentUser) -> User:
    return user
