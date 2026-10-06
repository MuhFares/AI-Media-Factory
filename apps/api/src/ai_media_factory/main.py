"""FastAPI application entry point."""

from __future__ import annotations

from datetime import UTC, datetime
import json
import os
import re
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException, Request as StarletteRequest
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
import base64
import hashlib
import hmac
import time
from contextvars import ContextVar

from ai_media_factory import __version__
from ai_media_factory.config import settings

app = FastAPI(title="AI Media Factory API", version=__version__)

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def _no_store_api(request, call_next):
    """Owner control-plane truth must never be served from heuristic caches."""
    response = await call_next(request)
    if request.url.path.startswith("/api/") and request.url.path != "/api/artifacts/preview":
        response.headers["Cache-Control"] = "no-store"
    return response


_owner_bearer: ContextVar[str | None] = ContextVar("amf_owner_bearer", default=None)
_AUTH_EXEMPT_POSTS = frozenset({"/api/auth/login"})
CSRF_COOKIE = "amf_csrf"


@app.middleware("http")
async def _owner_mutation_guard(request, call_next):
    """Server-side Owner authentication for state-changing API calls.

    POST/PUT/DELETE/PATCH under /api/ (except auth endpoints) require a
    valid Owner session; the Owner bearer is stashed request-scoped for
    runtime forwarding. Fails closed. Designed for later per-identity
    RBAC subjects without changing enforcement points.
    """
    if (request.method in ("POST", "PUT", "DELETE", "PATCH")
            and request.url.path.startswith("/api/")
            and request.url.path not in _AUTH_EXEMPT_POSTS):
        try:
            _owner_bearer.set(_require_owner(request))
            _require_csrf(request)
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    else:
        _owner_bearer.set(None)
    try:
        return await call_next(request)
    finally:
        _owner_bearer.set(None)


def _brand_architecture() -> dict[str, Any]:
    """Return the recorded brand architecture, never a fabricated project state."""
    import json

    source = REPOSITORY_ROOT / "artifacts" / "brand-architecture-v1.json"
    return json.loads(source.read_text(encoding="utf-8")) if source.exists() else {}


def _recorded_agents() -> list[dict[str, Any]]:
    """Project agent availability from checked-in package names only."""
    labels = {
        "research": "Research Agent", "planner": "Planner", "writer": "Writer",
        "seo": "SEO Agent", "brand": "Brand Gate", "qa": "Quality Gate",
        "media": "Media Agent", "growth": "Growth Agent", "finance": "Finance Agent",
        "director": "Director", "publisher": "Publisher",
    }
    packages = REPOSITORY_ROOT / "packages"
    rows = []
    for key, label in labels.items():
        available = (packages / f"{key}-agent").exists()
        rows.append({
            "id": key, "name": label, "available": available,
            "status": "IDLE" if available else "NOT_CONFIGURED",
            "provider": None, "model": None, "currentTask": None,
            "recentRuns": [], "successRate": None, "costTodayUsd": None,
            "source": "repository package inventory",
        })
    return rows


def _platform_snapshot() -> dict[str, Any]:
    architecture = _brand_architecture()
    morroway = architecture.get("finalistPlacements", {}).get("Morroway", {})
    return {
        "platform": {"name": "AMF Control", "health": "healthy", "costTodayUsd": None},
        "projects": [{
            "id": "morroway", "name": "Morroway", "status": "planning",
            "theme": {"accent": "#a95b78", "mark": "M"},
            "summary": "Consumer master-brand finalist; no publication actions enabled.",
            "recorded": bool(morroway), "architecture": morroway,
        }],
        "governance": {
            "providerPrecedence": ["Global Default", "Project Override", "Agent Override"],
            "globalDefaults": {"provider": None, "model": None, "state": "not configured"},
            "note": "Configuration changes require owner review and are not applied by this MVP.",
        },
    }


class CommandRequest(BaseModel):
    project_id: str
    audience: list[str] = Field(min_length=1)
    message: str = Field(min_length=1, max_length=4000)
    mode: str | None = None
    directive: str | None = None
    context_extra: dict[str, Any] | None = None


@app.get("/api/commands/{command_id}")
def command_detail(command_id: str, project_id: str = "morroway") -> dict[str, Any]:
    return _runtime_request(f"/control/commands/{command_id}?projectId={project_id}")


class ApprovalRequest(BaseModel):
    action: str
    rationale: str = Field(min_length=1, max_length=2000)
    recommendation: str = Field(min_length=1, max_length=2000)


class OverrideRequest(BaseModel):
    scope: str
    provider: str | None = None
    model: str | None = None
    rationale: str = Field(min_length=1, max_length=2000)


class HumanGateRequest(BaseModel):
    gate_key: str = Field(pattern="^(pre_production|visual)$")
    enabled: bool
    rationale: str = Field(min_length=1, max_length=2000)
    changed_by: str = Field(default="owner", max_length=200)


class HumanGateResetRequest(BaseModel):
    gate_key: str = Field(pattern="^(pre_production|visual)$")
    rationale: str = Field(min_length=1, max_length=2000)
    changed_by: str = Field(default="owner", max_length=200)


def _timestamp() -> str:
    return datetime.now(UTC).isoformat()


def _runtime_request(path: str, method: str = "GET", payload: dict[str, Any] | None = None, owner_bearer: str | None = None,
                     timeout_seconds: float = 8) -> Any:
    """Proxy business requests to the existing Node runtime API; never to a provider."""
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    bearer = owner_bearer if owner_bearer is not None else _owner_bearer.get()
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    request = Request(f"{settings.runtime_api_url.rstrip('/')}{path}", data=data, method=method,
                      headers=headers)
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # nosec B310: configured local runtime URL
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        raw_detail = error.read().decode("utf-8", errors="replace")
        detail: Any = raw_detail
        try:
            parsed = json.loads(raw_detail)
            if isinstance(parsed, dict):
                detail = parsed.get("detail") or parsed.get("error") or raw_detail
        except json.JSONDecodeError:
            pass
        raise HTTPException(status_code=error.code, detail=detail) from error
    except URLError as error:
        raise HTTPException(status_code=503, detail="AMF runtime API is unavailable. Start the API and worker before dispatching work.") from error


