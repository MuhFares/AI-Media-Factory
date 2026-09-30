# AMF Programs 01–05 Git Checkpoint Reconciliation

Task: `AMF_PROGRAMS_01_TO_05_GIT_CHECKPOINT_AND_WORKTREE_RECONCILIATION_V1`
Date: 2026-09-30
Original result: `PARTIAL / COMMIT_BLOCKED`
Current gate after V3 recheck: `READY_FOR_EXPLICIT_STAGING / COMMIT_NOT_CREATED`
Repository: `D:\AIWorkspace\AI-Media-Factory`

## Checkpoint purpose

Prepare a deterministic Programs 1–5 checkpoint without changing runtime
behavior, deleting historical material, committing secrets, or absorbing local
and generated files. The commit gate is intentionally fail-closed.

## Base and program state

- Branch: `main`
- Base HEAD: `a43bb1e84f5dfdf15907dcc8ba3ae9a28b4f745a`
- Upstream relation at inspection: `main...origin/main [ahead 5]`
- Program 1: `PROVIDER_FREE_PASS`
- Program 2: `PROVIDER_FREE_PASS`
- Program 3: `PROVIDER_FREE_PASS`
- Program 4: `LIVE_CANARY_PASS` / Owner `CLOSED`
- Program 5: `LIVE_OWNER_PASS` / Owner `CLOSED`
- Morroway: `OFF / L0_MANUAL / DISABLED`
- Future Wan submissions: `NO`
- Google OAuth: `EXTERNAL_TESTING`; production domain migration `DEFERRED`
- New program started: `NO`

The historical certification statuses remain authoritative. The failed
checkpoint regression below originally blocked the Git commit; it did not
rewrite the historical certifications. The deterministic test-harness repair
recorded below clears that specific blocker, but this document does not itself
authorize staging or create a commit.

## Worktree capture before manifest creation

- tracked modified reported by `git status`: 138
- tracked deleted: 0
- other tracked status: 0
- untracked files (`git ls-files --others --exclude-standard`): 1,760
- total dirty files using fully expanded untracked status: 1,898
- ignored files observed: 19,181
- content-bearing tracked diff: 123 files, 10,997 insertions, 843 deletions;
  15 additional tracked paths were status-dirty but produced no content diff

The earlier figure of approximately 542 was Git's directory-collapsed short
view. This checkpoint uses file-expanded counts.

## Deterministic dirty-path classification

Every one of the 1,898 tracked-modified or untracked paths examined
before this manifest was created matched exactly one classification. There were
zero unknown paths.

| Class | Count | Checkpoint treatment |
|---|---:|---|
| A — `PROGRAMS_01_TO_05_SOURCE` | 231 | candidate |
| B — `PROGRAMS_01_TO_05_TEST` | 253 | candidate |
| C — `PROGRAMS_01_TO_05_REMEDIATION_DOC` | 13 | candidate; 14 after this manifest |
| D — `CANONICAL_CONFIG` | 15 | candidate |
| E — `CANONICAL_OPERATOR_TOOL` | 29 | candidate |
| F — `IMMUTABLE_EVIDENCE` | 65 | excluded; preserved untouched |
| G — `HISTORICAL / FORENSIC` | 148 | excluded; preserved untouched |
| H — `GENERATED_BUILD_OUTPUT` | 830 | excluded |
| I — `GENERATED_RUNTIME_OUTPUT` | 165 | excluded |
| J — `LOCAL_ENVIRONMENT` | 1 | excluded |
| K — `SECRET_OR_SENSITIVE` | 12 | excluded; commit forbidden |
| L — `SCRATCH / WORK` | 136 | excluded |
| M — `UNRELATED_PRE_EXISTING` | 0 | excluded by rule if encountered |
| N — `UNKNOWN_REQUIRES_REVIEW` | 0 | commit would be blocked if nonzero |

Classification is path-rule based and deterministic:

- source: changed `apps/**/src`, `packages/**/src`, and their package manifests;
- tests: `test`, `tests`, `e2e`, and test/spec filenames;
- remediation: `docs/remediation/**`;
- canonical config: `configs/**`, selected workflows, root package/lock/workspace
  files and `.gitignore`;
- canonical operators: the explicit operator allowlist below;
- immutable evidence: `docs/platform/**`, `docs/incidents/**`, `docs/e2e-v2/**`;
- historical/forensic: other historical docs, experimental files and one-off
  proof/operator scripts;
- generated/local/scratch/secret paths are always excluded.

