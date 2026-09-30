"""Program 5 credential-health read proxy regression tests (provider-free)."""
import ai_media_factory.main as main
from fastapi import HTTPException
from fastapi.testclient import TestClient


def test_owner_credential_health_read_is_allowlisted_and_project_scoped(monkeypatch):
    seen = {}

    def fake_runtime(path, method="GET", payload=None, owner_bearer=None, **kwargs):
        seen.update(path=path, method=method, payload=payload, owner_bearer=owner_bearer)
        return {"projectId": "project-a", "credentials": [{
            "bindingId": "binding-a", "provider": "youtube", "state": "VALID"
        }]}

    monkeypatch.setattr(main, "_runtime_request", fake_runtime)
    response = TestClient(main.app).get(
        "/api/runtime/owner-credential-health?project_id=project-a"
    )
    assert response.status_code == 200
    assert seen == {
        "path": "/control/owner/credential-health?projectId=project-a",
        "method": "GET", "payload": None, "owner_bearer": None,
    }
    assert response.json()["credentials"][0]["bindingId"] == "binding-a"


def test_unknown_runtime_resource_remains_rejected(monkeypatch):
    monkeypatch.setattr(main, "_runtime_request", lambda *args, **kwargs: {"unexpected": True})
    response = TestClient(main.app).get("/api/runtime/not-a-control-resource")
    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown control resource"


def test_credential_health_runtime_resource_is_get_only(monkeypatch):
    called = False

    def fake_runtime(*args, **kwargs):
        nonlocal called
        called = True
        return {"unexpected": True}

    monkeypatch.setattr(main, "_runtime_request", fake_runtime)
    response = TestClient(main.app).post(
        "/api/runtime/owner-credential-health?project_id=project-a", json={}
    )
    assert response.status_code in (401, 405)
    assert called is False


def test_read_proxy_introduces_no_secret_fields(monkeypatch):
    safe = {"projectId": "project-a", "credentials": [{
        "bindingId": "binding-a", "provider": "youtube",
        "state": "UNKNOWN_REQUIRES_REFRESH", "fresh": False,
    }]}
    monkeypatch.setattr(main, "_runtime_request", lambda *args, **kwargs: safe)
    body = TestClient(main.app).get(
        "/api/runtime/owner-credential-health?project_id=project-a"
    ).json()
    serialized = str(body).lower()
    for forbidden in ("access_token", "refresh_token", "client_secret", "credential_ref", "authorization"):
        assert forbidden not in serialized


def test_node_project_denial_is_preserved(monkeypatch):
    def denied(*args, **kwargs):
        raise HTTPException(status_code=404, detail="Project not found")

    monkeypatch.setattr(main, "_runtime_request", denied)
    response = TestClient(main.app).get(
        "/api/runtime/owner-credential-health?project_id=other-project"
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Project not found"
