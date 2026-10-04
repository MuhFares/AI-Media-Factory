# AMF E2E Certification Matrix

Bootstrap: `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1` (2026-09-27)

## OP-STORAGE-01 — Durable artifact storage contract (operational backlog)

- STATUS: `PASS_PROVIDER_FREE`; production durability is not claimed.
- PROVIDER_MODE: PROVIDER_FREE. REAL_DB_REQUIRED: isolated test DB only.
- EVIDENCE: `artifact-storage.test.js` and
  `durable-publication-transport.test.js` passed 10/10; additive migration test
  passed 2/2. Verified hash/bytes, content-addressed idempotency, corruption
  detection, exact-key deletion guards, storage-root confinement, receipt-bound
  publication resolution and isolated schema constraints.
- SIDE_EFFECTS: cloud/provider calls 0; production DB mutations 0; files
  migrated/deleted 0. LAST_RUN_ID:
  `AMF_DURABLE_OBJECT_STORAGE_AND_OUTPUT_RETENTION_DESIGN_V1`.
  LAST_RUN_DATE: 2026-10-01.

Each entry tracks: SCENARIO / OWNER_PROGRAM / STATUS / REAL_DB_REQUIRED /
REAL_WORKER_REQUIRED / PROVIDER_MODE / EXPECTED_ARTIFACTS / EXPECTED_STATE /
EXPECTED_BUDGET_BEHAVIOR / EXIT_EVIDENCE / LAST_RUN_ID / LAST_RUN_DATE.

Statuses: `NOT_RUN` | `IN_PROGRESS` | `BLOCKED` | `PASS_PROVIDER_FREE` |
`PASS_LIVE` | `FAIL` | `UNKNOWN`.
Initial status reflects actual repo evidence ONLY. Historical `PASS` docs are
not converted into current certification without fresh exit evidence.

Provider modes: `PROVIDER_FREE` (zero provider calls) or `BOUNDED_LIVE`
(explicit Owner authorization required).

---

## E2E-01 — Owner→Research→CEO (P1)
- OWNER_PROGRAM: P1. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: research report → CEO artifact under canonical CEO output model.
- EXPECTED_STATE: workflow reaches CEO decision; no stall on partial/insufficient evidence.
- EXPECTED_BUDGET_BEHAVIOR: reservations atomic pre-transport; zero provider spend (fixtures/stubs).
- EXIT_EVIDENCE: `apps/worker/test/program-01-foundation-e2e.test.js` eligible
  fixture used the real isolated PostgreSQL queue, WorkflowWorker, and workflow
  engine; produced canonical Research, CEO recommendation, Brief, and Owner
  review state with a throwing network boundary. LAST_RUN_ID:
  `program-01-foundation-e2e:eligible`. LAST_RUN_DATE: 2026-09-27.

## E2E-02 — Insufficient evidence→Owner Review (P1)
- OWNER_PROGRAM: P1. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: `INSUFFICIENT_EVIDENCE` research outcome with frontier preserved.
- EXPECTED_STATE: durable `PAUSED` with owner-actionable review (no silent CEO call; `ceoEligible=false` honored).
- EXPECTED_BUDGET_BEHAVIOR: unused retrieval slots reconciled; zero provider spend.
- EXIT_EVIDENCE: Program-1 insufficient fixture persisted Research and
  `NO_PRODUCTION_CANDIDATE` CEO recommendation, then durably bounded-stopped
  before Brief creation. Zero provider calls. LAST_RUN_ID:
  `program-01-foundation-e2e:insufficient`. LAST_RUN_DATE: 2026-09-27.

