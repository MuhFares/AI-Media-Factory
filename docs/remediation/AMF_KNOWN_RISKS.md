# AMF Known Risks (audit failure map — preserved)

Bootstrap: `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1` (2026-09-27)

Each entry: RISK_ID / TITLE / ROOT_CAUSE / AFFECTED_STAGE / CURRENT_STATUS /
OWNER_PROGRAM / BLOCKS_FIRST_CONTENT / BLOCKS_AUTONOMY /
PROVIDER_FREE_PROOF_REQUIRED / LIVE_PROOF_REQUIRED / RESOLUTION_EVIDENCE.

Statuses: `OPEN` | `PARTIALLY_REMEDIATED` | `RESOLVED_AFTER_AUDIT` |
`RESOLVED_CERTIFIED` | `UNKNOWN`.
No risk is marked certified at bootstrap — certification requires the stated
E2E proof. `RESOLVED_AFTER_AUDIT` may only be set after source inspection.

Owner programs: P1 = Foundation, P2 = Routing/Preflight, P3 = Recovery/State/Lineage,
P4 = Media/Publication/Analytics, P5 = Owner Autonomy.

---

## Functional risks F-01..F-16

### F-01 — Hooks unresolvable
- ROOT_CAUSE: Hooks stage referenced by orchestration/contracts without a
  canonical agent/runtime decision (implement canonical agent/runtime OR
  remove/migrate explicitly — undecided).
- AFFECTED_STAGE: Hooks / Brief-chain entry.
- CURRENT_STATUS: RESOLVED_CERTIFIED. Hooks had no downstream consumer; it was
  removed from new production templates/runtime registries, its editorial
  responsibility remains in the Brief→Writer contract, and `hook_concepts` is
  explicitly `LEGACY_READ_ONLY`.
- OWNER_PROGRAM: P1. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-01, E2E-04.
- LIVE_PROOF_REQUIRED: none (P1 has no live exit).
- RESOLUTION_EVIDENCE: Program-1 contract matrix + isolated DB E2E-04 (2026-09-27).

### F-02 — Visual direction kind mismatch
- ROOT_CAUSE: `AgentArtifactKind` authority (`packages/shared/src/collaboration.ts`)
  declares `visual_direction_plan`, while `VISUAL_DIRECTOR_OUTPUT_KIND`
  (`packages/tool-framework/.../visual-director-spec.ts`) declares
  `visual_direction_contract`, and `packages/orchestrator/src/templates.ts`
  emits `visual_direction_plan`; lifecycle groups expect
  `visual_direction_contract`. No single artifact contract.
- AFFECTED_STAGE: Visual Direction.
- CURRENT_STATUS: RESOLVED_CERTIFIED. `visual_direction_contract` is the only
  canonical new-write kind across shared types, template, bootstrap, executor,
  media consumer, and contract registry; `visual_direction_plan` is legacy-read.
- OWNER_PROGRAM: P1. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-04.
- LIVE_PROOF_REQUIRED: none.
- RESOLUTION_EVIDENCE: Program-1 contract matrix + isolated DB E2E-04 (2026-09-27).

### F-03 — CEO degraded/partial mode stall
- ROOT_CAUSE: CEO artifact/output model unresolved (`ceo_report` vs
  `ceo_recommendation` vs Strategy Council V2 outputs); sufficiency-gated CEO
  eligibility + partial/insufficient-evidence semantics (V2 `PAUSED`,
  `ceoEligible=false`) can stall Owner→CEO progression without a governed
  insufficient-evidence path (E2E-02).
- AFFECTED_STAGE: CEO / Strategy.
- CURRENT_STATUS: RESOLVED_CERTIFIED. Canonical production output is
  `ceo_recommendation`; strong, partial, honest-empty, and Owner-closed modes
  resolve deterministically without treating business insufficiency as a
  technical crash.
- OWNER_PROGRAM: P1. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-01, E2E-02.
- LIVE_PROOF_REQUIRED: none.
- RESOLUTION_EVIDENCE: Program-1 CEO mode tests + isolated DB E2E-01 eligible
  and insufficient paths (2026-09-27).

