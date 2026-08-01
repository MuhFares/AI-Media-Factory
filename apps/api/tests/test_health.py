"""Tests for the health endpoint."""

from __future__ import annotations

from fastapi.testclient import TestClient

from ai_media_factory.main import app

client = TestClient(app)


def test_health_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
