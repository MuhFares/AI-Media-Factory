# Control Platform Gap-to-Operational Audit V1

Date: 2026-09-18. Source of truth: current repository + live Postgres (`DATABASE_URL`) + Node handler + Python facade + static UI. Historical handoff used for intent only.

Reference fixture: `wf-1789233193749-gvydpiah` (produce, `revision_required`), 29 submissions, 6 `control_approvals` for `morroway`, 15+ artifacts on the reference workflow incl. `art-...-final-media`, `publication_integration_validation`, `final_product_review`, `final_technical_qa`.

## Executive Summary

Backend is substantially real: Postgres persistence (31 tables), durable queue, worker with heartbeat/build identity, governed agent runtime, approvals/human gates/revisions/media-resume dispatchers, provider boundary, telemetry/cost-kind semantics, lineage. Canonical Node API (`:8080`, `apps/api/src/handler.ts`) exposes ~20 routes backed by real persistence.

Control Platform surface is split and incomplete: `apps/web` is a 17-line Node stub (no routes/components/API client). The actual UI is the Python FastAPI facade (`:8000`, `apps/api/src/ai_media_factory/main.py` + `static/app.js`, ~28 lines minified-ish JS) which mixes real proxies (`/control/commands`, `/control/approvals`, human gates, telemetry, reports, providers) with hardcoded/mock projections (`/api/platform`, `/api/projects/morroway/overview`, pipeline counts, agent provider/model always null, `override-requests` stub that persists nothing and only serves `morroway`).

`CONTROL_PLATFORM_GAP_AUDIT = FAIL` (not yet owner-operable). No false completion: pages render but Owner cannot discover real workflow state, approval scope/authority, effective provider/model, costs with UNKNOWN semantics, health, lineage, or publication blockers from the UI alone today.

## Current Architecture

- `apps/api/src/server.ts` + `handler.ts` (raw `node:http`, no framework/auth): workflows submit/status/artifacts/lineage/executions; `/control/{approvals,commands,revisions,human-gates,media-resumes,providers,telemetry,reports,configuration}`. All mutations durable + idempotent. No `/health` on Node.
- `apps/api/src/ai_media_factory/main.py` (FastAPI `:8000`): `/health` (shallow, no DB check), `/api/platform` (hardcoded morroway + file read), `/api/projects/{id}/overview` (404 unless morroway; pipeline counts null), `/api/command-room` (proxy), `/api/approvals` (hardcoded targetId `art-brand-architecture-v1`), `/api/runtime/{resource}` allowlist `{providers,telemetry,reports,approvals,commands}`, `/api/governance/override-requests` (stub, no persistence), gates proxy (+labels), `/` serves `static/index.html`.
- `static/app.js` views: hub, dashboard, pipeline, agents, command, approvals, reports, analytics (honest empty), assets (honest empty), settings (gates, real), system. Dashboard telemetry/reports/providers/gates are live; hub/pipeline/agents/config/approvals are still mock/static.
- `packages/database/src/schema.ts` (`SCHEMA_DDL`, advisory-lock migrate, no migrations dir): 31 tables; `control-plane.ts` (`ControlPlaneStore`): approvals, commands, telemetry/reports JOINs, config events, human gates, revision/review-resume/media-resume settling.
- `apps/worker`: `WorkflowWorker` claim/load/start|resume/ack, heartbeat every 60s to `amf_worker_presence`, build identity `SHA256(dist/**)` (`media-build-identity.ts`), parity enforced pre-authorization (`assertWorkerBuildParity`, maxAge 300s, exactly-1-live expectation in scripts).
- Live DB state: queue `succeeded 14 / failed 32`; worker presence shows 5 rows, 2+ with same build `98e9ee65...` (violates exactly-one-canonical-worker expectation); costs show `FREE` (0) vs `UNKNOWN` (null) correctly persisted; approvals show `DECIDED/PENDING` with `target_type` carrying scope signal (`publication_integration_validation_gate` vs `workflow_gate` vs `artifact`).

## Capability Matrix