## Canonical operator allowlist

Only these changed/untracked operator files were candidate category E:

- `scripts/activate-balanced-production-routing.mjs`
- `scripts/amf-backup.mjs`, `amf-down.mjs`, `amf-restore.mjs`,
  `amf-status.mjs`, `amf-supervise.mjs`, `amf-testdb.mjs`
- `scripts/apply-strategy-iteration-constraints-v2.mjs`
- `scripts/check-prompts.mjs`
- `scripts/inspect-worker-parity.mjs`
- `scripts/legacy-unsafe-runner-guard.mjs`
- `scripts/persistent-worker-singleton.mjs`, `persistent-worker.mjs`
- all eight `scripts/program-04-*` guarded operators present in this worktree
- `scripts/reconcile-content-governance-v4.mjs`
- `scripts/reconcile-experiment-gates-v2.mjs`
- `scripts/reconcile-strategy-corrections-v1.mjs`
- `scripts/reconcile-strategy-morroway-v1.mjs`
- `scripts/refresh-openrouter-model-catalog.mjs`
- `scripts/validate-content-intelligence-v1.mjs`
- `scripts/verify-runpod.mjs`
- `scripts/youtube-oauth.mjs` (break-glass only)

All other one-off, live-proof, v6/v7, revision, media-proof and benchmark
scripts were classified historical/forensic rather than silently included.

## Known dirty paths intentionally outside a future commit

- generated build/cache: `.pnpm-store/**`, `.tools/**`, build/dist/cache paths;
- generated runtime: `artifacts/**`, `output/**`, logs and PID files;
- local environment: `.kilo/**`, ignored `.env`, `.venv`, `node_modules`,
  pytest caches;
- immutable evidence and historical docs listed above;
- experimental Wan directories;
- root `run-*`, `phase*`, `audit-phase*`, `check*`, `persist-*`, diagnostic,
  recovery snapshot and `work/**` files;
- all paths classified secret/sensitive below.

Nothing was deleted, moved, rewritten, staged, or cleaned.

## Secret safety audit

Protected locations:

- `.env`: exists, is ignored, and is forbidden from Git;
- `D:\AMF-Secrets`: exists outside the repository and was not enumerated or
  read for content;
- OAuth token/client-secret filename patterns are covered by `.gitignore`.

Content-pattern scanning checked private-key headers, common API-key formats,
OAuth token/secret literals, bearer literals, JWT literals and credentialed
database URLs without printing matched values.

Twelve root scratch runners contained likely credential/API-key material and
were reclassified `SECRET_OR_SENSITIVE`, `commit_allowed = NO`:

- `check.mjs`
- `run-council.mjs`
- `run-council-correct.mjs`
- `run-council-full-recovery.mjs`
- `run-council-recovery.mjs`
- `run-council-recovery-correct.mjs`
- `run-council-recovery-v2.mjs`
- `run-final-propagation.mjs`
- `run-recovery.mjs`
- `run-recovery-correct2.mjs`
- `run-recovery-direct.mjs`
- `run-recovery-final.mjs`

Three candidate test files triggered literal-pattern heuristics, but redacted
inspection proved they contain explicit fake fixtures only: a fake bearer
token, a `test-client-secret`, and a localhost test-database URL. They are not
secret findings.

Candidate secret scan result: `PASS_WITH_REVIEWED_TEST_FIXTURE_FALSE_POSITIVES`.
No staged-content scan was possible because nothing was staged.

## Build and regression results

The repository-wide workspace build was attempted. All Programs 1–5 core
packages reached successful TypeScript builds, including API, worker, database,
orchestrator, provider adapters/providers, shared, tool framework, workflow
engine and the participating agents. The overall workspace command still
returned nonzero because clean, unrelated packages `context-engine`,
`evaluation-framework`, and `prompt-compiler` contain pre-existing TypeScript
errors. No source was changed to address that unrelated debt.

An isolated `ai_media_factory_test` database was guarded and migrated. No
production database test mutation occurred.

| Program | Provider-free checkpoint regression | Result |
|---|---|---|
| P1 | foundation E2E/contracts/visual definition | `PASS 12/12` |
| P2 | routing E2E/preflight/database routing | `PASS 20/20` |
| P3 | recovery/state/review/revision/media/crash | `BLOCKED`: 69 pass, 1 cancelled by 240-second timeout |
| P4 | closed loop/recovery/media/publication transport | `PASS 27/27` |
| P5 | autonomy/credentials/isolation/auth/UI resilience | `PASS 53/53` |