### F-04 — Non-Morroway routing bypass
- ROOT_CAUSE: DB production routing authoritative only for branded/Morroway
  paths in practice; Morroway-only enforcement plus legacy ControlPlane/env
  routes and ambient production model literals allow bypass/drift.
- AFFECTED_STAGE: Routing (all text roles).
- CURRENT_STATUS: RESOLVED_CERTIFIED.
- OWNER_PROGRAM: P2. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-11, E2E-16.
- LIVE_PROOF_REQUIRED: none (P2 provider-free only).
- RESOLUTION_EVIDENCE: project-generic `ProductionModelRoutingStore` authority,
  missing-project fail-close, Command Room/worker integration, and isolated-DB
  project-2/project-3 + E2E-16 tests (2026-09-27).

### F-05 — Specialist routing invalid/stale model
- ROOT_CAUSE: Strategy Council specialists and special modes can resolve stale
  or invalid models outside the canonical resolver; benchmark route vs worker
  route parity not enforced; provenance not uniformly persisted.
- AFFECTED_STAGE: Strategy Council / specialists / special modes.
- CURRENT_STATUS: RESOLVED_CERTIFIED.
- OWNER_PROGRAM: P2. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-11, E2E-16.
- LIVE_PROOF_REQUIRED: none.
- RESOLUTION_EVIDENCE: special modes use canonical project-role resolution;
  Strategy Council requires canonical routing provenance; catalog freshness,
  immutable price, explicit fallback, and targeted reevaluation regressions pass.

### F-06 — Text preflight missing
- ROOT_CAUSE: No complete preflight matrix before reservation/transport: LLM
  model existence, provider availability, protocol/endpoint compatibility,
  context-fit, structured-output/schema support, retrieval query/capability
  constraints.
- AFFECTED_STAGE: Research / text agents / retrieval.
- CURRENT_STATUS: RESOLVED_CERTIFIED.
- OWNER_PROGRAM: P2. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-11, E2E-16.
- LIVE_PROOF_REQUIRED: none.
- RESOLUTION_EVIDENCE: universal LLM preflight validates route, catalog
  freshness, provider/protocol, context/output fit, structured-output strategy,
  modality/tools, price snapshot, environment, and drift before reservation;
  retrieval preflight and E2E-11 pass provider-free.

### F-07 — Retry budget exhaustion
- ROOT_CAUSE: Bounded budgets with zero-retry terminal semantics (e.g. Phase-1
  `FAILED_AFTER_SUBMISSION`) plus missing price-snapshot provenance history;
  no unified retry/eligibility/preflight/fingerprint policy across modes.
- AFFECTED_STAGE: Budgets / recovery.
- CURRENT_STATUS: RESOLVED_CERTIFIED. Program 3 has an explicit retry
  budget decision: exact replay creates no new reservation, authorized retry
  requires available capacity, insufficient capacity creates Owner action, and
  ambiguous external effects require reconciliation rather than blind retry.
  E2E-06 plus W/X/Y certify fail-closed and exactly-once behavior.
- OWNER_PROGRAM: P2 (preflight/budget) + P3 (retry/settle semantics). Primary: P3.
- BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: NO.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-14 (budget exhaustion), E2E-06, E2E-12.
- LIVE_PROOF_REQUIRED: P4 live item must demonstrate budget/claim safety.
- RESOLUTION_EVIDENCE: Program-3 full provider-free 114/114 matrix,
  `AMF_REMEDIATION_PROGRAM_03_E2E_FIXTURE_ALIGNMENT_AND_EXIT_V1`.

### F-08 — Voice/fingerprint reauth
- ROOT_CAUSE: TTS voice authorization lifecycle + media fingerprint change
  handling undefined (re-auth flow, narration-fit, fingerprint-change policy).
- AFFECTED_STAGE: Media (narration/audio).
- CURRENT_STATUS: RESOLVED_LIVE_CANARY. Frozen media fingerprints now detect
  voice/provider/model changes and deterministically require Owner
  reauthorization; TTS chunk/restart and E2E-05/E2E-06 pass provider-free.