| Capability | Backend | Persisted | API | UI visible | Owner action | Authority | Audit/history | Real/Mock | Tested | Gap |
|---|---|---|---|---|---|---|---|---|---|---|
| Projects | partial (brand_id on submissions) | yes (submissions) | NO dedicated endpoint | mock (hardcoded morroway) | select only | n/a | no | MOCK | no | P0: no list endpoint |
| Workflows/Runs | yes | yes | GET one by id only, no list | NO (dashboard "Unavailable") | submit via commands | directive validation | via jobs | PARTIAL | yes (ship) | P0: no list per project |
| Pipeline stages | yes (steps/instances) | yes | via status.steps | STATIC (10 hardcoded stages, counts null) | inspect only | n/a | via checkpoints | MOCK | partial | P0: derive from truth |
| Jobs/Queue | yes (PostgresQueue) | yes | via status.jobs | NO | none | n/a | jobs table | PARTIAL | yes | P1: expose depth/failures |
| Workers | yes (heartbeat/build) | yes (`amf_worker_presence`) | NO | NO ("healthy" hardcoded) | none | n/a | presence rows | MOCK | no | P0: misleading health |
| Agents/Runs | yes (governed runtime) | yes (provenance) | via telemetry | PARTIAL (package existence, status IDLE stub) | via commands | governed directive | provenance | PARTIAL | partial | P1: status vs configured |
| Artifacts | yes | yes | per-workflow list; reports JOIN | PARTIAL (1 file-read artifact) | inspect | n/a | created_at | PARTIAL | yes | P1: no project-level list w/ pagination |
| Lineage | yes (parent_artifact) | yes | per-workflow | NO | inspect | n/a | artifacts | PARTIAL | yes | P1: not in UI |
| Provenance | yes (execution_provenance) | yes | executions + telemetry | PARTIAL (telemetry table, 12 rows) | inspect | n/a | lifecycle events | REAL | partial | P1: raw, needs summary |
| Providers | partial (env presence) | no | GET env-only, health always unknown | PARTIAL | none | config check | no | PARTIAL | no | P1: no real health |
| Models | partial | no | env allowlist | NO (always null) | stub only | validated SET | no | MOCK | no | P0: override stub not durable |
| Provider overrides | yes (config events) | yes | SET/RESET PROJECT+AGENT | NO (stub `pending_owner_review`, persists nothing) | request only (fake) | rationale required | events table, no UI | MOCK | no | P0: wire facade to real endpoint |
| Global defaults | claimed, not implemented | no GLOBAL writes via API | NO (UNCONFIGURED fallback) | badge "not configured" | none | n/a | no | MOCK | no | P2: add GLOBAL or relabel |
| Command Room ASK/MULTI/START | yes | yes (commands+submissions) | REAL (validates agents, directive, idempotent) | REAL submit, but no status/result/failure view | submit | directive+agent count | commands list | REAL_END_TO_END (submit) / PARTIAL (observe) | yes | P1: observe/inspect loop |
| Approvals/decisions | yes | yes | REAL create/decide/list | PARTIAL (single hardcoded approval) | decide (hardcoded target) | action+rationale, no auth | decided_at | PARTIAL | yes | P0: scope/authority not surfaced; list not shown |
| Approval scopes | implicit via target_type | NO scope/authority column | NO derived field | NO (generic badge) | n/a | DECISION != AUTHORITY not visible | no | MOCK | no | P0: surface target_type-derived authority + confirm text |
| Human gates | yes (PROJECT→GLOBAL→DEFAULT TRUE) | yes + audit events | REAL get/set/reset/events | REAL (settings view, confirm + rationale) | enable/disable/reset | rationale+confirm | REAL events table | REAL_END_TO_END | needs test | P1: done, keep |
| Media/QA | yes | yes | via artifacts/executions | NO | none | gates | provenance | PARTIAL | partial | P1: surface final media + QA |
| Publication validation | yes | yes | via artifacts/approvals | NO | none | publishingAuthorized=false fixed | approvals | PARTIAL | no | P0: no readiness view |
| Publication authority | guards exist (no publish path in UI) | yes (publications table) | NO publish endpoint (good) | correctly absent | none (good) | final approval required | n/a | REAL (blocked by design) | n/a | keep blocked |
| Costs | row-level cost/cost_kind/currency | yes | via telemetry/executions, no aggregate | "Unavailable"/raw cost col | none | n/a | provenance | PARTIAL | no | P0: UNKNOWN shown as blank; needs KNOWN_ZERO/KNOWN_NONZERO/UNKNOWN + aggregate |
| Budgets | providerBudget on media resume only | yes | eligibility only | NO | none | preflight | usage ledger | PARTIAL | no | P2 |
| Platform health | worker presence + queue + DB | yes | NO | fake "healthy" | none | n/a | presence | MOCK | no | P0: replace with real |
| Errors/failures/retries | failure classification, claims, recovery | yes | via telemetry error_classification | NO dedicated view | authorize resume/revision | rationale+preflight | dispatches | PARTIAL | partial | P1: failure explorer |
| Project settings | human gates only | yes (gates+config) | gates+config | gates REAL, rest absent | gates | rationale | events | PARTIAL | no | P1: expose only real ones |
| Strategy/Brand | artifact-centric (brand-arch JSON) | file, not first-class | file read | file read | none | n/a | no | MOCK-ish | no | P2/P3: defer, don't hard-wire |
| Content | via produce artifacts | yes | reports | NO | none | n/a | artifacts | PARTIAL | no | P2 |
| Analytics | not connected (correct) | no | none | honest empty (good) | none | n/a | n/a | DEFERRED (honest) | n/a | keep honest |
| Learning | partial (per docs) | unclear | none | none | none | n/a | n/a | DEFERRED | no | defer |
| Autonomy/Scheduling | owner-starts, auto-advances between gates | policy via gates | gates only | via gates | gate toggles | rationale | events | PARTIAL | no | P2: expose state, don't enable L3/L4 |
| Revisions/Media-resume | yes (frozen packages, preflight) | yes | REAL authorize/eligibility/state | NO UI | none in UI | rationale+parity | dispatches | PARTIAL | yes (preflight) | P1: surface eligibility safely |