## E2E-03 — Targeted Verification (P3)
- OWNER_PROGRAM: P3. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: verification plan + evidence sets + synthesis with opportunity-vs-factual-confidence semantics.
- EXPECTED_STATE: bounded mission completes or pauses durably; reload stable; zero CEO calls unless eligible.
- EXPECTED_BUDGET_BEHAVIOR: ≤6 retrieval + 2 text reservations; unused released.
- EXIT_EVIDENCE: provider-free targeted-verification dispatcher/runtime matrix
  passed with real isolated PostgreSQL persistence and worker queue path,
  proving bounded candidate-specific planning, evidence isolation, audited
  revision, idempotency, accounting, Owner Review preservation, and zero CEO
  calls. Bounded live corroboration preserved under source execution
  `targeted-verification-730e3a0bbe2edd5ccaac50bdefcdc1f4`
  (two successful retrievals), recovery
  `targeted-reevaluation-recovery-214424586a1a9c9ee1c0e5b9cdf59eb0`
  (zero new retrievals, one text call), job 87, and audited revision
  `targeted-verification-revision-targeted-verification-730e3a0bbe2edd5ccaac50bdefcdc1f4`.
  Workflow remained `PAUSED`, Research `COMPLETED`, CEO/downstream 0; Owner
  closed with no production candidate. This certifies E2E-03 only and does
  not complete Program 3 or any unrelated scenario.
  LAST_RUN_ID: `targeted-reevaluation-recovery-214424586a1a9c9ee1c0e5b9cdf59eb0`.
  LAST_RUN_DATE: 2026-09-28.

## E2E-04 — CEO→Brief→Script→Scenes→Visual Direction (P1)
- OWNER_PROGRAM: P1. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: canonical CEO output → brief → script → scenes → single visual-direction contract kind.
- EXPECTED_STATE: chain completes without kind-mismatch or unsupported-directive failure.
- EXPECTED_BUDGET_BEHAVIOR: zero provider spend.
- EXIT_EVIDENCE: `program-01-foundation-e2e:e2e04` traversed the real isolated
  DB queue/worker/engine path and persisted exactly: execution plan → Research
  → CEO recommendation → Brief → Writer → Scene plan →
  `visual_direction_contract` → Review → QA. No Hooks artifact, legacy visual
  kind, external provider, or unresolved stage. LAST_RUN_DATE: 2026-09-27.

## E2E-05 — Media bounded success (P4)
- OWNER_PROGRAM: P4. STATUS: PASS_PROVIDER_FREE + BOUNDED_LIVE_EVIDENCE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: canonical media chain outputs (image/scene, clip, narration-fit + caption verification evidence).
- EXPECTED_STATE: media workflow succeeds on canonical chain only (no legacy chain).
- EXPECTED_BUDGET_BEHAVIOR: reservations atomic; zero provider spend.
- EXIT_EVIDENCE: `program-04-closed-loop-e2e.test.js` executed the current worker
  `ProductionMediaChainBridge` with injected stub capabilities and isolated
  PostgreSQL persistence. It produced narration, timeline, three canonical
  scene visuals, three canonical clips, and final media; no legacy thumbnail/
  video artifact or external transport occurred. Technical versus semantic/
  human review remained distinct. LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS_V1:e2e05`.
  LAST_RUN_DATE: 2026-09-28.
- LIVE_CANARY_EVIDENCE (2026-09-29): one bounded TTS call, one image
  generation, one exactly-once video submission/recovery, and deterministic
  local composition produced canonical media with full narration coverage,
  burned captions, technical QA, and scoped Owner reviews. This is pipeline
  canary evidence, not permanent brand-quality certification.

## E2E-06 — Media failure/recovery (P3 + P4)
- OWNER_PROGRAM: P3 (framework) + P4 (media instance). STATUS:
  PASS_PROVIDER_FREE + LIVE_AMBIGUITY_RECOVERY_EVIDENCE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: failed execution preserved; recovery dispatch with distinct idempotency identity; settled artifact or honest terminal state.
- EXPECTED_STATE: original execution never overwritten; rewind horizon + frozen lineage honored.
- EXPECTED_BUDGET_BEHAVIOR: original reservation untouched; recovery reservation distinct; zero provider spend.
- EXIT_EVIDENCE: canonical Research/CEO/Brief/Writer/Scene/
  `visual_direction_contract` fixtures reach the actual stubbed media failure
  boundary and MEDIA_RESUME. Frozen lineage, failed-unit-only execution,
  completed-unit reuse, no duplicate provider effect, exactly-once accounting,
  restart and idempotent replay pass on isolated PostgreSQL. No external
  provider call occurred. Program 4 reran the same canonical media-resume suite
  after adding video/publish recovery policies (all cases green). LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS_V1:e2e06-regression`.
  LAST_RUN_DATE: 2026-09-28.
- Supplemental 2026-09-29 proof: the audited historical-video import validates
  frozen execution/source lineage; wrong, corrupt, or competing output fails
  closed; exact replay is idempotent; ambiguity cannot claim provider proof;
  and additional video-budget consumption is zero (10/10 focused tests). No live
  import or generation ran, and Runpod handler deployment/persistent-volume
  proof remains outstanding.
