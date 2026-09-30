# AMF Remediation Status

Bootstrap: `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1` (2026-09-27)
Authority order: this file → `AMF_REMEDIATION_MASTER_PLAN.md` → active `programs/*.md` →
`AMF_KNOWN_RISKS.md` → `AMF_HYGIENE_REGISTRY.md` →
`AMF_E2E_CERTIFICATION_MATRIX.md` → `AMF_AGENT_HANDOFF_PROTOCOL.md`

Allowed statuses: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` |
`PROVIDER_FREE_PASS` | `LIVE_CANARY_PASS` | `LIVE_OWNER_PASS` |
`COMPLETED` | `DEFERRED`

> Evidence cutoff: repository as inspected 2026-09-27 (branch `main`,
> tip `a43bb1e`; ~500 pre-existing dirty working-tree files unrelated to
> this bootstrap — see Validation section in bootstrap report; no runtime
> source was changed by this registry). Historical `PASS` docs are NOT
> re-interpreted as current certification. `UNKNOWN` is used where live
> verification is still required.

---

## OVERALL_REMEDIATION_STATE

- STATUS: `LIVE_OWNER_PASS` (Programs 1–3 retain provider-free exit, Program 4
  is Owner-closed at `LIVE_CANARY_PASS`, and Program 5 is Owner-closed after a
  bounded live AMF Control journey. Preserved operational blockers remain
  independent and are not waived.)
- ACTIVE_PROGRAM: `NONE_PROGRAM_05_OWNER_CLOSED`
- READY_FOR_STRUCTURED_REMEDIATION: YES (registry authoritative; execution may begin)
- NEXT_ACTION: `NO_AUTOMATIC_PROGRAM_START`.
- LAST_UPDATED: 2026-09-30

### Programs 1–5 authoritative closure snapshot — 2026-09-30

- FINAL_HANDOFF: `AMF_PROGRAMS_01_TO_05_FINAL_HANDOFF.md`.
- PROGRAMS: P1/P2/P3 `PROVIDER_FREE_PASS`; P4 `LIVE_CANARY_PASS` / Owner
  `CLOSED`; P5 `LIVE_OWNER_PASS` / Owner `CLOSED`.
- ACTIVE_PROGRAM: none. No new remediation program, workflow, next cycle,
  automation, provider operation, public publication, or Wan submission is
  authorized by this snapshot.
- CURRENT_GOVERNANCE: Morroway remains `OFF / L0_MANUAL / DISABLED`; proposal
  `ncp-294f1942f013` is `OWNER_DEFERRED` and unexecuted.
- INDEPENDENT_DEBT: Google OAuth productionization, hardened Wan deployment and
  receipts, backup/restore, durable object storage, scaling, retention,
  repository hygiene, final brand standards, and public-publication readiness.
- GIT_CHECKPOINT: `RETRY_READY / COMMIT_NOT_CREATED`. The V2 blockers were
  remediated by `AMF_PROGRAM_03_COLD_RESUME_AND_REVIEW_RESUME_CONCURRENCY_REMEDIATION_V1`.
  The cold-resume failure was a canonical-test fixture reconstruction defect:
  current Research and visual-direction contracts are now returned at their
  real stage boundaries, and the cold worker preserves the actionable Owner
  gate. The review-resume issue was a production concurrency defect: the full
  eligibility/mutation path is now serialized by a PostgreSQL advisory lock
  and new dispatches carry a database-unique idempotency identity. Historical
  duplicate evidence remains untouched. Final provider-free results: P1
  12/12, P2 20/20, P3 70/70, P4 29/29, P5 53/53, plus the canonical cold-resume
  regression and repeated cold-resume fail-closed tests. No staging, commit,
  push, provider call, or production-database migration occurred.

## RESEARCH_PILOT_STATE

- STATUS: `CLOSED`
- FINAL_OUTCOME: `NO_PRODUCTION_CANDIDATE`
- FINAL_OWNER_DECISION: `CLOSE_WITH_NO_PRODUCTION_CANDIDATE`
- CEO_ADVANCEMENT: `NONE`; CANDIDATES_ADVANCED: 0.
- FURTHER_RESEARCH_AUTHORIZED: NO.
- Canonical pilot scope (verified read-only against production DB 2026-09-27):
  - PROJECT_ID `morroway`; CONTENT_ID `content-mug6d970-jrkufn`;
    WORKFLOW_ID `wf-1790293235186-1l4105j4` (`content-factory`, state `PAUSED`,
    submission `bounded_stop`).
  - Research step `completed`; all downstream steps pending
    (`ceo-recommendation`, `hooks`, `planner-synthesis`, `writer`, `scenes`,
    `visual-prompt`, `phase1-qa`, `owner-pre-media-gate`, `review`).
  - CEO executions: 0. Downstream executions: none.
  - Owner Review: final decision recorded in this remediation registry;
    candidate-1 and candidate-2 are both `NOT_ADVANCED_TO_CEO`.
  - RESEARCH_ARTIFACT_ID
    `art-wf-1790293235186-1l4105j4-research-20260926T155304378Z`
    (`research_report`, `completed`) present; audited targeted-verification
    revision `targeted-verification-revision-targeted-verification-730e3a0bbe2edd5ccaac50bdefcdc1f4`
    applied 2026-09-27 with prior/repaired payload hashes and receipt preserved.
  - Failed targeted verification execution
    `targeted-verification-730e3a0bbe2edd5ccaac50bdefcdc1f4`
    (`OWNER_APPROVED`, status `FAILED`, job 86, `revision_id` NULL,
    preserved unchanged); its distinct reevaluation-recovery row is completed
    under the new recovery identity recorded below.
  - Candidate-1 targeted retrieval evidence: PRESENT (`...:verify-candidate-1-q1`, `success`).
  - Candidate-2 targeted retrieval evidence: PRESENT (`...:verify-candidate-2-q1`, `success`).
  - Targeted evidence was reused with ZERO new research retrievals by recovery
    `targeted-reevaluation-recovery-214424586a1a9c9ee1c0e5b9cdf59eb0`
    (job 87, `COMPLETED`, one attempt).
  - Reevaluation result: candidate-1 remains `PARTIAL`, candidate-2 changed
    `INCOMPLETE` → `PARTIAL`; both remain `recommendedForProduction=false`
    and CEO-ineligible; aggregate CEO-eligible count is 0.
- Canonical budgets (production DB `production_phase_call_budgets`,
  `morroway` / `PRE_MEDIA_PHASE`, read 2026-09-27):
  - research: limit 13 / consumed 13 / reserved 0 (ZERO capacity remaining).
  - text_agent: limit 25 / consumed 25 / reserved 0 (ZERO capacity remaining).
  - The Owner-authorized 24→25 text limit was consumed exactly once by the
    completed reevaluation recovery; research remained unchanged at 13/13.
- Legacy Job 68: TERMINAL — job status `failed`, attempts 18,
  error `workflow ended CANCELLED`; workflow `wf-1790228899612-hyfzmb2k`
  state `CANCELLED`; submission `cancelled`; legacy approval `PENDING`
  (not granted). `OWNER_DEFERRED_LEGACY_WORKFLOW`: must NOT be reopened,
  mutated, approved, or reused without explicit Owner authorization.
  Job 68 does NOT block Research Pilot close or worker refresh.
- Worker: `HEALTHY_SINGLETON`, PID 4996, one live presence/heartbeat,
  canonical `persistent-worker-script` / `PERSISTENT_PRODUCTION_WORKER` /
  `canonical-production-queue-worker`, environment `SUPPORTED`; running and
  source build both
  `d2d3800f3f5049e30bebf35a50e97694ed6b88989a2d801a0024289dc0c20c91`.
- What is proven (historical evidence, immutable):
  - Research V2 live pipeline proven; targeted verification retrievals completed.
  - Two persisted verification evidence sets exist (rows verified above).
  - Reevaluation previously failed on legacy routing; root cause remediated
    provider-free to canonical Morroway research routing with model preflight
    (see `packages/database/src/targeted-verification-reevaluation-recovery.ts`;
    one completed remediation task — NOT whole-Program 2 completion).
  - Reevaluation recovery reused the existing evidence successfully; no new
    retrievals or Research reservations were created.
- Remaining Research Pilot work: none. No further evidence-fishing or Research
  retry is authorized for this Pilot.
- BLOCKERS: none for Research Pilot closure.
- NEXT_ACTION: historical pilot is closed; the overall remediation next action
  is authoritative.

### Owner final closure — MORROWAY_RESEARCH_PILOT_OWNER_FINAL_CLOSURE_V1 (2026-09-27)

- Decision: `CLOSE_WITH_NO_PRODUCTION_CANDIDATE`; final outcome
  `NO_PRODUCTION_CANDIDATE`.
- Candidate-1 (`A Nile-side perspective on ancient Egypt`): verification and
  factual eligibility `PARTIAL`; not recommended; CEO-ineligible;
  `NOT_ADVANCED_TO_CEO`.
- Candidate-2 (`From Egyptian excavation to museum display`): verification and
  factual eligibility `PARTIAL`; not recommended; CEO-ineligible;
  `NOT_ADVANCED_TO_CEO`.
- Aggregate CEO-eligible candidates: 0. CEO advancement: none. Further
  Research authorized: NO.
- Technical proofs preserved: Research V2 live; targeted-verification live
  retrieval; live reevaluation recovery; canonical reevaluation routing and
  model-availability preflight; evidence reuse with zero new retrievals;
  audited artifact revision; accounting consistency; fail-closed evidence
  gate; bounded Owner decision boundary.
- Runtime intentionally unchanged: workflow remains `PAUSED` at bounded stop;
  Research remains `COMPLETED`; CEO/downstream remain unexecuted. Original
  Research artifact, failed and successful verification/recovery records,
  evidence lineage, revision receipt, and deferred Job 68 state are preserved.
- Budgets remain research 13/13 and text-agent 25/25; no reset, refund, or
  capacity creation occurred during closure.

### Live close-operation record — MORROWAY_RESEARCH_PILOT_FINAL_REEVALUATION_RECOVERY_V1 (2026-09-27)

- Readiness: worker PID 4996; `HEALTHY_SINGLETON`; environment `SUPPORTED`;
  expected/source/running build parity `d2d3800f…`; queue 0 queued / 0 running.
- Capacity: text-agent limit 24→25 only; consumed 24→25; reserved returned to 0.
  Research budget unchanged at limit 13 / consumed 13 / reserved 0.
- Recovery: `targeted-reevaluation-recovery-214424586a1a9c9ee1c0e5b9cdf59eb0`;
  job 87 succeeded on attempt 1 using project route
  `amf-balanced-production-routing-v1-morroway`, research primary
  `openai/gpt-6-luna`, price snapshot `model-price-624e02d5efc6936f182b`.
- Execution: one text transport; zero research reservations, retrievals, or
  capability executions; calculable cost USD 0.0009393; provider-billed cost
  remains `UNKNOWN`/not reported.
- Evidence/artifact: both persisted targeted evidence records reused with
  candidate isolation; audited in-place revision receipt and prior payload
  history preserved. Candidate-1 `PARTIAL`→`PARTIAL`; candidate-2
  `INCOMPLETE`→`PARTIAL`; both not recommended and CEO-ineligible; aggregate 0.
- Boundary: workflow remains `PAUSED`; Research remains `COMPLETED`; CEO and
  downstream artifacts/executions remain 0; Job 68 remains untouched and
  terminal. This was the pre-closure state; the later Owner final closure above
  is authoritative and the Research Pilot is `CLOSED`.

### Reconciliation changelog — CURRENT_STATE_RECONCILIATION_V1 (2026-09-27, read-only DB inspection)

- Conflict 1 (Job 68): observed bootstrap text "job 68 `running`/18 attempts
  blocks ordinary startup — queue disposition is the Owner decision" (sourced
  from 2026-09-25 engine-readiness-recovery doc). Canonical source:
  production DB `workflow_jobs` (job 68: `failed`/18/`workflow ended CANCELLED`),
  `workflow_instances` (`wf-1790228899612-hyfzmb2k`: `CANCELLED`),
  `workflow_submissions` (`cancelled`). Old value: running/blocking.
  Corrected value: terminal/deferred; NOT a pilot-close blocker; must not be
  mutated without explicit Owner authorization.
- Conflict 2 (budgets, reconciliation-time snapshot): observed bootstrap text "research 6/6, text-agent 12/14"
  (sourced from 2026-09-25 engine-readiness-recovery doc). Canonical source:
  production DB `production_phase_call_budgets` (`morroway`/`PRE_MEDIA_PHASE`).
  Old value: research 6/6, text 12/14. Reconciliation-time value: research
  13/13, text_agent 24/24, reserved 0/0. The later authorized reevaluation
  recovery consumed the final added text slot; current canonical state is the
  13/13 and 25/25 snapshot recorded above.
- No values invented: all corrected values are exact DB rows quoted above.
  No runtime, budget, job, provider, or workflow mutation performed.

---

## PROGRAM_01_FOUNDATION_CONTRACTS

- STATUS: `PROVIDER_FREE_PASS`
- STARTED_AT: 2026-09-27
- COMPLETED_AT: UNKNOWN
- OWNER_DECISION: provider-free exit criteria satisfied; no live exit applies
- BLOCKERS: none for Program 1 provider-free exit
- CURRENT_TASK: none
- LAST_COMPLETED_TASK: `AMF_REMEDIATION_PROGRAM_01_FOUNDATION_CONTRACTS_V1`
- PROVIDER_FREE_EXIT_STATUS: PASS (E2E-01 eligible + insufficient and E2E-04,
  real isolated PostgreSQL queue/worker/engine path, stubbed provider boundary)
- LIVE_EXIT_STATUS: NOT_APPLICABLE (no live exit for Program 1)
- HYGIENE_DEPENDENCIES: Hooks migrated into Brief→Writer and retained only as
  legacy-read; Visual Direction canonicalized; artifact authority and directive
  gate certified. Brand architecture and pointer-doc disposition deferred.
- NEXT_ACTION: historical handoff completed; Program 1 remains certified.

## PROGRAM_02_ROUTING_PREFLIGHT

- STATUS: `PROVIDER_FREE_PASS`
- STARTED_AT: 2026-09-27
- COMPLETED_AT: UNKNOWN
- OWNER_DECISION: none yet (Balanced routing activation is prior historical
  config, not Program 2 exit)
- BLOCKERS: none for provider-free exit
- CURRENT_TASK: none
- LAST_COMPLETED_TASK: `AMF_REMEDIATION_PROGRAM_02_ROUTING_PREFLIGHT_V1`
- LAST_COMPLETED_TASK (pre-program remediation, preserved):
  Targeted Verification reevaluation routing remediated to canonical Morroway
  research routing with model preflight (`TargetedVerificationReevaluationRecoveryDispatcher`).
  This does NOT complete Program 2.
- PROVIDER_FREE_EXIT_STATUS: PASS (E2E-11 and E2E-16 use isolated PostgreSQL;
  universal preflight, real worker routing seam, special-mode/Strategy Council,
  retrieval/publication/analytics contracts, and targeted-reevaluation
  regression are provider-free certified)
- LIVE_EXIT_STATUS: NOT_APPLICABLE (no live exit for Program 2)
- HYGIENE_DEPENDENCIES: dist/source test parity, env-vs-DB authority, and
  configs agents/models authority confusion certified; benchmark harness
  consolidation remains deferred (immutable benchmark evidence untouched).
- NEXT_ACTION: historical handoff completed; Program 2 remains certified.

## PROGRAM_03_RECOVERY_STATE_LINEAGE

- STATUS: `PROVIDER_FREE_PASS`
- STARTED_AT: 2026-09-27
- COMPLETED_AT: UNKNOWN
- OWNER_DECISION: none yet
- BLOCKERS: none for Program 3 provider-free exit. Job 68 remains
  terminal/deferred and untouched; it is not a blocker.
- CURRENT_TASK: none
- LAST_COMPLETED_TASK:
  `AMF_PROGRAM_03_COLD_RESUME_AND_REVIEW_RESUME_CONCURRENCY_REMEDIATION_V1`:
  cold gate reconstruction fixtures aligned to current contracts; concurrent
  review-resume dispatch made cross-process exactly once. Exact Program-3
  checkpoint suite passed 70/70 and P1/P2/P4/P5 regressions stayed green.
- PROVIDER_FREE_EXIT_STATUS: PASS (E2E-03, E2E-06, E2E-07, E2E-12 and
  E2E-18 all `PASS_PROVIDER_FREE`; zero provider calls)
- LIVE_EXIT_STATUS: NOT_APPLICABLE (no live exit for Program 3)
- HYGIENE_DEPENDENCIES: dangerous root runners, v6/v7 dispatch/worker launchers,
  and old media worker launchers are fail-closed behind the test-DB-only legacy
  guard. Direct `work/` DB utilities are likewise test-DB-only. Archival,
  historical scratch classification, and non-dangerous lifecycle script
  consolidation remain deferred cleanup.
- NEXT_ACTION: `PROGRAM_04_KICKOFF` (do not start without an explicit task).

## PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS

- STATUS: `LIVE_CANARY_PASS`
- STARTED_AT: 2026-09-28
- COMPLETED_AT: 2026-09-29 (Owner governance closure; status intentionally
  remains `LIVE_CANARY_PASS`, not autonomous/full-production certification)
- OWNER_STATE: `CLOSED`
- OWNER_DECISION: `CLOSE_PROGRAM_04_WITH_KNOWN_FUTURE_WAN_BLOCKER`
- BLOCKERS: none for the completed bounded live canary. Future Wan submissions
  remain forbidden until hardened handler deployment and persistent receipt
  storage are verified; that future-production blocker is preserved and is not
  waived by the canary closure evidence.
- CURRENT_TASK: none; Owner closure accepted. Program 5 subsequently completed
  at `LIVE_OWNER_PASS` / Owner `CLOSED`.
- LAST_COMPLETED_TASK:
  `AMF_REMEDIATION_PROGRAM_04_OWNER_FINAL_CLOSURE_V1`
- PROVIDER_FREE_EXIT_STATUS: PASS (E2E-05, E2E-06, E2E-08, E2E-09, E2E-10)
- LIVE_EXIT_STATUS: PASS_WITH_FUTURE_WAN_DEPLOYMENT_BLOCKER (one bounded real
  Owner-approved item was produced, privately published, observed, and closed
  through evidence-bound learning; future Wan generation remains disabled)
- HYGIENE_DEPENDENCIES: `tts-agent`; `timeline-executor`; legacy thumbnail/video kinds;
  media proof scripts; generated output separation
- LIVE_CANARY_READINESS_GATE: `PARTIAL` (2026-09-28). Governed source packages
  now build to `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`;
  no worker is live (`STALE_PID`, tracked PID 4996 dead). The four Program-4
  performance-observation lineage columns were subsequently applied by the
  Owner-authorized narrow migration recorded below. The verified Morroway
  YouTube channel now has one canonical active opaque credential binding;
  token liveness remains `UNKNOWN_REQUIRES_REFRESH` until a separately
  authorized network probe. VoiceTuT,
  self-hosted image, and
  self-hosted Wan selectors resolve locally, which proves configuration only,
  not provider health.
- LIVE_CANARY_INFRASTRUCTURE_PREPARATION: PASS (provider-free/local only,
  2026-09-28). A dedicated additive/idempotent migration
  `program-04-performance-observation-lineage-v1` and production-confirmed
  operator were added for exactly the four missing nullable `TEXT` columns;
  isolated PostgreSQL apply/reapply and conflicting-type fail-closed tests pass.
  The broad `v6-apply-additive-migration.mjs` path is explicitly unauthorized
  for this canary. A credential-binding operator now validates the exact
  Morroway verified channel and an outside-repository credential resource,
  stores only an opaque reference/metadata, and performs no OAuth call. The
  canonical analytics budget call kind is `analytics`; the future bounded
  authorization is limit 1 with zero retries. VoiceTuT/Mohamed quality still
  requires a canary-scoped Owner approval bound to the exact configuration
  fingerprint. No production mutation or worker action occurred.
- OWNER_INFRASTRUCTURE_ACTIVATION: PARTIAL (2026-09-28). Production migration
  `program-04-performance-observation-lineage-v1` applied exactly four nullable
  `TEXT` columns and passed read-only postcheck; `performance_observations` had
  zero rows and its non-target schema/data fingerprints remained unchanged.
  Canonical automation budget `morroway`/`analytics` was created as hard limit
  1, used 0, retries 0, cost UNKNOWN; other budgets were not mutated. Credential
  binding was not attempted because `D:\AMF-Secrets` contains two plausible
  Morroway token files and the task supplied no filename/canonical selector.
  Zero provider/OAuth calls occurred; worker, Pilot, and Job 68 were untouched.
- YOUTUBE_CREDENTIAL_BINDING: PASS (2026-09-28). Owner selected the external
  `morroway-youtube-oauth-token-v2.json` resource. Guarded binding created
  `binding-morroway-youtube-fe06cec2832354a9`; exactly one matching ACTIVE row
  exists for project `morroway`, channel `channel-morroway-youtube`, provider
  `youtube`, and the selected outside-repository reference. Only the opaque
  path/metadata was stored. No token content was read or printed, and no OAuth,
  YouTube, provider, budget, workflow, Pilot, or Job 68 action occurred. Token
  liveness remains `UNKNOWN_REQUIRES_REFRESH`.
- POST_ACTIVATION_READINESS_RECHECK: PASS for Phase 0 entry (2026-09-28).
  Owner-managed worker PID 4320 is the single live canonical process and
  heartbeat, `HEALTHY_SINGLETON`, role `canonical-production-queue-worker`,
  environment `SUPPORTED`, with exact source/running build
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`;
  queue is 0 queued / 0 running. Schema, unique ACTIVE credential binding, and
  analytics budget 1/0/retries-0 all pass. Voice/image/video selectors are
  locally configured; publishing and analytics selectors remain
  `KNOWN_INVALID` without an injected access token. No TTS approval exists, so
  Phase 1 is `QUALITY_SAMPLE_REQUIRED` (one chunk, <=200 characters, no retry,
  mandatory stop for Owner listening). Zero provider or runtime mutations.