def _require_project(project_id: str) -> None:
    """Fail closed for unregistered projects (registry truth, not a hardcoded name)."""
    try:
        projects = _runtime_request("/control/projects")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=503, detail="project registry unavailable") from error
    if not any(p.get("projectId") == project_id for p in projects.get("projects", [])):
        raise HTTPException(status_code=404, detail="Project not found")


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness probe."""
    digest = hashlib.sha256()
    for source in (Path(__file__), STATIC_DIR / "app.js", STATIC_DIR / "index.html"):
        if source.exists():
            digest.update(str(source.relative_to(REPOSITORY_ROOT)).replace("\\", "/").encode("utf-8"))
            digest.update(b"\0")
            digest.update(source.read_bytes())
            digest.update(b"\0")
    return {"status": "ok", "env": settings.app_env, "version": __version__, "sourceBuildId": digest.hexdigest(), "pid": os.getpid()}


SESSION_COOKIE = "amf_session"
SESSION_TTL_SECONDS = 12 * 3600


def _session_key() -> bytes:
    """Session HMAC key: explicit secret, else the Owner token itself."""
    raw = (settings.session_secret or settings.owner_token or "").encode("utf-8")
    return hashlib.sha256(b"amf-session-v1:" + raw).digest()


def _issue_session() -> str:
    ts = str(int(time.time()))
    sig = hmac.new(_session_key(), ts.encode("utf-8"), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{ts}.{sig}".encode("utf-8")).decode("ascii")


def _csrf_for_session(session: str) -> str:
    """Double-submit token cryptographically bound to the HttpOnly session."""
    return hmac.new(_session_key(), f"amf-csrf-v1:{session}".encode("utf-8"), hashlib.sha256).hexdigest()


def _require_csrf(request: StarletteRequest) -> None:
    session = request.cookies.get(SESSION_COOKIE, "")
    cookie = request.cookies.get(CSRF_COOKIE, "")
    header = request.headers.get("x-amf-csrf", "")
    expected = _csrf_for_session(session) if session else ""
    if not cookie or not header or not expected or not hmac.compare_digest(cookie, header) or not hmac.compare_digest(cookie, expected):
        raise HTTPException(status_code=403, detail="CSRF validation failed")


def _session_valid(request: StarletteRequest) -> bool:
    """Fail-closed session check: valid token-configured HMAC within TTL."""
    if not settings.owner_token:
        return False
    try:
        raw = request.cookies.get(SESSION_COOKIE, "")
        ts, sig = base64.urlsafe_b64decode(raw.encode("ascii")).decode("utf-8").split(".", 1)
        if abs(int(time.time()) - int(ts)) > SESSION_TTL_SECONDS:
            return False
        expect = hmac.new(_session_key(), ts.encode("utf-8"), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expect, sig)
    except Exception:
        return False


def _session_expires_at(request: StarletteRequest) -> str | None:
    """Return the verified session expiry for Owner-facing status only."""
    if not _session_valid(request):
        return None
    raw = request.cookies.get(SESSION_COOKIE, "")
    ts, _ = base64.urlsafe_b64decode(raw.encode("ascii")).decode("utf-8").split(".", 1)
    return datetime.fromtimestamp(int(ts) + SESSION_TTL_SECONDS, UTC).isoformat()


def _require_owner(request: StarletteRequest) -> str:
    """Return the Owner bearer for runtime forwarding, or raise 401."""
    if not settings.owner_token:
        raise HTTPException(status_code=503, detail="owner authentication is not configured; set AMF_OWNER_TOKEN")
    if not _session_valid(request):
        raise HTTPException(status_code=401, detail="owner sign-in required")
    return settings.owner_token


class AuthLoginRequest(BaseModel):
    token: str = Field(min_length=1, max_length=500)


@app.post("/api/auth/login")
def auth_login(request: AuthLoginRequest) -> Response:
    """Owner sign-in: constant-time token check, HttpOnly session cookie."""
    expected = settings.owner_token or ""
    ok = bool(expected) and hmac.compare_digest(request.token, expected)
    if not ok:
        raise HTTPException(status_code=401, detail="invalid owner token")
    session = _issue_session()
    csrf = _csrf_for_session(session)
    response = Response(content=json.dumps({"status": "signed_in", "csrf_token": csrf}), media_type="application/json")
    response.set_cookie(
        SESSION_COOKIE, session, httponly=True, samesite="strict",
        max_age=SESSION_TTL_SECONDS, path="/", secure=settings.app_env.lower() == "production",
    )
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, samesite="strict", max_age=SESSION_TTL_SECONDS,
                        path="/", secure=settings.app_env.lower() == "production")
    return response


@app.post("/api/auth/logout")
def auth_logout() -> Response:
    response = Response(content=json.dumps({"status": "signed_out"}), media_type="application/json")
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return response


@app.get("/api/auth/session")
def auth_session(request: StarletteRequest) -> dict[str, Any]:
    signed_in = _session_valid(request)
    return {
        "signed_in": signed_in,
        "auth_configured": bool(settings.owner_token),
        "session_ttl_seconds": SESSION_TTL_SECONDS,
        "session_expires_at": _session_expires_at(request) if signed_in else None,
        "csrf_token": request.cookies.get(CSRF_COOKIE) if signed_in else None,
    }


@app.get("/api/platform")
def platform() -> dict[str, Any]:
    """Business-safe projection of repository state for the control surface."""
    return _platform_snapshot()


@app.get("/api/projects/{project_id}/overview")
def project_overview(project_id: str) -> dict[str, Any]:
    _require_project(project_id)
    architecture = _brand_architecture()
    return {
        "project": _platform_snapshot()["projects"][0],
        "pipeline": [{"stage": stage, "count": None, "state": "unavailable until workflow records are connected"} for stage in
                     ["Ideas", "Research", "Brief", "Script", "Visual Plan", "Production", "QA", "Owner Review", "Ready", "Published"]],
        "agents": _recorded_agents(),
        "artifacts": [{
            "id": architecture.get("artifactId"), "title": "Brand architecture V1",
            "kind": architecture.get("kind"), "status": architecture.get("status"),
            "confidence": "recorded decision", "evidence": "artifacts/brand-architecture-v1.json",
            "createdAt": architecture.get("createdAt"),
        }] if architecture else [],
        "approvals": [{
            "id": architecture.get("artifactId"), "subject": "Brand architecture V1",
            "recommendation": "Architecture layers approved; consumer brand selection remains pending.",
            "ownerDecision": architecture.get("status"), "blocker": "Final consumer brand and legal entity remain undecided.",
        }] if architecture else [],
    }


@app.post("/api/command-room")
def command_room(request: CommandRequest) -> dict[str, Any]:
    mode = request.mode or ("ASK_AGENT" if len(request.audience) == 1 else "MULTI_AGENT_REVIEW")
    payload: dict[str, Any] = {"projectId": request.project_id,
                               "mode": mode, "message": request.message,
                               "selectedAgents": request.audience,
                               "context": {"projectId": request.project_id,
                                           "artifactRefs": ["art-brand-architecture-v1"],
                                           **(request.context_extra or {})}}
    if request.directive:
        payload["directive"] = request.directive
    return _runtime_request("/control/commands", "POST", payload)


@app.post("/api/approvals")
def approval(request: ApprovalRequest) -> dict[str, Any]:
    created = _runtime_request("/control/approvals", "POST", {"projectId": "morroway", "targetType": "artifact",
                              "targetId": "art-brand-architecture-v1", "agentRecommendation": request.recommendation,
                              "evidenceRefs": ["artifacts/brand-architecture-v1.json"]})
    approval_id = created["approval"]["approvalId"]
    return _runtime_request(f"/control/approvals/{approval_id}/decision", "POST",
                            {"action": request.action.upper(), "rationale": request.rationale})


@app.get("/api/runtime/{resource}")
def runtime_resource(resource: str, project_id: str = "morroway", workflow_id: str | None = None, artifact_id: str | None = None, content_id: str | None = None, subject_id: str | None = None, channel_id: str | None = None, binding_id: str | None = None, visibility: str | None = None, a: str | None = None, b: str | None = None, metric: str | None = None, question: str | None = None) -> dict[str, Any]:
    allowed = {"providers", "telemetry", "reports", "approvals", "commands", "projects", "revisions",
               "workflows", "health", "costs", "artifacts", "publication-readiness",
               "configuration-map", "configuration-history", "configuration-options",
               "strategy-entities", "strategy-effective", "strategy-preview",
                "strategy-artifact-lineage", "decision-queue", "agents",
                "agents-roster", "learning-summary", "content", "content-detail",
                "subjects", "subject-references", "scenes",
                "channels", "channel-detail", "publishing-route",
                "automation-policy", "automation-status", "automation-overview",
                "automation-jobs", "automation-events", "automation-attention",
                "automation-budgets",
                "model-intelligence-summary", "model-intelligence-models", "model-intelligence-shortlist",
                "analytics-overview", "analytics-content", "analytics-content-detail",
                "analytics-comparisons", "analytics-experiments", "analytics-insights",
                "analytics-availability", "analytics-agent-query"}
    allowed |= {"owner-onboarding", "owner-routing", "owner-next-cycle", "owner-audit",
                "owner-operation-matrix", "owner-health", "owner-credential-health", "owner-wan-supervised"}
    if resource not in allowed:
        raise HTTPException(status_code=404, detail="Unknown control resource")
    mapping = {"configuration-map": "configuration/map", "configuration-history": "configuration/history",
               "configuration-options": "configuration/options",
               "publication-readiness": "publication-readiness",
               "strategy-entities": "strategy/entities", "strategy-effective": "strategy/effective",
               "strategy-preview": "strategy/preview", "strategy-artifact-lineage": "strategy/artifact-lineage",
                 "decision-queue": "decision-queue",
                 "agents-roster": "agents/roster",
                 "learning-summary": "learning/summary",
                 "automation-policy": "automation/policy",
                 "automation-status": "automation/status",
                 "automation-overview": "automation/overview",
                 "automation-jobs": "automation/jobs",
                 "automation-events": "automation/events",
                 "automation-attention": "automation/attention",
                 "automation-budgets": "automation/budgets",
                 "model-intelligence-summary": "model-intelligence/summary",
                 "model-intelligence-models": "model-intelligence/models",
                 "model-intelligence-shortlist": "model-intelligence/shortlist",
                "analytics-overview": "analytics/overview",
                "analytics-content": "analytics/content",
                "analytics-content-detail": "analytics/content",
                "analytics-comparisons": "analytics/comparisons",
                "analytics-experiments": "analytics/experiments",
                "analytics-insights": "analytics/insights",
                "analytics-availability": "analytics/availability",
                "analytics-agent-query": "analytics/agent-query"}
    mapping.update({"owner-onboarding": "owner/onboarding", "owner-routing": "owner/routing",
                    "owner-next-cycle": "owner/next-cycle", "owner-audit": "owner/audit",
                    "owner-operation-matrix": "owner/operation-matrix", "owner-health": "owner/health",
                    "owner-credential-health": "owner/credential-health", "owner-wan-supervised": "owner/wan-supervised"})
    control = mapping.get(resource, resource)
    if resource == "content-detail":
        if not content_id:
            raise HTTPException(status_code=422, detail="content_id is required")
        return _runtime_request(f"/control/content/{quote(content_id, safe='')}")
    if resource == "analytics-content-detail":
        if not content_id:
            raise HTTPException(status_code=422, detail="content_id is required")
        return _runtime_request(f"/control/analytics/content/{quote(content_id, safe='')}?projectId={project_id}")
    if resource == "analytics-comparisons":
        if not a or not b or not metric:
            raise HTTPException(status_code=422, detail="a, b and metric are required")
        return _runtime_request(f"/control/{control}?projectId={project_id}&a={quote(a, safe='')}&b={quote(b, safe='')}&metric={quote(metric, safe='')}")
    if resource == "analytics-agent-query":
        if not question:
            raise HTTPException(status_code=422, detail="question is required")
        return _runtime_request(f"/control/{control}?projectId={project_id}&question={quote(question, safe='')}")
    if resource == "subject-references":
        if not subject_id:
            raise HTTPException(status_code=422, detail="subject_id is required")
        return _runtime_request(f"/control/subjects/{quote(subject_id, safe='')}/references")
    if resource == "channel-detail":
        if not channel_id:
            raise HTTPException(status_code=422, detail="channel_id is required")
        return _runtime_request(f"/control/channels/{quote(channel_id, safe='')}?projectId={project_id}")
    if resource == "publishing-route":
        if not channel_id:
            raise HTTPException(status_code=422, detail="channel_id is required")
        return _runtime_request(
            f"/control/publishing/route?projectId={project_id}&channelId={quote(channel_id, safe='')}"
            f"&bindingId={quote(binding_id or '', safe='')}&visibility={quote(visibility or '', safe='')}")
    if resource == "scenes":
        if not content_id:
            raise HTTPException(status_code=422, detail="content_id is required")
        return _runtime_request(f"/control/scenes?contentId={quote(content_id, safe='')}")
    control = mapping.get(resource, resource)
    if resource == "providers":
        return _runtime_request("/control/providers")
    if resource == "projects":
        return _runtime_request("/control/projects")
    if resource == "health":
        return _runtime_request("/control/health")
    if resource == "automation-overview":
        return _runtime_request("/control/automation/overview")
    if resource in {"model-intelligence-summary", "model-intelligence-models", "model-intelligence-shortlist"}:
        return _runtime_request(f"/control/{control}")
    suffix = f"?projectId={project_id}"
    if resource in {"artifacts", "publication-readiness"} and workflow_id:
        suffix += f"&workflowId={workflow_id}"
    if resource == "strategy-artifact-lineage":
        if not artifact_id:
            raise HTTPException(status_code=422, detail="artifact_id is required")
        return _runtime_request(f"/control/strategy/artifact-lineage?artifactId={artifact_id}")
    if resource == "configuration-history":
        suffix += ""
    return _runtime_request(f"/control/{control}{suffix}")


@app.get("/api/model-intelligence/overview")
def model_intelligence_overview() -> dict[str, Any]:
    return _runtime_request("/control/model-intelligence/overview")


@app.get("/api/model-intelligence/models")
def model_intelligence_models(q: str = "", price_class: str = "", capability: str = "",
                              evaluation: str = "", provider: str = "", sort: str = "name",
                              direction: str = "asc", page: int = 1, page_size: int = 25,
                              availability: str = "") -> dict[str, Any]:
    params = {"q": q, "priceClass": price_class, "capability": capability,
              "evaluation": evaluation, "provider": provider, "sort": sort,
              "direction": direction, "page": str(max(1, page)),
              "pageSize": str(max(1, min(100, page_size))), "availability": availability}
    query = "&".join(f"{quote(k, safe='')}={quote(v, safe='')}" for k, v in params.items() if v)
    return _runtime_request(f"/control/model-intelligence/models?{query}")


@app.get("/api/model-intelligence/models/{model_id:path}")
def model_intelligence_detail(model_id: str) -> dict[str, Any]:
    return _runtime_request(f"/control/model-intelligence/models/{quote(model_id, safe='')}")


@app.get("/api/model-intelligence/shortlist")
def model_intelligence_shortlist() -> dict[str, Any]:
    return _runtime_request("/control/model-intelligence/shortlist")


@app.get("/api/model-intelligence/providers")
def model_intelligence_providers() -> dict[str, Any]:
    return _runtime_request("/control/model-intelligence/providers")


@app.get("/api/model-intelligence/routing")
def model_intelligence_routing() -> dict[str, Any]:
    return _runtime_request("/control/model-intelligence/routing")

@app.get("/api/model-intelligence/roles")
def model_intelligence_roles() -> dict[str, Any]: return _runtime_request("/control/model-intelligence/roles")
@app.get("/api/model-intelligence/candidates")
def model_intelligence_candidates() -> dict[str, Any]: return _runtime_request("/control/model-intelligence/candidates")
@app.get("/api/model-intelligence/benchmark-plan")
def model_intelligence_benchmark_plan() -> dict[str, Any]: return _runtime_request("/control/model-intelligence/benchmark-plan")
@app.get("/api/model-intelligence/benchmark-runtime")
def model_intelligence_benchmark_runtime() -> dict[str, Any]: return _runtime_request("/control/model-intelligence/benchmark-runtime")
@app.get("/api/model-intelligence/blind-reviews")
def model_intelligence_blind_reviews() -> dict[str, Any]: return _runtime_request("/control/model-intelligence/blind-reviews")
class BenchmarkBlindReviewRequest(BaseModel):
    benchmarkRunId: str = Field(min_length=1, max_length=200)
    taskId: str = Field(min_length=1, max_length=100)
    blindCandidateId: str = Field(min_length=1, max_length=100)
    dimensionScores: dict[str, float]
    notes: str | None = Field(default=None, max_length=2000)
    finalized: bool = False
@app.post("/api/model-intelligence/blind-reviews")
def save_model_intelligence_blind_review(request: BenchmarkBlindReviewRequest) -> dict[str, Any]:
    return _runtime_request("/control/model-intelligence/blind-reviews", "POST", request.model_dump())
@app.get("/api/model-intelligence/executive")
def model_intelligence_executive() -> dict[str, Any]: return _runtime_request("/control/model-intelligence/executive")
@app.get("/api/model-intelligence/cost")
def model_intelligence_cost() -> dict[str, Any]: return _runtime_request("/control/model-intelligence/cost")


@app.get("/api/model-intelligence/price-history")
def model_intelligence_price_history(model_id: str = "", limit: int = 25) -> dict[str, Any]:
    suffix = f"?limit={max(1, min(500, limit))}"
    if model_id:
        suffix += f"&modelId={quote(model_id, safe='')}"
    return _runtime_request(f"/control/model-intelligence/price-history{suffix}")


PREVIEW_MAX_BYTES = 256 * 1024 * 1024
PREVIEW_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-.:]{0,200}$")


@app.get("/api/artifacts/preview")
def artifact_preview(request: StarletteRequest, artifact_id: str = "") -> Response:
    """Stream read-only inspection bytes for one canonical artifact ID.

    The browser references an artifact ID only; the Node control plane
    resolves bytes from durable metadata under confined storage roots.
    Only the Range header is forwarded. Statuses mirror the control plane
    (200/206 bytes, 400/403/404/413/416 denials). No mutation, no workflow,
    no authority change — inspection only.
    """
    if not artifact_id or not PREVIEW_ID_PATTERN.match(artifact_id):
        raise HTTPException(status_code=404, detail="artifact not found")
    forward: dict[str, str] = {}
    client_range = request.headers.get("range")
    if client_range:
        forward["Range"] = client_range
    url = f"{settings.runtime_api_url.rstrip('/')}/control/artifacts/preview?artifactId={quote(artifact_id, safe='')}"
    proxy_request = Request(url, headers=forward, method="GET")
    try:
        with urlopen(proxy_request, timeout=30) as response:  # nosec B310: configured local runtime URL
            body = response.read(PREVIEW_MAX_BYTES + 1)
            if len(body) > PREVIEW_MAX_BYTES:
                raise HTTPException(status_code=413, detail="preview too large")
            passthrough = {"Content-Length": str(len(body))}
            for name in ("Content-Type", "Content-Range", "Accept-Ranges", "Content-Disposition"):
                value = response.headers.get(name)
                if value is not None:
                    passthrough[name] = value
            return Response(content=body, status_code=response.status, headers=passthrough)
    except HTTPError as error:
        try:
            detail = json.loads(error.read().decode("utf-8")).get("error", "preview unavailable")
        except Exception:
            detail = "preview unavailable"
        raise HTTPException(status_code=error.code, detail=detail) from error
    except URLError as error:
        raise HTTPException(status_code=503, detail="AMF runtime API is unavailable. Start the API and worker before dispatching work.") from error


class ConfigChangeRequest(BaseModel):
    project_id: str = "morroway"
    agent_id: str | None = None
    scope: str = Field(pattern="^(PROJECT|AGENT)$")
    action: str = Field(pattern="^(SET|RESET)$")
    provider: str | None = None
    model: str | None = None
    rationale: str = Field(min_length=1, max_length=2000)


@app.post("/api/governance/override-requests")
def override_request(request: OverrideRequest) -> dict[str, Any]:
    # V1 operationalization: legacy stub retained for audit trail, but the
    # canonical path is /api/governance/configuration (durable SET/RESET).
    return {"status": "pending_owner_review", "scope": request.scope, "provider": request.provider,
            "model": request.model, "rationale": request.rationale, "createdAt": _timestamp(),
            "precedence": ["Global Default", "Project Override", "Agent Override"],
            "disclosure": "No provider or model setting has been changed. Use POST /api/governance/configuration for a durable change."}


@app.post("/api/governance/configuration")
def configuration_change(request: ConfigChangeRequest) -> dict[str, Any]:
    """Durable provider/model SET/RESET via the canonical Node control plane."""
    payload: dict[str, Any] = {"scope": request.scope, "projectId": request.project_id,
                               "action": request.action, "rationale": request.rationale}
    if request.agent_id:
        payload["agentId"] = request.agent_id
    if request.action == "SET":
        if not request.provider or not request.model:
            raise HTTPException(status_code=422, detail="provider and model are required for SET")
        payload["provider"] = request.provider
        payload["model"] = request.model
    result = _runtime_request("/control/configuration", "POST", payload)
    result["disclosure"] = "Durable configuration event persisted. No provider execution was triggered by this change."
    return result


class ApprovalDecideRequest(BaseModel):
    approval_id: str = Field(min_length=1, max_length=500)
    action: str = Field(min_length=1, max_length=40)
    rationale: str = Field(min_length=1, max_length=2000)


@app.post("/api/approvals/decide")
def approval_decide(request: ApprovalDecideRequest) -> dict[str, Any]:
    """Scoped owner decision on any approval (authority scope shown by GET first)."""
    return _runtime_request(f"/control/approvals/{request.approval_id}/decision", "POST",
                            {"action": request.action.upper(), "rationale": request.rationale})


class StrategyProposalRequest(BaseModel):
    project_id: str = "morroway"
    entity_type: str
    entity_key: str | None = None
    payload: dict[str, Any]
    source_artifact_ids: list[str] = []
    draft: bool = False


class StrategyActivationRequest(BaseModel):
    entity_id: str = Field(min_length=1, max_length=300)
    approval_id: str = Field(min_length=1, max_length=300)


@app.post("/api/strategy/proposals")
def strategy_propose(request: StrategyProposalRequest) -> dict[str, Any]:
    """Persist a strategic proposal as non-active state (never auto-activates)."""
    return _runtime_request("/control/strategy/proposals", "POST", {
        "projectId": request.project_id, "entityType": request.entity_type,
        "entityKey": request.entity_key, "payload": request.payload,
        "sourceArtifactIds": request.source_artifact_ids, "draft": request.draft,
        "createdBy": "owner"})


@app.post("/api/strategy/activations")
def strategy_activate(request: StrategyActivationRequest) -> dict[str, Any]:
    """Activate under exact Owner approval (fail-closed on scope/target mismatch)."""
    return _runtime_request("/control/strategy/activations", "POST",
                            {"entityId": request.entity_id, "approvalId": request.approval_id,
                             "activatedBy": "owner"})


@app.get("/api/strategy/preview")
def strategy_preview(project_id: str = "morroway", agent_id: str | None = None, task_class: str | None = None) -> dict[str, Any]:
    """Side-effect-free preview of the strategic context that WOULD be injected."""
    suffix = f"?projectId={project_id}"
    if agent_id:
        suffix += f"&agentId={agent_id}"
    if task_class:
        suffix += f"&taskClass={task_class}"
    return _runtime_request(f"/control/strategy/preview{suffix}")


def _evidence_metadata(refs: list[str]) -> list[dict[str, Any]]:
    """Presentation-level evidence refs: readable name + existence. Read-only stat; never mutates."""
    out = []
    for ref in refs:
        name = ref.rsplit("/", 1)[-1]
        kind = "artifact" if ref.startswith("art-") else "document" if ref.endswith(".md") else "reference"
        try:
            target = (REPOSITORY_ROOT / ref).resolve()
            exists = str(target).startswith(str(REPOSITORY_ROOT)) and target.exists()
        except (OSError, ValueError):
            exists = False
        out.append({"ref": ref, "name": name, "kind": kind,
                    "state": "listed" if exists else "Evidence reference unavailable"})
    return out


@app.get("/api/strategy/review")
def strategy_review(project_id: str = "morroway", entity_id: str = "") -> dict[str, Any]:
    """Owner review bundle: backend review + resolved evidence metadata."""
    if not entity_id:
        raise HTTPException(status_code=422, detail="entity_id is required")
    review = _runtime_request(f"/control/strategy/review?projectId={project_id}&entityId={entity_id}")
    review["evidence"] = _evidence_metadata(review.get("entity", {}).get("sourceArtifactIds", []) or [])
    return review


class StrategyDecisionRequest(BaseModel):
    project_id: str = "morroway"
    entity_id: str = Field(min_length=1, max_length=300)
    entity_type: str = Field(min_length=1, max_length=40)


@app.post("/api/strategy/decision-requests")
def strategy_decision_request(request: StrategyDecisionRequest) -> dict[str, Any]:
    """Request an Owner decision: creates a PENDING scoped approval. Grants no authority by itself."""
    scope = "STRATEGY_ACTIVATION" if request.entity_type == "STRATEGY" else f"{request.entity_type}_ACTIVATION"
    created = _runtime_request("/control/approvals", "POST", {
        "projectId": request.project_id, "targetType": scope, "targetId": request.entity_id,
        "agentRecommendation": {"activate": request.entity_id, "requestedVia": "strategy-review"},
        "evidenceRefs": []})
    created["disclosure"] = ("PENDING decision request only. No authority granted. "
                             "An Owner decision with rationale is still required, then a separate activation.")
    return created


@app.get("/api/strategy/snapshots/{snapshot_id}")
def strategy_snapshot(snapshot_id: str) -> dict[str, Any]:
    return _runtime_request(f"/control/strategy/snapshots/{snapshot_id}")


@app.get("/api/strategy/lineage/{execution_id}")
def strategy_execution_lineage(execution_id: str) -> dict[str, Any]:
    return _runtime_request(f"/control/strategy/lineage/{execution_id}")


@app.get("/api/lifecycle")
def lifecycle_list(project_id: str = "morroway", limit: int = 20) -> dict[str, Any]:
    """Canonical lifecycle summaries for a project's workflows (Owner-readable)."""
    return _runtime_request(f"/control/lifecycle?projectId={project_id}&limit={max(1, min(limit, 50))}")


