import json
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import AnyHttpUrl, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

env_root = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    PROJECT_NAME: str = "BiletFlow"
    API_V1_PREFIX: str = "/api/v1"
    VERSION: str = "0.1.0"
    DATABASE_URL: str
    # Optional Postgres TLS enforcement (e.g. "require", "verify-ca", "verify-full").
    DB_SSLMODE: Literal["", "disable", "allow", "prefer", "require", "verify-ca", "verify-full"] = (
        ""
    )
    SECRET_KEY: str
    # Optional Fernet key for application-level encryption of sensitive fields at rest.
    # Leave empty in local development; in production set a Fernet key or rely on
    # KMS/LUKS volume encryption as documented in docs/backup-recovery.md.
    FIELD_ENCRYPTION_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Lifetime of the signed "view my order" link guests receive. It has to
    # outlive the event, since the link is how a guest reaches their tickets.
    ORDER_LINK_EXPIRE_DAYS: int = 365
    # Lifetime of the signed link a guest uses to follow their support case.
    SUPPORT_LINK_EXPIRE_DAYS: int = 90
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"
    # How often the app releases expired checkout holds. 0 turns the sweeper
    # off, which the test suite does so no test touches the real database.
    HOLD_SWEEP_INTERVAL_SECONDS: int = 30

    # §3.3: a one-time fee per event to unlock paid sales, in KZT minor units
    # (tiyn). The amount is open question #4; 5 000 ₸ is a placeholder.
    ACTIVATION_FEE_MINOR: int = 500_000
    # Lifetime of password-reset and email-verification links (user_tokens).
    PASSWORD_RESET_EXPIRE_MINUTES: int = 60
    EMAIL_VERIFICATION_EXPIRE_HOURS: int = 48
    # Where the web app lives, for links that leave the API: emails, the
    # signed guest order link, campaign QR codes.
    PUBLIC_WEB_URL: str = "http://localhost:5173"

    # New event images use S3 when a bucket is configured.
    MEDIA_ROOT: str = "media"
    MEDIA_URL_PATH: str = "/media"
    PUBLIC_API_URL: str = "http://localhost:8000"
    AWS_S3_BUCKET: str = ""
    AWS_REGION: str = ""
    # Optional custom S3-compatible endpoint (MinIO, Cloudflare R2, DigitalOcean Spaces).
    AWS_S3_ENDPOINT_URL: str = ""
    AWS_S3_ADDRESSING_STYLE: Literal["auto", "virtual", "path"] = "virtual"
    MAX_IMAGE_BYTES: int = 2 * 1024 * 1024
    MAX_EVENT_IMAGES: int = 5

    # Email. With SMTP_HOST and RESEND_API_KEY empty, messages go to the log
    # only (the default for tests and bare `uvicorn`). Compose sets SMTP_HOST
    # to Mailpit; production may use SMTP or the Resend HTTP API adapter.
    EMAIL_PROVIDER: Literal["auto", "console", "smtp", "resend"] = "auto"
    SMTP_HOST: str = ""
    SMTP_PORT: int = 1025
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_STARTTLS: bool = False
    RESEND_API_KEY: str = ""
    RESEND_API_URL: str = "https://api.resend.com/emails"
    MAIL_FROM: str = "BiletFlow <no-reply@biletflow.local>"
    # How often queued notification emails are sent. 0 turns the sender off.
    NOTIFY_INTERVAL_SECONDS: int = 5

    # §4.6 "calculate ticket totals and processing charges", in basis points
    # (250 = 2.5 %). §3.3 says these are "deducted from each transaction", so
    # the attendee pays the ticket price and the fee comes out of the
    # organizer's payout (open question #3, decided). A Platform Admin can
    # change it at runtime (platform_settings); this is only the default.
    PROCESSING_FEE_BPS: int = 250
    DEFAULT_CURRENCY: str = "KZT"
    SUPPORTED_CURRENCIES: Annotated[list[str], NoDecode] = ["KZT"]

    CORS_ORIGINS: Annotated[list[AnyHttpUrl], NoDecode] = []

    # Which payment provider takes ticket payments (§4.6). "simulator" is the
    # in-process demo with pass/fail buttons; "halyk" sends the buyer to the
    # Halyk Bank ePay payment page. Activation fees stay simulated either way.
    PAYMENT_PROVIDER: Literal["simulator", "halyk"] = "simulator"
    # Halyk ePay credentials. Deliberately no defaults, not even the public
    # sandbox ones: they live in .env.example, so a production deploy cannot
    # silently run on test credentials. Required when PAYMENT_PROVIDER=halyk.
    HALYK_CLIENT_ID: str = ""
    HALYK_CLIENT_SECRET: str = ""
    HALYK_TERMINAL_ID: str = ""
    # Sandbox endpoints by default (epayment.kz/docs). Production is
    # epay-oauth.homebank.kz / epay-api.homebank.kz / epay.homebank.kz.
    HALYK_OAUTH_URL: str = "https://test-epay-oauth.epayment.kz/oauth2/token"
    HALYK_API_URL: str = "https://test-epay-api.epayment.kz"
    HALYK_PAYFORM_JS_URL: str = "https://test-epay.epayment.kz/payform/payment-api.js"
    # True while on the sandbox: those payments move no real money, so they are
    # stored with is_simulated=True and labelled as such (§4.6).
    HALYK_IS_SANDBOX: bool = True
    HALYK_TIMEOUT_SECONDS: float = 15.0
    # Where a finished Halyk payment may send the buyer back to, besides
    # PUBLIC_WEB_URL: the mobile app's URL schemes ("mobile" is app.json's
    # scheme, "exp" is Expo Go in development). Anything else is refused, so
    # the return link cannot be turned into an open redirect.
    APP_RETURN_SCHEMES: Annotated[list[str], NoDecode] = ["mobile", "exp"]

    @field_validator("APP_RETURN_SCHEMES", mode="before")
    @classmethod
    def assemble_app_return_schemes(cls, v: Any) -> Any:
        if isinstance(v, str):
            return [s.strip().lower() for s in v.split(",") if s.strip()]
        return v

    @model_validator(mode="after")
    def require_halyk_credentials(self) -> "Settings":
        if self.PAYMENT_PROVIDER == "halyk":
            missing = [
                name
                for name in ("HALYK_CLIENT_ID", "HALYK_CLIENT_SECRET", "HALYK_TERMINAL_ID")
                if not getattr(self, name)
            ]
            if missing:
                raise ValueError(f"PAYMENT_PROVIDER=halyk needs {', '.join(missing)}")
        return self

    @field_validator("SUPPORTED_CURRENCIES", mode="before")
    @classmethod
    def assemble_supported_currencies(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return ["KZT"]
            if v.startswith("["):
                return [c.strip().upper() for c in json.loads(v) if c.strip()]
            return [c.strip().upper() for c in v.split(",") if c.strip()]
        if isinstance(v, list):
            return [str(c).strip().upper() for c in v if str(c).strip()]
        raise ValueError(f"Invalid SUPPORTED_CURRENCIES: {v!r}")

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Any) -> Any:
        """Accept a comma-separated string or a JSON array from the environment."""
        if isinstance(v, str):
            v = v.strip()
            if not v:
                return []
            if v.startswith("["):
                return json.loads(v)
            return [i.strip() for i in v.split(",") if i.strip()]
        if isinstance(v, list):
            return v
        raise ValueError(f"Invalid CORS_ORIGINS: {v!r}")

    model_config = SettingsConfigDict(
        env_file=env_root,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
