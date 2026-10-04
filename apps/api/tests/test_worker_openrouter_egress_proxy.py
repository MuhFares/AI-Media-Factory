import ai_media_factory.main as main
from fastapi.testclient import TestClient


def test_probe_requires_owner_session_and_csrf(monkeypatch):
    monkeypatch.setattr(main.settings, "owner_token", "owner-secret-token")
    called = []
    monkeypatch.setattr(main, "_runtime_request", lambda *args, **kwargs: called.append((args, kwargs)) or {"probe": {"httpStatus": 200}})
    client = TestClient(main.app)
    body = {"project_id": "morroway", "reason": "bounded diagnostic"}
    assert client.post("/api/owner/diagnostics/openrouter-egress", json=body).status_code == 401
    login = client.post("/api/auth/login", json={"token": "owner-secret-token"})
    assert login.status_code == 200
    assert client.post("/api/owner/diagnostics/openrouter-egress", json=body).status_code == 403
    response = client.post("/api/owner/diagnostics/openrouter-egress", json=body, headers={"X-AMF-CSRF": login.json()["csrf_token"]})
    assert response.status_code == 200
    assert called[-1][0][0] == "/control/owner/diagnostics/openrouter-egress"
    assert called[-1][0][1] == "POST"