@app.get("/api/lifecycle/{workflow_id}")
def lifecycle_detail(workflow_id: str) -> dict[str, Any]:
    """Canonical lifecycle for one workflow: current truth, history, outputs, blockers."""
    return _runtime_request(f"/control/lifecycle/{workflow_id}")


@app.get("/api/workflows/{workflow_id}")
def workflow_detail(workflow_id: str) -> dict[str, Any]:
    status = _runtime_request(f"/workflows/{workflow_id}")
    try:
        artifacts = _runtime_request(f"/workflows/{workflow_id}/artifacts")
    except HTTPException:
        artifacts = {"artifacts": []}
    try:
        lineage = _runtime_request(f"/workflows/{workflow_id}/lineage")
    except HTTPException:
        lineage = {"lineage": []}
    try:
        executions = _runtime_request(f"/workflows/{workflow_id}/executions")
    except HTTPException:
        executions = {"executions": []}
    return {"status": status, "artifacts": artifacts.get("artifacts", []),
            "lineage": lineage.get("lineage", []), "executions": executions.get("executions", [])}


@app.get("/api/projects/{project_id}/dashboard")
def project_dashboard(project_id: str) -> dict[str, Any]:
    """Operational aggregate for the Control Platform dashboard (all real runtime state)."""
    _require_project(project_id)
    projects = _runtime_request("/control/projects")
    entry = next((p for p in projects.get("projects", []) if p.get("projectId") == project_id), None)
    workflows = _runtime_request(f"/control/workflows?projectId={project_id}")
    approvals = _runtime_request(f"/control/approvals?projectId={project_id}")
    try:
        queue = _runtime_request(f"/control/decision-queue?projectId={project_id}")
        needs_decision_count = queue.get("counts", {}).get("needsDecision", 0)
    except HTTPException:
        needs_decision_count = None
    costs = _runtime_request(f"/control/costs?projectId={project_id}")
    health = _runtime_request("/control/health")
    readiness = _runtime_request(f"/control/publication-readiness?projectId={project_id}")
    latest_wf = (workflows.get("workflows", []) or [{}])[0].get("workflowId")
    artifacts = _runtime_request(f"/control/artifacts?projectId={project_id}") if not latest_wf else \
        _runtime_request(f"/control/artifacts?workflowId={latest_wf}")
    return {"project": entry, "workflows": workflows.get("workflows", []),
            "approvals": approvals.get("approvals", []), "needsDecisionCount": needs_decision_count,
            "costs": costs.get("costs"),
            "health": health.get("health"), "readiness": readiness.get("readiness"),
            "artifacts": (artifacts.get("artifacts", []) or [])[:12]}


