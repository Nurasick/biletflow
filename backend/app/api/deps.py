from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt import InvalidTokenError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_PREFIX}/auth/login")

CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)

DbSession = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(oauth2_scheme)]


def get_current_user(token: TokenDep, db: DbSession) -> User:
    try:
        payload = decode_token(token)
    except InvalidTokenError:
        raise CREDENTIALS_EXCEPTION from None
    if payload.get("type") != "access":
        raise CREDENTIALS_EXCEPTION
    try:
        user_id = int(payload["sub"])
    except (KeyError, TypeError, ValueError):
        raise CREDENTIALS_EXCEPTION from None
    user = db.get(User, user_id)
    if user is None:
        raise CREDENTIALS_EXCEPTION
    return user


def get_current_active_user(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.status != "active":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_active_user)]