- Supplemental live recovery evidence (2026-09-29): the explicitly authorized
  guarded import created one canonical `scene_video_clip` and one audited
  lifecycle receipt for the existing logical execution, with local H.264 MP4
  proof verified and provider identity retained as
  `OWNER_ATTESTED_NOT_PROVIDER_VERIFIED`. The historical timeout evidence stayed
  immutable and video accounting remained 1/3. This is recovery evidence only;
  hardened Runpod deployment and persistent-receipt proof remain outstanding.
- Supplemental local-composition evidence (2026-09-29): the audited recovered
  clip and approved narration produced canonical timeline and
  `final_media_artifact` rows through deterministic FFmpeg only. A governed
  last-frame hold covers the full narration, exact Arabic captions are burned
  in with hash-bound render evidence, technical QA passes, semantic QA remains
  at the Owner gate, generation accounting is unchanged, and external calls
  are zero.

## E2E-07 — Owner reject/revision (P3)
- OWNER_PROGRAM: P3. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: rejection → revision artifact lineage (supersession by new rows, never mutation).
- EXPECTED_STATE: workflow returns to governed revision step; Decision≠Authority preserved.
- EXPECTED_BUDGET_BEHAVIOR: new reservations for rework; zero provider spend.
- EXIT_EVIDENCE: canonical source artifacts and Owner decision APIs construct
  `REVISION_REQUIRED`; authorization rewinds exactly at Writer while preserving
  Research/planning. New artifacts carry revision lineage, prior artifacts stay
  immutable, concurrent/duplicate dispatch is idempotent, and REVIEW_RESUME
  reruns review only from frozen inputs. No external provider call occurred.
  LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_03_E2E_FIXTURE_ALIGNMENT_AND_EXIT_V1:e2e07`.
  LAST_RUN_DATE: 2026-09-28.

## E2E-08 — Publication authorization/private upload (P4)
- OWNER_PROGRAM: P4. STATUS: PASS_PROVIDER_FREE + PASS_LIVE_PRIVATE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: token-liveness preflight evidence + authorization record + private-upload readiness binding.
- EXPECTED_STATE: unauthorized publish fails closed; authorized private path binds correctly.
- EXPECTED_BUDGET_BEHAVIOR: zero provider spend (no real upload in provider-free mode).
- EXIT_EVIDENCE: isolated PostgreSQL closed-loop E2E passed a VALID credential
  preflight, exact `PRIVATE_VALIDATION` authority bound to media SHA, payload
  hash, account and identity, then invoked one stub upload and persisted a
  canonical published report. No YouTube call occurred. LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS_V1:e2e08`.
  LAST_RUN_DATE: 2026-09-28.
- REGRESSION_EVIDENCE (2026-09-29): explicit final-media ID/hash and typed
  transport passed provider-free preflight, local-file hash mismatch/missing
  file failed before adapter invocation, and the exact Phase-5 canary passed
  identity plus transport preflight with zero YouTube calls. The prior live
  attempt remains `BLOCKED_PRE_TRANSPORT_NO_UPLOAD` until worker/schema refresh
  and a separate Owner reauthorization.
- LIVE_CANARY_EVIDENCE (2026-09-29): after Owner worker refresh and exact
  reauthorization, one private upload completed with zero retries. Independent
  receipt read-back verified provider video `QC0XPZak0Q4`, the exact Morroway
  channel, private visibility, unchanged metadata, and canonical published
  report lineage. The preceding blocked attempt remains preserved and no public
  publication or analytics call occurred.