- PHASE_0_CREDENTIAL_HEALTH: NOT_EXECUTED_PRECONDITION_FAILED (2026-09-28).
  Immediately before the authorized network boundary, canonical launcher
  status changed to `STALE_PID`: tracked PID 4320 was dead, with zero active
  PIDs and zero live worker-presence rows. The queue remained empty. Local
  credential preflight still proved one ACTIVE binding, the selected external
  credential file present outside the repository, and all three required
  YouTube upload/read-only/analytics scopes in the canonical credential
  metadata. No OAuth, YouTube, analytics, upload, media, workflow, database,
  or budget operation ran. Token liveness and authenticated channel identity
  therefore remain `UNKNOWN_REQUIRES_REFRESH` / unverified live.
- PHASE_0_CREDENTIAL_HEALTH_RERUN: PASS_LIVE (2026-09-28). After the Owner
  restarted the worker, PID 21988 was `HEALTHY_SINGLETON` on exact expected
  build `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`;
  queue remained empty and the canonical binding remained uniquely ACTIVE.
  One refresh-token exchange succeeded and exactly one read-only
  `channels.list(mine=true)` call authenticated channel
  `UCA5ECzcK_96akfUT5fQUT3A` (`Morroway`). Canonical credential metadata
  contains the exact upload, YouTube-read-only, and YouTube-Analytics-read-only
  scopes. Health evidence fingerprint:
  `e49faee7928ed8a794b97f59e6aeaf23e980c206cc00fcc1636a5c1fcf251304`;
  verified at `2026-09-28T16:41:48.169Z`. No upload, analytics fetch, media,
  workflow, budget, or production-database mutation occurred; no access token
  or secret was persisted or printed.