The failing Program-3 case is:

`apps/worker/test/media-resume-v1.test.js` —
`N: a restart after completed TTS reuses the narration without a second provider call`.

It timed out after 240 seconds in the combined run and again when run alone.
This is reproducible, not a concurrency-only flake. No provider call occurred.

## Program-3 timeout diagnosis and resolution (2026-09-30)

`AMF_PROGRAM_03_CHECKPOINT_REGRESSION_TIMEOUT_DIAGNOSIS_V1` proved the timeout
was a test-harness race, not a production recovery defect. Test N started the
workflow engine's fire-and-forget execution loop and described the loop as
"abandoned", but did not actually stop it. The loop could complete Timeline
and the following local stages before the polling assertion observed the very
short-lived `TTS completed + Timeline pending/running` state. The test then
waited on a state that had already passed.

The fixture now raises the same canonical `WorkflowCrashError` used by the
adjacent restart test at the deterministic post-TTS/pre-Timeline boundary.
Production lease, heartbeat, timeout and recovery behavior are unchanged. The
durable invariant remains strict: the restarted worker reused the one canonical
narration artifact and the TTS provider-call counter remained unchanged.

- Test N alone after repair: `PASS 1/1` in about 2 seconds.
- Complete media-resume file: `PASS 22/22`.
- Exact checkpoint Program-3 regression: `PASS 70/70`, zero failures, zero
  cancellations and zero timeouts.
- Program 1 smoke: `PASS 3/3`.
- Program 2 smoke: `PASS 7/7`.
- Program 4 smoke: `PASS 1/1` against the explicitly isolated test database.
- Program 5 smoke: `PASS 22/22`.
- Worker TypeScript build: `PASS`; the test imports current worker `dist`, and
  stale distribution output was not involved.

No provider call or production-database mutation occurred. Program 3 remains
`PROVIDER_FREE_PASS`. The Programs 1–5 Git checkpoint is now safe to retry as a
separate task with a fresh worktree classification, candidate regression run,
explicit staging, staged secret scan and diff review.

## V2 checkpoint recheck (2026-09-30)

Task: `AMF_PROGRAMS_01_TO_05_GIT_CHECKPOINT_AND_WORKTREE_RECONCILIATION_V2`.

The refreshed worktree contains 1,899 dirty paths: 138 tracked modifications,
zero tracked deletions and 1,761 untracked files. The deterministic classifier
again assigned every path exactly once, with zero unknown paths:

| Class | Count | V2 treatment |
|---|---:|---|
| A — `PROGRAMS_01_TO_05_SOURCE` | 231 | candidate |
| B — `PROGRAMS_01_TO_05_TEST` | 253 | candidate |
| C — `PROGRAMS_01_TO_05_REMEDIATION_DOC` | 14 | candidate |
| D — `CANONICAL_CONFIG` | 15 | candidate |
| E — `CANONICAL_OPERATOR_TOOL` | 29 | candidate |
| F — `IMMUTABLE_EVIDENCE` | 65 | excluded |
| G — `HISTORICAL_FORENSIC` | 148 | excluded |
| H — `GENERATED_BUILD_OUTPUT` | 830 | excluded |
| I — `GENERATED_RUNTIME_OUTPUT` | 165 | excluded |
| J — `LOCAL_ENVIRONMENT` | 1 | excluded |
| K — `SECRET_OR_SENSITIVE` | 12 | excluded; commit forbidden |
| L — `SCRATCH_WORK` | 136 | excluded |
| M — `UNRELATED_PRE_EXISTING` | 0 | excluded by rule |
| N — `UNKNOWN_REQUIRES_REVIEW` | 0 | commit blocker if nonzero |

The exact candidate set remains 542 repository-owned files: 231 source, 253
tests, 14 remediation documents, 15 canonical configuration files and 29
allowlisted operator tools. Generated media/runtime output, build caches,
local environments, immutable evidence, historical/forensic files, scratch
work and the 12 previously identified secret-bearing root runners remain
outside the candidate set.

The candidate secret scan found no private-key material, Google/OpenAI-style
live key formats, JWTs, credential files, `.env`, `AMF-Secrets`, or OAuth token
files. Generic assignment/bearer heuristics matched source configuration names
and provider-free test fixtures; no candidate contained a proven live secret.
Result: `PASS_WITH_REVIEWED_CODE_AND_TEST_FIXTURE_FALSE_POSITIVES`.

