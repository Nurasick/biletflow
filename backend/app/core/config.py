import json
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

env_root = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    PROJECT_NAME: str = "BiletFlow"
    API_V1_PREFIX: str = "/api/v1"
    VERSION: str = "0.1.0"
    DATABASE_URL: str
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    # Lifetime of the signed "view my order" link guests receive. It has to
    # outlive the event, since the link is how a guest reaches their tickets.
    ORDER_LINK_EXPIRE_DAYS: int = 365
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

    # Uploaded event images. Local disk for development and the demo; the
    # storage module is the only code that knows, so S3 (§9) replaces it there.
    MEDIA_ROOT: str = "media"
    MEDIA_URL_PATH: str = "/media"
    PUBLIC_API_URL: str = "http://localhost:8000"
    MAX_IMAGE_BYTES: int = 2 * 1024 * 1024
    MAX_EVENT_IMAGES: int = 5

    CORS_ORIGINS: Annotated[list[AnyHttpUrl], NoDecode] = []

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