GATE_LABELS = {"pre_production": "Require human approval before media production",
               "visual": "Require human approval after Visual QA"}


@app.get("/api/projects/{project_id}/gates")
def human_gates(project_id: str) -> dict[str, Any]:
    """Effective human-review-gate settings for the Control Platform."""
    _require_project(project_id)
    payload = _runtime_request(f"/control/human-gates?projectId={project_id}")
    for gate in payload.get("gates", []):
        gate["label"] = GATE_LABELS.get(gate.get("gateKey"), gate.get("gateKey"))
    return payload


@app.post("/api/projects/{project_id}/gates")
def update_human_gate(project_id: str, request: HumanGateRequest) -> dict[str, Any]:
    """Owner-authorized human-gate setting change (audited; never automatic)."""
    _require_project(project_id)
    return _runtime_request("/control/human-gates", "POST", {"projectId": project_id, "gateKey": request.gate_key,
                             "enabled": request.enabled, "rationale": request.rationale,
                             "changedBy": request.changed_by})


@app.post("/api/projects/{project_id}/gates/reset")
def reset_human_gate(project_id: str, request: HumanGateResetRequest) -> dict[str, Any]:
    """Reset a project gate override so it inherits the global default again."""
    _require_project(project_id)
    return _runtime_request("/control/human-gates/reset", "POST", {"projectId": project_id, "gateKey": request.gate_key,
                            "rationale": request.rationale, "changedBy": request.changed_by})