- OWNER_PROGRAM: P4. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: NO.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-05, E2E-06.
- LIVE_PROOF_REQUIRED: P4 bounded live item.
- RESOLUTION_EVIDENCE: Program-4 media contracts, existing chunk coordinator,
  media-resume regression, and provider-free closed-loop E2E (2026-09-28).
  Bounded live voice quality/reauthorization proof completed through the exact
  canary-scoped VoiceTuT/Mohamed fingerprint and Owner decision. This grants no
  permanent brand-voice approval. Owner Program-4 closure accepts this as
  resolved for the bounded governance architecture; final Morroway voice
  selection remains deferred.
  Readiness inspection 2026-09-28 found the configured production default is
  VoiceTuT `Mohamed` (WAV, 200-character chunk policy), but no current human
  quality-approval record for this canary exists; Phase 1 remains blocked.

### F-09 — Reference image transport
- ROOT_CAUSE: Signed/publicly-fetchable reference asset handling + subject/
  reference continuity across scenes not governed (transport failures,
  stale references, continuity drift).
- AFFECTED_STAGE: Media (image/scene).
- CURRENT_STATUS: PARTIALLY_REMEDIATED. Canonical reference identity,
  ownership/content/subject binding, MIME/hash/suitability/fetchability/expiry
  preflight and provider-safe HTTPS/data transport are enforced provider-free.
- OWNER_PROGRAM: P4. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: NO.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-05.
- LIVE_PROOF_REQUIRED: P4 bounded live item.
- RESOLUTION_EVIDENCE: Program-4 reference contract and image capability tests
  reject local/non-HTTPS, untyped and ambiguous transports before provider.
  Bounded live signed/reference transport remains required.
  Owner closure preserves `PARTIALLY_REMEDIATED`: the live canary validly used
  `REFERENCE_MODE=NONE`, so it did not prove a live signed-reference transport.

### F-10 — Wan ambiguous submission
- ROOT_CAUSE: Wan ambiguous submission reconciliation undefined (duplicate/
  ambiguous video submissions can diverge without canonical reconcile).
- AFFECTED_STAGE: Media (video).
- CURRENT_STATUS: PARTIALLY_REMEDIATED. Intent-before-submit ledger semantics,
  ambiguous `RECONCILIATION_REQUIRED`, no blind resubmit, provider-job recovery,
  and shared `VIDEO_RECONCILIATION` policy pass provider-free.
- OWNER_PROGRAM: P4. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: NO.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-05, E2E-06.
- LIVE_PROOF_REQUIRED: P4 bounded live item.
- RESOLUTION_EVIDENCE: Program-4 L/M/N tests plus RunPod Wan boundary and
  Program-3 recovery/accounting regressions. Live provider reconciliation remains.
  Owner closure preserves `PARTIALLY_REMEDIATED`. The live ambiguous submission
  obeyed intent-before-POST, no-blind-retry and exactly-once accounting, then
  recovered through an audited Owner output import without falsifying provider
  proof. Source hardening is provider-free certified, but the hardened handler,
  persistent receipts and endpoint digest parity are not deployed or certified.

### F-11 — Caption/narration verification
- ROOT_CAUSE: Burned-caption verification + narration-fit verification missing
  as certification gates (synthetic-audio proxies do not prove semantic quality).
- AFFECTED_STAGE: Media QA/composition.
- CURRENT_STATUS: RESOLVED_LIVE_CANARY. Narration-fit/no-cut/tail policy is
  deterministic. Sidecar captions are explicitly not burn-in proof; renderer
  receipt without semantic/pixel certification remains HUMAN_REVIEW_REQUIRED.
- OWNER_PROGRAM: P4. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: NO.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-05.
- LIVE_PROOF_REQUIRED: P4 bounded live item.
- RESOLUTION_EVIDENCE: Program-4 narration/caption, timeline and final-media QA
  provider-free tests. The bounded live output preserved full narration,
  rendered captions, passed technical QA, and received exact Owner approval for
  the private-publication canary. No permanent brand-quality approval is
  inferred.
  Owner Program-4 closure accepts this as resolved live for the bounded canary;
  broader permanent brand-quality approval remains outside this proof.

