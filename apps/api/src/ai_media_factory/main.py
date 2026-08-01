"""FastAPI application entry point."""

from __future__ import annotations

from fastapi import FastAPI

from ai_media_factory import __version__
from ai_media_factory.config import settings

app = FastAPI(title="AI Media Factory API", version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    """Liveness probe."""
    return {"status": "ok", "env": settings.app_env, "version": __version__}