- NEXT_ACTION: prepare and separately authorize one no-retry VoiceTuT quality
  sample (one <=200-character chunk) for Owner
  listening; do not treat that sample as production approval and do not proceed
  to image generation without a subsequent decision.
- PHASE_1_TTS_QUALITY_SAMPLE: PASS_LIVE (2026-09-28). With the canonical
  persistent worker still healthy on build
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`,
  one Owner-authorized VoiceTuT submission generated the exact 131-character
  Egyptian-Arabic sample using voice `Mohamed`, locale `ar-EG`, WAV output,
  and the authorized configuration fingerprint
  `bb5dc22ded09cf2a437c4ed129b552b2964464de028158943f8f7ad08c4d694a`.
  The provider submission returned HTTP 200; all polling observed the same
  provider job and every retry count was zero. Independent WAV inspection
  proved PCM signed 16-bit little-endian audio, 24 kHz mono, 10.53 seconds,
  505,484 bytes, SHA-256
  `84ef7d955eae99d976e16d3eecf539b65990f91e38c592c2800020968abf6dac`.
  Execution `tts-quality-sample-48feac9ac7e900efe35f8b3b` and artifact
  `tts-quality-sample-artifact-48feac9ac7e900efe35f8b3b` are durably audited;
  approval `approval-tts-quality-sample-48feac9ac7e900efe35f8b3b` is
  `AWAITING_OWNER`. Voice-generation accounting is exactly 1/1 with zero
  retries and UNKNOWN provider-billed cost. No image, video, upload,
  analytics, workflow, Research, or LLM call occurred. The sample is not
  production-approved and Phase 2 remains blocked pending the Owner's explicit
  `APPROVE_FOR_CANARY_ONLY`, `REJECT`, or separately authorized
  `REQUEST_NEW_SAMPLE` decision.
- TTS_CANARY_QUALITY_DECISION: `APPROVE_FOR_CANARY_ONLY` (2026-09-28), bound
  only to `PROGRAM_04_BOUNDED_LIVE_CANARY`; permanent brand-voice approval
  remains `NO` and future voice selection remains required.
- PHASE_2_IMAGE_SINGLE_SCENE_CANARY: PASS_LIVE (2026-09-28). One fresh
  Morroway identity (`content-mulk44ho-kih3gg`,
  `wf-p4-canary-2b0da0ba762b65477107`) was created without enqueueing a
  workflow job. Canonical `visual_direction_contract` V2 compiled one
  reference-free (`NONE`) 9:16 scene and the self-hosted image boundary made
  exactly one FLUX.1-dev-fp8 submission with zero generation retries. Artifact
  `art-scene-visual-b6796e3e71f4d8f7ce473bdf` is a readable 768x1344 PNG,
  1,402,009 bytes, SHA-256
  `7da769d5b0f22cec1dc2e6c8e1b817822a9e6a550faa6047bdd753c538639c0e`.
  The image-generation budget settled from 0/3 to 1/3; its configured known
  unit estimate is USD 0.005, while provider-billed cost remains unverified.
  Semantic status is `AWAITING_OWNER_REVIEW`, approval for video is `NO`, and
  no TTS, video, upload, analytics, LLM, Research, or downstream workflow call
  occurred.
- PHASE_2_IMAGE_DECISION: `APPROVE_FOR_VIDEO_CANARY` (2026-09-28), scoped only
  to `PROGRAM_04_PHASE_3_VIDEO_CANARY`; no composition authority was granted.
- PHASE_3_SINGLE_VIDEO_CANARY: PARTIAL / `RECONCILIATION_REQUIRED`
  (2026-09-28). Frozen intent and canonical Wan authorization
  `art-wan-authorization-e46409193d5f74e14829258c` were persisted before one
  self-hosted-video/Wan 2.2 POST. The POST timed out after 30 seconds without an
  acknowledgement or provider job ID; no retry occurred and no poll was
  possible. Execution `video-canary-2f94234d481cefe0a56d09a2` is blocked with
  final remote result `UNKNOWN`. Video accounting settled once from 0/3 to 1/3
  because transport started. No `scene_video_clip` exists, no technical or
  semantic video approval is claimed, and composition remains forbidden.
- PHASE_3_RECONCILIATION_ONLY: FAIL_CLOSED (2026-09-28). One exact-job
  read-only status request was made for Owner-supplied RunPod job
  `a926f991-076f-4e36-bdb7-03cefc223cd8-e1`; the canonical endpoint returned
  HTTP 404. Therefore job existence, completed output, and identity compatibility
  could not be independently proven, no provider job binding or clip artifact
  was created, and the original execution remains `RECONCILIATION_REQUIRED`.
  No generation POST, retry, or budget consumption occurred; video accounting
  remains 1/3.
- NEXT_ACTION: Owner/provider must supply durable retrievable output or a
  provider-side receipt/status endpoint that resolves the exact job. Do not
  resubmit video generation or start Phase 4.
- WAN_SUBMISSION_TIMEOUT_HARDENING: `PASS_PROVIDER_FREE` (2026-09-28).
  Forensics proved the 30-second boundary was the AMF RunPod adapter's
  `AbortController` timeout (`RUNPOD_VIDEO_TIMEOUT_MS`), shared incorrectly by
  submission and status reads. RunPod `/run` is an asynchronous queue
  operation; cold-start/model generation occurs after durable queue acceptance,
  while completed async results are retained by RunPod for only 30 minutes.
  The adapter now separates submission acknowledgement (default 300s),
  generation (15m), polling (4s), status request (30s), and result download
  (120s) policies. The request carries runtime-owned client/idempotency/source/
  configuration identities, the owned Wan handler records timing metadata and
  durable receipts on the configured network-volume path, and receipt lookup
  supports reconciliation by client execution identity without a second video
  generation. Provider-native idempotency is not claimed; AMF's submission
  ledger plus handler receipt suppression provides the exactly-once boundary.
  The ledger now distinguishes `INTENT_PERSISTED`, `SUBMITTING`,
  `ACKNOWLEDGED`, `RECONCILIATION_REQUIRED`, and `COMPLETED`.
- WAN_HARDENING_TESTS: 25/25 focused adapter/boundary tests and 11/11 zero-GPU
  handler tests passed. Program-2/3/4 provider-free regressions passed 67/67
  after the isolated Program-4 DB scenario was run separately (DB fingerprints
  `1268bceebd35c456` production / `7492be0a08ef2297` test). Zero real provider
  calls, video submissions, or production budget/database mutations occurred.
- EXISTING_PHASE_3: remains `RECONCILIATION_REQUIRED`. The new receipt contract
  was not deployed for the historical job, so it cannot retroactively create a
  receipt. The Owner-downloaded MP4 can be imported only through a separately
  authorized verified-output pathway that checks bytes, SHA-256, media
  metadata, frozen intent, source lineage, and Owner-supplied job provenance.
  No import or resubmission occurred in this task.
- NEXT_ACTION: deploy/refresh the owned Wan handler with a durable
  `AMF_VIDEO_RECEIPT_DIR` network-volume binding, refresh the AMF worker to the
  new source build, then separately authorize verified-output import for the
  existing Phase-3 execution. Do not submit a new generation.
- WAN_HARDENING_DEPLOYMENT_READINESS: `BLOCKED_PRE_DEPLOYMENT` (2026-09-28).
  Current canonical AMF source/build identity is
  `2f1610e1ac4240c64300a761fb2c5269a955c9cd3e7013cc325313ae24bf94a5`.
  The production worker remains healthy and singleton at PID 21988, but still
  runs pre-hardening build
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`;
  queue state is 0 queued / 0 running. No worker refresh was attempted because
  the provider deployment gate failed first.
