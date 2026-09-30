# Program 3 — Recovery + State + Lineage

- PROGRAM_ID: `PROGRAM_03_RECOVERY_STATE_LINEAGE`
- PROGRAM_NAME: Recovery + State + Lineage
- PURPOSE: Stop creating one-off recovery systems for every execution mode;
  enforce state invariants; establish durable lineage.
- STATUS: `PROVIDER_FREE_PASS`

## SCOPE_IN

- Generic recovery/redispatch framework: explicit mode plugins; authorization;
  eligibility; preflight; fingerprint; rewind horizon; frozen lineage; enqueue;
  settle; idempotency.
- Unify semantics for: normal recovery, revision, review resume, media resume,
  targeted verification, targeted reevaluation recovery, visual iteration,
  orphan recovery. (`PostgresRecoveryDispatcher` and
  `TargetedVerificationReevaluationRecoveryDispatcher` are inputs, not the framework.)
- STATE: workflow/state invariants; PAUSED→owner actionability mapping;
  authorization-with-no-job detection; submission/job/workflow split-brain
  detection; reconciliation sweeper or equivalent; singleton worker enforcement.
- LINEAGE: durable ID ownership rules (runtime- vs model- vs provider-generated);
  canonical lineage graph; artifact revision semantics (supersession, never
  mutation); generic artifact hash/reload validation; analytics join identity rules.

## SCOPE_OUT

- Contract/routing changes (P1/P2), media/publication/analytics product gates (P4),
  owner UI/autonomy (P5).
- Mutating job 68 or starting workers to "fix" the queue. Job 68 is terminal/deferred
  (`failed`/18 attempts, workflow `CANCELLED`, submission `cancelled` per 2026-09-27
  read-only DB check) and must NOT be reopened, mutated, approved, or reused
  without explicit Owner authorization.
- Rewriting historical recovery evidence.

## DEPENDENCIES

- Requires P1 + P2 provider-free passes (recovery operates on stable contracts/routes).
- Blocks P4 certification (media recovery instances) and P5 (state truth for Owner ops).

## AUDIT_FINDINGS_ADDRESSED

- Per-mode recovery sprawl; unenforced state invariants; convention-based lineage;
  singleton/split-brain/sweeper gaps; artifact corruption handling.

## RISKS_ADDRESSED

F-07 (primary), F-14, F-15, R-4, R-5, R-6 (+ F-16 shared with P2).
See `../AMF_KNOWN_RISKS.md`.

## HYGIENE_BEFORE

- Root `run-council`/recovery runners (~20 root `run-*.mjs`).
- `work/` direct writers (verify before any action).
- v6/v7 launchers; lifecycle script duplication; old worker launchers.
- Singleton behavior (stale PID/supervisor records; legacy job 68 is terminal and
  must be left untouched — no disposition action required).

## HYGIENE_DURING

- Migrate mode-specific paths onto framework as plugins; mark superseded runners
  LEGACY_STILL_REFERENCED (never delete yet).

## HYGIENE_AFTER

- Archive superseded runners only after framework certification (E2E-12/E2E-18);
  delete only with explicit evidence per safe sequence.

## ENGINEERING_WORKSTREAMS

1. WS1-Framework: generic recovery/redispatch core + mode-plugin interface.
2. WS2-Modes: migrate the eight mode semantics onto plugins with parity tests.
3. WS3-State: invariants, PAUSED/actionability, split-brain detection, sweeper,
   singleton enforcement (terminal legacy job 68 left untouched by design).
4. WS4-Lineage: ID ownership, lineage graph, revision/hash/reload, join identity.

## PROVIDER_FREE_EXIT_CRITERIA

- **E2E-03** (targeted verification), **E2E-06** (media failure/recovery),
  **E2E-07** (reject/revision), **E2E-12** (worker crash recovery),
  **E2E-18** (state invariants) — all pass provider-free.
- Zero provider calls; original executions never overwritten; distinct recovery identities.

## LIVE_EXIT_CRITERIA

- NOT_APPLICABLE. No live execution required to close P3.

## REQUIRED_E2E_SCENARIOS

E2E-03, E2E-06, E2E-07, E2E-12, E2E-18 (exit); E2E-13, E2E-14 exercised as invariants.

## BLOCKERS

- None for provider-free exit. Legacy job 68 remains terminal/deferred and
  untouched; it is not a blocker.

## COMPLETED_TASKS

- Added `RECOVERY_MODE_REGISTRY` covering normal recovery, revision,
  review-resume, media-resume, targeted verification, reevaluation-only
  recovery, visual iteration, and orphan reconciliation.
