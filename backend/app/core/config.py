import json
from pathlib import Path
from typing import Annotated, Any, Literal

from pydantic import AnyHttpUrl, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

env_root = Path(__file__).resolve().parents[3] / ".env"


class Settings(BaseSettings):
    PROJECT_NAME: str = "BiletFlow"
    API_V1_PREFIX: str = "/api/v1"

    DATABASE_URL: str
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"

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
