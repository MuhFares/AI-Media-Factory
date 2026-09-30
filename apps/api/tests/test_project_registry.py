"""Program 5 facade project gating (no network; _runtime_request mocked)."""
import pytest
from fastapi import HTTPException
import ai_media_factory.main as main
from ai_media_factory.main import (
    _require_project, content_create, ContentCreateRequest,
    channel_create, ChannelCreateRequest,
)


def _projects(*ids):
    return {"projects": [{"projectId": pid} for pid in ids]}


def test_require_project_passes_registered(monkeypatch):
    monkeypatch.setattr(main, "_runtime_request", lambda *a, **k: _projects("morroway", "proj-b"))
    _require_project("proj-b")


def test_require_project_404_unknown(monkeypatch):
    monkeypatch.setattr(main, "_runtime_request", lambda *a, **k: _projects("morroway"))
    with pytest.raises(HTTPException) as exc:
        _require_project("ghost")
    assert exc.value.status_code == 404


def test_content_create_rejects_unknown_project(monkeypatch):
    monkeypatch.setattr(main, "_runtime_request", lambda *a, **k: _projects("morroway"))
    with pytest.raises(HTTPException) as exc:
        content_create(ContentCreateRequest(project_id="ghost", title="t", objective="o"))
    assert exc.value.status_code == 404


def test_channel_create_maps_fields(monkeypatch):
    captured = {}

    def fake_runtime(path, method="GET", payload=None, owner_bearer=None):
        captured["path"] = path
        captured["payload"] = payload
        return {"channel": {"channelId": "channel-1"}}

    monkeypatch.setattr(main, "_runtime_request", fake_runtime)
    out = channel_create(ChannelCreateRequest(project_id="morroway", platform="youtube", display_name="Main"))
    assert captured["path"] == "/control/channels"
    assert captured["payload"]["projectId"] == "morroway"
    assert captured["payload"]["platform"] == "youtube"
    assert out["channel"]["channelId"] == "channel-1"
