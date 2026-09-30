# Program 5 — Owner Autonomy

- PROGRAM_ID: `PROGRAM_05_OWNER_AUTONOMY`
- PROGRAM_NAME: Owner Autonomy
- PURPOSE: Owner operates AMF through AMF Control without engineering agents or
  direct database/scripts during normal operation.
- STATUS: `LIVE_OWNER_PASS`
- OWNER_STATE: `CLOSED`

## CANONICAL_PRODUCT_ARCHITECTURE

- Canonical Owner UI: AMF Control static application under
  `apps/api/src/ai_media_factory/static/`.
- Canonical state-changing control plane: Node `apps/api` routes and canonical
  database domain stores.
- Python status: compatibility serve/proxy layer. Cookie/session and CSRF are
  edge concerns; domain mutations are proxied to Node and business authority is
  not duplicated.
- `apps/web` status: absent from current executable source; it is not a second
  UI authority and will not be recreated as a placeholder.

## SCOPE_IN

- Owner journeys: project onboarding; channel onboarding; credential binding;
  routing activation; budget changes; premium escalation; repair authorization;
  reconcile actions; reauthorization flows; media resume; publish session actions.
- Operations visibility: provider health; worker/build health; monitoring/alerts;
  scheduler; analytics measurement; learning progression.
- Next-cycle flow: proposal→directive flow; multi-project isolation; per-project
  credentials/budgets/routing.
- Decision Center as sole owner-attention queue; single canonical Owner UI decision;
  Python facade vs `apps/web` final architecture decision.
- AuthN/Z, supervision, backup/restore, and other production-grade operations
  scoping (with R-10; implement to the degree required for owner-operation exits).

## SCOPE_OUT

- Contract/routing/recovery/media product changes (P1–P4) except Owner-facing exposure.
- Marketplace/SaaS, L3/L4 autonomy, public autonomous publishing, mobile,
  microservices, second state store (deferred per architecture audit).
- Breaking the current Python-facade serve path before replacement certified.
- Rewriting historical Owner-experience proofs/acceptances.

## DEPENDENCIES

- Requires P1–P4 (certified factory + first closed-loop content) before autonomy
  certification is meaningful.
- Final program of the critical path.

## AUDIT_FINDINGS_ADDRESSED

- Split owner plane; scripts-only operations; missing onboarding/initiation/
  management journeys; supervision/backup/auth gaps; UI drift.

## RISKS_ADDRESSED

R-9, R-10 (plus all BLOCKS_AUTONOMY risks as entry conditions: F-01–F-06,
F-12–F-15, R-1–R-6, R-8). See `../AMF_KNOWN_RISKS.md`.

## HYGIENE_BEFORE

- `apps/web` stub (PLACEHOLDER; canonical UI decision required).
- Python facade duplicated read-models (DUPLICATE; facade stays canonical serve path until P5).
- Node/Python owner-plane overlap (DUPLICATE by design until P5).
- UI documentation drift (PLACEHOLDER; reconcile after UI decision).
- Scripts-only owner operations (MIGRATION_REQUIRED; productize into Owner actions).

## HYGIENE_DURING

- Productize operations into Decision Center actions one journey at a time.

## HYGIENE_AFTER

- Archive superseded stubs/scripts only after Owner-action parity proven; no
  deletes before replacement certified.

## ENGINEERING_WORKSTREAMS

1. WS1-Onboarding: project/channel/credential/routing/budget flows.
2. WS2-Operate: repair/reconcile/reauth/resume/publish-session/escalation actions.
3. WS3-Observe: health, monitoring/alerts, scheduler, analytics/learning surfaces.
4. WS4-Isolate: multi-project isolation + per-project credentials/budgets/routing.
5. WS5-Unify: Decision Center sole queue + canonical Owner UI decision + facade/`apps/web` finale.

## PROVIDER_FREE_EXIT_CRITERIA

- Multi-project and owner-operation certification scenarios pass provider-free
  (E2E-15 plus program-defined owner-operation scenarios: onboarding, budget
  change, repair/reconcile, reauth, resume, publish-session handling — all
  without direct DB/agent/script).
- Zero provider calls in provider-free runs.

## LIVE_EXIT_CRITERIA

- Owner completes a normal content lifecycle without: direct DB, coding agent,
  one-off script, or manual backend repair.

