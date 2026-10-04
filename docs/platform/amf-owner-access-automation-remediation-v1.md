# AMF Owner Access and Automation Runtime Remediation V1

Date: 2026-09-24  
Result: **PASS**  
Scope: post-acceptance product/runtime remediation after Program 6.  
Governance: Morroway remained Automation OFF / L0. No provider, YouTube,
live-analytics, LLM, media-generation, upload, or publication call occurred.

## Canonical history boundary

This event is append-only and does not reopen or rewrite Program 6:

1. Program 6 — Governed Automation: CLOSED / PASS.
2. Post-acceptance Owner UI `app.js` parse-time regression: FOUND, then FIXED;
   remediation PASS (`node --check` is now an automated Owner test guard).
3. Post-acceptance Automation runtime integration defect: FOUND, then FIXED;
   this remediation PASS.

Program 7 remains NOT STARTED. M4 measurement is independent and unchanged;
`M4_CALLS_CONSUMED=0` during this remediation.

## Owner authentication contract (Program 1 preserved)

- `AUTH_SECRET_SOURCE = AMF_SESSION_SECRET` when explicitly configured;
  otherwise the session HMAC key is derived from `AMF_OWNER_TOKEN` with a
  domain-separated SHA-256 derivation. Neither value is returned to the UI.
- `OWNER_TOKEN_SOURCE = AMF_OWNER_TOKEN` in the deployment environment. The
  controlled localhost supervisor loads the repository-root private `.env`.
  `.env` remains ignored and no credential is committed or printed.
- `OWNER_TOKEN_LIFECYCLE = deployment-managed static localhost Owner secret`.
  The operator creates/rotates it outside source control and restarts the
  controlled runtime. Rotation invalidates old sessions when the token is the
  HMAC fallback; rotating a distinct `AMF_SESSION_SECRET` invalidates sessions
  independently.
- `SESSION_COOKIE_MODEL = amf_session`, HttpOnly, SameSite=Lax, path `/`,
  Max-Age 43,200 seconds. Its value is only an issued-at timestamp plus an HMAC;
  it does not contain the raw Owner token or an authorization grant.
- `SESSION_TTL = 12 hours`, enforced server-side and now exposed as safe expiry
  metadata from `/api/auth/session` for product status.
- `SESSION_RESTART_BEHAVIOR = remains valid across restart when deployment
  secrets are unchanged`; expiry, sign-out, or secret rotation ends it.
- `BROWSER_SECRET_STORAGE = none`: the password-type field is not copied to
  localStorage/sessionStorage, is cleared after successful sign-in, and the raw
  token is sent only in the login request body. The browser retains only the
  HttpOnly session cookie.
- `MUTATION_AUTHORIZATION_MODEL = two-hop fail-closed`: Python requires a valid
  signed session for every state-changing `/api/*` call, then forwards the
  configured Owner token as a request-scoped Bearer credential; Node performs
  a constant-time comparison on every state-changing control route. Read-only
  inspection stays open.

This remains the intentionally limited single-Owner localhost MVP model, not
email/password, external identity, or multi-user SaaS authentication. The UI
now explains why sign-in exists, where this deployment is configured, who
supplies the credential, what remains readable while signed out, the 12-hour
session, raw-token handling, restart/rotation behavior, current status, and
sign-out. A stale Global System claim that mutations were unauthenticated was
removed.

## Automation 404 forensic matrix

| UI surface | Frontend request | Python route | Node route | Expected response | Before remediation | Root cause |
|---|---|---|---|---|---|---|
| Automation status | `GET /api/runtime/automation-status?project_id=<id>` | `runtime_resource` mapping | `GET /control/automation/status?projectId=<id>` | Project status with OFF/L0 default | 404 `{"error":"not found"}` | Listening Node process predated Program 6 routes |
| What needs me | `GET /api/runtime/automation-attention?project_id=<id>` | `runtime_resource` mapping | `GET /control/automation/attention?projectId=<id>` | Scoped attention list | Same 404 | Same stale served runtime; route/source contract itself was correct |
| Scheduled & waiting work | `GET /api/runtime/automation-jobs?project_id=<id>` | `runtime_resource` mapping | `GET /control/automation/jobs?projectId=<id>` | Scoped jobs list | Same 404 | Same stale served runtime; GET/method and parameter mapping were correct |
| Budget remaining | `GET /api/runtime/automation-budgets?project_id=<id>` | `runtime_resource` mapping | `GET /control/automation/budgets?projectId=<id>` | Scoped count budgets | Same 404 | Same stale served runtime |
| All projects at a glance | `GET /api/runtime/automation-overview` | explicit global mapping | `GET /control/automation/overview` | Every registered project with current/default state | Same 404; source also omitted registered projects with no policy/activity | Stale runtime plus a real read-model completeness defect |
| Recent automation history | `GET /api/runtime/automation-events?project_id=<id>` | `runtime_resource` mapping | `GET /control/automation/events?projectId=<id>` | Scoped audit events | Same 404 | Same stale served runtime |