- Deployment precheck found no canonical repository operator that updates a
  RunPod endpoint deployment. The only owned workflow builds/pushes a container
  image after GitHub workflow dispatch and explicitly performs no endpoint
  mutation. Production configuration has no `AMF_VIDEO_RECEIPT_DIR`, and no
  persistent RunPod network-volume mount/retention binding can be verified from
  repository or runtime configuration. Deploying with the handler's container
  default would be ephemeral and is forbidden by the task contract.
- Consequently the hardened handler was not built/pushed/deployed, the worker
  was not stopped or restarted, and no provider, media, budget, workflow, Pilot,
  Job-68, or production-database mutation occurred. The historical Phase-3
  execution remains `RECONCILIATION_REQUIRED`. Program 4 remains
  `PROVIDER_FREE_PASS`; no live-video completion is claimed.
- NEXT_ACTION: Owner/operator must provision and identify a persistent RunPod
  network volume, bind an absolute receipt directory through
  `AMF_VIDEO_RECEIPT_DIR`, and provide/establish the canonical endpoint-image
  deployment operator. After the handler image/digest is deployed and verified,
  refresh the AMF worker using `node scripts/persistent-worker.mjs stop`,
  `node scripts/persistent-worker.mjs start`, and
  `node scripts/persistent-worker.mjs status`.
