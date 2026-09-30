"""Tests for the artifact preview streaming proxy (no network, no DB)."""

from __future__ import annotations

import io
import json
from urllib.error import HTTPError, URLError

from fastapi.testclient import TestClient

import ai_media_factory.main as main
from ai_media_factory.main import app

client = TestClient(app)


class FakeResponse:
    def __init__(self, body: bytes, status: int = 200, headers: dict | None = None):
        self._body = body
        self.status = status
        self.headers = headers or {}

    def read(self, n: int = -1) -> bytes:
        return self._body if n < 0 else self._body[:n]

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_preview_proxies_bytes_and_headers(monkeypatch):
    seen = {}

    def fake_urlopen(request, timeout=30):
        seen["url"] = request.full_url
        seen["range"] = request.get_header("Range")
        return FakeResponse(b"MP4" * 100, 200, {
            "Content-Type": "video/mp4",
            "Content-Length": "300",
            "Accept-Ranges": "bytes",
            "Content-Disposition": 'inline; filename="a.mp4"',
        })

    monkeypatch.setattr(main, "urlopen", fake_urlopen)
    response = client.get("/api/artifacts/preview", params={"artifact_id": "art-1"})
    assert response.status_code == 200
    assert response.content == b"MP4" * 100
    assert response.headers["content-type"] == "video/mp4"
    assert response.headers["accept-ranges"] == "bytes"
    assert "artifactId=art-1" in seen["url"]
    assert seen["range"] is None


def test_preview_forwards_range_and_206(monkeypatch):
    def fake_urlopen(request, timeout=30):
        assert request.get_header("Range") == "bytes=0-99"
        return FakeResponse(b"0" * 100, 206, {
            "Content-Type": "video/mp4",
            "Content-Length": "100",
            "Content-Range": "bytes 0-99/300",
            "Accept-Ranges": "bytes",
        })

    monkeypatch.setattr(main, "urlopen", fake_urlopen)
    response = client.get("/api/artifacts/preview", params={"artifact_id": "art-1"}, headers={"Range": "bytes=0-99"})
    assert response.status_code == 206
    assert response.headers["content-range"] == "bytes 0-99/300"
    assert len(response.content) == 100


def test_preview_maps_control_plane_denials(monkeypatch):
    def fake_urlopen(request, timeout=30):
        raise HTTPError(request.full_url, 404, "Not Found", {}, io.BytesIO(json.dumps({"error": "preview unavailable"}).encode()))

    monkeypatch.setattr(main, "urlopen", fake_urlopen)
    response = client.get("/api/artifacts/preview", params={"artifact_id": "art-nope"})
    assert response.status_code == 404
    assert response.json()["detail"] == "preview unavailable"


def test_preview_rejects_bad_ids_without_backend_call(monkeypatch):
    def fail_urlopen(*args, **kwargs):
        raise AssertionError("backend must not be called")

    monkeypatch.setattr(main, "urlopen", fail_urlopen)
    assert client.get("/api/artifacts/preview").status_code == 404
    assert client.get("/api/artifacts/preview", params={"artifact_id": "../x"}).status_code == 404


def test_preview_runtime_down_maps_503(monkeypatch):
    def fail_urlopen(*args, **kwargs):
        raise URLError("refused")

    monkeypatch.setattr(main, "urlopen", fail_urlopen)
    assert client.get("/api/artifacts/preview", params={"artifact_id": "art-1"}).status_code == 503
