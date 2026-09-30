# AMF Programs 01–05 Final Handoff

Snapshot task: `AMF_REMEDIATION_PROGRAMS_01_TO_05_FINAL_HANDOFF_AND_CLOSURE_SNAPSHOT_V1`
Snapshot date: 2026-09-30
Repository: `D:\AIWorkspace\AI-Media-Factory`

This is the authoritative closure handoff for Programs 1–5. It reconciles
documentation and read-only state; it grants no execution authority.

## 1. Executive state

| Program | Canonical status | Owner state | Proof boundary |
|---|---|---|---|
| Program 1 — Foundation Contracts | `PROVIDER_FREE_PASS` | n/a | Provider-free |
| Program 2 — Routing / Preflight | `PROVIDER_FREE_PASS` | n/a | Provider-free |
| Program 3 — Recovery / State / Lineage | `PROVIDER_FREE_PASS` | n/a | Provider-free |
| Program 4 — Media / Publication / Analytics | `LIVE_CANARY_PASS` | `CLOSED` | Provider-free plus one bounded live closed loop |
| Program 5 — Owner Autonomy | `LIVE_OWNER_PASS` | `CLOSED` | Provider-free plus bounded live Owner operation |

No remediation program is active. `NEXT_ACTION = NO_AUTOMATIC_PROGRAM_START`.
Morroway remains `OFF / L0_MANUAL / DISABLED`.

Read-only runtime verification at snapshot time found one canonical worker on
build `6a4fca473d493f241e7e2d5fb2c12877506ec8584accb3c0fa565133a40a2e4b`,
exact build parity, a healthy heartbeat, and queue `0 queued / 0 running`.
Node reported database/queue health through the canonical status operator and
AMF Control returned HTTP 200. Preserved 2026-09-24 supervisor crash-loop
metadata is historical, not current process health.

## 2. Program-by-program status

### Program 1 — Foundation

`FOUNDATION_CONTRACTS = PROVEN_PROVIDER_FREE`.

- Canonical stage catalog established; Hooks is not an independent production
  stage and its responsibility remains in Brief→Writer.
- `visual_direction_contract` and `ceo_recommendation` are canonical.
- The artifact registry and runtime schema validation are active.
- Unsupported directives fail closed.

### Program 2 — Routing / Preflight

`ROUTING_PREFLIGHT = PROVEN_PROVIDER_FREE`.

- Database production routing is authoritative; silent fallback is prohibited.
- Special modes use canonical routing.
- Model/catalog/price, context-fit, retrieval, publication and analytics
  preflights are certified.
- Cross-project route isolation is enforced; stale or unavailable models fail
  before reservation or transport.

### Program 3 — Recovery / State / Lineage

`RECOVERY_STATE_LINEAGE = PROVEN_PROVIDER_FREE`.

- The shared recovery framework covers revision, review, media, targeted,
  visual and orphan recovery.
- Rewind horizons, frozen lineage, state invariants, reconciliation, singleton
  protection and exactly-once accounting are certified.
- Dangerous legacy runners fail closed or are explicit guarded engineering
  paths.

### Program 4 — Live closed loop

`PROGRAM_04_STATUS = LIVE_CANARY_PASS`; `OWNER_STATE = CLOSED`.

Canonical lineage:

`TTS / media inputs → scene_visual_artifact → scene_video_clip → final_media_artifact → published_report → performance_observation → learning_record → recommendation → next-cycle proposal`

Final identifiers:

- final media: `art-final-media-canary-e46409193d5f74e14829258c`
- private YouTube video: `QC0XPZak0Q4`
- published report: `art-published-report-b71671ebda5049b64b3b7c82`
- analytics observation: `obs-ea5b7d61d0a7`
- learning record: `learn-01ecc33b989b`
- recommendation: `rec-a1b07efbdc83`
- next-cycle proposal: `ncp-294f1942f013`
- final proposal state: `OWNER_DEFERRED`; no workflow started

`PRIVATE_PUBLICATION_PROVEN = YES`. `PUBLIC_PUBLICATION_PROVEN = NO`.
`PROCESS_LEARNING_PROVEN = YES`.
`CONTENT_PERFORMANCE_LEARNING_PROVEN = NO / INSUFFICIENT_DATA`.

### Program 5 — Owner autonomy

`OWNER_AUTONOMY = LIVE_PROVEN`; `PROGRAM_05_STATUS = LIVE_OWNER_PASS`;
`OWNER_STATE = CLOSED`.

- The Owner authenticated in AMF Control and ran the final bounded credential
  `VERIFY_HEALTH` through the product path. Current health was certified
  `VALID / FRESH`, scope `PASS`, channel identity `MATCH`.
- Decision Center credential attention cleared canonically.
- The Owner chose `DEFER` for `ncp-294f1942f013`; no workflow was created,
  queued, or started.
- Normal operations require no script and no direct database access.
- Node is the sole state-changing authority. Python serves static UI and owns
  session/auth/CSRF/proxy compatibility only.