@app.get("/api/projects/{project_id}/gates/events")
def human_gate_events(project_id: str) -> dict[str, Any]:
    """Durable audit trail of human-gate configuration changes."""
    _require_project(project_id)
    return _runtime_request(f"/control/human-gates/events?projectId={project_id}")


class ContentCreateRequest(BaseModel):
    project_id: str = "morroway"
    title: str = Field(min_length=1, max_length=300)
    objective: str = Field(min_length=1, max_length=2000)
    channel: str = "youtube"
    format: str = "short"
    topic: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=2000)
    constraints: str | None = Field(default=None, max_length=2000)
    seed_artifact_id: str | None = None
    experiment_id: str | None = None
    production_brief: dict[str, Any] = {}


class ContentLinkRequest(BaseModel):
    workflow_id: str | None = None
    seed_artifact_id: str | None = None
    experiment_id: str | None = None


@app.post("/api/content")
def content_create(request: ContentCreateRequest) -> dict[str, Any]:
    """Create a governed content item (idea only; starts nothing)."""
    _require_project(request.project_id)
    created = _runtime_request("/control/content", "POST", {
        "projectId": request.project_id, "title": request.title,
        "objective": request.objective, "channel": request.channel,
        "format": request.format, "topic": request.topic, "notes": request.notes,
        "constraints": request.constraints, "seedArtifactId": request.seed_artifact_id,
        "experimentId": request.experiment_id, "productionBrief": request.production_brief})
    created["disclosure"] = ("Content item created as an idea. No workflow started, "
                             "nothing decided, no authority granted.")
    return created


@app.post("/api/content/{content_id}/link")
def content_link(content_id: str, request: ContentLinkRequest) -> dict[str, Any]:
    """Link existing canonical records to a content item (no execution)."""
    linked = _runtime_request(f"/control/content/{quote(content_id, safe='')}/link", "POST", {
        "workflowId": request.workflow_id, "seedArtifactId": request.seed_artifact_id,
        "experimentId": request.experiment_id})
    linked["disclosure"] = "Linked existing canonical records only. Nothing started or decided."
    return linked


class ProductionBriefRequest(BaseModel):
    brief: dict[str, Any]


class RevisionRequest(BaseModel):
    layer: str
    owner_feedback: str = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=1, max_length=1000)
    target_artifact_id: str | None = None
    previous_artifact_id: str | None = None


class VisualReviewRequest(BaseModel):
    artifact_id: str
    scene_id: str | None = None
    technical_qa: dict[str, Any]
    semantic_qa: str
    semantic_notes: str | None = None
    owner_acceptance: str = "PENDING"
    owner_feedback: str | None = None


class FinalApprovalRequest(BaseModel):
    final_artifact_id: str
    rationale: str = Field(min_length=1, max_length=2000)


class MetadataRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(min_length=1, max_length=5000)
    tags: list[str] = []
    visibility: str = "private"


