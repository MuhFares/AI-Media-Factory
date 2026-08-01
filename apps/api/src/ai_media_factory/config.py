"""Application configuration loaded from the environment."""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings, populated from environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    log_level: str = "info"
    api_host: str = "0.0.0.0"
    api_port: int = 8000
    media_output_dir: str = "./output"


settings = Settings()