Authority note: `control_approvals` has NO `scope/authority` column. Scope signal lives in `target_type` (`publication_integration_validation_gate` vs `workflow_gate` vs `artifact`) + `target_id`. UI must derive and display authority explicitly (no migration in V1; additive migration is P1).

## Owner Journey Matrix

| # | Journey | Currently possible? | Evidence |
|---|---|---|---|
| 1 | Open AMF | YES (static UI loads) | `/` serves index.html |
| 2 | See all projects | NO (only hardcoded Morroway) | `_platform_snapshot` single project |
| 3 | Open Morroway | PARTIAL (file-read overview) | overview has no workflow truth |
| 4 | Understand status immediately | NO | active workflows "Unavailable", cost "Unavailable" |
| 5 | See current workflow/pipeline | NO | pipeline stages hardcoded, counts null |
| 6 | See waiting attention | PARTIAL (1 hardcoded brand decision; real PENDING visual-human-gate-vi1-flux not shown) | approvals list not surfaced |
| 7 | See active agents | NO (IDLE stub from package existence) | no runtime status |
| 8 | See provider/model per agent | NO (always null) | effectiveConfiguration never called by facade |
| 9 | See costs + unknown states | NO | costToday null; telemetry raw, UNKNOWN blank |
| 10 | Open artifacts | PARTIAL (1 file artifact; runtime reports count only) | no artifact detail/lineage view |
| 11 | Provenance/lineage | NO in UI (API exists) | `/lineage` never fetched |
| 12 | Approve/reject/iterate with scope | PARTIAL (decide works but hardcoded target, no scope display/confirm) | `/api/approvals` fixed targetId |
| 13 | Start governed task | PARTIAL (submit works; START_GOVERNED_TASK not selectable in UI) | mode derived from audience size only |
| 14 | Ask an agent | YES (submit path real) | `/api/command-room` → `/control/commands` |
| 15 | Multi-agent + synthesis | PARTIAL (submit real; synthesis never displayed) | `synthesis` field exists but UI ignores |
| 16 | Inspect failures | NO | error_classification in telemetry only, no view |
| 17 | Worker/platform health | NO (fake healthy) | no presence/queue exposure |
| 18 | Configure inheritance | NO (stub, no persistence) | override-requests disclosure admits no change |
| 19 | Publication readiness w/o publishing | NO | no readiness view; DB has PASS validation + blockers |

## UI/API/Backend Parity

REAL_END_TO_END: command submit (ASK/MULTI), approval create/decide (API-level), human-gate get/set/reset/events, telemetry/reports fetch, providers discovery.
PARTIAL: workflow status (one-by-id, no list), artifacts/lineage/executions (per-workflow, no project view), config SET/RESET (Node real, facade stub), dashboard telemetry table.
MOCK/STATIC: `apps/web` (entire package), `/api/platform`, overview pipeline/agents/artifacts/approvals, hub cards, cost cards, "Platform healthy", override-requests.
BROKEN: none found (proxies correctly 503 when runtime down; validation consistent enough).
NOT_IMPLEMENTED: project list, workflow list, health, cost aggregate, artifact explorer, lineage explorer, publication readiness, config history/map UI, failure explorer, command status/result view, approval scope display.

## Mock/Static Inventory

- `apps/web/src/index.ts`: `sampleJob job-0001`, `apiBaseUrl` logged never fetched — entire package is stub. Keep building (tests depend on nothing) but exclude from V1 claims.
- Python `_platform_snapshot`: `health "healthy"`, single morroway project, `globalDefaults null/not configured`.
- `project_overview`: pipeline 10 stages `count None/state "unavailable..."`, agents from package names (`provider None, model None, currentTask None, successRate None, costTodayUsd None`), 1 file artifact, 1 file approval.
- `override-requests`: returns `pending_owner_review` without persistence (explicit disclosure — honest but not operational).
- `app.js`: hub cards from mock snapshot; dashboard metrics "Unavailable"/hardcoded 1; pipeline static; agents null badges; approvals single file record; analytics/assets honest empties (keep).

## Critical Operational Gaps (P0)