@app.post("/api/content/{content_id}/brief")
def content_brief(content_id: str, request: ProductionBriefRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/content/{quote(content_id, safe='')}/brief", "POST", {"brief": request.brief})


@app.post("/api/content/{content_id}/start-production")
def content_start_production(content_id: str) -> dict[str, Any]:
    return _runtime_request(f"/control/content/{quote(content_id, safe='')}/start-production", "POST", {})


@app.post("/api/content/{content_id}/revisions")
def content_revision(content_id: str, request: RevisionRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/content/{quote(content_id, safe='')}/revisions", "POST", {
        "layer": request.layer, "ownerFeedback": request.owner_feedback, "reason": request.reason,
        "targetArtifactId": request.target_artifact_id, "previousArtifactId": request.previous_artifact_id})


@app.post("/api/content/{content_id}/visual-reviews")
def content_visual_review(content_id: str, request: VisualReviewRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/content/{quote(content_id, safe='')}/visual-reviews", "POST", {
        "artifactId": request.artifact_id, "sceneId": request.scene_id,
        "technicalQa": request.technical_qa, "semanticQa": request.semantic_qa,
        "semanticNotes": request.semantic_notes, "ownerAcceptance": request.owner_acceptance,
        "ownerFeedback": request.owner_feedback})


@app.post("/api/content/{content_id}/final-approval")
def content_final_approval(content_id: str, request: FinalApprovalRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/content/{quote(content_id, safe='')}/final-approval", "POST", {
        "finalArtifactId": request.final_artifact_id, "rationale": request.rationale})


@app.post("/api/content/{content_id}/metadata")
def content_metadata(content_id: str, request: MetadataRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/content/{quote(content_id, safe='')}/metadata", "POST", {
        "title": request.title, "description": request.description,
        "tags": request.tags, "visibility": request.visibility})


@app.post("/api/content/{content_id}/publication-preparations")
def content_publication_prepare(content_id: str) -> dict[str, Any]:
    return _runtime_request(f"/control/content/{quote(content_id, safe='')}/publication-preparations", "POST", {})


class SubjectCreateRequest(BaseModel):
    project_id: str = "morroway"
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=2000)
    subject_type: str = "person"
    traits: dict[str, Any] = {}
    wardrobe: dict[str, Any] = {}
    negatives: list[str] = []
    style_context: str | None = None
    voice_id: str | None = None
    supersedes: str | None = None


class SubjectApproveRequest(BaseModel):
    approved_by: str = "owner"
    rationale: str = Field(min_length=1, max_length=2000)


class SubjectReferenceRequest(BaseModel):
    project_id: str = "morroway"
    artifact_id: str = Field(min_length=1, max_length=300)
    reference_kind: str = Field(min_length=1, max_length=40)


class SceneSaveRequest(BaseModel):
    scene_id: str = Field(min_length=1, max_length=200)
    content_id: str = Field(min_length=1, max_length=300)
    project_id: str = "morroway"
    sequence: int
    duration_ms: int | None = None
    purpose: str | None = None
    script_ref: str | None = None
    visual: str | None = None
    subjects: list[dict[str, Any]] = []
    environment: str | None = None
    shot: str | None = None
    camera_angle: str | None = None
    movement: str | None = None
    continuity: list[str] = []
    references: list[str] = []
    intent: dict[str, Any] = {}
    audio_ref: str | None = None
    status: str = "PLANNED"


@app.post("/api/subjects")
def subject_create(request: SubjectCreateRequest) -> dict[str, Any]:
    """Create a subject profile draft (metadata only; starts nothing)."""
    _require_project(request.project_id)
    return _runtime_request("/control/subjects", "POST", {
        "projectId": request.project_id, "name": request.name,
        "description": request.description, "subjectType": request.subject_type,
        "traits": request.traits, "wardrobe": request.wardrobe,
        "negatives": request.negatives, "styleContext": request.style_context,
        "voiceId": request.voice_id, "supersedes": request.supersedes})


@app.post("/api/subjects/{subject_id}/approve")
def subject_approve(subject_id: str, request: SubjectApproveRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/subjects/{quote(subject_id, safe='')}/approve", "POST", {
        "approvedBy": request.approved_by, "rationale": request.rationale})


@app.post("/api/subjects/{subject_id}/references")
def subject_attach_reference(subject_id: str, request: SubjectReferenceRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/subjects/{quote(subject_id, safe='')}/references", "POST", {
        "projectId": request.project_id, "artifactId": request.artifact_id,
        "referenceKind": request.reference_kind})


@app.post("/api/scenes")
def scene_save(request: SceneSaveRequest) -> dict[str, Any]:
    """Persist a scene spec with subject bindings (no execution)."""
    _require_project(request.project_id)
    return _runtime_request("/control/scenes", "POST", {
        "sceneId": request.scene_id, "contentId": request.content_id,
        "projectId": request.project_id, "sequence": request.sequence,
        "durationMs": request.duration_ms, "purpose": request.purpose,
        "scriptRef": request.script_ref, "visual": request.visual,
        "subjects": request.subjects, "environment": request.environment,
        "shot": request.shot, "cameraAngle": request.camera_angle,
        "movement": request.movement, "continuity": request.continuity,
        "references": request.references, "intent": request.intent,
        "audioRef": request.audio_ref, "status": request.status})


class ProjectCreateRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=200, pattern="^[A-Za-z0-9][A-Za-z0-9_-]*$")
    display_name: str = Field(min_length=1, max_length=200)
    metadata: dict[str, Any] = {}


class ChannelCreateRequest(BaseModel):
    project_id: str = "morroway"
    platform: str = "youtube"
    display_name: str = Field(min_length=1, max_length=200)
    handle: str | None = None
    external_channel_id: str | None = None
    capabilities: dict[str, Any] = {}


class ChannelVerifyRequest(BaseModel):
    external_channel_id: str = Field(min_length=1, max_length=200)
    handle: str | None = None
    rationale: str = Field(min_length=1, max_length=2000)


class ChannelBindRequest(BaseModel):
    project_id: str = "morroway"
    provider: str = Field(min_length=1, max_length=100)
    credential_ref: str = Field(min_length=1, max_length=200)


@app.post("/api/projects")
def project_create(request: ProjectCreateRequest) -> dict[str, Any]:
    """Register a business project workspace (starts nothing)."""
    created = _runtime_request("/control/projects", "POST", {
        "projectId": request.project_id, "displayName": request.display_name,
        "metadata": request.metadata})
    created["disclosure"] = ("Project workspace registered. No strategy, content, "
                             "workflows, or authority created.")
    return created


@app.post("/api/channels")
def channel_create(request: ChannelCreateRequest) -> dict[str, Any]:
    """Create a channel record as PENDING (nothing uploads)."""
    return _runtime_request("/control/channels", "POST", {
        "projectId": request.project_id, "platform": request.platform,
        "displayName": request.display_name, "handle": request.handle,
        "externalChannelId": request.external_channel_id,
        "capabilities": request.capabilities})


@app.post("/api/channels/{channel_id}/verify")
def channel_verify(channel_id: str, request: ChannelVerifyRequest) -> dict[str, Any]:
    """Owner-attested channel verification (no provider call)."""
    return _runtime_request(f"/control/channels/{quote(channel_id, safe='')}/verify", "POST", {
        "externalChannelId": request.external_channel_id, "handle": request.handle,
        "rationale": request.rationale})


@app.post("/api/channels/{channel_id}/bindings")
def channel_bind(channel_id: str, request: ChannelBindRequest) -> dict[str, Any]:
    """Record an opaque credential binding (secrets never enter the store)."""
    return _runtime_request(f"/control/channels/{quote(channel_id, safe='')}/bindings", "POST", {
        "projectId": request.project_id, "provider": request.provider,
        "credentialRef": request.credential_ref})


class OwnerBudgetRequest(BaseModel):
    project_id: str
    phase: str = Field(min_length=1, max_length=100)
    call_kind: str = Field(min_length=1, max_length=100)
    limit: int = Field(ge=0, le=1000000)
    max_retries: int = Field(default=0, ge=0, le=10)
    reason: str = Field(min_length=1, max_length=2000)


class OwnerGoldenCanaryEnvelopeRequest(BaseModel):
    project_id: str
    phase: str = Field(pattern="^MORROWAY_GOLDEN_CANARY_[A-Z0-9_]{1,80}$")
    reason: str = Field(min_length=1, max_length=2000)


