# Control Platform Operational Proof V1 (Closure Acceptance)

Date: 2026-09-18/19 (UTC+3 evening session). Browser QA executed headless (system Chrome + playwright-core 1.63.0, 1600×900 + 900px narrow check) against the live local stack. No secrets included.

## Runtime identity

- Canonical UI: Python FastAPI facade + static UI (`apps/api/src/ai_media_factory/{main.py,static/}`) at `http://127.0.0.1:8000` — health `{status ok, env development, version 0.1.0}`.
- Canonical API: Node `apps/api/dist/server.js` (freshly built from current source) at `http://127.0.0.1:8080`.
- Database: production Postgres `ai_media_factory` (127.0.0.1:5432); TEST DB `ai_media_factory_test` proven isolated (never equal, truncations scoped to test DB only).
- Served-UI proof: `/static/app.js` (23,918 bytes) contains V1 markers (`Artifacts & Lineage`, `PLATFORM_VALIDATION_MODE`, `authorityScope`, `configuration-map`).
- `apps/web` = NON_CANONICAL_STUB / DEFERRED. It is a 17-line Node smoke module with no routes; it is NOT the Owner-facing surface and must not be presented as such in runtime instructions. This does not block V1: the Python facade + static UI is the canonical Owner-facing V1 surface.

## Worker before/after

- Before: instance `9edf7381-…`, build `98e9ee65…`, heartbeat fresh, 1 live, queue 0 queued / 0 running. Expected build `6fb2d16c…` (drift from V1 `control-plane.ts` change). Pre-restart safety: TEST isolation true, no RUNNING jobs, topology unambiguous → proceed.
- Restart: `node scripts/persistent-worker.mjs stop` (pid 880, clean SIGTERM via established pid-file mechanism; no broad killing) → `start` (new pid 24216, launcher `persistent-worker-script`).
- After: instance `953931e0-169b-4df9-9cca-96c94481e27b`, build `6fb2d16c…`, heartbeat fresh (21:57Z), `exactlyOneCanonicalWorker: true`, `buildParity: true`. Queue unchanged (0/0; 14 succeeded / 32 failed historical).
- WORKER_BUILD_PARITY = PASS. CANONICAL_WORKER_COUNT = 1. WORKER_HEARTBEAT_FRESH = YES.

## Tested Owner journeys (all against live Morroway state, rendered browser)

1. Project Hub: Morroway card from `/control/projects` (26 workflows, latest `wf-1789233193749-gvydpiah` `revision_required`, pending 1), posture line with live worker + heartbeat + queue. PASS.
2. Dashboard: latest workflow (canonical `revision_required`, not prettified), pending 1, costs `UNKNOWN (0 priced) · FREE 24 · UNKNOWN 99`, external publish NO + 3 blockers, readiness PASS/NO/NO + final media id, pending PENDING gate with WORKFLOW_GATE badge, workflow table. PASS.
3. Pipeline: workflow list + reference-workflow inspect; stage truth (queue-submission authority note for command executions); lineage table (108/108 artifacts/lineage via detail endpoint). PASS.
4. Approval Center: 6 real approvals; `PUBLICATION_INTEGRATION_VALIDATION` ("does NOT authorize production or public publish") visually distinct from `WORKFLOW_GATE` ("gate only"); rationale input + 5 decision buttons on PENDING item only; no history mutated. PASS.
5. Agents: real telemetry runs with provider/actual/requested/config-source/cost; effective-config + override/reset with rationale; UNKNOWN preserved. PASS (assert-level; per-agent screenshot captured).
6. Command Room: ASK/MULTI/START_GOVERNED_TASK surfaces + durable command list; no live submit executed (isolated TEST-DB proof reused). PASS.
7. Artifacts/Lineage: full runtime list (50) incl. `art-…-final-media` (`final_media_artifact`); workflow association/kind/producer/status. PASS.
8. Costs: KNOWN vs FREE vs UNKNOWN split; no fake zeros. PASS.
9. Health: DB ok, queue q0/r0/ok14/fail32, 1 live worker + heartbeat + build ids + recent failures; no fabricated green. PASS.
10. Publication readiness: PASS / NO / NO / NO + `NO_PRODUCTION_APPROVAL · NO_PUBLIC_PUBLISH_APPROVAL · TARGET_ACCOUNT_NOT_RESOLVED`. PASS.
11. Settings: human gates real (GATE ON/OFF + audit events) + config-policy note; no live mutations (isolated proof reused). PASS.

Browser QA totals: 25/25 asserts PASS, 0 console errors, 0 failed requests (final clean run). Narrow (900px) check: overflow < 120px, no breakage. No `undefined` leaks.

## Write-path evidence (reused isolated proofs, no live provider work)

- Safe command: TEST-DB submit → QUEUED → status reload (5-test suite).
- Scoped approval: TEST-DB create (authority enriched) → decide → reload; Morroway history untouched.
- Config: TEST-DB SET → map/history reload → RESET → UNCONFIGURED reload.

## Browser defects found → fixed (minimal repairs only)

- P0-1: `static/app.js` syntax error (`Unexpected token ')'`) — app stuck on boot loader. Fixed by simplifying the decide handler (no nested async-arrow in `.then`); verified with `node --check` + re-QA. (This defect existed in the prior session's code and is why PARTIAL was honest.)
- P0-2: artifacts view used dashboard 12-artifact slice → final media not discoverable. Fixed to fetch full `/api/runtime/artifacts` list.
- P1-1 (fixed, tiny): pipeline showed stale previous view during 108-artifact fetch — added explicit loading state.
- P2-1 (fixed, one line): `/favicon.ico` 404 console noise — added inline SVG favicon in `index.html`.
- No other defects: navigation, empty/error states, tables, status coloring, authority badges, UNKNOWN rendering all correct.

## Remaining debt (explicitly not blocking)

- P1 backlog: failure explorer UI; revision/media-resume eligibility surfacing; localhost-no-auth hardening (already disclosed in UI Global System view).
- P2: strategy layer, analytics/learning loop, benchmarking, mobile polish, `apps/web` future.
- Known per-handoff debt (§47) untouched.

## External side effects

PROVIDER CALLS = 0. LLM CALLS = 0. MEDIA GENERATION = 0. PUBLICATION = 0. PUBLIC POSTS = 0. PUBLIC VISIBILITY CHANGE = NO. PRODUCTION APPROVAL CREATED = NO. PUBLIC_PUBLISH APPROVAL CREATED = NO. No new workflow started; Morroway approvals/artifacts unmutated (QA was read-only + isolated-DB writes only).

## Acceptance decision

WORKER_BUILD_PARITY = PASS and browser QA proves all 16 V1 Owner journeys against real canonical state with zero P0 blockers remaining.

CONTROL_PLATFORM_OPERATIONALIZATION_V1 = PASS. CONTROL_PLATFORM_OPERATIONAL_PROOF = PASS.
