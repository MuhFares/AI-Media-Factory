"""Program 1 Workstream B — Owner session and mutation-guard tests (no network)."""
import hashlib
import re

import ai_media_factory.main as main
from ai_media_factory.main import (
    _issue_session, _require_owner, _session_expires_at, _session_valid,
    auth_login, AuthLoginRequest,
)
from fastapi import HTTPException
from fastapi.testclient import TestClient


class FakeCookies:
    def __init__(self, jar):
        self._jar = jar

    def get(self, key, default=""):
        return self._jar.get(key, default)


class FakeRequest:
    def __init__(self, jar):
        self.cookies = FakeCookies(jar)


def test_session_round_trip(monkeypatch):
    monkeypatch.setattr(main.settings, "owner_token", "owner-secret-token")
    token = _issue_session()
    assert _session_valid(FakeRequest({"amf_session": token})) is True
    assert _session_expires_at(FakeRequest({"amf_session": token})) is not None
    assert _session_valid(FakeRequest({"amf_session": "bogus"})) is False
    assert _session_valid(FakeRequest({})) is False


def test_session_rejects_tampered_and_unconfigured(monkeypatch):
    monkeypatch.setattr(main.settings, "owner_token", "owner-secret-token")
    token = _issue_session()
    assert _session_valid(FakeRequest({"amf_session": token[:-2] + "xx"})) is False
    monkeypatch.setattr(main.settings, "owner_token", "")
    assert _session_valid(FakeRequest({"amf_session": token})) is False


def test_login_logout_and_require_owner(monkeypatch):
    monkeypatch.setattr(main.settings, "owner_token", "owner-secret-token")
    resp = auth_login(AuthLoginRequest(token="owner-secret-token"))
    cookie = resp.headers.get("set-cookie", "")
    assert "amf_session=" in cookie and "httponly" in cookie.lower()
    assert "max-age=43200" in cookie.lower()
    jar = {"amf_session": cookie.split("amf_session=")[1].split(";")[0]}
    assert _require_owner(FakeRequest(jar)) == "owner-secret-token"
    try:
        auth_login(AuthLoginRequest(token="wrong"))
        raise AssertionError("expected 401")
    except HTTPException as exc:
        assert exc.status_code == 401
    try:
        _require_owner(FakeRequest({}))
        raise AssertionError("expected 401")
    except HTTPException as exc:
        assert exc.status_code == 401


def test_mutation_guard_forwards_bearer_only_with_session(monkeypatch):
    monkeypatch.setattr(main.settings, "owner_token", "owner-secret-token")
    seen = {}

    def fake_runtime(path, method="GET", payload=None, owner_bearer=None):
        # Mirror the real proxy: explicit bearer wins, else request-scoped var.
        seen["auth"] = owner_bearer if owner_bearer is not None else main._owner_bearer.get()
        return {"ok": True}

    monkeypatch.setattr(main, "_runtime_request", fake_runtime)
    client = TestClient(main.app)
    blocked = client.post("/api/command-room", json={
        "project_id": "morroway", "audience": ["research"], "message": "hi",
    })
    assert blocked.status_code == 401
    assert "auth" not in seen
    login = client.post("/api/auth/login", json={"token": "owner-secret-token"})
    assert login.status_code == 200
    csrf = login.json()["csrf_token"]
    ok = client.post("/api/command-room", json={
        "project_id": "morroway", "audience": ["research"], "message": "hi",
    }, headers={"X-AMF-CSRF": csrf})
    assert ok.status_code == 200
    assert seen["auth"] == "owner-secret-token"
    readonly = client.get("/api/runtime/health")
    assert readonly.status_code in (200, 503)


def test_csrf_is_session_bound_and_fail_closed(monkeypatch):
    monkeypatch.setattr(main.settings, "owner_token", "owner-secret-token")
    monkeypatch.setattr(main, "_runtime_request", lambda *args, **kwargs: {"ok": True})
    client = TestClient(main.app)
    login = client.post("/api/auth/login", json={"token": "owner-secret-token"})
    assert login.status_code == 200
    missing = client.post("/api/command-room", json={
        "project_id": "morroway", "audience": ["research"], "message": "hi",
    })
    assert missing.status_code == 403
    forged = client.post("/api/command-room", headers={"X-AMF-CSRF": "forged"}, json={
        "project_id": "morroway", "audience": ["research"], "message": "hi",
    })
    assert forged.status_code == 403
    good = client.post("/api/command-room", headers={"X-AMF-CSRF": login.json()["csrf_token"]}, json={
        "project_id": "morroway", "audience": ["research"], "message": "hi",
    })
    assert good.status_code == 200


def test_credential_health_proxy_requires_session_and_csrf_and_sends_only_binding_id(monkeypatch):
    monkeypatch.setattr(main.settings, "owner_token", "owner-secret-token")
    seen = {}
    def fake_runtime(path, method="GET", payload=None, owner_bearer=None, **kwargs):
        seen.update({"path": path, "method": method, "payload": payload})
        return {"health": {"state": "VALID"}}
    monkeypatch.setattr(main, "_runtime_request", fake_runtime)
    client = TestClient(main.app)
    body = {"project_id": "project-a", "action": "VERIFY_HEALTH", "reason": "Owner check", "idempotency_key": "health-request-001"}
    assert client.post("/api/owner/credentials/binding-a/verify", json=body).status_code == 401
    login = client.post("/api/auth/login", json={"token": "owner-secret-token"})
    assert client.post("/api/owner/credentials/binding-a/verify", json=body).status_code == 403
    response = client.post("/api/owner/credentials/binding-a/verify", json=body, headers={"X-AMF-CSRF": login.json()["csrf_token"]})
    assert response.status_code == 200
    assert seen["path"] == "/control/owner/credentials/binding-a/verify"
    serialized = str(seen)
    assert "credential_ref" not in serialized and "access_token" not in serialized and "refresh_token" not in serialized


def test_owner_shell_pins_current_source_bundle_hash():
    client = TestClient(main.app)
    shell = client.get("/")
    assert shell.status_code == 200
    expected = hashlib.sha256((main.STATIC_DIR / "app.js").read_bytes()).hexdigest()[:12]
    match = re.search(r'/static/app\.js\?v=([0-9a-f]{12})', shell.text)
    assert match and match.group(1) == expected