## REQUIRED_E2E_SCENARIOS

E2E-15 plus E2E-P5-01..18 (all provider-free) and the bounded live Owner
journey. Standalone E2E-17 sandbox-error classification remains independent
cross-program debt and is not represented as completed evidence.

## BLOCKERS

- R-10 production operations debt (backup/restore, durable object-storage
  policy, and scaling beyond the certified singleton) remains outside this
  provider-free Owner-autonomy exit.
- Future Wan submissions remain blocked until the hardened owned handler and
  persistent receipt store are deployed and certified.
- The bounded live Owner journey is complete. Independent production-operations
  debt remains: backup/restore operationalization, durable object storage,
  horizontal scaling, hardened Wan deployment/receipts/digest parity, and the
  Google OAuth production-domain/In-production migration.

## COMPLETED_TASKS

- Explicit architecture decision: one UI, one state-changing Node authority.
- Owner Operations UI/API for onboarding readiness, routing history/activation,
  bounded budgets, next-cycle decisions, worker lifecycle, health/alerts,
  recovery links, script/break-glass matrix, and audit history.
- Additive Owner audit and next-cycle decision persistence; approvals remain
  immutable and APPROVE stops at `OWNER_APPROVED_AWAITS_EXPLICIT_START`.
- Session-bound CSRF protection for all cookie-authenticated mutations and
  Secure cookies in production.
- Project-scoped isolation fixtures, Decision Center parity, automation
  fail-closed behavior, Programs 1–4 regressions, and E2E-P5-01..18 contract
  coverage executed provider-free.
- Morroway remains `OFF / L0_MANUAL / DISABLED`; future Wan generation remains
  blocked and visible.
- Credential health is a canonical provider-neutral Owner action in AMF Control
  (`VERIFY_HEALTH` / `REFRESH_AND_VERIFY`). The browser supplies only the opaque
  binding ID; Node resolves the external reference internally, invokes an
  injectable provider verifier, persists freshness and safe evidence, writes a
  redacted audit event, and creates/resolves Decision Center attention.
- Project/channel/credential/routing/budget onboarding reaches ready state via
  UI/API product paths only. The full Program-4 Owner decision journey and all
  four next-cycle decisions were replayed provider-free through the real Node
  control plane with no direct SQL used for certified Owner actions.
- All normal-operation matrix rows now have UI and API paths with
  `SCRIPT_REQUIRED=NO` and `DIRECT_DB_REQUIRED=NO`. Historical credential tools
  remain explicit guarded `BREAK_GLASS_ONLY` engineering paths.
- E2E-P5-01..18, security, isolation, Python proxy/CSRF, Programs 1–4 regression,
  and script-zero certification pass provider-free. No provider or production DB
  call was made.

## CURRENT_TASK

- None. Provider-free and bounded live Owner exits are complete.

## NEXT_TASK

- No automatic next program or workflow. Morroway remains manual, the future-
  Wan blocker remains authoritative, and OAuth production migration remains
  deferred technical debt.

## OWNER_OPERATED_LIVE_CANARY_READINESS

- READINESS_TASK: `AMF_PROGRAM_05_OWNER_OPERATED_LIVE_CANARY_READINESS_V1`
- ASSESSED_AT: 2026-09-29
- RESULT: `PARTIAL` / `NOT_READY_FOR_AUTHORIZATION`
- CURRENT_SOURCE_BUILD:
  `0a0916cefaae9d2ac7e54b5183ebdcf46509b809c832668b90d1c56d538a6775`.
- WORKER: healthy singleton PID 23588, empty queue and healthy heartbeat, but
  running build
  `2e1f5b75991e32ff39fde40e17ec954a9511ff638e373e6d864e0df584d51aab`;
  exact build parity fails and an Owner refresh is required.
- CONTROL_RUNTIME: the Node API on 127.0.0.1:8080 and Python/AMF Control on
  127.0.0.1:8000 were both unreachable. Historical supervisor state is in
  crash-loop guard after port-conflict failures; no listener currently owns
  either port. Source routes and security tests pass, but an unavailable UI is
  not live readiness.
- PRODUCTION_SCHEMA: `credential_health_checks` and
  `credential_binding_health` exist with the expected additive definitions.
  No migration is required or authorized by this readiness task.