- WAN_DEPLOYMENT_AND_EXISTING_OUTPUT_RECOVERY: `PARTIAL` (2026-09-29). At task
  entry the Owner-refreshed worker was a healthy singleton (PID 11192), queue
  0/0, on exact then-current build
  `2f1610e1ac4240c64300a761fb2c5269a955c9cd3e7013cc325313ae24bf94a5`.
  Read-only Runpod infrastructure inspection failed closed with HTTP 401: the
  configured endpoint execution key is not accepted as a management GraphQL
  credential. No retry, endpoint mutation, image push, or generation occurred.
  Official Runpod contracts confirm endpoint updates use GraphQL
  `saveEndpoint`, network volumes attach through `networkVolumeId`, and
  Serverless network volumes mount at `/runpod-volume`. The guarded deployment
  preflight now requires a distinct management credential, immutable handler
  image digest, and network-volume ID; all three are currently missing.
- A canonical `AUDITED_VERIFIED_OUTPUT_IMPORT` path and guarded production
  operator now validate the frozen Wan intent, project/content/workflow/scene,
  source visual ID/hash, original reconciliation evidence, exact 1/3 video
  accounting, and local MP4 bytes/hash/codec/dimensions/duration. Imported
  artifacts must retain `RECOVERED_FROM_OWNER_VERIFIED_EXTERNAL_OUTPUT`,
  provider proof `OWNER_ATTESTED_NOT_PROVIDER_VERIFIED`, and local proof
  `VERIFIED`; they enter only `AWAITING_OWNER_REVIEW`. Replay is idempotent,
  competing artifacts are blocked, and no budget row or schema is changed.
- Import was NOT executed because no MP4 path or explicit production-import
  authorization was supplied. The historical execution remains
  `RECONCILIATION_REQUIRED` at 1/3. Import tests passed 10/10; Wan adapter 42/42,
  zero-GPU handler 10/10, Program-2 7/7, Program-3 25/25, and Program-4
  closed-loop 1/1 passed provider-free. The new canonical build is
  `451710def1eaecb2130acb2ec5e0c0ca30258e6b9f1b4f082e6dc77acb506aeb`;
  PID 11192 still runs the prior build and requires another Owner refresh.
- NEXT_ACTION: provision/identify the Runpod network volume and management API
  credential, build/push an immutable handler digest, deploy/verify the endpoint,
  then Owner-refresh the worker. Separately authorize audited import with the
  exact downloaded MP4 path. Never resubmit the historical generation.
- PHASE_3_AUDITED_EXISTING_VIDEO_IMPORT: `PASS_LIVE` (2026-09-29). The
  Owner-authorized guarded import ran once against worker PID 14308, a healthy
  singleton on exact build
  `451710def1eaecb2130acb2ec5e0c0ca30258e6b9f1b4f082e6dc77acb506aeb`,
  with queue 0/0. Local proof measured the exact Owner-held MP4 as H.264,
  480x832, 5.032 seconds, 2,230,749 bytes, SHA-256
  `aa0ca49a4e1fe6aa95add50532ea38b71534e7b5e024b463902a3bec03d63f3d`.
  Import execution `video-output-import-e46409193d5f74e14829258c` created the
  sole canonical clip `art-scene-video-import-e46409193d5f74e14829258c` and
  lifecycle receipt event 355. Proof remains explicitly
  `OWNER_ATTESTED_NOT_PROVIDER_VERIFIED`; local technical proof is `VERIFIED`.
  The original timeout/reconciliation event remains immutable, video accounting
  remains 1/3 with zero additional consumption, and the clip is
  `AWAITING_OWNER_REVIEW` / not approved for composition.
- FUTURE_WAN_SUBMISSIONS: `NOT_ALLOWED`. The audited import does not satisfy the
  separate hardened-handler deployment gate: exact endpoint image/source parity,
  a persistent Runpod network volume, and persistent
  `AMF_VIDEO_RECEIPT_DIR` remain unverified. Program 4 remains
  `PROVIDER_FREE_PASS`, not `LIVE_CANARY_PASS`; Program 5 remains `NOT_STARTED`.
- PHASE_4_LOCAL_COMPOSITION_AND_QA_CANARY: `PASS_LIVE_LOCAL_ONLY`
  (2026-09-29). The exact approved narration artifact
  `tts-quality-sample-artifact-48feac9ac7e900efe35f8b3b` (10.530 seconds,
  SHA-256 `84ef7d955eae99d976e16d3eecf539b65990f91e38c592c2800020968abf6dac`)
  and audited recovered clip `art-scene-video-import-e46409193d5f74e14829258c`
  (5.032 seconds, SHA-256
  `aa0ca49a4e1fe6aa95add50532ea38b71534e7b5e024b463902a3bec03d63f3d`)
  were composed locally with zero external calls. Timeline
  `art-timeline-canary-e46409193d5f74e14829258c` applies the canary-scoped
  deterministic `LAST_FRAME_HOLD` policy: one native clip followed by a
  5.798-second governed pad (5.498 seconds of coverage to narration end).
- Final artifact `art-final-media-canary-e46409193d5f74e14829258c` is a
  readable 480x832 H.264/AAC MP4, 10.532 seconds, 768,251 bytes, SHA-256
  `41d8a68152b9f34bb65da54ad18298b8c8f1bdb57a508afd631d75aac4c27d49`.
  Exact-text Arabic captions were rendered into the video through FFmpeg/libass;
  deterministic layout and timing pass, while caption/product semantics remain
  honestly `HUMAN_REVIEW_REQUIRED` / `AWAITING_OWNER_REVIEW`. Narration was not
  truncated, generation budgets stayed voice 1/1, image 1/3, video 1/3, and no
  provider, upload, analytics, Research, or LLM call occurred.
- PHASE_4_NEXT_ACTION: Owner must watch the canonical final MP4 and choose
  `APPROVE_FOR_PRIVATE_PUBLICATION_CANARY` or `REJECT`. Phase 5 is not
  authorized automatically. Program 4 remains `PROVIDER_FREE_PASS`, not
  `LIVE_CANARY_PASS`; future Wan deployment blockers remain independent.