class OwnerRoutingActivationRequest(BaseModel):
    project_id: str
    routing_version_id: str = Field(min_length=1, max_length=300)
    reason: str = Field(min_length=1, max_length=2000)


class OwnerNextCycleDecisionRequest(BaseModel):
    project_id: str
    decision: str = Field(pattern="^(APPROVE|REJECT|DEFER|REQUEST_CHANGES)$")
    rationale: str = Field(min_length=1, max_length=2000)


class OwnerRecoveryRequest(BaseModel):
    authorized_by: str = "owner"
    rationale: str = Field(min_length=1, max_length=2000)
    provider_budget: int | None = Field(default=None, ge=0, le=100)


class OwnerWorkerRequest(BaseModel):
    project_id: str
    action: str = Field(pattern="^(START|STOP|RESTART)$")
    reason: str = Field(min_length=1, max_length=2000)


class OwnerWorkerDiagnosticRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=1, max_length=2000)


class OwnerCredentialHealthRequest(BaseModel):
    project_id: str
    action: str = Field(default="VERIFY_HEALTH", pattern="^(VERIFY_HEALTH|REFRESH_AND_VERIFY)$")
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_key: str = Field(min_length=8, max_length=300)


class OwnerWanSingleSceneRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=200)
    content_id: str = Field(min_length=1, max_length=300)
    workflow_id: str = Field(min_length=1, max_length=300)
    scene_id: str = Field(min_length=1, max_length=300)
    scene_visual_artifact_id: str = Field(min_length=1, max_length=300)
    scene_visual_sha256: str = Field(pattern="^[A-Fa-f0-9]{64}$")
    provider: str = Field(min_length=1, max_length=100)
    model: str = Field(min_length=1, max_length=200)
    model_config: dict[str, Any] = {}
    reason: str = Field(min_length=1, max_length=2000)
    idempotency_identity: str = Field(min_length=8, max_length=300)


class OwnerWanAttachJobRequest(BaseModel):
    project_id: str = Field(min_length=1, max_length=200)
    provider_job_id: str = Field(min_length=1, max_length=300)
    reason: str = Field(min_length=1, max_length=2000)


@app.post("/api/owner/budgets")
def owner_budget_set(request: OwnerBudgetRequest) -> dict[str, Any]:
    """Bounded production budget change; capacity is not execution authority."""
    return _runtime_request("/control/owner/budgets", "POST", {
        "projectId": request.project_id, "phase": request.phase,
        "callKind": request.call_kind, "limit": request.limit,
        "maxRetries": request.max_retries, "reason": request.reason,
        "actor": "owner-ui"})


@app.post("/api/owner/golden-canary-envelope")
def owner_golden_canary_envelope(request: OwnerGoldenCanaryEnvelopeRequest) -> dict[str, Any]:
    """Atomically create one scoped, no-retry pre-media Canary envelope."""
    return _runtime_request("/control/owner/golden-canary-envelope", "POST", {
        "projectId": request.project_id, "phase": request.phase,
        "reason": request.reason, "actor": "owner-ui"})


@app.post("/api/owner/routing/activate")
def owner_routing_activate(request: OwnerRoutingActivationRequest) -> dict[str, Any]:
    """Activate an existing benchmark-backed canonical routing version."""
    return _runtime_request("/control/owner/routing/activate", "POST", {
        "projectId": request.project_id, "routingVersionId": request.routing_version_id,
        "reason": request.reason, "actor": "owner-ui"})


@app.post("/api/owner/next-cycle/{proposal_id}/decision")
def owner_next_cycle_decision(proposal_id: str, request: OwnerNextCycleDecisionRequest) -> dict[str, Any]:
    """Record an immutable proposal decision. APPROVE still starts nothing."""
    return _runtime_request(
        f"/control/owner/next-cycle/{quote(proposal_id, safe='')}/decision", "POST", {
            "projectId": request.project_id, "decision": request.decision,
            "rationale": request.rationale, "actor": "owner-ui"})


@app.post("/api/owner/revisions/{task_id}/authorize")
def owner_revision_authorize(task_id: str, request: OwnerRecoveryRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/revisions/{quote(task_id, safe='')}/authorize", "POST", {
        "authorizedBy": request.authorized_by, "rationale": request.rationale})


@app.post("/api/owner/revisions/{task_id}/resume-review")
def owner_review_resume(task_id: str, request: OwnerRecoveryRequest) -> dict[str, Any]:
    return _runtime_request(f"/control/revisions/{quote(task_id, safe='')}/resume-review", "POST", {
        "authorizedBy": request.authorized_by, "rationale": request.rationale})


@app.get("/api/owner/media-resumes/{workflow_id}/eligibility")
def owner_media_resume_eligibility(workflow_id: str) -> dict[str, Any]:
    return _runtime_request(f"/control/media-resumes/{quote(workflow_id, safe='')}/eligibility")


@app.post("/api/owner/media-resumes/{workflow_id}/authorize")
def owner_media_resume_authorize(workflow_id: str, request: OwnerRecoveryRequest) -> dict[str, Any]:
    payload: dict[str, Any] = {"authorizedBy": request.authorized_by, "rationale": request.rationale}
    if request.provider_budget is not None:
        payload["providerBudget"] = request.provider_budget
    return _runtime_request(f"/control/media-resumes/{quote(workflow_id, safe='')}/authorize", "POST", payload)


@app.post("/api/owner/worker")
def owner_worker_control(request: OwnerWorkerRequest) -> dict[str, Any]:
    """Use only the canonical singleton launcher; never target arbitrary PIDs."""
    return _runtime_request("/control/owner/worker", "POST", {
        "projectId": request.project_id, "action": request.action,
        "reason": request.reason, "actor": "owner-ui"}, timeout_seconds=35)


@app.post("/api/owner/diagnostics/openrouter-egress")
def owner_openrouter_egress_probe(request: OwnerWorkerDiagnosticRequest) -> dict[str, Any]:
    """CSRF/auth proxy; the non-inference GET executes inside the worker."""
    return _runtime_request("/control/owner/diagnostics/openrouter-egress", "POST", {
        "projectId": request.project_id, "reason": request.reason,
        "actor": "owner-ui"}, timeout_seconds=25)


@app.post("/api/owner/credentials/{binding_id}/verify")
def owner_credential_health_verify(binding_id: str, request: OwnerCredentialHealthRequest) -> dict[str, Any]:
    """Proxy only: credential resolution and verification remain Node authority."""
    return _runtime_request(f"/control/owner/credentials/{quote(binding_id, safe='')}/verify", "POST", {
        "projectId": request.project_id, "action": request.action, "reason": request.reason,
        "idempotencyKey": request.idempotency_key, "actor": "owner-ui"}, timeout_seconds=45)


@app.post("/api/owner/wan-supervised/generate")
def owner_wan_single_scene_generate(request: OwnerWanSingleSceneRequest) -> dict[str, Any]:
    """CSRF/auth proxy only; Node owns authorization, ledger and execution state."""
    return _runtime_request("/control/owner/wan-supervised/generate", "POST", {
        "projectId": request.project_id, "contentId": request.content_id,
        "workflowId": request.workflow_id, "sceneId": request.scene_id,
        "sceneVisualArtifactId": request.scene_visual_artifact_id,
        "sceneVisualSha256": request.scene_visual_sha256,
        "provider": request.provider, "model": request.model,
        "modelConfig": request.model_config, "reason": request.reason,
        "idempotencyIdentity": request.idempotency_identity, "actor": "owner-ui"})


@app.post("/api/owner/wan-supervised/{execution_id}/attach-provider-job")
def owner_wan_attach_provider_job(execution_id: str, request: OwnerWanAttachJobRequest) -> dict[str, Any]:
    """Attach Owner-attested reconciliation identity; never calls RunPod."""
    return _runtime_request(
        f"/control/owner/wan-supervised/{quote(execution_id, safe='')}/attach-provider-job", "POST", {
            "projectId": request.project_id, "providerJobId": request.provider_job_id,
            "reason": request.reason, "actor": "owner-ui"})


