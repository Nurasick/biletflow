"""Cookie policy for browser clients.

One module owns the name and the attributes. Scattering `set_cookie` calls is
how a Secure or SameSite flag ends up set in one place and forgotten in
another, and the two disagree silently.
"""

from fastapi import Response

from app.core.config import settings

REFRESH_COOKIE = "refresh_token"

# Scoped to /auth rather than the whole API: the two endpoints that consume the
# refresh token are both under it, so no other route ever receives the cookie
# and no other route can echo it back by accident.
REFRESH_COOKIE_PATH = f"{settings.API_V1_PREFIX}/auth"


def _secure() -> bool:
    """Secure everywhere but local dev, where the frontend runs on plain http."""
    return settings.ENVIRONMENT != "local"


def set_refresh_cookie(response: Response, refresh_token: str) -> None:
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=_secure(),
        samesite="lax",
        path=REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response) -> None:
    # The attributes must match the ones it was set with or the browser treats
    # this as a different cookie and leaves the original in place.
    response.delete_cookie(
        REFRESH_COOKIE,
        path=REFRESH_COOKIE_PATH,
        httponly=True,
        secure=_secure(),
        samesite="lax",
    )