- PHASE_5_PRIVATE_PUBLICATION_CANARY: `BLOCKED_PRE_TRANSPORT` (2026-09-29).
  Owner authority, worker parity (PID 14308; build
  `451710def1eaecb2130acb2ec5e0c0ca30258e6b9f1b4f082e6dc77acb506aeb`),
  empty queue, exact final-media file/hash, unique active channel credential
  binding, and the untouched 0/1 private-upload budget all passed locally.
  Publication was stopped before reservation or network transport because the
  canonical publishing capability currently uses one `assetId` both as the
  authority-bound `finalMediaArtifactId` and as the provider adapter's required
  HTTP(S) download URL. The approved artifact ID
  `art-final-media-canary-e46409193d5f74e14829258c` and its local file cannot
  truthfully satisfy both contracts. No URL substitution, authority
  falsification, direct-adapter bypass, upload, OAuth call, database mutation,
  or budget mutation occurred. Program 4 remains `PROVIDER_FREE_PASS`; Phase 5
  requires a source-level separation of canonical artifact identity from media
  transport reference, provider-free regression proof, and a subsequent Owner
  worker refresh before this exact authorization can be retried.
- PHASE_5_ARTIFACT_TRANSPORT_REMEDIATION: `RESOLVED_PROVIDER_FREE`
  (2026-09-29). The publication contract now carries immutable
  `finalMediaArtifactId` + `finalMediaSha256` separately from a typed
  `mediaTransportRef` (`LOCAL_FILE`, `HTTPS_URL`, or
  `PROVIDER_MATERIALIZED`). Owner authority and publication identity remain
  path-independent; the YouTube adapter consumes only the verified transport.
  Local files are re-hashed at both preflight and adapter boundaries, and
  publish sessions/reports retain canonical final-media lineage plus a
  path-independent transport fingerprint. The exact blocked canary now passes
  identity and local-file transport preflight with its original payload hash
  and publication identity; no upload or budget mutation occurred.
- PHASE_5_REAUTHORIZATION_GATE: the current canonical build is
  `e4f95be2dd1fc9e3a8a00120b955b0be175081451a1b66f8e5d84d958668193f`.
  The Owner refreshed the canonical worker to this exact build before the
  reauthorized Phase-5 execution. Read-only production inspection verified
  all four additive nullable `provider_upload_sessions` lineage/transport
  columns are already present with type `text`; no database mutation was made
  by the provider-free remediation task.
- PHASE_5_PRIVATE_PUBLICATION_CANARY_REAUTHORIZED_V2: `PASS_LIVE_PRIVATE`
  (2026-09-29). The previous `BLOCKED_PRE_TRANSPORT_NO_UPLOAD` attempt remains
  preserved as historical evidence. With one healthy canonical worker (PID
  21112) on build
  `e4f95be2dd1fc9e3a8a00120b955b0be175081451a1b66f8e5d84d958668193f`,
  the separated `LOCAL_FILE` transport passed byte/hash validation for final
  media `art-final-media-canary-e46409193d5f74e14829258c`. Exactly one upload
  was submitted with zero retries and private visibility. YouTube returned
  video `QC0XPZak0Q4`; an independent receipt read verified channel
  `UCA5ECzcK_96akfUT5fQUT3A`, private visibility, and the unchanged authorized
  title/description. Canonical published report
  `art-published-report-b71671ebda5049b64b3b7c82` and completed upload session
  `6b689806dcac517b` retain final-media ID/hash lineage, publication identity
  `publish:v2:c214902df486eea757c3c6d815918b9cf628c923ab34d224a27313d1229d131f`,
  and payload hash
  `0f9afd05f726c12b05f2ce7992f1f1aa89a9c6930dbb17ac72816e17220177f2`.
  Private-upload accounting settled exactly once from 0/1 to 1/1; analytics
  remained 0/1 and no media-generation, LLM, Research, public-publication, or
  analytics call occurred. Program 4 remains `PROVIDER_FREE_PASS`, not full
  `LIVE_CANARY_PASS`; Phase 6 analytics and learning remain separately gated.
- PHASE_6_SINGLE_ANALYTICS_OBSERVATION: `PASS_LIVE` (2026-09-29). One
  Owner-authorized, video-specific YouTube Analytics request was issued for
  private publication `QC0XPZak0Q4` with zero retries. A minimum credential
  refresh and read-only channel check reconfirmed the exact Morroway channel;
  the analytics request returned HTTP 200 with zero rows. This is preserved as
  `EMPTY_VALID_PROVIDER_RESPONSE`, not zero-filled metrics, poor performance,
  or negative signal. Live observation `obs-ea5b7d61d0a7` and canonical
  `analytics_report` `art-analytics-report-ea5b7d61d0a7` preserve the exact
  final-media → published-report → provider-publication → analytics join.
  Classification
  `PROGRAM_04_LIVE_CANARY_EXCLUDED_FROM_NORMAL_PRODUCTION_KPIS` explicitly
  excludes this private validation item from normal production aggregates.
  Analytics accounting settled exactly once from 0/1 to 1/1; private-upload
  and media budgets were unchanged. No learning execution occurred. Program 4
  remains `PROVIDER_FREE_PASS`, not `LIVE_CANARY_PASS`; Phase 7 learning is a
  separate Owner boundary.
- PHASE_7_LOCAL_EVIDENCE_BOUND_LEARNING: `PASS_LOCAL` (2026-09-29). Immutable
  learning `learn-01ecc33b989b` cites only live observation
  `obs-ea5b7d61d0a7` and preserves the empty-response truth: process validation
  succeeded while content performance is `INSUFFICIENT_DATA`. No metric was
  cited or zero-filled and no performance conclusion was fabricated.
  Recommendation `rec-a1b07efbdc83` is `EVIDENCE_BOUND`; next-cycle proposal
  `ncp-294f1942f013` is `AWAITS_OWNER_DECISION` with no approval and no new
  workflow. The canary KPI-exclusion classification remains intact. All seven
  bounded phases now have their required evidence, so Program 4 advances to
  `LIVE_CANARY_PASS`. The next action is `OWNER_PROGRAM_04_CLOSURE_REVIEW`, not
  Program 5. Future Wan submissions remain prohibited pending hardened RunPod
  deployment and persistent receipt verification.
- OWNER_FINAL_CLOSURE: `CLOSED` (2026-09-29). The Owner accepted the bounded
  closed-loop evidence and explicitly closed Program 4 with the known future
  Wan deployment blocker. This closure proves neither public-publication
  readiness nor full production autonomy. TTS/Mohamed and the generated visual
  treatment were approved only for this canary; the historical video provider
  identity remains `OWNER_ATTESTED_NOT_PROVIDER_VERIFIED`; the empty private
  analytics response supports process learning only. Proposal
  `ncp-294f1942f013` remains `AWAITS_OWNER_DECISION` and is not approved.
  Future Wan submissions remain prohibited until the hardened owned handler,
  immutable digest/source parity, persistent RunPod volume and
  `AMF_VIDEO_RECEIPT_DIR`, durable receipt lookup, deployed
  `clientExecutionId` correlation, and endpoint readiness are certified.

## PROGRAM_05_OWNER_AUTONOMY

- STATUS: `LIVE_OWNER_PASS`
- STARTED_AT: 2026-09-29
- COMPLETED_AT: 2026-09-30
- OWNER_DECISION: `PROGRAM_05_LIVE_OWNER_CANARY_CERTIFIED`; Morroway automation
  remains `OFF / L0_MANUAL / DISABLED`. Proposal `ncp-294f1942f013` is
  `OWNER_DEFERRED` and was not executed.
- OWNER_STATE: `CLOSED`.
- BLOCKERS: no Program-5 Owner-autonomy exit blocker remains. Independent R-10
  backup/restore, durable object storage and horizontal-scaling debt remain;
  future Wan generation is still blocked by undeployed handler hardening,
  persistent receipts and endpoint digest parity; Google OAuth remains
  `EXTERNAL_TESTING` with production-domain migration deferred.
- CURRENT_TASK: none; live Owner certification completed read-only.
- LAST_COMPLETED_TASK: `AMF_PROGRAM_05_OWNER_OPERATED_LIVE_CANARY_CERTIFICATION_V3`.
- PROVIDER_FREE_EXIT_STATUS: PASS. E2E-P5-01..18, credential security,
  isolation, Owner journey, script-zero and direct-DB-zero all pass.