- MORROWAY: project ACTIVE; automation fail-closed at `OFF / L0_MANUAL` with
  no policy row; YouTube channel VERIFIED; opaque credential binding ACTIVE;
  Balanced project route ACTIVE; budgets are present but Research and
  text-agent capacity are exhausted. This control-only canary needs no media,
  workflow, analytics, or generation capacity.
- CREDENTIAL_HEALTH: no row exists yet in the new productized health store, so
  current canonical product state is `UNKNOWN_REQUIRES_REFRESH`. The proposed
  canary authorizes exactly one Verify/Refresh Health operation to establish it.
- EXISTING_EVIDENCE: final media, private published report, analytics report,
  observation, learning and recommendation/proposal lineage is present.
  Proposal `ncp-294f1942f013` remains `AWAITS_OWNER_DECISION`.
- WAN: future submissions remain blocked. AMF Control source now names all
  three reasons: hardened handler not deployed, persistent receipts not
  certified, and endpoint digest/source parity not proven. No Generate Video
  action exists on the Owner surface.
- SIDE_EFFECT_ENVELOPE: one credential-health operation; media, uploads,
  analytics, LLM, Research, social, public publication and next-cycle execution
  all remain zero.

### Proposed Owner checklist (execute only after a separate authorization)

| PAGE | ACTION | EXPECTED VISIBLE RESULT | EXPECTED AUDIT / STATE CHANGE | STOP CONDITION |
|---|---|---|---|---|
| Sign in | Authenticate through AMF Control | Owner session active | Session only | Authentication or CSRF failure |
| Project Hub | Open Morroway | ACTIVE project selected | None | Wrong or missing project |
| Owner Operations | Inspect worker/providers | Current build, healthy singleton, empty queue; Wan BLOCKED with three reasons | None | Build mismatch, unhealthy worker, active queue, missing Wan blocker |
| Credentials | Select the active YouTube binding and run Verify/Refresh Health once | Precise health, scope and channel identity result | One safe health check, latest-health row and redacted audit event | Any non-VALID result, identity mismatch, scope failure, secret exposure, or retry prompt |
| Decision Center | Confirm credential item resolves or shows the exact failure | Credential attention matches health | Canonical item updated | Duplicate/ambiguous attention |
| Models / Routing | Inspect effective Morroway route | Balanced project route active | None | Missing/drifted route |
| Budgets | Inspect existing envelopes | Exact limits/used/reserved shown; no change made | None | UI asks to increase capacity |
| Artifacts & Lineage | Inspect Program-4 chain | Final media → private report → observation → learning resolves | None | Broken lineage |
| Content / Publication | Inspect the private canary | Private publication `QC0XPZak0Q4`; no public authority | None | Upload/publish action proposed |
| Analytics / Learning | Inspect the live empty observation and process learning | `EMPTY_VALID_PROVIDER_RESPONSE` and insufficient-data learning | None | Fabricated metric or performance conclusion |
| Owner Operations / Next Cycle | Open `ncp-294f1942f013` and choose DEFER | Proposal becomes Owner-deferred | One immutable decision/audit event | Any workflow is created or execution starts |
| Pipeline / Audit | Confirm no new workflow and review audit | Queue remains idle; only credential-health and DEFER mutations appear | None beyond the two authorized records | Any additional mutation or provider action |

## CHANGELOG

- 2026-09-27: Program file created by `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1`. Status `NOT_STARTED`.
- 2026-09-29: `AMF_REMEDIATION_PROGRAM_05_OWNER_AUTONOMY_V1` moved the program
  to `IN_PROGRESS` and delivered the control-plane foundation. Certification is
  deliberately `PARTIAL`: no provider calls or production DB mutations occurred,
  and the remaining blockers above prevent `PROVIDER_FREE_PASS`.
- 2026-09-29: `AMF_REMEDIATION_PROGRAM_05_CREDENTIAL_HEALTH_AND_OWNER_JOURNEY_EXIT_V1`
  productized credential health, completed onboarding and the full stubbed Owner
  journey, passed E2E-P5-01..18 and script/direct-DB-zero certification, and set
  Program 5 to `PROVIDER_FREE_PASS`. Live operation remains unexecuted.
- 2026-09-29: `AMF_PROGRAM_05_OWNER_OPERATED_LIVE_CANARY_READINESS_V1` recorded
  `PARTIAL`: production schema and Morroway evidence are ready, but worker build
  parity fails and AMF Control/API are unavailable. No live journey or provider
  call was executed.