### F-12 — Publication token liveness
- ROOT_CAUSE: Publish token-liveness preflight missing; private/public authority
  separation, publication binding, session recovery/reconcile, duplicate-upload
  protection, and public/scheduled promotion rules incomplete as an Owner flow.
- AFFECTED_STAGE: Publication.
- CURRENT_STATUS: PARTIALLY_REMEDIATED. Provider-free credential states now
  distinguish VALID, EXPIRED, REVOKED and UNKNOWN_REQUIRES_REFRESH; private
  validation and public publish use distinct exact scopes. Publish sessions,
  exact identity/hash binding and duplicate protection pass on isolated DB.
- OWNER_PROGRAM: P4. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-08, E2E-09.
- LIVE_PROOF_REQUIRED: P4 bounded live item (private/safe only).
- RESOLUTION_EVIDENCE: Program 2 established the provider-free publication
  preflight contract and explicitly returns
  `TOKEN_LIVENESS_UNKNOWN_REQUIRES_REFRESH`; live token proof, Owner publication
  flow. P4 E2E-08/E2E-09 now pass provider-free; live credential refresh and
  private publication remain intentionally unproven.
  Readiness inspection 2026-09-28 verified channel
  `channel-morroway-youtube` / `@morrowaystudio` as `VERIFIED`; subsequent
  Owner-authorized activation created exactly one ACTIVE opaque project binding.
  The first Phase-0 attempt stopped before OAuth transport because the worker
  had exited. After Owner restart, the bounded rerun completed one successful
  refresh and one read-only `channels.list(mine=true)` call, verifying the exact
  Morroway channel and required persisted upload/read-only/analytics scopes.
  This resolves the live credential-health sub-gate only; private publication,
  idempotency, and the bounded live item remain unproven.
  On 2026-09-29 the Phase-5 pre-transport contract defect was resolved
  provider-free: immutable final-media ID/hash are now independent of typed
  provider transport, local bytes are hash-verified before transport, session
  provenance retains both identity and a path-independent transport
  fingerprint, and E2E-08/E2E-09 remain passing. The Owner then refreshed the
  worker and reauthorized the exact canary: one private upload completed with
  zero retries, independent read-back verified the exact Morroway channel,
  private visibility and unchanged metadata, the canonical published report
  retained final-media ID/hash lineage, and private-upload accounting settled
  once from 0/1 to 1/1. F-12 remains `PARTIALLY_REMEDIATED` rather than fully
  resolved because this evidence authorizes no public publication and does not
  complete the broader Owner publication lifecycle.
  Owner closure therefore preserves `PARTIALLY_REMEDIATED`: credential health,
  exact private authority, one private upload, receipt validation and
  exactly-once accounting are live-proven; public publication remains governed,
  unauthorized and unproven.

### F-13 — Analytics join
- ROOT_CAUSE: Analytics join identity undefined across
  `final_media_artifact → published_report → performance observation → learning`;
  join-key invariants, fixture exclusion from live metrics, and durable visible
  learning not enforced.
- AFFECTED_STAGE: Analytics/Learning.
- CURRENT_STATUS: RESOLVED_LIVE. Governed observations require the full
  content/workflow/final-media SHA/published-report/provider publication/channel/
  analytics-provider join. Fixtures remain validation-only; learning evidence
  cannot cite absent metrics and proposals stop at Owner decision.
- OWNER_PROGRAM: P4. BLOCKS_FIRST_CONTENT: YES (for closed loop). BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-10.
- LIVE_PROOF_REQUIRED: P4 bounded live item (analytics captured + learning recorded).
- RESOLUTION_EVIDENCE: isolated-DB E2E-10 and learning regressions (2026-09-28).
  Bounded live analytics capture completed on 2026-09-29: one zero-retry,
  video-specific request returned HTTP 200 with zero rows; observation
  `obs-ea5b7d61d0a7` truthfully preserves an empty live response without
  zero-filling and carries the complete canonical join plus explicit live-canary
  KPI exclusion. Local learning `learn-01ecc33b989b`, evidence-bound
  recommendation `rec-a1b07efbdc83`, and Owner-gated proposal
  `ncp-294f1942f013` now complete the live chain without citing absent metrics,
  zero-filling, or creating next-cycle execution.
  Readiness inspection 2026-09-28 found all four Program-4 nullable lineage
  columns absent in production (`content_id`, `published_report_id`,
  `final_media_sha256`, `analytics_provider_id`). The source bootstrap is
  additive/idempotent for these columns, but production migration was not
  authorized or executed at that inspection. The later narrow migration and
  live observation and learning chain prove those analytics join columns and
  the full bounded closed-loop authority in production.
  Owner Program-4 closure accepts F-13 as `RESOLVED_LIVE`; the empty observation
  remains insufficient for content-performance conclusions by design.