- LIVE_EXIT_STATUS: PASS. The Owner used AMF Control to execute one successful
  credential-health verification and one DEFER decision without scripts/direct
  DB; no workflow or forbidden provider/media/publication action followed.
- ARCHITECTURE_DECISION: Node API/control stores are the sole state-changing
  authority. AMF Control static UI is canonical and is served by the Python
  compatibility facade; the facade proxies mutations and owns no duplicate
  domain authority. No `apps/web` implementation exists in current source.
- SECURITY: Owner HMAC session remains HttpOnly; all cookie-authenticated
  mutations now require a session-bound double-submit CSRF token; production
  cookies are Secure; project scoping, secret redaction, and durable Owner audit
  envelopes are covered by provider-free tests.
- DATABASE_CHANGES: additive `credential_health_checks` and
  `credential_binding_health` tables join the prior Owner audit/decision tables;
  migrations were exercised only against the isolated test DB and no production
  DDL was run. The later bounded live canary contains only its expected domain
  mutations: one successful credential check/current-health update/redacted
  audit and one DEFER decision/proposal update/redacted audit.
- TEST_EVIDENCE: 295 selected provider-free assertions passed, 0 failed across
  the clean final runs; database, provider-adapter and API builds pass, as do UI
  syntax and 25 Python auth/proxy tests. Database isolation passed; no credential
  or provider call was made.
- NEXT_ACTION: Owner may review a separately bounded live Owner-operated journey.
  Do not enable automation or future Wan generation as part of that review.

### Owner-operated live canary readiness — 2026-09-29

- TASK: `AMF_PROGRAM_05_OWNER_OPERATED_LIVE_CANARY_READINESS_V1`
- RESULT: `PARTIAL`; Program 5 remains `PROVIDER_FREE_PASS` and is not
  `LIVE_OWNER_PASS` or `COMPLETED`.
- READY: production credential-health tables, active Morroway project/channel/
  binding/route, L0 manual automation, existing Program-4 evidence lineage,
  proposal `ncp-294f1942f013` awaiting decision, productized credential-health
  path, auth/CSRF/project scoping/redaction/audit source certification, and
  script/direct-DB-zero journey design.
- BLOCKED: worker build `2e1f5b75991e…` does not match current build
  `0a0916cefaae…`; Node API 8080 and AMF Control/Python 8000 are unreachable.
  Therefore live UI/API operation and the current-source Wan warning cannot be
  certified at runtime.
- CREDENTIAL_HEALTH_CURRENT: `UNKNOWN_REQUIRES_REFRESH` because no productized
  Morroway health row exists yet. This is the intended single external action
  of the future canary, not permission to execute it now.
- PROPOSED_ENVELOPE: one credential verify/refresh; zero media, upload,
  analytics, LLM, Research, social, public-publication or next-cycle execution.
- OWNER_REFRESH_REQUIRED: use the canonical persistent-worker stop/start/status
  sequence from ordinary PowerShell, then restore AMF Control/API through the
  canonical supervised-runtime operating procedure and rerun this readiness
  gate. No runtime was started or stopped by this task.

### Control-plane runtime restore and readiness V2 — 2026-09-29

- TASK: `AMF_PROGRAM_05_CONTROL_PLANE_RUNTIME_RESTORE_AND_READINESS_V2`
- RESULT: `PARTIAL`; Program 5 remains `PROVIDER_FREE_PASS`. The Owner-operated
  live canary was not executed and is not yet ready for authorization.
- WORKER: healthy canonical singleton PID 32912, current build
  `0a0916cefaae9d2ac7e54b5183ebdcf46509b809c832668b90d1c56d538a6775`,
  healthy heartbeat, queued 0 / running 0. Source/worker parity now passes.
- CONTROL_RUNTIME: the repository Node entrypoint `apps/api/dist/server.js` is
  reachable on `127.0.0.1:8080`; the FastAPI compatibility/auth/CSRF/static-UI
  entrypoint `ai_media_factory.main:app` is reachable on `127.0.0.1:8000`.
  They were restored independently so the legacy all-in-one supervisor could
  not create a second worker. Node remains the sole state-changing authority.
- LIVE_SECURITY: Owner login created a valid HMAC session, the session reported
  its bound CSRF token, a mutation without the token failed with HTTP 403, and
  an unknown project failed closed with HTTP 404. Audit/read models and the
  database-backed control API are reachable; no credential verification ran.
- STATUS_OPERATOR: `node scripts/amf-status.mjs` reports API/database/UI and the
  current worker reachable. Its supervisor subsection is stale historical
  crash-loop metadata from 2026-09-24 and is not current process truth.
- MORROWAY: channel and opaque credential binding are present; credential health
  is `UNKNOWN_REQUIRES_REFRESH`, routing is active, automation is disabled at
  `L0_MANUAL`, proposal `ncp-294f1942f013` remains
  `AWAITS_OWNER_DECISION`, and the queue is idle. Future Wan submissions remain
  blocked with all three deployment/receipt/digest reasons visible.
- BLOCKER: the Node read endpoint
  `/control/owner/credential-health?projectId=morroway` returns HTTP 200, and
  the UI contains Verify/Refresh actions, but the Python runtime allowlist omits
  `owner-credential-health`. Consequently the live UI proxy request
  `/api/runtime/owner-credential-health?project_id=morroway` returns HTTP 404,
  and the Owner Operations credential section cannot complete its load. This
  must be corrected and the UI runtime revalidated before live authorization.
- SIDE_EFFECTS: zero provider calls, workflow executions, credential checks,
  budget changes, or verified production data/schema mutations. Only the API/UI
  runtime processes were restored and documentation was updated.

### Owner Operations proxy resilience repair — 2026-09-29

- TASK: `AMF_PROGRAM_05_OWNER_OPERATIONS_PROXY_RESILIENCE_FIX_V1`
- RESULT: `PASS`; Program 5 remains `PROVIDER_FREE_PASS`. This repairs and
  certifies readiness only; no Owner-operated live canary action was executed.
- ROOT_CAUSE_FIXED: `owner-credential-health` is now in the Python compatibility
  proxy's existing GET-only runtime-resource allowlist. Python still delegates
  to `/control/owner/credential-health` and owns no credential-health domain or
  mutation logic.
- UI_RESILIENCE: Owner Operations now uses settled per-resource reads. A failed
  optional read produces an explicit `UNKNOWN / UNAVAILABLE` section while
  independently available onboarding, worker/Wan health, routing, budgets,
  recovery, proposals, operation matrix, and audit sections continue rendering.
  No page-load path issues a mutation.
- TESTS: 12 targeted Python proxy/auth/CSRF tests and 27 Owner Operations,
  bundle, and Program-5 UI tests passed; the production bundle syntax check also
  passed. Unknown proxy resources remain 404, the runtime resource remains
  GET-only, project denial is preserved, and no secret-bearing field is added.
- LIVE_READ_ONLY: after replacing only the Python compatibility proxy, the
  credential-health proxy and Owner page return HTTP 200. Browser rendering
  verified the stale Morroway credential state, visible Verify/Refresh actions,
  healthy worker, active routing, budgets, proposal awaiting decision, and the
  three-reason future-Wan blocker. No action button was activated.
- RUNTIME: Node API PID 14212 was not restarted; AMF Control listens on 8000 at
  PID 19220 (venv launcher PID 11236); worker PID 32912 remains the healthy
  singleton. Canonical build remains
  `0a0916cefaae9d2ac7e54b5183ebdcf46509b809c832668b90d1c56d538a6775`
  with exact worker parity and an idle queue.
- STATUS_PRESENTATION: current API/UI/worker health is authoritative and green.
  The separate `supervisor` object remains preserved historical crash-loop
  evidence from 2026-09-24; it is not treated as current health and does not
  block this readiness result.