### V2 authoritative regression result

- Program 1: `PASS 12/12`.
- Program 2: `PASS 20/20`.
- Program 3: `FAIL 64/70`; six review-resume cases failed after the concurrent
  authorization case returned two successful dispatches instead of exactly
  one. Subsequent cases could not create their expected pending revision task.
  There were zero test-runner timeouts, but the required 70/70 gate was not met.
- Program 4: `PASS 29/29`.
- Program 5: `PASS 53/53`.

The repaired narration-reuse case N continued to pass and preserved the strict
no-second-provider-call invariant. The new Program-3 failures are separate from
the repaired timing race and were not changed in this checkpoint-only task.

### Cold-resume test authority

`apps/worker/test/cold-resume-gate-frontier-regression.test.js` is
`CANONICAL`, not exploratory. Its own contract identifies it as an end-to-end
regression for the 2026-09-14 production incident and exercises the canonical
`process() -> engine.resume()` cold-worker path. It protects the production
invariant that a workflow resumed at the pre-production Owner gate continues
from the gate successor and never injects the alphabetically first pending
Analytics stage into the frontier.

The test fails reproducibly by reaching workflow state `FAILED` instead of
`AWAITING_APPROVAL` before the cold-resume phase. It failed alone against the
isolated test database after a current worker build. Therefore:

- `TEST_AUTHORITY = CANONICAL`
- `PRODUCTION_RISK = YES`
- `CHECKPOINT_BLOCKING = YES`

Per the fail-closed checkpoint policy, V2 stopped before staging. No staged
secret scan, cached-diff review, commit or push was attempted. The historical
Programs 1–5 certification statuses remain unchanged; the current source tree
cannot receive the requested checkpoint until both the canonical cold-resume
regression and the fresh Program-3 70-test regression failure are separately
diagnosed and resolved.

## Staging and commit decision

- Candidate files after this manifest: 542
  (231 source + 253 tests + 14 remediation + 15 config + 29 operators +
  package/category overlap already eliminated by the exact-one classifier).
- Staged files: 0.
- Commit created: `NO`.
- Push performed: `NO`.

The original checkpoint commit was correctly blocked because the explicit
policy required tests to pass before staging/commit. Although the original
case-N timeout is resolved, V2 found the canonical cold-resume failure and a
fresh 64/70 Program-3 result. Both are checkpoint blockers. The separately
identified clean-package baseline build failures also remain recorded. Using
`git add .` or `git add -A` remains forbidden.

## Open risks and restrictions

Existing closure risks remain unchanged: Google OAuth productionization,
hardened Wan deployment/receipts/digest parity, backup/restore, durable object
storage, horizontal scaling, output retention, hygiene archival, final brand
standards and public-publication readiness.

This task made zero provider/OAuth/media/upload/analytics calls, zero workflow
executions, and zero production database, budget, route, automation or runtime
mutations. It did not start another program.

## Required next checkpoint action

Separately diagnose the canonical cold-resume production invariant and the
review-resume concurrency/idempotency regression. After both are proven fixed,
rerun this checkpoint from inventory through exact regressions before staging.
No staging or commit was performed by V2. WAN deployment work remains out of
scope until the checkpoint gate is completed or explicitly waived by the
Owner.

## Program-3 blocker remediation (2026-09-30)

`AMF_PROGRAM_03_COLD_RESUME_AND_REVIEW_RESUME_CONCURRENCY_REMEDIATION_V1`
resolved both V2 blockers without creating a checkpoint commit.

- Cold resume: the production frontier/gate invariant was sound. The canonical
  incident test had stale fixture reconstruction at two current-contract
  boundaries (Research and visual direction). The fixture now supplies the
  canonical Research payload and returns the V2 visual-direction artifact from
  the visual-direction stage itself. The real `process() -> engine.resume()`
  path reaches `AWAITING_APPROVAL`, leaves Analytics unattempted, and restores
  an actionable Decision Center approval. Repeated cold resumes with no Owner
  decision remain at the same gate and fail closed.
- Review resume: a real cross-process race allowed two callers to calculate
  different attempts before the task transitioned to `IN_PROGRESS`. The whole
  eligibility-and-dispatch path is now serialized with a PostgreSQL advisory
  lock. An additive nullable `idempotency_identity` column and unique index
  give every new failed-review execution a durable database backstop while
  preserving historical duplicate rows unchanged. The losing caller observes
  the same canonical dispatch/job; dispatch, job, revision task and
  authorization consumption are exactly once.