class AutomationPolicyRequest(BaseModel):
    project_id: str = "morroway"
    enabled: bool = False
    level: str = "L0_MANUAL"
    allowed_ops: list[str] = []
    human_gated_ops: list[str] = []
    provider_policy: dict[str, Any] = {"mode": "DENY_ALL"}
    publication_policy: str = "PREPARE_ONLY"
    next_cycle_policy: str = "OWNER_START_ONLY"


class AutomationJobRequest(BaseModel):
    project_id: str = "morroway"
    job_type: str = Field(min_length=1, max_length=100)
    due_at: str | None = None
    payload: dict[str, Any] = {}
    idempotency_key: str = Field(min_length=1, max_length=200)
    max_attempts: int | None = None


class AutomationBudgetRequest(BaseModel):
    project_id: str = "morroway"
    call_kind: str = Field(min_length=1, max_length=50)
    limit_count: int = Field(ge=0, le=1000000)
    max_retries: int = Field(default=0, ge=0, le=10)
    limit_kind: str = Field(default="HARD", pattern="^(HARD|SOFT)$")
    cost_kind: str = Field(default="UNKNOWN", pattern="^(KNOWN|UNKNOWN)$")
    known_unit_cost_usd: float | None = Field(default=None, ge=0)


class AutomationTickRequest(BaseModel):
    project_id: str = "morroway"
    max_actions: int = Field(default=5, ge=1, le=25)


class AutomationTriggerRequest(BaseModel):
    project_id: str = "morroway"
    trigger_kind: str = Field(min_length=1, max_length=100)
    subject_type: str | None = None
    subject_id: str | None = None
    payload: dict[str, Any] = {}


class AutomationMeasurementRequest(BaseModel):
    project_id: str = "morroway"
    publication_id: str | None = None
    channel_id: str | None = None
    window_start: str | None = None
    window_end: str | None = None
    due_at: str | None = None
    idempotency_key: str = Field(min_length=1, max_length=200)


class AutomationLearningChainRequest(BaseModel):
    project_id: str = "morroway"
    observation_id: str = Field(min_length=1, max_length=200)


@app.post("/api/automation/policy")
def automation_policy_set(request: AutomationPolicyRequest) -> dict[str, Any]:
    """Set project automation policy. Disabled by default; Owner action only."""
    return _runtime_request("/control/automation/policy", "POST", {
        "projectId": request.project_id, "enabled": request.enabled,
        "level": request.level, "allowedOps": request.allowed_ops,
        "humanGatedOps": request.human_gated_ops,
        "providerPolicy": request.provider_policy,
        "publicationPolicy": request.publication_policy,
        "nextCyclePolicy": request.next_cycle_policy})


@app.post("/api/automation/jobs")
def automation_job_schedule(request: AutomationJobRequest) -> dict[str, Any]:
    """Schedule an internal automation job (idempotent; never publishes)."""
    payload: dict[str, Any] = {"projectId": request.project_id,
                               "jobType": request.job_type,
                               "payload": request.payload,
                               "idempotencyKey": request.idempotency_key}
    if request.due_at:
        payload["dueAt"] = request.due_at
    if request.max_attempts is not None:
        payload["maxAttempts"] = request.max_attempts
    return _runtime_request("/control/automation/jobs", "POST", payload)


@app.post("/api/automation/jobs/{job_id}/cancel")
def automation_job_cancel(job_id: str, request: dict[str, Any]) -> dict[str, Any]:
    """Cancel a pending automation job (terminal rows untouched)."""
    project_id = str(request.get("project_id") or "morroway")
    return _runtime_request(f"/control/automation/jobs/{quote(job_id, safe='')}/cancel",
                            "POST", {"projectId": project_id,
                                     "reason": str(request.get("reason") or "owner-cancelled")})


@app.post("/api/automation/attention/{attention_id}/resolve")
def automation_attention_resolve(attention_id: str, request: dict[str, Any]) -> dict[str, Any]:
    """Resolve one Owner attention item explicitly (never auto-cleared)."""
    project_id = str(request.get("project_id") or "morroway")
    return _runtime_request(
        f"/control/automation/attention/{quote(attention_id, safe='')}/resolve",
        "POST", {"projectId": project_id})


@app.post("/api/automation/budgets")
def automation_budget_set(request: AutomationBudgetRequest) -> dict[str, Any]:
    """Set a count-based call budget (monetary price stays UNKNOWN)."""
    return _runtime_request("/control/automation/budgets", "POST", {
        "projectId": request.project_id, "callKind": request.call_kind,
        "limitCount": request.limit_count, "maxRetries": request.max_retries,
        "limitKind": request.limit_kind, "costKind": request.cost_kind,
        "knownUnitCostUsd": request.known_unit_cost_usd})


@app.post("/api/automation/explain")
def automation_explain(request: dict[str, Any]) -> dict[str, Any]:
    """Dry-run: what would automation do next (executes nothing)."""
    return _runtime_request("/control/automation/explain", "POST", {
        "projectId": str(request.get("project_id") or "morroway")})


@app.post("/api/automation/tick")
def automation_tick(request: AutomationTickRequest) -> dict[str, Any]:
    """Run one bounded automation tick (stops at human gates)."""
    return _runtime_request("/control/automation/tick", "POST", {
        "projectId": request.project_id, "maxActions": request.max_actions,
        "actor": "owner-ui"})


@app.post("/api/automation/triggers")
def automation_trigger(request: AutomationTriggerRequest) -> dict[str, Any]:
    """Record a deterministic automation trigger (no blind polling)."""
    return _runtime_request("/control/automation/triggers", "POST", {
        "projectId": request.project_id, "triggerKind": request.trigger_kind,
        "subjectType": request.subject_type, "subjectId": request.subject_id,
        "payload": request.payload})


@app.post("/api/automation/proposals/{proposal_id}/start")
def automation_proposal_start(proposal_id: str, request: dict[str, Any]) -> dict[str, Any]:
    """Evaluate a next-cycle proposal through the governed starter."""
    return _runtime_request(
        f"/control/automation/proposals/{quote(proposal_id, safe='')}/start",
        "POST", {"actor": "owner-ui"})


@app.post("/api/automation/analytics/measurements")
def automation_measurement_schedule(request: AutomationMeasurementRequest) -> dict[str, Any]:
    """Schedule a governed analytics measurement window (fixture-only)."""
    payload: dict[str, Any] = {"projectId": request.project_id,
                               "idempotencyKey": request.idempotency_key}
    for key, value in (("publicationId", request.publication_id),
                       ("channelId", request.channel_id),
                       ("windowStart", request.window_start),
                       ("windowEnd", request.window_end),
                       ("dueAt", request.due_at)):
        if value:
            payload[key] = value
    return _runtime_request("/control/automation/analytics/measurements", "POST", payload)


@app.post("/api/automation/learning/chain")
def automation_learning_chain(request: AutomationLearningChainRequest) -> dict[str, Any]:
    """Progress observation→learning→recommendation→proposal (internal only)."""
    return _runtime_request("/control/automation/learning/chain", "POST", {
        "projectId": request.project_id, "observationId": request.observation_id})


@app.post("/api/automation/recover")
def automation_recover(request: dict[str, Any]) -> dict[str, Any]:
    """Re-queue jobs interrupted by a runtime restart (no duplication)."""
    return _runtime_request("/control/automation/recover", "POST", {
        "projectId": str(request.get("project_id") or "morroway")})


@app.get("/")
def control_platform() -> HTMLResponse:
    """Owner shell with content-hashed asset URLs so a stale cached bundle can never masquerade as current UI."""
    import hashlib
    raw = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    js_digest = hashlib.sha256((STATIC_DIR / "app.js").read_bytes()).hexdigest()[:12]
    css_digest = hashlib.sha256((STATIC_DIR / "style.css").read_bytes()).hexdigest()[:12]
    html = raw.replace("/static/app.js", f"/static/app.js?v={js_digest}").replace(
        "/static/style.css", f"/static/style.css?v={css_digest}")
    return HTMLResponse(html, headers={"Cache-Control": "no-store"})