## E2E-09 — Publication idempotency (P4)
- OWNER_PROGRAM: P4. STATUS: PASS_PROVIDER_FREE + LIVE_SINGLE_EFFECT_EVIDENCE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: duplicate submission blocked by idempotency key; single publication record.
- EXPECTED_STATE: no duplicate session/publication rows.
- EXPECTED_BUDGET_BEHAVIOR: duplicate consumes no new budget. EXIT_EVIDENCE:
  the exact replay returned the completed Postgres publication with
  `deduplicated=true` and the stub upload count remained one. Publish-session
  crash/resume and terminal no-downgrade tests also passed. LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS_V1:e2e09`.
  LAST_RUN_DATE: 2026-09-28.
- REGRESSION_EVIDENCE (2026-09-29): publication identity is independent of
  local path, identical bytes at different paths deduplicate, changed bytes
  invalidate authority, and isolated PostgreSQL session/crash replay preserved
  one provider-side effect and one publication row. No live upload occurred.
- LIVE_CANARY_EVIDENCE (2026-09-29): preflight found no successful report,
  provider video, active ambiguous session, or prior budget consumption. The
  one authorized upload produced one completed session
  `6b689806dcac517b`, one provider publication, and one published report;
  private-upload accounting moved exactly once from 0/1 to 1/1. No retry or
  duplicate upload occurred.

## E2E-10 — Analytics→Learning (P4)
- OWNER_PROGRAM: P4. STATUS: PASS_PROVIDER_FREE + PASS_LIVE_CLOSED_LOOP.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: `final_media_artifact → published_report → performance observation → learning` with join-key invariants; fixtures excluded.
- EXPECTED_STATE: learning result visible and durable.
- EXPECTED_BUDGET_BEHAVIOR: zero provider spend. EXIT_EVIDENCE: isolated
  PostgreSQL persisted the canonical content/workflow/final-media SHA/published
  report/provider publication/channel/provider join, a STUBBED observation,
  validation-only learning, evidence-bound recommendation, and next-cycle
  proposal in `AWAITS_OWNER_DECISION`. Missing metrics were never fabricated;
  unobserved metric citations failed closed. LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS_V1:e2e10`.
  LAST_RUN_DATE: 2026-09-28.
- LIVE_CANARY_EVIDENCE (2026-09-29, analytics half only): one authorized
  video-specific YouTube Analytics request completed HTTP 200 with zero rows
  and zero retries. Observation `obs-ea5b7d61d0a7` and analytics report
  `art-analytics-report-ea5b7d61d0a7` preserve the full canonical join and the
  explicit private-canary KPI exclusion. Missing metrics remain absent rather
  than zero-filled. This does not yet constitute live E2E-10 closure because
  Phase-7 learning remains separately authorized and unexecuted.
- LIVE_CANARY_CLOSURE_EVIDENCE (2026-09-29): local learning
  `learn-01ecc33b989b` preserved `INSUFFICIENT_DATA`, cited no absent metric,
  and retained the private-canary KPI exclusion. Recommendation
  `rec-a1b07efbdc83` is evidence-bound; proposal `ncp-294f1942f013` remains
  `AWAITS_OWNER_DECISION` and created no workflow. This completes the bounded
  live analytics→learning chain with zero additional provider calls.

## E2E-11 — Provider/model unavailable before transport (P2)
- OWNER_PROGRAM: P2. STATUS: PASS.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: preflight rejection evidence (model/route/availability cause).
- EXPECTED_STATE: fails before reservation/transport; workflow honestly blocked.
- EXPECTED_BUDGET_BEHAVIOR: zero reservation, zero transport, zero spend.
- EXIT_EVIDENCE: `program-02-routing-e2e.test.js` isolated PostgreSQL route and
  catalog fixtures plus worker universal-preflight regression; no reservation,
  provider transport, or spend. LAST_RUN_ID: `PROGRAM_02_ROUTING_PREFLIGHT_V1`.
  LAST_RUN_DATE: 2026-09-28.

## E2E-12 — Worker crash recovery (P3)
- OWNER_PROGRAM: P3. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: crash-consistent queue state; reclaimed/redispatched job with provenance.
- EXPECTED_STATE: singleton enforced; no duplicate execution; stale-`running` reconciled.
- EXPECTED_BUDGET_BEHAVIOR: no double-spend on redispatch. EXIT_EVIDENCE:
  isolated PostgreSQL crash/restart test preserves artifact/evidence lineage
  without duplication; DB advisory singleton and worker/job lease tests prove
  second-worker refusal, crash release, and healthy long-running protection.
- LAST_RUN_ID: `AMF_REMEDIATION_PROGRAM_03_E2E_FIXTURE_ALIGNMENT_AND_EXIT_V1:e2e12`.
  LAST_RUN_DATE: 2026-09-28.