- 2026-09-29: `AMF_PROGRAM_05_CONTROL_PLANE_RUNTIME_RESTORE_AND_READINESS_V2`
  verified the refreshed worker at exact build
  `0a0916cefaae9d2ac7e54b5183ebdcf46509b809c832668b90d1c56d538a6775`
  (PID 32912; healthy singleton; queued 0 / running 0) and restored the canonical
  Node API on 8080 plus the FastAPI AMF Control compatibility surface on 8000
  without starting another worker. Live login/session and CSRF fail-closed
  behavior passed, as did project rejection and the read-only Project Hub,
  health, routing, budget, artifact, analytics, learning, audit, and next-cycle
  surfaces. Readiness remains `PARTIAL`: the Python runtime-resource allowlist
  does not include the already-mapped `owner-credential-health` resource, so
  the live credential-health UI read returns HTTP 404 even though the Node
  endpoint returns HTTP 200 and the Verify/Refresh mutation route exists. No
  Owner action, provider call, workflow execution, budget change, or production
  data mutation occurred.
- 2026-09-29: `AMF_PROGRAM_05_OWNER_OPERATIONS_PROXY_RESILIENCE_FIX_V1` added
  the missing GET-only `owner-credential-health` proxy allowlist entry and made
  Owner Operations resilient through per-resource settled reads with explicit
  unavailable states. Targeted tests passed (12 Python plus 27 UI/Program-5),
  and live read-only browser verification showed credential health, worker
  health, routing, budgets, the next-cycle proposal, and the three-reason Wan
  blocker together. Only the Python compatibility proxy was replaced; Node and
  the healthy current-build worker were untouched. The Program-5 Owner-operated
  live canary is now ready for separate authorization, but was not executed and
  Program 5 remains `PROVIDER_FREE_PASS` rather than live-closed.
- 2026-09-29: `AMF_PROGRAM_05_LIVE_OWNER_ACTION_WIRING_AND_AUTH_FIX_V1`
  confirmed the manual inspection was genuinely signed out and removed silent
  rationale no-ops. Signed-out Owner mutations are now visibly disabled;
  signed-in actions have progress, duplicate suppression, canonical inline
  errors, success feedback and settled state refresh. Intentional L0 manual
  automation is readiness-safe, credential health remains action-required,
  and budget alerts identify their call kind and scope. Provider-free tests and
  live read-only UI/login checks passed with zero domain mutations. The source
  build advanced to
  `6a4fca473d493f241e7e2d5fb2c12877506ec8584accb3c0fa565133a40a2e4b`;
  the untouched worker still runs the prior build, so the live Owner canary is
  held pending a canonical Owner worker refresh.
- 2026-09-30: Google OAuth publishing status was Owner-confirmed as
  `EXTERNAL_TESTING`. Refresh credentials obtained in this mode carry an
  approximately seven-day lifetime for the requested YouTube scopes, so
  periodic interactive Owner reauthorization is an explicit temporary
  operational debt. One authorized loopback reauthorization window expired
  before consent; no token exchange or credential replacement occurred.
  `GOOGLE_OAUTH_PRODUCTION_DOMAIN_REQUIRED = DEFERRED`; the future durable fix
  remains domain/branding completion and an In-production OAuth posture.
- 2026-09-30: `AMF_PROGRAM_05_OWNER_OPERATED_LIVE_CANARY_CERTIFICATION_V3`
  certified the final Owner journey from production evidence. Exactly one final
  successful `VERIFY_HEALTH` produced `VALID / PASS / MATCH`; two earlier failed
  checks remain immutable. One Owner `DEFER` moved proposal
  `ncp-294f1942f013` to `OWNER_DEFERRED` without creating or starting a
  workflow. AMF Control/Node provenance, redacted audit, script/direct-DB zero,
  current-build singleton health, idle queue, preserved L0 manual automation,
  and the future-Wan block all passed. Program 5 is `LIVE_OWNER_PASS`, Owner
  state `CLOSED`.
- 2026-09-30: final Programs 1–5 handoff reconciliation preserved Program 5
  `LIVE_OWNER_PASS` / Owner `CLOSED`, recorded no automatic next program, and
  linked the authoritative closure snapshot. No runtime or production state
  was changed.