## 3. Live-proven capabilities

- One bounded Morroway media chain through technically verified final media.
- Exactly-once ambiguous-video recovery without blind resubmission.
- One private YouTube publication with canonical media/report lineage.
- One live video-specific analytics response, truthfully empty and excluded
  from production KPIs.
- Local evidence-bound process learning with no fabricated performance claim.
- Authenticated Owner credential-health and DEFER actions through AMF Control,
  with redacted audits and no automatic workflow start.

Live evidence does not prove public publication, permanent brand quality,
content performance, general provider scale, or autonomous production.

## 4. Provider-free-only capabilities

- Programs 1–3 in full.
- Program-4 contract, preflight, recovery, idempotency and closed-loop test
  matrices beyond the single bounded live canary.
- Wan timeout/cold-start source hardening, durable-receipt design and no-blind-
  retry behavior. Deployment is not proven.
- Program-5 E2E-P5-01..18, multi-project isolation, onboarding, security,
  project scoping, script-zero and direct-DB-zero matrices.
- Standalone E2E-17 sandbox-error classification remains `NOT_RUN`; it is an
  independent coverage gap and does not reopen the certified exits.

## 5. Current Owner operating model

- UI: AMF Control.
- Mutation authority: canonical Node API and domain stores.
- Edge: Python static serving, Owner session/auth, CSRF and proxy only.
- Automation: `OFF / L0_MANUAL / DISABLED`.
- Next-cycle proposal: `OWNER_DEFERRED`; not approved or executable.
- Normal operation: `SCRIPT_REQUIRED = NO`; `DIRECT_DB_REQUIRED = NO`.
- Break-glass/engineering scripts are not normal Owner instructions.

## 6. Current production restrictions

- No automatic next cycle or workflow.
- No autonomous or public publication authority.
- No future Wan submission.
- No automatic Research Pilot or Job-68 reopening.
- No permanent brand voice or visual-quality approval.
- The Program-4 private canary remains excluded from normal production KPI
  aggregates.

## 7. OAuth temporary workaround

- `GOOGLE_OAUTH_MODE = EXTERNAL_TESTING`.
- Current credential health at the final live certification: `VALID / FRESH`.
- Testing-mode refresh-token lifetime is approximately seven days.
- Temporary operation requires periodic interactive Owner reauthorization,
  followed by the bounded product health check.
- Future production fix: domain ownership, branding completion, Google OAuth
  `In production`, and a long-lived production credential path.
- `GOOGLE_OAUTH_PRODUCTION_DOMAIN_REQUIRED = DEFERRED`.

This is not productionized OAuth readiness.

## 8. Wan blocker

- `SOURCE_HARDENING = PROVIDER_FREE_PASS`.
- Canonical timing policy: submission ACK 300000 ms; generation 900000 ms;
  poll 4000 ms; status request 30000 ms; result download 120000 ms.
- No-blind-retry and exactly-once accounting are certified provider-free.
- `FUTURE_WAN_SUBMISSIONS_ALLOWED = NO`.
- `WAN_DEPLOYMENT_CERTIFICATION = NOT_PROVEN`.

Required before future Wan generation:

1. Deploy the hardened owned handler.
2. Configure a persistent RunPod network volume and persistent
   `AMF_VIDEO_RECEIPT_DIR`.
3. Prove deployed image/source digest parity.
4. Activate durable receipt lookup and deployed `clientExecutionId`
   correlation.
5. Complete a separately authorized endpoint readiness certification.

Historical Phase-3 proof remains
`OWNER_ATTESTED_NOT_PROVIDER_VERIFIED`; local output technical proof is
`VERIFIED`. The ambiguity must never be rewritten.

## 9. Closed Research Pilot

- `RESEARCH_PILOT = CLOSED`.
- Outcome: `NO_PRODUCTION_CANDIDATE`.
- CEO advancement: `NONE`.
- Further Research authorization: `NO`.

Do not reopen the Pilot automatically or treat closure as permission for new
research.

## 10. Job 68 immutable state

- workflow: `wf-1790228899612-hyfzmb2k`
- workflow state: `CANCELLED / OWNER_DEFERRED_LEGACY_WORKFLOW`
- job: `failed / terminal`
- attempts: `18`
- Owner authority: `PENDING / NOT_GRANTED`

`DO NOT reopen`, `DO NOT approve`, `DO NOT mutate`, and `DO NOT reuse` without
explicit Owner authorization. Job 68 is historical evidence, not a queue item.

## 11. Open operational backlog

These are independent debt, not hidden invalidators of Programs 1–5 closure:

1. Google OAuth domain / In-production migration.
2. Hardened Wan deployment.
3. Persistent Wan receipt storage.
4. RunPod endpoint digest/source parity.
5. Backup/restore operationalization.
6. Durable object-storage policy.
7. Horizontal scaling / singleton architecture beyond the certified singleton.
8. Generated-output retention policy.
9. Remaining legacy package/script archival.
10. Final brand voice selection.
11. Final brand visual-quality standard.
12. Public-publication authority and lifecycle.