### F-14 — Worker singleton
- ROOT_CAUSE: Singleton worker enforcement + stale-`running` reclamation +
  reconciliation sweeper missing/ambiguous. Canonical note (2026-09-27
  read-only DB check): legacy job 68 is TERMINAL (`failed`/18 attempts,
  `workflow ended CANCELLED`; workflow `CANCELLED`; submission `cancelled`)
  and is NOT the live queue state — it must not be reopened, mutated,
  approved, or reused without explicit Owner authorization. No worker process
  was running at that historical inspection; latest presence heartbeat then
  was stale (2026-09-26T22:56:08Z). Program-3 provider-free certification now
  supersedes that unverified implementation state.
- AFFECTED_STAGE: Worker/queue/state.
- CURRENT_STATUS: RESOLVED_CERTIFIED. Persistent production worker bootstrap
  now acquires a database/session-scoped advisory singleton lease by singleton
  key + worker role; a second worker fails closed. Queue claims carry worker
  and job-lease heartbeats; crash release and healthy long-running protection
  pass against isolated PostgreSQL; Program-3 exit is certified.
- OWNER_PROGRAM: P3. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-12, E2E-18.
- LIVE_PROOF_REQUIRED: none (provider-free). Pilot close needs Owner worker
  refresh to expected build `d2d3800f…` (job-68 disposition is NOT required).
- RESOLUTION_EVIDENCE: E2E-12 + E2E-18 and Program-3 S/T/U/V/AD/AE matrix.

### F-15 — Submission/job split-brain
- ROOT_CAUSE: Submission/job/workflow split-brain detection missing
  (authorization-with-no-job, PAUSED↔owner-actionability mapping,
  authorization/job/workflow divergence).
- AFFECTED_STAGE: Workflow/state.
- CURRENT_STATUS: RESOLVED_CERTIFIED. Canonical state classification and a
  read-only reconciliation sweeper detect authorization-without-job,
  running-job/terminal-workflow, terminal-job/running-workflow, and active
  recovery/terminal-job conflicts without inventing completion. E2E-06,
  E2E-07, REVIEW_RESUME, E2E-12 and E2E-18 certify settlement and replay.
- OWNER_PROGRAM: P3. BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: YES.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-18 (state invariants), E2E-12.
- LIVE_PROOF_REQUIRED: none.
- RESOLUTION_EVIDENCE: Program-3 full provider-free 114/114 matrix.

### F-16 — Sandbox execution guidance
- ROOT_CAUSE: Managed-sandbox egress policy (EACCES) vs provider failure
  ambiguity; execution-guidance/preflight does not distinguish sandbox-denied
  transport from authentic provider errors before budget/attempt consumption.
- AFFECTED_STAGE: Execution environment / transport.
- CURRENT_STATUS: PARTIALLY_RESOLVED (universal preflight rejects a known
  unsupported execution environment before transport; post-start typed
  failure classification/recovery remains Program 3).
- OWNER_PROGRAM: P2 (preflight) + P3 (failure classification). Primary: P2.
- BLOCKS_FIRST_CONTENT: YES. BLOCKS_AUTONOMY: NO.
- PROVIDER_FREE_PROOF_REQUIRED: E2E-11, E2E-17.
- LIVE_PROOF_REQUIRED: none.
- RESOLUTION_EVIDENCE: Program-2 environment-preflight regression plus prior
  diagnostic evidence; full E2E-17 transport-error classification deferred.

---

## Architectural roots R-1..R-10

