import secrets

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.api.deps import BearerMode, CurrentUser, DbSession
from app.core.cookies import REFRESH_COOKIE, clear_refresh_cookie, set_refresh_cookie
from app.core.security import generate_url_token
from app.models.user import User, UserStatus
from app.schemas.auth import LoginRequest, RefreshRequest, TokenResponse
from app.schemas.user import UserCreate, UserRead
from app.services import auth as auth_service
from app.services import user as user_service

router = APIRouter(prefix="/auth", tags=["auth"])

BEARER_HEADER = {"WWW-Authenticate": "Bearer"}
CSRF_HEADER = "X-CSRF-Token"

INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Incorrect email or password",
    headers=BEARER_HEADER,
)
INVALID_REFRESH_TOKEN = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Invalid refresh token",
    headers=BEARER_HEADER,
)
SUSPENDED = HTTPException(status.HTTP_403_FORBIDDEN, "Account suspended")
CSRF_FAILED = HTTPException(status.HTTP_403_FORBIDDEN, "CSRF check failed")


def _issue(user: User, response: Response, bearer_mode: bool) -> TokenResponse:
    """Hand out a fresh pair the way this client asked to receive it."""
    if bearer_mode:
        access, refresh = auth_service.issue_tokens(user)
        return TokenResponse(access_token=access, refresh_token=refresh)

    csrf = generate_url_token()
    access, refresh = auth_service.issue_tokens(user, csrf=csrf)
    set_refresh_cookie(response, refresh)
    return TokenResponse(access_token=access, csrf_token=csrf)


def _verify_csrf(request: Request, refresh_token: str) -> None:
    """Require proof that the caller can read what only our login response gave out.

    A cookie is attached by the browser to any request, including one triggered
    by another site, so possession of the cookie alone proves nothing. The
    expected value lives as a claim inside the cookie's own JWT, so nothing has
    to be stored server-side and a value from an older token will not match.
    """
    expected = auth_service.token_csrf_claim(refresh_token)
    supplied = request.headers.get(CSRF_HEADER)
    if not expected or not supplied or not secrets.compare_digest(expected, supplied):
        raise CSRF_FAILED


@router.post("/register", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def register(data: UserCreate, db: DbSession) -> User:
    """Create an account. The new user is active but not email-verified."""
    try:
        return user_service.create_user(db, data)
    except user_service.EmailAlreadyRegistered:
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered") from None


@router.post("/login", response_model=TokenResponse)
def login(
    data: LoginRequest, db: DbSession, response: Response, bearer_mode: BearerMode
) -> TokenResponse:
    """Exchange credentials for an access/refresh pair.

    The password is checked before the status is, so a suspended account is only
    distinguishable to someone who already knows its password (01-identity.md:
    suspension must not be distinguishable to strangers).
    """
    user = user_service.authenticate(db, data.email, data.password)
    if user is None:
        raise INVALID_CREDENTIALS
    if user.status != UserStatus.ACTIVE:
        raise SUSPENDED
    return _issue(user, response, bearer_mode)


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
    db: DbSession,
    bearer_mode: BearerMode,
    data: RefreshRequest | None = None,
) -> TokenResponse:
    """Trade a refresh token for a fresh pair.

    The token comes from the body for clients in bearer mode and from the
    httpOnly cookie for browsers. A cookie-borne token additionally has to pass
    the CSRF check, because unlike a body it is sent without the caller asking.

    The status is re-read here rather than trusted from the token, so suspending
    an account takes effect at the next refresh instead of at the token's expiry.
    """
    token = data.refresh_token if data and data.refresh_token else None
    from_cookie = token is None
    if from_cookie:
        token = request.cookies.get(REFRESH_COOKIE)
    if token is None:
        raise INVALID_REFRESH_TOKEN

    user = auth_service.resolve_token_user(db, token, "refresh")
    if user is None:
        raise INVALID_REFRESH_TOKEN
    if from_cookie:
        _verify_csrf(request, token)
    if user.status != UserStatus.ACTIVE:
        raise SUSPENDED
    return _issue(user, response, bearer_mode)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(user: CurrentUser, response: Response) -> None:
    """Clear the refresh cookie; the caller discards its in-memory access token.

    For a browser this genuinely ends the session, because the refresh token
    only ever existed as the cookie being deleted here. For a client in bearer
    mode nothing is revoked: that refresh token stays valid until it expires,
    and this codebase has no store of issued tokens to mark as spent. Real
    revocation would be added here, without changing any client.
    """
    clear_refresh_cookie(response)
    return None
