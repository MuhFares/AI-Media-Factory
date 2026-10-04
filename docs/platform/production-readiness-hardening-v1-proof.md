# Production Readiness Hardening V1 — Proof (Program 1)

**Date:** 2026-09-23/24. **Mode:** PLATFORM_VALIDATION_MODE.
Authority throughout: NOT_GRANTED / NOT_GRANTED / NOT_PUBLISHED.
No public publishing. No workflows/commands started for this program
(except isolated TEST DB fixtures). No provider/LLM calls.

## Workstream results (all PASS)

### A — Publication status truth
`provider_publications.visibility` (nullable, additive; single verified
backfill of the M4 private row). Lifecycle derives PUBLISHED only for
exact `public` visibility; private/unlisted/unknown/missing fail closed
to NOT_PUBLISHED. New `providerPublication` field keeps confirmation
visible separately. Owner UI (pipeline, workflow Authority, dashboard)
shows "Provider record: private" with "integration truth, not public
visibility" copy. Live Morroway lifecycle now reads NOT_PUBLISHED with
the private record visible. Tests: publication-visibility 8/8 DB +
3/3 UI.

### B — Authentication foundation
Node: Bearer check (constant-time) on every POST/PUT/DELETE/PATCH under
`/control/*` and `/workflows`; 503 unconfigured, 401 unauthenticated;
GETs open. Python: HMAC session cookie (12h TTL, HttpOnly, SameSite),
login/logout/session endpoints, mutation middleware forwarding the
bearer request-scoped. UI: sign-in view, auth chip, sign-out. Deployment
token generated into gitignored `.env` (never printed). Live verified:
login 200, authed read 200, unauthenticated mutation blocked, logout 200.
Tests: owner-auth 2/2 Node, auth_session 4/4 pytest; 9 existing suites
updated to authenticate.

### C — Supervision
`scripts/amf-supervise.mjs` (api → worker → ui, health-gated order,
5s backoff, crash-loop guard at 5 exits/120s, logs/ retention, status
file), `amf-status.mjs` (supervisor + live health summary),
`amf-down.mjs`. Live stack currently runs supervised (api + persistent
production worker with fresh heartbeat + ui, 0 restarts). Worker mode
fix discovered during bring-up: supervisor sets
AMF_WORKER_RUNTIME_MODE=persistent-production-worker (dash form; the
underscored form does not match the marker) plus launcher tag.

### D — Backup / restore
`scripts/amf-backup.mjs` (pg_dump custom format outside repo;
verified 37MB dump) and `scripts/amf-restore.mjs` (refuses production
targets, creates non-existing targets). Verified: restored into scratch
DB (1 project, 68 approvals, 168 artifacts, 4 publications, 75 strategic
entities), scratch dropped afterwards. Error output sanitized for
connection strings.

### E — Test database
`scripts/amf-testdb.mjs` (derive by path-swap, production-identity guard,
create + migrate, --reset with DROP guard, --print-export opt-in only).
All DB suites now run reproducibly with TEST_DATABASE_URL set.

### F — Runtime currency
Documented in amf-runtime-operations-v1.md; proven by this program's own
deployments (served-bundle hash matched source twice, health + decision
counts verified after each restart).

### G — Secrets / OAuth operations
Documented in amf-runtime-operations-v1.md (external files, ephemeral
tokens, refresh/rotation/re-consent, channel guard, gitignore defense,
no-secret logging). No architecture change; no secrets moved.

### H — Test/policy debt
resolvedAt flake: fixed in test (wall-clock excluded from deep-equal;
canonical behavior is per-call timestamp). boundary unlisted drift:
canonical fail-closed PUBLIC_PUBLISH gate kept; stale test aligned to
assert blocked-before-provider (success path remains covered in
tool-framework guard tests).

### I — Observability
amf-status.mjs + supervisor status file + existing health/costs/global
surfaces verified live (db ok, queue idle, worker live, UI 200).
No metrics/tracing/alerting (Program 7 scope).

## Files changed (summary)

- packages/database/src: schema.ts (visibility column + verified backfill),
  publish-store.ts, lifecycle.ts, index.ts (unchanged exports surface).
- apps/api/src/handler.ts + server.ts (auth enforcement; learning wiring
  unchanged), ai_media_factory/{config,main}.py (session + guard),
  static/app.js (auth UI + provider-publication lines).
- packages/provider-adapters: no source change in Program 1 (boundary
  test alignment only).
- scripts/: amf-supervise, amf-status, amf-down, amf-testdb, amf-backup,
  amf-restore (new); test files updated for auth headers.
- docs/: amf-master-program-state.md (new), amf-runtime-operations-v1.md
  (new), this proof.

## Debt remaining (non-blocking)

AGENT_ROUTER/AGENTROUTER env-name mismatch (UX-AGENT-004, still blocked);
20 root run-*.mjs scripts (removal deferred); apps/web stub; mcp
README-only package; metrics/tracing/alerting (Program 7).

## External pending proofs

M4 measurement schedule intact (T+24h from 2026-09-23T01:02:22Z, 2 reads
remaining); no analytics calls consumed by this program.