- Added canonical rewind enforcement, deterministic frozen-context hashing and
  drift detection, ID ownership, immutable revision descriptors, restricted
  audited in-place repair, state classification, split-brain scanning, and
  explicit retry-budget/ambiguous-side-effect policy.
- Added PostgreSQL session advisory singleton leases for persistent production
  workers and worker-owned job lease heartbeats. Long-running jobs are reclaimed
  only after both job lease expiry and worker presence expiry.
- Quarantined root `run-council*.mjs` and `run-recovery*.mjs` scripts behind an
  explicit legacy override plus mandatory test-database validation.
- Provider-free E2E-03, E2E-12, and E2E-18 regressions pass; Program-1 and
  Program-2 provider-free regression suites remain green.
- Canonical Program-1 fixture builders now inject runtime-owned Research
  identity and preserve semantic evidence. E2E-06 reaches the media failure
  and MEDIA_RESUME boundary; E2E-07 and REVIEW_RESUME construct state through
  canonical Owner decision/dispatch APIs. Frozen lineage, rewind, immutable
  artifacts, exactly-once accounting, concurrency and replay are certified.
- Remaining v6/v7 dispatch/worker and historical media worker launchers are
  quarantined behind the explicit test-database-only legacy guard.
- Historical `work/` utilities are barred from production DB connections by
  the canonical pool guard; direct-`pg` exceptions carry the same explicit
  test-database-only guard.

## CURRENT_TASK

- None. Provider-free exit certified by
  `AMF_REMEDIATION_PROGRAM_03_E2E_FIXTURE_ALIGNMENT_AND_EXIT_V1`.

## NEXT_TASK

- `PROGRAM_04_KICKOFF`. Program 4 remains `NOT_STARTED` until explicitly
  authorized.

## CHANGELOG

- 2026-09-27: Program file created by `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1`. Status `NOT_STARTED`.
- 2026-09-27: `AMF_REMEDIATION_REGISTRY_CURRENT_STATE_RECONCILIATION_V1` — job-68
  stale `running` references corrected to terminal/deferred (read-only DB check);
  no disposition blocker remains. Status stays `NOT_STARTED`.
- 2026-09-27: Program activated by
  `AMF_REMEDIATION_PROGRAM_03_RECOVERY_STATE_LINEAGE_V1`; implementation and
  provider-free certification started with production state explicitly out of scope.
- 2026-09-27: Partial provider-free result recorded. Core policy/state/lease
  tests pass (28/28), targeted-verification E2E passes (16/16), crash recovery
  and state-invariant DB proofs pass, and Program-1/2 regressions pass (22/22).
  E2E-06/E2E-07 remain failed because their source-workflow fixtures drifted
  from current Research contracts; Program status remains `IN_PROGRESS`.
- 2026-09-28: Fixture-alignment exit completed. E2E-06/E2E-07 and
  REVIEW_RESUME now use current canonical contracts and reach real recovery
  boundaries. Full Program-3 plus Program-1/2 regression command passed
  114/114; direct normal-recovery and visual-iteration suites passed 26/26.
  All used isolated PostgreSQL with zero provider calls. Status advanced to
  `PROVIDER_FREE_PASS`.
- 2026-09-30: Checkpoint regression diagnosis resolved a test-only restart race
  in media-resume case N. The fixture previously allowed the fire-and-forget
  engine to advance beyond its narrow post-TTS polling state; it now injects a
  deterministic `WorkflowCrashError` at the post-TTS/pre-Timeline boundary.
  Production recovery behavior and timeouts were not changed. Test N passed
  alone, media-resume passed 22/22, and the exact checkpoint Program-3 suite
  passed 70/70 with zero timeouts and zero provider calls. Status remains
  `PROVIDER_FREE_PASS`; the Git checkpoint is ready to retry separately.
- 2026-09-30: The V2 checkpoint's two later blockers were remediated. The
  cold-resume production path was not defective; its canonical fixture was
  stale against current Research and visual-direction contracts. After fixture
  alignment, cold `process() -> engine.resume()` restores the Owner gate and
  repeated resumes without approval remain fail-closed. A separate production
  defect in review-resume authorization was confirmed: concurrent callers
  could pass eligibility and create different attempts. PostgreSQL advisory
  serialization plus a database-unique idempotency identity now enforce one
  dispatch/job/revision task across processes while preserving historical
  evidence. Program 3 passed 70/70 with zero failures/timeouts and status
  remains `PROVIDER_FREE_PASS`; no production schema was migrated.