- SIDE_EFFECTS: zero provider calls, workflow executions, credential checks,
  next-cycle decisions, budget changes, or production database mutations.
- READINESS: `READY_FOR_OWNER_OPERATED_LIVE_CANARY_AUTHORIZATION = YES`.
  Program-5 live closure remains `NO` until a separately authorized Owner
  journey completes.

### Live Owner action wiring and authentication repair — 2026-09-29

- TASK: `AMF_PROGRAM_05_LIVE_OWNER_ACTION_WIRING_AND_AUTH_FIX_V1`
- RESULT: `PASS_ENGINEERING / LIVE_OWNER_CANARY_HELD_FOR_WORKER_REFRESH`;
  Program 5 remains `PROVIDER_FREE_PASS` and no live Owner action was executed.
- ROOT_CAUSE: the inspected browser had no valid Owner session, so the visible
  `signed out · inspection only` state was truthful. Credential and next-cycle
  handlers also returned silently when the required rationale was blank. This
  combination made enabled controls appear to do nothing.
- AUTH_AND_ACTION_UX: every Owner Operations mutation is disabled while signed
  out and labelled `Sign in required`. Signed-in actions use one pending-action
  path with immediate progress, duplicate-click suppression, canonical error
  codes, visible success/failure, and a settled refresh of credential,
  onboarding, Decision Center and audit reads. Publication preparation is also
  auth-gated. Python remains an auth/CSRF/proxy layer; Node remains the sole
  state-changing authority.
- READINESS_SEMANTICS: intentional `OFF / L0_MANUAL / DISABLED` automation now
  renders and evaluates as `READY — L0 MANUAL` without enabling automation.
  `UNKNOWN_REQUIRES_REFRESH` credential health remains action-required until a
  separately authorized live verification returns `VALID`.
- BUDGET_ALERTS: the two current exhaustions are no longer generic: `research`
  is `13/13` and `text_agent` is `25/25`, both in `PRE_MEDIA_PHASE`, classified
  as current capacity exhaustion and explicitly non-blocking for the zero-spend
  Owner control journey. They are distinct canonical attention items.
- CERTIFICATION: 52 unique provider-free tests passed (5 injected credential /
  isolated-database tests, 35 Owner auth/UI/Program-5 tests, and 12 Python
  session/proxy tests); TypeScript builds for database and API passed. Live
  read-only browser inspection proved the signed-out gate, healthy worker,
  contextual alerts, `READY — L0 MANUAL`, credential action-required state,
  disabled recovery/next-cycle/worker controls, and the three-reason Wan block.
- LIVE_LOGIN: the configured login endpoint created a valid local Owner session
  and the session endpoint changed from signed-out to signed-in; the ephemeral
  test session was then logged out. No credential-health action was invoked.
- RUNTIME: Node was refreshed to the certified API build at PID 15456; AMF
  Control remained healthy at PID 19220. The canonical source build is now
  `6a4fca473d493f241e7e2d5fb2c12877506ec8584accb3c0fa565133a40a2e4b`.
  The production worker remains untouched at PID 32912 on prior build
  `0a0916cefaae9d2ac7e54b5183ebdcf46509b809c832668b90d1c56d538a6775`.
- SIDE_EFFECTS: zero provider calls, credential checks, next-cycle decisions,
  workflows, budget changes, or production database mutations.
- OPEN_BLOCKER: Owner must refresh the canonical production worker to the new
  source build and verify healthy singleton/build parity before the separately
  authorized live Owner journey. Therefore
  `READY_FOR_OWNER_LOGIN_AND_LIVE_CANARY = NO` in this task.

### Google OAuth External/Testing temporary recovery posture — 2026-09-30

- GOOGLE_OAUTH_MODE: `EXTERNAL_TESTING` (Owner-confirmed Google Auth Platform
  state; the intended Morroway account is an authorized test user).
- GOOGLE_OAUTH_TOKEN_LIFETIME: `APPROX_7_DAYS`; periodic interactive
  reauthorization is required while this temporary mode remains in use.
- RECOVERY_ATTEMPT: one explicitly authorized Desktop loopback authorization
  flow was opened with offline access, forced consent, and exactly the existing
  three YouTube scopes. The Owner did not complete consent within the bounded
  ten-minute callback window, so code exchange did not occur and the external
  credential file remained byte-identical to its pre-attempt backup.
- FUTURE_PRODUCTION_FIX: `DOMAIN + BRANDING + IN_PRODUCTION`.
  `GOOGLE_OAUTH_PRODUCTION_DOMAIN_REQUIRED = DEFERRED`; this temporary posture
  is not final production credential readiness.
- NEXT_GATE: a separately authorized interactive reauthorization must complete
  before exactly one bounded AMF Control Verify Health action. No upload,
  analytics, media, workflow, budget, or next-cycle action occurred.
- TELEMETRY_RUNTIME: the stale Node API process was replaced with the canonical
  API entrypoint after the provider-free credential-forensics build. The new
  process is healthy and started after the telemetry bundle, so safe OAuth HTTP
  status/error-code and stage evidence is active for a future authorized check.

### Owner-operated live canary certification V3 — 2026-09-30

- RESULT: `PASS`; Program 5 is `LIVE_OWNER_PASS`, Owner state `CLOSED`.
- CREDENTIAL: three canonical checks are preserved: two historical `ERROR`
  checks followed by exactly one final `VERIFY_HEALTH` result `VALID`. Current
  health is fresh, scope `PASS`, channel identity `MATCH` for the canonical
  Morroway channel. The successful redacted audit records
  `secretMaterialPersisted=false`; dynamic credential attention is cleared.
- NEXT_CYCLE: one immutable Owner `DEFER` decision moved
  `ncp-294f1942f013` from `AWAITS_OWNER_DECISION` to `OWNER_DEFERRED`.
  Audit flags and direct production reads prove no workflow, submission, job,
  automation job, or execution was created.
- PRODUCT_PATH: both mutations identify actor `owner-ui`. AMF Control enforces
  Owner session + CSRF at the Python edge, fixes the actor, and proxies to the
  canonical Node domain store. Node remains sole state-changing authority;
  scripts/direct DB were not part of the final Owner canary. The earlier OAuth
  bootstrap remains separately classified engineering recovery.
- FINAL_WINDOW_ACCOUNTING: one OAuth refresh and one YouTube identity read are
  implied and bounded by the single-path verifier required to produce `VALID`;
  it has no retry loop. Production reads found zero call reservations, upload
  sessions, analytics observations, capability executions, workflow records,
  automation jobs, or budget updates during the final canary window.
- RUNTIME: worker PID 24332 is the healthy current-build singleton
  (`6a4fca473d493f241e7e2d5fb2c12877506ec8584accb3c0fa565133a40a2e4b`),
  heartbeat healthy, queue idle; Node API and AMF Control both return HTTP 200.
  Production database fingerprint remains
  `9ac133330fd37d5967d9125a77afdb6b3a7d6d7f44ec600d478e415e6b4d9376`.
- GOVERNANCE: L0 manual automation and the three-reason future-Wan block remain
  enforced. Program-4 private publication, empty live observation, insufficient-
  data learning and recommendation records remain intact.

---

## Status consistency notes

- Programs 1, 2 and 3 are `PROVIDER_FREE_PASS`; Program 4 is Owner-closed at
  `LIVE_CANARY_PASS`; Program 5 is Owner-closed at `LIVE_OWNER_PASS`. Future
  Wan deployment and other independent operational debt remain preserved.
- Program 2's targeted-reevaluation regression remains part of its completed
  provider-free certification; it does not grant any live authority.
- Research Pilot is `CLOSED`; Program 3 provider-free certification is complete.
  Programs 4 and 5 are closed for their bounded live exits. No new remediation
  program or workflow is automatically authorized.
- Timestamps are `UNKNOWN` where no program lifecycle event has occurred; no
  timestamps are invented.