1. No project/workflow list endpoints → hub/dashboard cannot render backend truth.
2. Approval scope/authority invisible (no derived `authorityScope`, no confirm text, hardcoded single approval) — safety risk of confusing validation approval with production/publication authority.
3. Config override path fake (facade stub) while Node canonical path exists — owner cannot actually configure; silent non-persistence.
4. Health is fabricated ("healthy") while real presence/queue data exists — misleading green.
5. Costs: UNKNOWN vs zero not distinguished in UI; no aggregate — risk of fake zeros.
6. Publication readiness not surfaced though all signals exist (validation PASS approval DECIDED APPROVE, PENDING visual gate, no production/public-publish approval, TARGET_ACCOUNT_NOT_RESOLVED per handoff) — owner cannot see why publish is blocked.
7. `apps/web` stub masquerades as web app in workspace — must be labeled non-operational or redirected to Python surface for V1.

## Authority/Safety Gaps

- No auth on any mutating route (any local caller can decide/authorize/configure); owner attribution is client string. Acceptable for local V1 only; must be documented + never exposed beyond localhost without auth (P1).
- `decideApproval` does not verify projectId scope; `updateConfiguration` validates provider/model against env (good); human-gate writes affect future routing only (good, with auditNote); media/revision authorizations enforce parity+preflight+frozen packages (good).
- No public-publish endpoint in UI/API (good — preserve). Confirmation copy for high-risk scopes missing in UI (P0 to add for any approval with publication-adjacent target_type).

## Data Source-of-Truth Gaps

- UI reads file `artifacts/brand-architecture-v1.json` + package existence instead of `workflow_submissions/artifacts/control_approvals/execution_provenance/amf_worker_presence/workflow_jobs`.
- `GLOBAL` precedence displayed but unwritable/unread (store returns UNCONFIGURED; no GLOBAL API). Either implement GLOBAL reads or relabel to PROJECT→AGENT for V1.
- Secrets safe: provider discovery returns presence only (good). Keep.

## P0 / P1 / P2

P0 (blocks V1 PASS): project/workflow list API; approval list + derived authority + confirm copy; real config proxy (SET/RESET/history/map) + UI; real health endpoint + UI (UNKNOWN allowed, no fake green); cost aggregate with UNKNOWN semantics + UI; publication-readiness endpoint + UI; pipeline derived from workflow truth; remove/honestly-label all mock operational claims.
P1 (required for useful V1): artifact/lineage explorer w/ pagination + summary (not raw dump); command status/result/synthesis/failure view; failure explorer (stage/agent/error class/retry/claim); agent effective-config per-agent display; revision/media-resume eligibility surfacing (read-only first); auth/localhost warning; GLOBAL scope decision (implement or relabel).
P2 (after V1): strategy first-class layer; budgets/analytics/learning closed loop; benchmarking; mobile polish; second state store — none required.
P3: microservices/Kafka/vector DB/LangChain etc. — explicitly out.

## Recommended V1 Scope

Slices 1–8 as in handoff, but minimal: (1) hub+dashboard from new project/workflow/health/cost APIs; (2) pipeline from workflow truth; (3) approval center (list + scope + confirm + decide on isolated fixture, never mutate Morroway history for tests); (4) agents + effective config (map/history/SET/RESET with rationale); (5) command room observe loop; (6) artifact/lineage explorer; (7) cost + health; (8) settings limited to gates + real config. Analytics/strategy/autonomy stay honest-deferred.

## Deferred Scope

Public publishing, analytics closed loop, learning, L3/L4 autonomy, production content quality, benchmarking, RBAC, mobile-first, strategic layer, `apps/web` rebuild (keep stub, document Python surface as V1 UI).

## Implementation Sequence

1. `ControlPlaneStore` read models (projects, workflows, health, costs, pub-readiness, config map/history) — no schema change.
2. Node handler routes (GET list/health/costs/artifacts/readiness/map/history; approval responses enriched with derived authority).
3. Python facade proxies + dashboard aggregate, real config proxy replacing stub (keep disclosure).
4. Static UI rewrite of hub/dashboard/pipeline/approvals/agents/costs/health/readiness/lineage on real endpoints, UNKNOWN/empty/error states, scope badges, confirm copy.
5. Tests (contract+persistence+reload+idempotency+UNKNOWN) on isolated TEST DB; builds; live read-only verification against Morroway fixture; one bounded ASK_AGENT write-path if explicitly authorized at runtime (default: use existing history, no new provider calls).

## Acceptance Criteria

Owner can, without DB/PowerShell: discover Morroway + its completed workflow + pipeline history + approvals with scopes + agent runs + provider/model effective config + artifacts + final media + Final QA/Review + integration validation PASS + why publish is NOT ready (no production approval, no public-publish approval, target account unresolved) + costs without fake zeros + worker/queue health; execute one safe governed command and observe completion; scoped approval on isolated fixture; config change + reset + reload. No YouTube calls, no production approval created, no public visibility change, no media generation calls for validation.
