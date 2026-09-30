"""Application configuration loaded from the environment."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    """Runtime settings, populated from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    log_level: str = "info"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    media_output_dir: str = "./output"
    runtime_api_url: str = "http://127.0.0.1:8080"
    # Program 1 Workstream B: single shared Owner token (same value as the
    # Node runtime's AMF_OWNER_TOKEN). Optional session-signing key; falls
    # back to the Owner token. Designed for later per-identity RBAC subjects
    # without changing the enforcement points.
    owner_token: str = Field(default="", validation_alias="AMF_OWNER_TOKEN")
    session_secret: str = Field(default="", validation_alias="AMF_SESSION_SECRET")


settings = Settings()