## E2E-13 — Artifact corruption prevention (P3)
- OWNER_PROGRAM: P3. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: hash/reload validation evidence; corrupt artifact rejected before persistence.
- EXPECTED_STATE: invalid output never creates a successful artifact.
- EXPECTED_BUDGET_BEHAVIOR: zero provider spend. EXIT_EVIDENCE: Program-3 I/J/K/L
  frozen-context, ID namespace, immutable revision hash, and audited-repair
  tests fail closed on drift/invalid receipts; Program-1 runtime schema
  regressions remain green. LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_03_E2E_FIXTURE_ALIGNMENT_AND_EXIT_V1:e2e13`.
  LAST_RUN_DATE: 2026-09-28.

## E2E-14 — Budget exhaustion (P2/P3)
- OWNER_PROGRAM: P2 (preflight) + P3 (settle). STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: cap-rejection evidence; atomic reservation refusal.
- EXPECTED_STATE: fail-closed before transport; no partial charge.
- EXPECTED_BUDGET_BEHAVIOR: hard-cap rejection proven (no spend).
- EXIT_EVIDENCE: Program-3 W/X/Y plus media-resume M prove insufficient
  capacity requires Owner action, exact replay consumes nothing, ambiguous
  external effects cannot auto-retry, and over-budget calls fail before stub
  transport. LAST_RUN_ID:
  `AMF_REMEDIATION_PROGRAM_03_E2E_FIXTURE_ALIGNMENT_AND_EXIT_V1:e2e14`.
  LAST_RUN_DATE: 2026-09-28.

## E2E-15 — Multi-project isolation (P5)
- OWNER_PROGRAM: P5. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: per-project credentials/budgets/routing records; cross-project access denial evidence.
- EXPECTED_STATE: two projects operate without leakage.
- EXPECTED_BUDGET_BEHAVIOR: per-project accounting; zero provider spend.
- EXIT_EVIDENCE: isolated-database Program-5 project/channel/credential/routing/
  budget fixtures deny cross-project routing, credentials, artifacts,
  workflows and analytics access. The complete E2E-P5-01..18 matrix and
  script/direct-DB-zero journey passed with zero provider calls.
  LAST_RUN_ID: `AMF_REMEDIATION_PROGRAM_05_CREDENTIAL_HEALTH_AND_OWNER_JOURNEY_EXIT_V1:e2e15`.
  LAST_RUN_DATE: 2026-09-29.

## E2E-16 — Routing drift (P2)
- OWNER_PROGRAM: P2. STATUS: PASS.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: canonical route provenance for every model-backed role; drift detection evidence.
- EXPECTED_STATE: legacy/env/ambient resolution fails closed or is demoted; benchmark↔worker parity holds.
- EXPECTED_BUDGET_BEHAVIOR: unresolved route consumes nothing.
- EXIT_EVIDENCE: isolated PostgreSQL project-1/project-2 route provenance and
  route-version/catalog-availability/price-fingerprint drift tests; stale
  worker resolution fails before transport. LAST_RUN_ID:
  `PROGRAM_02_ROUTING_PREFLIGHT_V1`. LAST_RUN_DATE: 2026-09-27.

## E2E-17 — Sandbox safety (P2/P5)
- OWNER_PROGRAM: P2 (primary). STATUS: NOT_RUN.
- REAL_DB_REQUIRED: NO (may run isolated). REAL_WORKER_REQUIRED: NO. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: sandbox-denied transport classified distinctly from provider errors.
- EXPECTED_STATE: guidance/preflight prevents attempt or labels cause without budget burn.
- EXPECTED_BUDGET_BEHAVIOR: no spend on sandbox-denied attempts.
- EXIT_EVIDENCE: none yet. LAST_RUN_ID: UNKNOWN. LAST_RUN_DATE: UNKNOWN.

## E2E-18 — State invariants (P3)
- OWNER_PROGRAM: P3. STATUS: PASS_PROVIDER_FREE.
- REAL_DB_REQUIRED: YES. REAL_WORKER_REQUIRED: YES. PROVIDER_MODE: PROVIDER_FREE.
- EXPECTED_ARTIFACTS: invariant-check evidence (PAUSED↔actionability, auth-with-no-job, split-brain scans, sweeper runs).
- EXPECTED_STATE: violations detected/reported, never silently absorbed.
- EXPECTED_BUDGET_BEHAVIOR: checks are local; zero provider spend.
- EXIT_EVIDENCE: canonical classifier matrix plus isolated PostgreSQL sweeper
  fixtures detect PAUSED/actionability, authorization-without-job,
  job/workflow split-brain, artifact and revision reconciliation conflicts;
  scans preserve source state and perform no destructive repair.
  LAST_RUN_ID: `AMF_REMEDIATION_PROGRAM_03_E2E_FIXTURE_ALIGNMENT_AND_EXIT_V1:e2e18`.
  LAST_RUN_DATE: 2026-09-28.

---

## Program 5 Owner-operation matrix — 2026-09-29

All executions below were provider-free and used the isolated test database
where persistence was required. The 18 scenarios, real credential-health
control path, full Owner journey replay, script-zero and direct-DB-zero matrices
pass. No provider or production database call occurred.

| ID | RESULT | VERIFIED BOUNDARY |
|---|---|---|
| E2E-P5-01 | `PASS_PROVIDER_FREE` | Complete project/channel/opaque-credential/health/routing/budget onboarding reaches ready through product APIs only |
| E2E-P5-02 | `PASS_PROVIDER_FREE` | Decision Center is the canonical actionable queue and approval resumes through canonical routes |
| E2E-P5-03 | `PASS_PROVIDER_FREE` | Reject/revision and review-resume paths remain canonical |
| E2E-P5-04 | `PASS_PROVIDER_FREE` | Bounded budget change is audited, cannot erase exposure, and grants no execution authority |
| E2E-P5-05 | `PASS_PROVIDER_FREE` | Unavailable/unknown provider state is visible and never fabricated healthy |
| E2E-P5-06 | `PASS_PROVIDER_FREE` | Owner verifies/refreshes an opaque binding through Node; precise safe states, freshness, audit, Decision Center and secret redaction pass with injected verifiers |
| E2E-P5-07 | `PASS_PROVIDER_FREE` | Media/review recovery routes use Program-3 dispatchers |
| E2E-P5-08 | `PASS_PROVIDER_FREE` | Private publication approval is a distinct Owner action |
| E2E-P5-09 | `PASS_PROVIDER_FREE` | Analytics preserves NOT_RETURNED/insufficient-data semantics |
| E2E-P5-10 | `PASS_PROVIDER_FREE` | Approve/reject/defer/request-changes decisions are immutable and never auto-start |
| E2E-P5-11 | `PASS_PROVIDER_FREE` | Worker drift is visible; lifecycle actions use only canonical launcher |
| E2E-P5-12 | `PASS_PROVIDER_FREE` | Cross-project routing activation is denied |
| E2E-P5-13 | `PASS_PROVIDER_FREE` | Credential/channel bindings are project-scoped |
| E2E-P5-14 | `PASS_PROVIDER_FREE` | Cross-project artifacts/workflows/analytics are server-denied or isolated |
| E2E-P5-15 | `PASS_PROVIDER_FREE` | Morroway defaults to `OFF / L0_MANUAL / DISABLED` |
| E2E-P5-16 | `PASS_PROVIDER_FREE` | Private authority cannot authorize `PUBLIC_PUBLISH` |
| E2E-P5-17 | `PASS_PROVIDER_FREE` | Every normal operation has UI/API paths with `SCRIPT_REQUIRED=NO` and `DIRECT_DB_REQUIRED=NO` |
| E2E-P5-18 | `PASS_PROVIDER_FREE` | Break-glass classes remain explicit, guarded, audited, Owner/Admin-only |

- PROGRAM_04_OWNER_JOURNEY_REPLAY: `PASS_PROVIDER_FREE`; credential health,
  TTS/image/video-recovery/final/private-publication decisions, analytics and
  learning visibility, and next-cycle defer were exercised through real Node
  control routes with provider-free fixtures. No live workflow started.
- FINAL_SELECTED_TEST_RUNS: 295 passed, 0 failed across the clean final runs;
  Programs 1–4 regressions, Python facade/auth/CSRF, Decision Center,
  automation, multi-project isolation, credential security, onboarding,
  Program-5 persistence/contracts, and script-zero are included.
- PROVIDER_CALLS: 0; PRODUCTION_DATABASE_MUTATIONS: 0; PUBLIC_UPLOADS: 0.

### Program 5 bounded live Owner certification — 2026-09-30

- STATUS: `PASS_LIVE_OWNER`; run
  `AMF_PROGRAM_05_OWNER_OPERATED_LIVE_CANARY_CERTIFICATION_V3`.
- E2E-P5-06 LIVE: one final Owner `VERIFY_HEALTH` traversed AMF Control →
  authenticated/CSRF Python proxy → Node verifier/domain store and produced
  fresh `VALID`, scope `PASS`, channel `MATCH`. Two earlier failed checks remain
  distinguishable; the successful audit is redacted and records no persisted
  secret material.
- E2E-P5-10 LIVE: one Owner `DEFER` moved proposal `ncp-294f1942f013` from
  `AWAITS_OWNER_DECISION` to `OWNER_DEFERRED`; audit flags and production-table
  reads prove zero workflow/submission/job/execution creation.
- E2E-P5-15 LIVE GOVERNANCE: Morroway remains `OFF / L0_MANUAL / DISABLED`.
- E2E-P5-17 LIVE: the two normal Owner actions required no script or direct DB;
  the earlier OAuth bootstrap remains separate engineering recovery.
- FINAL WINDOW: exactly one OAuth refresh and one YouTube identity read on the
  single successful verifier path; zero media generation, uploads, new
  analytics, LLM/Research/social, public publication, workflow execution or
  budget increase. Worker/API/UI/database parity and the future-Wan block pass.
- PROGRAM_05_FINAL: `LIVE_OWNER_PASS`; Owner state `CLOSED`. External/Testing
  OAuth and its deferred production-domain migration remain explicit debt.

---

## E2E → program index

- P1: E2E-01, E2E-02, E2E-04.
- P2: E2E-11, E2E-16 (+ E2E-14 shared, E2E-17 primary).
- P3: E2E-03, E2E-06 (shared), E2E-07, E2E-12, E2E-13, E2E-18 (+ E2E-14 shared).
- P4: E2E-05, E2E-06 (shared), E2E-08, E2E-09, E2E-10.
- P5: E2E-15 (+ E2E-P5-01..18 above; all pass provider-free).

2026-09-30 checkpoint regression supplement: the Program-3 restart/reuse
fixture now uses a deterministic post-TTS crash boundary instead of polling a
transient engine state. The exact recovery/state/review/revision/media/crash
checkpoint suite passed 70/70 with no timeout. The narration was reused with
no second provider call. This is test-harness evidence only and does not alter
the existing Program-3 certification scope or status.

2026-09-30 cold-resume/concurrency supplement: the canonical PostgreSQL cold
worker regression now reaches the restored actionable Owner gate, never starts
the unrelated Analytics frontier, and makes zero provider calls. Three focused
engine tests prove definition-order recovery plus repeated cold resumes with a
missing Owner decision remain `AWAITING_APPROVAL`. Concurrent identical
review-resume requests now persist one dispatch, one queue job and one pending
revision task; the second caller replays the canonical result. The exact
Program-3 checkpoint suite passed 70/70 with zero failures/timeouts, and P1,
P2, P4 and P5 regressions remained green (12/12, 20/20, 29/29, 53/53).

Total scenarios registered: 18. Currently certified provider-free: 17. Only
the standalone sandbox-safety scenario `E2E-17` remains `NOT_RUN`; its
environment-classification debt does not reopen the certified Program 1–5
exits. Program 5 additionally has E2E-P5-01..18 provider-free and bounded live
Owner evidence.

2026-10-01 supervised-Wan single-scene supplement: provider-free certification
passed 43 focused assertions across the isolated PostgreSQL ledger, concurrent
Owner idempotency, exact one-POST/budget accounting, worker runner, AMF Control,
auth/CSRF/project scoping, timeout separation, no-retry ambiguity, manual
reconciliation, Decision Center actionability and batch fail-closed behavior.
Production schema/runtime activation was not performed; real video calls remain
zero and `WAN_LIVE_GENERATION = PENDING_RUNTIME_ACTIVATION`.

2026-10-01 supervised-Wan runtime supplement: production DB/backup prechecks,
the narrow ledger migration, current-build singleton worker, Node API, AMF
Control, Owner auth/session/CSRF boundary, mode projection and read-only scene
eligibility passed. The ledger contains zero executions and the queue contains
zero active work; no RunPod/video/provider call occurred. Runtime is ready for
one separately authorized Owner action, not autonomous or batch generation.