- Certification: Program 3 passed 70/70 with zero failures/timeouts; Programs
  1/2/4/5 passed 12/12, 20/20, 29/29 and 53/53. The standalone canonical cold
  regression and three recovery-frontier tests also passed. All database
  writes were confined to the isolated test database; no production migration
  was executed.

Current checkpoint decision: `READY_TO_RETRY`. The next separately authorized
task must rerun inventory, secret scan, exact regression gates and explicit
staging before any commit. WAN work remains out of scope.

## V3 final checkpoint candidate (2026-09-30)

Task: `AMF_PROGRAMS_01_TO_05_GIT_CHECKPOINT_AND_WORKTREE_RECONCILIATION_V3`.

The refreshed file-expanded inventory is unchanged at 1,899 dirty paths: 138
tracked modifications, zero tracked deletions and 1,761 untracked files. The
deterministic exact-one classifier assigned all paths with zero unknowns:

| Class | Count | V3 treatment |
|---|---:|---|
| A — `PROGRAMS_01_TO_05_SOURCE` | 231 | candidate |
| B — `PROGRAMS_01_TO_05_TEST` | 253 | candidate |
| C — `PROGRAMS_01_TO_05_REMEDIATION_DOC` | 14 | candidate |
| D — `CANONICAL_CONFIG` | 15 | candidate |
| E — `CANONICAL_OPERATOR_TOOL` | 29 | candidate |
| F — `IMMUTABLE_EVIDENCE` | 65 | excluded and preserved |
| G — `HISTORICAL_FORENSIC` | 148 | excluded and preserved |
| H — `GENERATED_BUILD_OUTPUT` | 830 | excluded |
| I — `GENERATED_RUNTIME_OUTPUT` | 165 | excluded |
| J — `LOCAL_ENVIRONMENT` | 1 | excluded |
| K — `SECRET_OR_SENSITIVE` | 12 | excluded; commit forbidden |
| L — `SCRATCH_WORK` | 136 | excluded |
| M — `UNRELATED_PRE_EXISTING` | 0 | excluded by rule |
| N — `UNKNOWN_REQUIRES_REVIEW` | 0 | none |

The candidate contains 542 files. Its high-confidence secret scan found no
real secret. One credentialed-database-URL heuristic matched the already
reviewed local provider-free singleton test fixture; no `.env`, OAuth token,
credential JSON, private key, live API key, JWT or external secret file is in
the candidate. Result: `PASS_WITH_REVIEWED_LOCAL_TEST_FIXTURE_FALSE_POSITIVE`.

The final immediately-pre-staging authoritative runs passed:

- Program 1: `12/12`.
- Program 2: `20/20`.
- Program 3: `70/70`, zero failures and zero timeouts.
- Canonical cold-resume gate-frontier: `PASS 1/1`.
- Concurrent review-resume exactly-once dispatch: `PASS 1/1`.
- Program 4: `29/29`.
- Program 5: `53/53`.

The candidate includes the current review-resume schema source: nullable
`idempotency_identity` plus `uq_review_resume_idempotency_identity`, alongside
PostgreSQL advisory serialization. This is additive source/schema intent only.
`PRODUCTION_SCHEMA_MIGRATED = NO`; no production database was touched.

Explicit exclusions remain generated media/runtime output, build caches,
local environments, immutable evidence, historical/forensic material,
scratch work and the 12 secret-bearing legacy root runners. No excluded file
was deleted or rewritten. Existing operational risks remain the hardened Wan
deployment/receipts/digest parity, Google OAuth productionization, backup and
restore, durable object storage, horizontal scaling, retention, final brand
standards and public-publication readiness.

V3 explicit staging selected 528 content-bearing files (406 additions and 122
modifications, zero deletions). The 14 remaining members of the 542-path
candidate classification were tracked status-only/line-ending entries with no
content diff and therefore produced no staged blob. Candidate-to-index
comparison found zero missing and zero extra paths. The staged secret scan
reproduced only the reviewed local test-database fixture match in
`scripts/test/persistent-worker-singleton.test.mjs`; it found no real secret
and no forbidden path. Cached-diff review found no `.env`, external secrets,
OAuth credential/token JSON, media output, virtual environment, `node_modules`,
runtime log/cache, accidental deletion, scratch path or historical evidence
destruction. `STAGED_SECRET_SCAN = PASS_WITH_REVIEWED_LOCAL_TEST_FIXTURE_FALSE_POSITIVE`.