### R-1 — No single contract authority
`CANONICAL_STAGE_CATALOG` and `ARTIFACT_CONTRACT_REGISTRY` are the authoritative
runtime catalog/validator layer; production templates fail closed on drift and
critical executor boundaries validate identity, lineage, semantics, producer
kind, and consumer acceptance. OWNER_PROGRAM: P1. STATUS: RESOLVED_CERTIFIED
(Program-1 matrix + E2E-01/E2E-04, 2026-09-27).

### R-2 — Routing authority fragmented
Project DB routing vs env/ControlPlane vs ambient literals vs special modes.
OWNER_PROGRAM: P2. STATUS: RESOLVED_CERTIFIED (branded production uses exact
PROJECT DB routing; configuration files/env are explicitly non-authoritative;
special modes and Command Room use the same resolver/preflight).

### R-3 — Preflight after transport
Reservation/transport can precede validity checks. OWNER_PROGRAM: P2.
STATUS: RESOLVED_CERTIFIED (route/materialization/preflight precede reservation;
capability local preflight precedes transport, with canonical release semantics
retained where a boundary must reserve first).

### R-4 — Recovery per-mode instead of per-framework
`PostgresRecoveryDispatcher` + `TargetedVerificationReevaluationRecoveryDispatcher`
+ media/review/visual/orphan paths share no generic lifecycle.
OWNER_PROGRAM: P3. STATUS: RESOLVED_CERTIFIED. All canonical recovery
modes share the mode/rewind registry and required frozen-context, drift,
idempotency, settlement, state-reconciliation and lineage primitives. The
2026-09-30 review-resume concurrency recheck additionally proved durable
cross-process exactly-once dispatch through PostgreSQL serialization plus a
unique idempotency identity; the 70/70 Program-3 suite is green.

### R-5 — State invariants unenforced at runtime
PAUSED/actionability, split-brain, singleton, sweeper are documented more than enforced.
OWNER_PROGRAM: P3. STATUS: RESOLVED_CERTIFIED. Runtime classifier, read-only
sweeper, DB singleton, job leases, Owner action creation and all-mode
settlement/replay are provider-free certified. The canonical cold-worker gate
regression now also proves reconstruction in definition order and repeated
restart fail-closed behavior at the same actionable Owner gate.

### R-6 — Lineage by convention, not by rule
No durable ID-ownership rules (runtime vs model vs provider IDs), no canonical
lineage graph, no revision/hash/reload semantics, analytics join by convention.
OWNER_PROGRAM: P3 (lineage) + P4 (analytics join). STATUS:
RESOLVED_CERTIFIED. Program 3 certifies runtime/model/provider ID ownership,
frozen-context hashes, immutable revisions and recovery lineage. Program 4 adds
and certifies the canonical final-media/publication/observation join on isolated
PostgreSQL; legacy media identity cannot satisfy the new governed join.

### R-7 — Media chain has no certified canonical path for new production
Legacy chains still referenced; signed-asset/continuity/reauth/fingerprint/
caption/narration/Wan-reconcile/budget-safety gates missing.
OWNER_PROGRAM: P4. STATUS: RESOLVED_CERTIFIED for provider-free new production.
The stage catalog, reference/fingerprint/continuity/QA contracts, canonical
scene/final-media artifacts and recovery/accounting path pass E2E-05/E2E-06.
The separate bounded live item remains a program exit criterion, not an
alternate canonical path.
Wan submission/cold-start sub-risk: RESOLVED_PROVIDER_FREE on 2026-09-28.
Submission acknowledgement, generation, polling, status reads, and result
download now have distinct bounded policies; client execution identity and
durable provider receipts support post-ACK-loss reconciliation while the
no-blind-retry/exactly-once invariant remains enforced. Live deployment of the
new handler receipt path is still required before another Wan submission.
The 2026-09-29 follow-up added a fail-closed deployment manifest/preflight and
provider-free audited historical-output import. A Runpod management credential,
immutable handler digest, and persistent network-volume ID remain operational
blockers. Historical import is separately Owner-authorized and permanently
distinguishes `OWNER_ATTESTED_NOT_PROVIDER_VERIFIED` provider identity from
locally `VERIFIED` technical output.