The Python facade did contain the Program 6 routes and correct snake-to-camel
project propagation. Authentication middleware was not involved because these
were open GETs. The base URL (`127.0.0.1:8080`), route prefix, API version,
methods, and source bundle were correct. Direct calls to the live Node listener
proved the 404 originated in the stale process. The facade now also normalizes
upstream JSON error bodies so product errors do not surface as JSON-encoded
strings.

The architectural fixes were:

- rebuild and cleanly restart the canonical supervised Node/Python/worker
  runtime from current source;
- include the canonical `control_projects` registry in platform Automation
  overview, using `getPolicy()`'s truthful OFF/L0 default when no policy exists;
- keep the global overview route global (no synthetic project query);
- preserve real empty lists as product empty states, never fabricated zeros;
- preserve all existing mutation auth and governance boundaries.

## Mutation and governance proof

- Signed-out live `POST /api/automation/tick`: 401 before handler execution.
- Invalid live Owner credential: 401.
- Valid configured live Owner credential: 200; `/api/auth/session` changed to
  signed in without exposing the secret.
- Live preview-next-actions: `executed=false`, with no jobs/actions created.
- Sign-out: session returned to signed out.
- Authenticated mutation contract was exercised only in the isolated TEST DB:
  Automation API 7/7 and governed Automation matrix 34/34 passed, including
  policy, budgets, bounded tick, Owner boundary, retries, isolation, and dry-run
  purity. No live Morroway mutation was used as proof.
- Live Morroway after restart: `enabled=false`, `level=L0_MANUAL`,
  `state=DISABLED`, running/waiting/scheduled all zero, no policy row.

`PRODUCTION_AUTHORITY=NOT_GRANTED`,
`GENERAL_PUBLICATION_AUTHORITY=NOT_GRANTED`, and
`PUBLIC_STATUS=NOT_PUBLISHED` remain unchanged.

## Served product and regression proof

- Root and Project Hub rendered in the actual in-app browser with Morroway
  selected and `signed out · inspection only` visible.
- Owner sign-in page rendered the deployment credential explanation, read-only
  boundary, HttpOnly session model, TTL, restart/rotation behavior, and sign-out
  journey without displaying the configured value.
- Automation rendered all eight product sections with real/default canonical
  state and distinct empty states. No section showed a transport error.
- Content, Analytics, Owner Decision Center, and Project Settings rendered live
  data while signed out.
- `node --check apps/api/src/ai_media_factory/static/app.js` passed and is now
  invoked by `owner-bundle-syntax.test.js` in the ordinary API suite.
- Root HTML pinned `app.js?v=6e16674006b1`; SHA-256 of the live served bytes and
  source bytes matched exactly.
- Full API suite: 158/158 PASS. Full database suite: 222/222 PASS. Python
  auth/facade suite: 10/10 PASS. TypeScript API/database build and lint PASS.

## Previous red-test debt

The four `hub-dashboard.test.js` failures were `HARNESS_ONLY=YES`,
`REAL_PRODUCT_DEFECT=NO`, `STALE_TEST=YES`, `REAL_ROUTE_DEFECT=NO`.
`dashboard()` legitimately calls the browser-global `loadDashboardChannels()`;
the extraction harness supplied the dashboard function but not that dependency.
The harness now supplies a no-op dependency for dashboard-only assertions.
All four tests pass and the production dashboard implementation is unchanged.

## Runtime operations note

The first stop found a stale supervisor PID file while an older unrecorded
supervisor still owned the services. That orphan supervisor restarted children
and briefly caused port collisions/duplicate worker heartbeats. The exact AMF
process trees were stopped, ports 8000/8080 were verified free, and one clean
supervisor was started. No queued/running work existed during restart. Final
supervisor state has one API, one worker process, and one UI service with zero
restart failures in the clean run.

## Change classification

- Schema changes: none.
- Database migration: none (existing additive migrations were merely verified).
- Live data changes: none.
- Next recommended program: **Pre-Production Morroway Readiness Audit**.
- Program 7: **NOT STARTED**.

