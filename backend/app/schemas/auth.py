from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserBase


class LoginRequest(UserBase):
    """Credentials for POST /auth/login.

    Inherits the email normalisation from UserBase so a login and the account
    it belongs to agree on what the address is.
    """

    password: str = Field(min_length=1)

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [{"email": "organizer@example.com", "password": "correct-horse-battery"}]
        }
    )


class RefreshRequest(BaseModel):
    """Body for POST /auth/refresh.

    Optional because browsers send the refresh token as a cookie instead and
    post no body at all; only clients in bearer mode fill this in.
    """

    refresh_token: str | None = Field(default=None, min_length=1)


class TokenResponse(BaseModel):
    """The answer to a login or a refresh.

    Which optional half is populated says how the caller was served. In bearer
    mode `refresh_token` is present and the client stores both. In cookie mode
    the refresh token goes out as an httpOnly cookie and never appears here,
    and `csrf_token` carries the value to echo back on the next refresh.
    """

    access_token: str
    token_type: Literal["bearer"] = "bearer"
    refresh_token: str | None = None
    csrf_token: str | None = None