### R-8 — Publication/analytics/learning not a closed Owner loop
Private/public separation, binding, idempotency, join keys, fixture exclusion,
durable learning visibility missing as product behavior.
OWNER_PROGRAM: P4. STATUS: RESOLVED_LIVE for the bounded closed Owner loop.
Private/public authority, hash/payload binding, crash-safe idempotency,
canonical analytics join, fixture exclusion and durable learning-to-Owner
proposal pass provider-free. The bounded live canary then proved one private
publication, one truthful empty analytics observation, evidence-bound process
learning, and an Owner-deferred proposal with no workflow start. This resolution
does not authorize or prove public publication; that independent boundary
remains governed under F-12 and the open operational backlog.

### R-9 — Owner plane split across Python facade / Node / scripts / stubs
`apps/api` (Python) vs Node API vs `apps/web` stub vs scripts-only operations;
duplicated read-models; UI drift; no single canonical Owner UI decision.
OWNER_PROGRAM: P5. STATUS: `RESOLVED_LIVE`. Current executable source has
one canonical AMF Control UI, one state-changing Node authority, and a
Python compatibility serve/proxy boundary protected by Owner session + CSRF.
`apps/web` is absent and non-authoritative.
Credential health now uses an opaque-binding Owner UI/API action with safe
freshness/evidence/audit persistence and an injectable provider verifier. The
complete Owner journey and script/direct-DB-zero matrices pass provider-free;
legacy OAuth tooling is guarded `BREAK_GLASS_ONLY`.
Temporary OAuth grant debt (2026-09-30): the Morroway Google OAuth application
is confirmed `External / Testing`. Its current YouTube grants are therefore
subject to the approximately seven-day testing authorization lifetime. Periodic
interactive Owner reauthorization is required until domain/branding work and
the In-production publishing posture are completed. This does not reopen the
provider-free Owner-plane architecture result, but it blocks durable live
credential readiness. `GOOGLE_OAUTH_PRODUCTION_DOMAIN_REQUIRED = DEFERRED`.
LIVE_EVIDENCE (2026-09-30): an authenticated Owner used AMF Control for the
successful credential-health action and next-cycle DEFER; canonical audits and
domain records prove Node authority, safe evidence, Decision Center clearance,
and zero workflow auto-start. The Testing-mode grant debt remains independent.

### R-10 — Operations not production-grade
No auth/RBAC, no supervision (processes die silently), no backup/restore, no
metrics/tracing/alerts, no scheduler, local-disk artifacts, single worker
bottleneck. OWNER_PROGRAM: P5 (with P3 for singleton/state). STATUS:
PARTIALLY_REMEDIATED.
PROGRAM_05_EVIDENCE (2026-09-29): Owner authentication, HttpOnly sessions,
session-bound CSRF, project authorization, secret redaction, canonical singleton
worker controls, build/heartbeat/queue visibility, provider-health honesty,
alerts, governed scheduler foundations, and normal-operation script/direct-DB
elimination are provider-free tested. STATUS remains `PARTIALLY_REMEDIATED`;
The Owner normal-operation portion is `RESOLVED_LIVE` as of 2026-09-30: one
authenticated credential verification and one DEFER decision completed through
AMF Control with no script/direct DB, no workflow start and no forbidden side
effect. Remaining independent debt is backup/restore operationalization,
durable object storage, horizontal scaling, hardened Wan deployment/persistent
receipts/endpoint digest parity, and Google OAuth production-domain migration.

---

## Risk → program index

- P1: F-01, F-02, F-03, R-1.
- P2: F-04, F-05, F-06, F-16, R-2, R-3 (+ F-07 shared).
- P3: F-07 (primary), F-14, F-15, R-4, R-5, R-6 (+ F-16 shared).
- P4: F-08, F-09, F-10, F-11, F-12, F-13, R-7, R-8 (+ R-6 shared).
- P5: R-9, R-10 (plus all BLOCKS_AUTONOMY risks as entry conditions).

Counts: functional risks registered = 16; architectural roots = 10; total = 26.