Risk reconciliation: R-9 is `RESOLVED_LIVE`; the Owner normal-operation portion
of R-10 is `RESOLVED_LIVE`, while R-10 overall remains
`PARTIALLY_REMEDIATED`. F-09, F-10 and F-12 remain partial for their explicit
live/deployment/public boundaries. F-11 and F-13 are resolved live for the
bounded evidence. F-16 remains partial and E2E-17 remains unexecuted.

## 12. Hygiene carry-forward

- COMPLETED: canonical contract/routing/recovery/media guards and unified Owner
  mutation authority.
- DEFERRED: OAuth/Wan/storage/backup/scaling/retention/publication and brand
  productionization.
- BREAK_GLASS_ONLY: guarded credential, migration and recovery operators.
- HISTORICAL: Program-4 proof scripts/canary artifacts and Pilot evidence.
- DO_NOT_TOUCH: Job 68, closed Pilot data, Program-4 live evidence, audit
  history and Owner decisions.
- SAFE_FUTURE_CLEANUP: legacy TTS/timeline physical archival, media-proof and
  old-runner archival, Python read-model thinning, generated-output lifecycle,
  and a broader dead-code sweep after reference checks.

No cleanup or deletion occurred in this snapshot.

## 13. Rules for future agents

Before making changes, every future engineering agent MUST read, in order:

1. `AMF_REMEDIATION_STATUS.md`
2. `AMF_PROGRAMS_01_TO_05_FINAL_HANDOFF.md`
3. `AMF_KNOWN_RISKS.md`
4. `AMF_HYGIENE_REGISTRY.md`
5. `AMF_AGENT_HANDOFF_PROTOCOL.md`

Then read the master plan, relevant program file and E2E matrix. Historical
proofs are immutable. Unknown state must be recorded as `UNKNOWN`, not guessed.
No closed program, Owner decision, Job 68, Research Pilot, budget, production
route, workflow, provider operation, or publication may be reopened merely
because an engineering agent is present.

## 14. Next separately authorized work candidates

All candidates are `NOT_AUTHORIZED / NOT_STARTED`:

- A. `GOOGLE_OAUTH_PRODUCTIONIZATION`
- B. `WAN_DEPLOYMENT_CERTIFICATION`
- C. `BACKUP_RESTORE_OPERATIONALIZATION`
- D. `DURABLE_OBJECT_STORAGE`
- E. `HORIZONTAL_SCALING`
- F. `FINAL_BRAND_VOICE_SELECTION`
- G. `FINAL_BRAND_VISUAL_STANDARD`
- H. `PUBLIC_PUBLICATION_READINESS`
- I. `REPOSITORY_HYGIENE_FINAL_SWEEP`

## 15. Do not automatically start

Do not start Program 6, another remediation program, a workflow, a next cycle,
Research, media generation, Wan generation, publication, analytics, provider
verification, automation, cleanup, deployment, or public release without a
new exact Owner authorization.

## E2E final summary

- Programs 1–3: provider-free certified at their defined exits.
- Program 4: provider-free E2E-05/06/08/09/10 plus bounded live private
  publication and closed analytics→learning evidence.
- Program 5: E2E-P5-01..18 and E2E-15 provider-free plus live authenticated
  Owner credential-health and DEFER evidence.
- No public-production evidence is claimed.

## Git/change snapshot

- branch: `main`
- HEAD: `a43bb1e84f5dfdf15907dcc8ba3ae9a28b4f745a`
- Checkpoint attempt `AMF_PROGRAMS_01_TO_05_GIT_CHECKPOINT_AND_WORKTREE_RECONCILIATION_V1`
  is `PARTIAL / COMMIT_BLOCKED`; see
  `AMF_PROGRAMS_01_TO_05_GIT_CHECKPOINT.md`. No file was staged or committed.
  A reproducible Program-3 media-resume test timeout must be resolved or
  explicitly waived before the deterministic checkpoint can proceed.
- Earlier directory-collapsed view: 542 dirty entries. The checkpoint's
  file-expanded inventory found 1,898 dirty files before its manifest
  (138 status-dirty tracked paths and 1,760 untracked files; 123 tracked paths
  carry content diffs). See the checkpoint manifest for
  exact deterministic category counts.
- This task does not revert, stage, commit, delete, or reinterpret unrelated
  work. Its owned changes are restricted to remediation documentation:
  `README.md`, `AMF_AGENT_HANDOFF_PROTOCOL.md`, `AMF_REMEDIATION_STATUS.md`,
  `AMF_E2E_CERTIFICATION_MATRIX.md`, `AMF_HYGIENE_REGISTRY.md`,
  `programs/04-media-publication-analytics.md`,
  `programs/05-owner-autonomy.md`, and this handoff document.

## Snapshot side effects

- provider/OAuth/media/upload/analytics/LLM/Research calls: `0`
- workflow executions: `0`
- production database mutations: `0`
- budget/routing/automation/runtime mutations: `0`
- next program started: `NO`
