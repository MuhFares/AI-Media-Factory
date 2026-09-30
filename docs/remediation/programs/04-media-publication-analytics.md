# Program 4 — Media + Publication + Analytics

- PROGRAM_ID: `PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS`
- PROGRAM_NAME: Media + Publication + Analytics
- PURPOSE: Safely produce one real Morroway media item through publication and learning.
- STATUS: `LIVE_CANARY_PASS`
- OWNER_STATE: `CLOSED`
- OWNER_DECISION: `CLOSE_PROGRAM_04_WITH_KNOWN_FUTURE_WAN_BLOCKER`
- CLOSED_AT: 2026-09-29

## SCOPE_IN

- MEDIA: signed/publicly-fetchable reference asset handling; subject/reference
  continuity; TTS voice reauthorization flow; media fingerprint change handling;
  narration-fit verification; burned caption verification; Wan ambiguous
  submission reconciliation; media provider budget/claim safety; canonical media
  chain only for new production.
- LEGACY MEDIA: migrate tests off legacy thumbnail/video report chain; legacy
  media outputs read-only until migration complete; migrate old
  `tts-agent`/`timeline-executor` E2E dependencies before removal.
- PUBLICATION: token-liveness preflight; private/public authority separation;
  publication binding; session recovery/reconcile; duplicate upload protection;
  public/scheduled promotion rules.
- ANALYTICS: canonical `final_media_artifact → published_report → performance
  observation → learning`; join-key invariants; validation fixtures excluded from
  live owner metrics; learning result visible and durable.
- Bounded live item only after provider-free pass + explicit Owner authority
  (production, spend, credential binding, private publication).

## SCOPE_OUT

- Contract/routing/recovery framework changes (P1–P3) except media recovery instances.
- Public autonomous publishing (explicitly NOT required for completion).
- Owner autonomy productization (P5); analytics dashboards beyond V1 surfaces.
- Rewriting historical media/publication/analytics proofs (M4 private video,
  benchmark evidence, VoiceTuT history).

## DEPENDENCIES

- Requires P1–P3 provider-free passes (stable contracts, routes, recovery/state/lineage).
- Its provider-free pass + bounded live item gate P5 and the first real
  closed-loop Morroway content milestone.

## AUDIT_FINDINGS_ADDRESSED

- Uncertified media chain; legacy media references; publication authority/session/
  idempotency gaps; analytics join/learning-visibility gaps; INVALID-LINEAGE
  (FLUX-derived) handling; synthetic-audio proxy limits.

## RISKS_ADDRESSED

F-08, F-09, F-10, F-11, F-12, F-13, R-7, R-8 (+ R-6 shared with P3, F-07 live aspect).
See `../AMF_KNOWN_RISKS.md`.

## HYGIENE_BEFORE

- `packages/tts-agent`, `packages/timeline-executor` (LEGACY_STILL_REFERENCED;
  still imported by worker e2e smokes — migrate deps first).
- Legacy thumbnail/video kinds + INVALID-LINEAGE outputs (MIGRATION_REQUIRED; read-only).
- Media proof scripts (KEEP_TEMPORARILY until canonical chain proven).
- Generated output separation (`output/`, `artifacts/` → lifecycle/retention policy).

## HYGIENE_DURING

- Tests off legacy chain; legacy outputs enforced read-only; canonical-chain-only rule for new production.

## HYGIENE_AFTER

- Archive legacy media paths only after migration + certification; delete only
  with explicit evidence. Proof outputs immutable.

## ENGINEERING_WORKSTREAMS

1. WS1-Media: reference assets, continuity, TTS reauth, fingerprint policy,
   narration-fit + caption verification, Wan reconcile, budget/claim safety.
2. WS2-Legacy: test migration; read-only enforcement; `tts-agent` /
   `timeline-executor` dep migration.
3. WS3-Publication: token preflight, authority separation, binding, session
   recovery, duplicate protection, promotion rules.
4. WS4-Analytics: canonical chain, join keys, fixture exclusion, durable visible learning.
5. WS5-Canary: one bounded real Owner-approved item (private/safe only).

## PROVIDER_FREE_EXIT_CRITERIA

- **E2E-05** (media bounded success), **E2E-06** (media failure/recovery),
  **E2E-08** (publication authorization/private upload), **E2E-09** (publication
  idempotency), **E2E-10** (analytics→learning) — all pass provider-free.
- Zero provider calls in provider-free runs.

## LIVE_EXIT_CRITERIA

- One bounded real item: Owner-approved → produced → private/safe publication →
  analytics captured → learning recorded.
- No public autonomous publishing required for completion.
- Requires separate explicit authority: production + provider-spend +
  credential-binding + private-publication authorization.

## REQUIRED_E2E_SCENARIOS

E2E-05, E2E-06, E2E-08, E2E-09, E2E-10 (provider-free exit); live canary evidenced separately.

## BLOCKERS

- Provider-free blockers: none.
- Bounded live-canary blockers: none; the Owner closure review completed on
  2026-09-29.
- Future-production blocker: hardened Wan handler deployment, persistent
  receipt storage, and endpoint source/digest parity remain unverified. Future
  Wan submissions stay prohibited; the bounded canary used the audited
  Owner-output recovery path and does not waive this blocker.
- Historical readiness entries below are preserved as chronology; they are not
  current Program-4 blockers.
- `AMF_PROGRAM_04_BOUNDED_LIVE_CANARY_READINESS_V1` (2026-09-28) additionally
  verified that the production worker is stopped (`STALE_PID`, tracked PID 4996
  dead), current expected governed build is
  `4a078ea491a302150b9db1a9746a4560e1e4f0326cdfefa6c7d4dbc03841261b`,
  and the four nullable Program-4 observation-lineage columns are absent from
  production. The Morroway YouTube channel is verified, but no canonical
  credential binding exists and neither publishing nor analytics resolves from
  local configuration. These are readiness blockers, not permission to mutate
  schema, credentials, budgets, or worker state.
- `AMF_PROGRAM_04_LIVE_CANARY_INFRASTRUCTURE_PREPARATION_V1` prepared, but did
  not apply, the three infrastructure remediations. Production still lacks the
  columns, the worker remains stopped, and the credential binding remains
  absent until the Owner executes the commands below. Phase 0 remains blocked.
- `AMF_PROGRAM_04_OWNER_INFRASTRUCTURE_ACTIVATION_V1` subsequently applied the
  exact narrow schema migration and the bounded `analytics` budget. Credential
  binding failed closed before mutation because the authorized directory
  contains multiple plausible Morroway token files and no exact filename was
  supplied. The worker remains stopped and Phase 0 remains blocked.
- `AMF_PROGRAM_04_YOUTUBE_CREDENTIAL_BINDING_ONLY_V1` resolved that ambiguity
  from an explicit Owner selection and created one canonical ACTIVE opaque
  binding. Token liveness remains unknown; this did not authorize a probe.
- `AMF_PROGRAM_04_POST_ACTIVATION_READINESS_RECHECK_V1` verifies Phase 0 entry
  gates: current-build healthy singleton, empty queue, schema, binding, and
  analytics budget. TTS quality remains unapproved. Publishing/analytics env
  selectors still fail closed without a verified ephemeral access token.
- `AMF_PROGRAM_04_PHASE_0_YOUTUBE_CREDENTIAL_HEALTH_V1` stopped before any
  network call because its just-in-time readiness check found tracked PID 4320
  dead, no live worker presence, and launcher state `STALE_PID`. Local binding,
  external-reference, required-scope, and empty-queue checks passed, but token
  liveness and authenticated channel identity remain unverified.
- The Owner restarted the worker and explicitly authorized a rerun. Phase 0
  then passed live with one token refresh and one read-only channel-identity
  request. No upload, analytics, media, workflow, or budget operation occurred.

## COMPLETED_TASKS

- Established canonical Program-4 media contracts for input identity, reference
  transport/preflight, frozen media configuration reauthorization, caption and
  semantic-review honesty, video intent/reconciliation, final-media integrity,
  analytics join identity, cost provenance, and legacy-media read-only policy.
- Image generation rejects local/non-HTTPS, untyped, or ambiguous reference
  transports before provider invocation.
- Governed observations persist the complete content/workflow/final-media hash/
  published-report/provider-publication/channel/provider join; fixtures remain
  explicitly separate. Learning/recommendation evidence cannot cite an absent metric.
- Added shared Program-3 policies for `VIDEO_RECONCILIATION` and
  `PUBLISH_SESSION_RESUME`; ambiguous video submission cannot blindly resubmit.
- Private validation and public publication use distinct exact authority scopes;
  credential state models VALID/EXPIRED/REVOKED/UNKNOWN_REQUIRES_REFRESH.
- Removed unused worker runtime dependency declarations on legacy `tts-agent`
  and `timeline-executor`; both packages remain for historical compatibility.
- Provider-free matrix passed 293/293 tests across Program 4 and Program 1–3
  regressions; four final rebuilt E2E/preflight checks also passed. Zero external
  provider calls and zero production database/workflow/budget mutations.

## CURRENT_TASK

- None. The Owner accepted the seven-phase bounded live-canary evidence and
  closed Program 4. Program 5 subsequently completed at `LIVE_OWNER_PASS`.

## NEXT_TASK

- None automatically. Hardened Wan deployment certification is a separately
  authorized future work candidate and remains mandatory before any future Wan
  generation.

## LIVE_CANARY_INFRASTRUCTURE_PREPARATION (2026-09-28)

### Narrow production migration

- Migration ID: `program-04-performance-observation-lineage-v1`.
- Runtime implementation:
  `packages/database/src/program-04-performance-lineage-migration.ts`.
- Operator:
  `scripts/program-04-apply-performance-lineage-migration.mjs`.
- Exact scope: nullable `TEXT` columns
  `performance_observations.content_id`, `published_report_id`,
  `final_media_sha256`, and `analytics_provider_id` only. No DML, backfill,
  delete, or broad schema bootstrap is invoked.
- Preflight validates database fingerprint, target-table presence, current
  column state, and exact type/nullability. An incompatible existing definition
  fails closed. Apply uses one transaction and a transaction-scoped advisory
  lock; postcheck validates all four columns. Reapply is a no-op success.
- Isolated PostgreSQL proof: absent-column apply, reapply, sentinel row/table
  preservation, and incompatible-definition failure all pass. The test database
  fingerprint is `1bd1aa3f...`; production read-only preflight fingerprint is
  `9ac13333...` and confirms all four columns are still absent.
- Owner production command (ordinary PowerShell, repository root):
  `node --env-file=.env scripts/program-04-apply-performance-lineage-migration.mjs --apply --confirm-production=program-04-performance-observation-lineage-v1`.
- The broad historical command
  `node --env-file=.env scripts/v6-apply-additive-migration.mjs` is NOT
  authorized for this canary.

### Canonical worker refresh

- Current source/governed build after the migration export is
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`.
- Canonical launcher: `scripts/persistent-worker.mjs`.
- Owner commands, in order: `node scripts/persistent-worker.mjs status`,
  `node scripts/persistent-worker.mjs start`, then
  `node scripts/persistent-worker.mjs status`.
- The tracked PID 4996 is dead. `start` holds the launcher lock, verifies the
  PID is dead, removes only its canonical stale pid/state records, checks live
  canonical presence, then launches and registers the current build. No manual
  state-file or database-row deletion is permitted.

### YouTube credential binding

- Channel: project `morroway`, binding `channel-morroway-youtube`, external ID
  `UCA5ECzcK_96akfUT5fQUT3A`, handle `@morrowaystudio`.
- Canonical database metadata is binding ID, project, channel, provider,
  opaque external credential reference, ACTIVE/REVOKED status, and timestamps.
  Scope and token liveness remain properties of the externally stored OAuth
  artifact and its preflight; raw secret/token content is never copied into the
  binding row.
- Operator: `scripts/program-04-bind-youtube-credential.mjs`. It verifies that
  an Owner-supplied outside-repository file exists using metadata only, checks
  exact channel/project/provider ownership, prints only fingerprints, and
  performs zero OAuth/network calls. The resulting liveness state is
  `UNKNOWN_REQUIRES_REFRESH`.
- Owner command:
  `node --env-file=.env scripts/program-04-bind-youtube-credential.mjs --credential-ref=<ABSOLUTE_OUTSIDE_REPOSITORY_TOKEN_FILE> --apply --confirm-production=program-04-morroway-youtube-credential-binding-v1`.
  A previously Owner-managed OAuth artifact can be reused by reference; no
  regeneration is required merely to create the binding.

### Remaining bounded authorities

- Analytics call kind is the existing canonical `analytics`. The smallest
  future authorization is limit 1, current used 0 for that new budget, and
  maximum retries 0. It is not applied here; monetary/provider cost is UNKNOWN.
- TTS quality approval must be a canary-scoped Owner decision bound to provider
  `voicetut`, voice `Mohamed`, language `arz` / locale `ar-EG`, format `wav`,
  configuration fingerprint
  `bb5dc22ded09cf2a437c4ed129b552b2964464de028158943f8f7ad08c4d694a`,
  one named canary content/workflow, and at most one 200-character narration
  chunk. It must not silently grant global or permanent voice approval.
- The fresh canary must be genuine Owner-approved Morroway content with a new
  content/workflow/correlation/idempotency identity, one scene, Egyptian-Arabic
  narration of at most 200 characters, one vertically composed visual brief,
  an explicit reference-asset disposition (approved HTTPS asset or documented
  no-reference intent), and Owner approvals for the brief, TTS configuration,
  image review, final product, and private-only publication. It uses zero
  Research and zero LLM calls under this infrastructure task.

## OWNER_INFRASTRUCTURE_ACTIVATION (2026-09-28)

- Build identity revalidated before mutation:
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`.
- Production DB fingerprint `9ac13333...`; the narrow migration added exactly
  the four declared nullable `TEXT` columns. Read-only recheck is current and
  idempotent. The target table contained zero rows before and after; its data
  fingerprint stayed `d41d8cd...`, and the schema fingerprint excluding the
  four target columns stayed `4c8c27aa...`. No broad migration ran.
- Canonical automation budget `morroway` / `analytics`: hard limit 1, used 0,
  remaining 1, maximum retries 0, unknown cost. No other call-kind row was
  updated.
- At the partial activation attempt, credential binding remained absent.
  `D:\AMF-Secrets` contains both
  `morroway-youtube-oauth-token.json` and
  `morroway-youtube-oauth-token-v2.json`; neither repository metadata nor an
  existing binding selects one. Choosing by filename/timestamp would be an
  unauthorized account-identity assumption, so the operator was not run.
- Worker was not started or stopped. Status remains `STALE_PID`, tracked PID
  4996 dead; canonical next commands remain `node scripts/persistent-worker.mjs
  start` and `node scripts/persistent-worker.mjs status` after binding.
- Research Pilot remains `PAUSED`/closed at its bounded stop; Job 68 remains
  `failed` with 18 attempts. Zero provider/OAuth/media/upload/analytics calls.

### Credential binding completion

- The Owner subsequently selected
  `D:\AMF-Secrets\morroway-youtube-oauth-token-v2.json` explicitly.
- The guarded operator created binding
  `binding-morroway-youtube-fe06cec2832354a9`. Postcheck proves exactly one
  matching ACTIVE row for project `morroway`, channel
  `channel-morroway-youtube`, provider `youtube`, external channel
  `UCA5ECzcK_96akfUT5fQUT3A`, and handle `@morrowaystudio`.
- Only the opaque outside-repository path and ordinary binding metadata were
  persisted. No token contents were read, copied, printed, or stored in the
  database. No duplicate binding was created.
- Token liveness remains `UNKNOWN_REQUIRES_REFRESH`; no OAuth or YouTube API
  request occurred. Phase 0 still requires separate Owner authorization.

### Post-activation readiness recheck

- Worker PID 4320: `HEALTHY_SINGLETON`, one live presence/heartbeat,
  `persistent-worker-script`, `PERSISTENT_PRODUCTION_WORKER`, role
  `canonical-production-queue-worker`, environment `SUPPORTED`, exact build
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`.
  Queue is 0 queued / 0 running.
- All four Program-4 lineage columns remain nullable `TEXT`. The YouTube
  binding is unique and ACTIVE. Budgets are unchanged: analytics 1/0,
  voice-generation 1/0, image-generation 3/0, video-generation 3/0, and
  private-upload 1/0; all have maximum retries 0.
- No canonical TTS quality approval exists for the VoiceTuT/Mohamed
  fingerprint. Phase 1 is therefore `QUALITY_SAMPLE_REQUIRED`: at most one
  <=200-character chunk, no retry, then mandatory stop for Owner listening.
- Local configuration construction reports VoiceTuT, self-hosted image, and
  self-hosted video `CONFIGURED`. The durable YouTube credential binding is
  configured, but current publishing and analytics environment selectors are
  `KNOWN_INVALID` until a verified ephemeral access token is supplied. No live
  provider health is inferred.
- Phase 0 credential-health authorization is ready because its entry gates do
  not require TTS approval or upload/analytics selector activation. Fresh
  Morroway canary content is still required for later phases; the closed
  Research workflow and Job 68 remain excluded.

### Phase-0 credential-health attempt

- The just-in-time preflight found launcher state `STALE_PID`: PID 4320 was
  dead, with no active canonical PID or live worker-presence heartbeat. The
  queue remained empty.
- The unique ACTIVE Morroway YouTube binding, selected outside-repository file,
  exact channel metadata, and all three required persisted scopes passed local
  validation. No credential contents or token values were printed.
- The operation stopped before OAuth refresh or `channels.list`. Consequently
  token liveness remains `UNKNOWN_REQUIRES_REFRESH`, authenticated channel
  identity is not live-verified, and Phase 0 is not passed. Zero provider,
  upload, analytics, media, workflow, database, or budget calls/mutations
  occurred.

### Phase-0 credential-health successful rerun

- After the Owner restarted the canonical worker, PID 21988 was the sole live
  worker (`HEALTHY_SINGLETON`) on the exact expected build; queue remained
  empty and the binding remained uniquely ACTIVE.
- The canonical owner-local credential path validated all three fixed scopes,
  performed one successful refresh-token exchange, and performed exactly one
  read-only `channels.list(mine=true)` request. The authenticated channel was
  `UCA5ECzcK_96akfUT5fQUT3A`, title `Morroway`, matching the binding exactly.
- Phase-0 state is `PASS_LIVE`; verified at `2026-09-28T16:41:48.169Z` with
  safe evidence fingerprint
  `e49faee7928ed8a794b97f59e6aeaf23e980c206cc00fcc1636a5c1fcf251304`.
  The ephemeral access token was not printed or persisted. Upload and analytics
  budgets remained unused, and no upload, analytics fetch, media, workflow,
  production-database, Pilot, or Job-68 mutation occurred.

### Phase-1 VoiceTuT quality sample

- Status: `PASS_LIVE` on 2026-09-28 for the bounded quality-sample operation
  only; Program 4 remains `PROVIDER_FREE_PASS`, not `LIVE_CANARY_PASS`.
- Execution `tts-quality-sample-48feac9ac7e900efe35f8b3b` made exactly one
  VoiceTuT generation submission, with zero retries, using `Mohamed`, `arz` /
  `ar-EG`, WAV, and the authorized fingerprint
  `bb5dc22ded09cf2a437c4ed129b552b2964464de028158943f8f7ad08c4d694a`.
  All status polling referred to that same provider job.
- The exact 131-character Owner-supplied narration produced artifact
  `tts-quality-sample-artifact-48feac9ac7e900efe35f8b3b`: 505,484 bytes,
  SHA-256 `84ef7d955eae99d976e16d3eecf539b65990f91e38c592c2800020968abf6dac`,
  10.53 seconds, PCM signed 16-bit little-endian, 24 kHz mono. Both the
  container parser and independent `ffprobe-static` inspection passed.
- The hard `voice_generation` budget settled from 0/1 to 1/1; maximum retries
  remained zero and provider-billed cost remains `UNKNOWN`. No other call-kind
  was consumed.
- Owner approval record
  `approval-tts-quality-sample-48feac9ac7e900efe35f8b3b` is
  `AWAITING_OWNER`. Technical validation is not human quality approval:
  production approval remains `NO`, and Phase 2 is blocked until the Owner
  explicitly selects `APPROVE_FOR_CANARY_ONLY`, `REJECT`, or separately
  authorizes `REQUEST_NEW_SAMPLE`.

### Phase-2 single-scene image canary

- The Owner recorded `APPROVE_FOR_CANARY_ONLY` for the Phase-1 VoiceTuT sample;
  the decision is restricted to this bounded canary and is not permanent brand
  voice approval.
- Status: `PASS_LIVE` on 2026-09-28 for image generation only. The canonical
  worker was healthy at PID 21988 on exact build
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`;
  queue conflicts were zero.
- Fresh identities were created: content `content-mulk44ho-kih3gg`, workflow
  `wf-p4-canary-2b0da0ba762b65477107`, correlation
  `corr-p4-canary-91a7723e93f4253c0309`, and scene `scene-001`. The workflow
  identity was not enqueued or executed.
- Canonical Visual Direction V2 compiled a reference-free (`NONE`) one-scene
  contract. One self-hosted-image / FLUX.1-dev-fp8 submission produced
  `art-scene-visual-b6796e3e71f4d8f7ce473bdf`; generation retries were zero.
  Provider polling reconciled only the same submitted provider job and is not a
  second generation.
- Independent PNG inspection proved 768x1344 RGB, 1,402,009 bytes, SHA-256
  `7da769d5b0f22cec1dc2e6c8e1b817822a9e6a550faa6047bdd753c538639c0e`.
  Image accounting settled exactly once from 0/3 to 1/3. The configured known
  unit estimate is USD 0.005; provider-billed cost was not returned and remains
  `UNKNOWN`.
- Approval `approval-image-b6796e3e71f4d8f7ce473bdf` is
  `AWAITING_OWNER`; semantic status is `AWAITING_OWNER_REVIEW` and approval for
  video remains `NO`. No video, upload, analytics, TTS, LLM, Research, social,
  Pilot, Job-68, or downstream workflow execution occurred. Program 4 remains
  `PROVIDER_FREE_PASS`, not `LIVE_CANARY_PASS`; Program 5 remains `NOT_STARTED`.

### Phase-3 single-video canary attempt

- The Owner decision `APPROVE_FOR_VIDEO_CANARY` was durably recorded against
  Phase-2 approval `approval-image-b6796e3e71f4d8f7ce473bdf`, scoped only to
  the Phase-3 canary. It grants no composition authority.
- Frozen Wan authorization
  `art-wan-authorization-e46409193d5f74e14829258c` and execution intent
  `video-canary-2f94234d481cefe0a56d09a2` were persisted before transport for
  self-hosted-video / Wan 2.2, 480x832, 81 frames, 10 steps, CFG 2.0, source
  SHA-256 `7da769d5b0f22cec1dc2e6c8e1b817822a9e6a550faa6047bdd753c538639c0e`,
  and configuration fingerprint
  `f9d45d557e6edbb5170baf4ea1aee878275ab9c65d2a8a4f55ad23bbd2fa09fc`.
- Exactly one generation POST crossed the provider boundary with retry count
  zero. It timed out after 30 seconds before acknowledgement, so provider
  acceptance and job identity are unknown. The canonical state is
  `RECONCILIATION_REQUIRED`, provider job ID is unavailable, and a second POST
  is forbidden. No provider poll occurred.
- Video accounting settled exactly once from 0/3 to 1/3 because the legitimate
  submission transport began. No clip output or `scene_video_clip` was created;
  no video technical/semantic pass or composition approval is claimed. No TTS,
  image, upload, analytics, LLM, Research, Pilot, Job-68, or workflow execution
  occurred. Program 4 remains `PROVIDER_FREE_PASS`; Program 5 remains
  `NOT_STARTED`.

### Phase-3 reconciliation-only attempt

- The Owner supplied exact provider job
  `a926f991-076f-4e36-bdb7-03cefc223cd8-e1` and authorized only status/result
  retrieval for existing execution `video-canary-2f94234d481cefe0a56d09a2`.
- Frozen intent, source-image lineage, 480x832 / 81-frame / 10-step / CFG 2.0
  configuration, original timeout evidence, and unchanged 1/3 accounting all
  passed locally before the provider read.
- One GET to the canonical RunPod status path for that exact endpoint/job
  returned HTTP 404. No alternate lookup, generation POST, retry, or budget
  mutation occurred. The Owner observation alone is insufficient to bind a
  provider job or fabricate output lineage, so no `scene_video_clip` or Owner
  video-review record was created and state remains `RECONCILIATION_REQUIRED`.
- Source inspection proves the adapter's intended flow is asynchronous: POST
  `/run` must return a job ID before polling begins. It does not deliberately
  wait for generation completion before acknowledgement. The original timeout
  is therefore most consistent with delayed/lost provider ingress or response,
  but the precise network/proxy cause remains unconfirmed.

### Wan submission timeout and cold-start hardening

- Root cause: the AMF RunPod adapter owned a single 30,000ms
  `RUNPOD_VIDEO_TIMEOUT_MS` and reused it for the side-effecting `/run` POST and
  status polling. RunPod documents `/run` as immediate asynchronous queue
  acknowledgement; generation/model cold start belongs after acceptance.
- Canonical timing policy now separates:
  `RUNPOD_VIDEO_SUBMISSION_ACK_TIMEOUT_MS=300000`,
  `RUNPOD_VIDEO_GENERATION_TIMEOUT_MS=900000`,
  `RUNPOD_VIDEO_POLL_INTERVAL_MS=4000`,
  `RUNPOD_VIDEO_STATUS_TIMEOUT_MS=30000`, and
  `RUNPOD_VIDEO_RESULT_DOWNLOAD_TIMEOUT_MS=120000`. Legacy shared env names are
  compatibility fallbacks only.
- Requests carry `client_execution_id`, AMF idempotency identity, source input
  hash, and configuration fingerprint. The owned handler persists an atomic
  receipt keyed by a traversal-safe hash under `AMF_VIDEO_RECEIPT_DIR`, echoes
  timing/job correlation, suppresses duplicate generation for the same client
  identity, and supports receipt lookup as a non-generation reconciliation
  control operation. RunPod has no documented native client idempotency lookup;
  this behavior is therefore explicit AMF/provider-handler infrastructure.
- RunPod active `/status` is not durable history: async results expire after 30
  minutes. The receipt store is the canonical post-retention lookup, and AMF
  still never sends a second generation POST after ambiguous acknowledgement.
- Provider-free proof: cold/warm acknowledgement, simulated 3.5-minute-class
  generation separation, generation timeout, lost ACK receipt lookup,
  completed history, replay suppression, no blind retry, same-job polling, and
  independent download timeout all pass. Program 2/3/4 regressions remain
  green. No live provider or budget operation ran.
- The historical Phase-3 execution remains `RECONCILIATION_REQUIRED`; its
  pre-hardening job has no retroactive receipt. A separately authorized,
  hash-verified local-output import is possible but was not executed.

### Wan hardening deployment/readiness attempt

- Result: `BLOCKED_PRE_DEPLOYMENT`. Source/build identity is
  `2f1610e1ac4240c64300a761fb2c5269a955c9cd3e7013cc325313ae24bf94a5`.
  The current worker is healthy at PID 21988 but remains on build
  `20e2ff124b876bace7bf3b784665012a9aa3402e54f7545ddfbb151d38326dcc`.
- `handler.py`, `receipt_store.py`, and the Dockerfile are present and locally
  certified. Their source SHA-256 values are respectively
  `c65763ed214efa66e9b4665a2766bd8190b022fae4d424cde9ba11ec11cda978`,
  `fdf8e223262fecaad7ae7fc8f4d6db0278030d22bec6ec73545abbcfbbf2d817`,
  and `09e9eb4b96c4d40ba62da5ce59f752ba90f1426180b69e616c1e2cff872d8225`.
- The repository provides a build-and-push GitHub workflow, not a canonical
  RunPod endpoint deployment/update operator. `AMF_VIDEO_RECEIPT_DIR` is absent
  from production configuration, and no persistent network-volume mount can be
  proven. The container default is not accepted as persistence evidence.
- Fail-closed outcome: no handler deployment, provider request, generation,
  worker restart, budget mutation, or production database mutation occurred.
  Future Wan submission readiness remains NO until persistent storage and exact
  deployed-image/source parity are verified.

### Wan deployment + audited historical-output import readiness

- The Owner-refreshed worker passed entry parity at PID 11192 on build
  `2f1610e1ac4240c64300a761fb2c5269a955c9cd3e7013cc325313ae24bf94a5`,
  with healthy singleton/heartbeat and no queue conflict.
- Deployment authority remains split: GitHub Actions builds/pushes
  `ghcr.io/muhfares/amf-wan22-i2v`; Runpod endpoint/template/network-volume
  updates require console or authenticated management GraphQL. The configured
  endpoint execution key returned HTTP 401 to one read-only management query
  and was not retried. No deployment mutation is claimed.
- `configs/media/program-04-wan-hardening-deployment.json` and
  `scripts/program-04-wan-deployment-preflight.mjs` now fail closed unless a
  distinct management credential, immutable handler digest, and network-volume
  ID exist. The receipt directory is fixed under persistent
  `/runpod-volume/amf-video-receipts`; current preflight reports all three
  deployment inputs missing.
- `AuditedVideoOutputImportStore` and the guarded
  `scripts/program-04-import-historical-video-output.mjs` implement the only
  local-output recovery path. The transaction verifies frozen identities,
  source lineage, historical reconciliation state, local MP4 technical proof,
  and unchanged 1/3 accounting; it inserts one canonical clip and audit event,
  preserves ambiguity, blocks competing artifacts, and consumes no budget.
- Provider-free import cases A-J pass (10 tests), and focused Programs 2/3/4,
  adapter, and zero-GPU handler regressions remain green. No import ran, so the
  historical execution remains `RECONCILIATION_REQUIRED`. The import source
  changes the canonical build to
  `451710def1eaecb2130acb2ec5e0c0ca30258e6b9f1b4f082e6dc77acb506aeb`;
  another Owner worker refresh is required before future execution.

## CHANGELOG

- 2026-09-27: Program file created by `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1`. Status `NOT_STARTED`.
- 2026-09-28: Program activated by
  `AMF_REMEDIATION_PROGRAM_04_MEDIA_PUBLICATION_ANALYTICS_V1`; provider-free
  source audit, implementation, and exit certification started. No live media,
  publication, analytics, provider, worker, budget, or production-state action
  is authorized by this activation.
- 2026-09-28: Provider-free exit certified. E2E-05/06/08/09/10 and Program
  1–3 regressions pass against isolated PostgreSQL/current builds with stubbed
  boundaries. Status advanced to `PROVIDER_FREE_PASS`; bounded live authority
  remains explicitly separate and NOT_GRANTED.
- 2026-09-28: `AMF_PROGRAM_04_BOUNDED_LIVE_CANARY_READINESS_V1` completed a
  read-only production readiness inspection with zero provider/media/upload/
  analytics calls and zero production mutations. Result `PARTIAL`: media
  selectors and existing hard budgets are locally configured, but the worker,
  schema, publication credential binding/token, fresh canary identity, and
  human TTS-quality decision are not ready. Program status remains
  `PROVIDER_FREE_PASS`; no `LIVE_CANARY_PASS` is claimed.
- 2026-09-28: `AMF_PROGRAM_04_LIVE_CANARY_INFRASTRUCTURE_PREPARATION_V1`
  added and tested the narrow migration plus guarded migration/credential
  operator paths, documented canonical singleton refresh and remaining Owner
  decision records, and made zero production/provider/worker/budget changes.
  Program 4 remains `PROVIDER_FREE_PASS`; Program 5 remains `NOT_STARTED`.
- 2026-09-28: `AMF_PROGRAM_04_OWNER_INFRASTRUCTURE_ACTIVATION_V1` completed
  partially. The production schema and one-call analytics budget were activated
  within authority. Credential binding stopped fail-closed on ambiguous source
  selection. No external call, worker action, workflow execution, or unrelated
  production mutation occurred.
- 2026-09-28: `AMF_PROGRAM_04_YOUTUBE_CREDENTIAL_BINDING_ONLY_V1` created and
  verified the single Owner-selected opaque YouTube credential binding. Zero
  network/provider/budget/workflow operations occurred; Program 4 remains
  `PROVIDER_FREE_PASS` and Program 5 remains `NOT_STARTED`.
- 2026-09-28: `AMF_PROGRAM_04_POST_ACTIVATION_READINESS_RECHECK_V1` passed the
  read-only Phase 0 entry gate and classified Phase 1 as a quality sample only.
  Zero provider, media, upload, analytics, database, budget, workflow, Pilot,
  or Job 68 mutations occurred.
- 2026-09-28: `AMF_PROGRAM_04_PHASE_0_YOUTUBE_CREDENTIAL_HEALTH_V1` stopped
  fail-closed before transport after the worker became stale. Local credential
  integrity passed, but no live health claim was made and no external call or
  production mutation occurred.
- 2026-09-28: After Owner worker restart and explicit authorization to start
  over, the same bounded Phase-0 task passed live with one OAuth refresh and one
  read-only channel identity call. Program 4 remains `PROVIDER_FREE_PASS`; no
  live-canary completion or Phase-1 authority is inferred.
- 2026-09-28: Following the Owner's canary-only TTS approval, Phase 2 passed
  live with one no-retry self-hosted FLUX image generation for a fresh one-scene
  Morroway canary. The canonical scene visual artifact passed technical
  validation and stopped at mandatory Owner visual review; Phase 3 was not
  authorized or started.
- 2026-09-28: After the Owner approved the Phase-2 image only for the video
  canary, Phase 3 persisted frozen intent and made one Wan submission. The POST
  timed out without acknowledgement/job ID, so the execution stopped in
  `RECONCILIATION_REQUIRED` with no retry, output clip, or Phase-4 authority.
- 2026-09-28: A reconciliation-only read for the exact Owner-supplied RunPod
  job returned HTTP 404. The job was not bound, output was not fabricated, and
  the original reconciliation-required state and 1/3 accounting were preserved.
- 2026-09-29: `AMF_PROGRAM_04_PHASE_3_AUDITED_EXISTING_VIDEO_IMPORT_V1`
  completed the explicitly authorized audited import. Worker PID 14308 was a
  healthy singleton on exact build
  `451710def1eaecb2130acb2ec5e0c0ca30258e6b9f1b4f082e6dc77acb506aeb`
  with queue 0/0. The exact Owner-held H.264 MP4 validated at 480x832, 5.032
  seconds, 2,230,749 bytes, SHA-256
  `aa0ca49a4e1fe6aa95add50532ea38b71534e7b5e024b463902a3bec03d63f3d`.
  Import `video-output-import-e46409193d5f74e14829258c` created the sole
  canonical `scene_video_clip`
  `art-scene-video-import-e46409193d5f74e14829258c` plus audited lifecycle
  event 355. The record truthfully distinguishes provider identity as
  `OWNER_ATTESTED_NOT_PROVIDER_VERIFIED` from local technical proof `VERIFIED`,
  preserves the historical timeout/reconciliation event, and leaves video
  accounting unchanged at 1/3. The artifact is awaiting Owner semantic review
  and is not approved for composition.
- This recovery does not authorize future Wan submissions. Hardened handler
  deployment, immutable endpoint digest/source parity, a persistent Runpod
  network volume, and persistent `AMF_VIDEO_RECEIPT_DIR` remain mandatory and
  unverified. Program 4 remains `PROVIDER_FREE_PASS`, not `LIVE_CANARY_PASS`.

### Phase-4 local composition and technical QA canary

- `AMF_PROGRAM_04_PHASE_4_LOCAL_COMPOSITION_AND_QA_CANARY_V1` passed locally
  on 2026-09-29 with zero external/provider calls. It consumed the exact
  approved 10.530-second VoiceTuT sample and the exact audited recovered
  5.032-second scene clip; both source hashes were independently revalidated.
- Canonical timeline `art-timeline-canary-e46409193d5f74e14829258c` uses the
  native scene once, then deterministic `LAST_FRAME_HOLD`. The governed pad is
  5.798 seconds including the 300ms safety tail; the final mux ends at 10.532
  seconds and fully covers the narration without truncation or speed change.
- Three exact-text Arabic caption segments passed deterministic 480x832 safe
  area and continuous timing validation. FFmpeg/libass burned them into the
  output and produced a renderer receipt bound to output and caption hashes.
  QA-frame inspection confirms rendered caption pixels, but semantic/readability
  approval remains `HUMAN_REVIEW_REQUIRED` rather than being fabricated.
- Final artifact `art-final-media-canary-e46409193d5f74e14829258c` is a
  768,251-byte 480x832 H.264/AAC MP4, duration 10.532 seconds, SHA-256
  `41d8a68152b9f34bb65da54ad18298b8c8f1bdb57a508afd631d75aac4c27d49`.
  Technical QA is `PASS`; semantic QA is `AWAITING_OWNER_REVIEW`; composition
  approval is false. Voice/image/video generation budgets remain unchanged at
  1/1, 1/3, and 1/3. Phase 5 is not authorized.

### Phase-5 private-publication canary pre-transport stop

- On 2026-09-29 the Owner authorized one private upload of the exact Phase-4
  artifact. Worker/source parity, queue state, media bytes and SHA-256,
  Morroway channel/binding ownership, metadata limits, duplicate checks, and
  private-upload capacity passed. The intended payload hash is
  `0f9afd05f726c12b05f2ce7992f1f1aa89a9c6930dbb17ac72816e17220177f2`
  and its v2 publication identity is
  `publish:v2:c214902df486eea757c3c6d815918b9cf628c923ab34d224a27313d1229d131f`.
- Execution stopped before reservation and provider transport. The current
  canonical capability validates `publicationAuthority.finalMediaArtifactId`
  against `input.assetId`, while `YouTubePublishAdapter` rejects that same
  `assetId` unless it is an HTTP(S) media URL. This canary has a canonical
  artifact ID plus a local storage reference; replacing the artifact ID with a
  temporary URL would break the exact Owner authority and artifact lineage.
- Required remediation is to separate the immutable canonical
  `finalMediaArtifactId` from an independently validated transport reference
  (for example `assetTransportUrl`) across the capability and adapter, with
  hash binding, local/controlled transport policy, tests, and current-worker
  deployment. No direct-adapter bypass is allowed. Phase 5 remains not
  executed; private-upload accounting is still 0/1 and no provider, OAuth,
  upload, analytics, database, or budget mutation occurred.

### Publication artifact identity / transport separation

- On 2026-09-29 the pre-transport defect was resolved provider-free. Canonical
  publication inputs now separate `finalMediaArtifactId` and
  `finalMediaSha256` from a discriminated `mediaTransportRef`. Supported
  transport classes are `LOCAL_FILE`, `HTTPS_URL`, and
  `PROVIDER_MATERIALIZED`; the YouTube adapter accepts verified local-file or
  HTTPS bytes and never interprets an artifact ID as a URL.
- Owner authority, payload hash, publication identity, and deduplication remain
  bound to immutable artifact identity/hash rather than a path. Moving
  identical bytes does not change authority or publication identity; changed
  bytes fail before provider transport. Local-file bytes are checked at
  preflight and rechecked at the adapter boundary.
- Upload sessions persist final-media identity/hash and a path-independent
  transport type/fingerprint. `published_report` preserves the canonical
  final-media lineage; a transport reference is operational provenance only.
  Four additive nullable session columns support this evidence:
  `final_media_artifact_id`, `final_media_sha256`, `transport_type`, and
  `transport_fingerprint`.
- Provider-free proof passed: contract cases A-L, adapter and publisher-agent
  regressions, isolated PostgreSQL publication visibility/session durability,
  crash/replay, and serial Program 1-4 E2Es including E2E-08/E2E-09. The exact
  canary file passed identity, readability, and SHA-256 transport preflight
  without a YouTube call. Phase 5 remains historically
  `BLOCKED_PRE_TRANSPORT_NO_UPLOAD`; it has not been retried.
- Deployment gate: current build
  `e4f95be2dd1fc9e3a8a00120b955b0be175081451a1b66f8e5d84d958668193f`
  was activated by an Owner worker refresh before the exact Phase-5
  reauthorization.
  Read-only inspection verified the four additive nullable session columns are
  already present in production; this task performed no database mutation.
  Program 4 remains `PROVIDER_FREE_PASS`.

### Phase 5 private publication — reauthorized live canary V2

- On 2026-09-29 the exact approved final-media artifact/hash and its separately
  typed `LOCAL_FILE` transport passed production preflight on the current
  canonical worker (PID 21112, exact build match, healthy singleton and empty
  queue). The earlier `BLOCKED_PRE_TRANSPORT_NO_UPLOAD` attempt remains
  immutable historical evidence.
- Exactly one private YouTube upload was made with zero retries. Provider video
  `QC0XPZak0Q4` was independently read back and matched the Morroway channel
  `UCA5ECzcK_96akfUT5fQUT3A`, private visibility, and the authorized title and
  description. Public publication remained unauthorized.
- Publication identity
  `publish:v2:c214902df486eea757c3c6d815918b9cf628c923ab34d224a27313d1229d131f`
  and payload hash
  `0f9afd05f726c12b05f2ce7992f1f1aa89a9c6930dbb17ac72816e17220177f2`
  were preserved. Completed session `6b689806dcac517b` and published report
  `art-published-report-b71671ebda5049b64b3b7c82` retain canonical
  final-media lineage and operational transport provenance.
- Private-upload accounting settled exactly once from 0/1 to 1/1. No analytics
  unit was consumed and no TTS, image, video, LLM, Research, public upload, or
  analytics call occurred. Phase 5 is `PASS_LIVE_PRIVATE`; Program 4 remains
  `PROVIDER_FREE_PASS` pending separately authorized analytics and learning.

### Phase 6 single live analytics observation

- On 2026-09-29 the Owner authorized exactly one YouTube Analytics fetch for
  private provider publication `QC0XPZak0Q4`. Worker/source parity, empty queue,
  publication/media lineage, unique channel credential, analytics scope, the
  unused 0/1 budget, and absence of a prior observation all passed before the
  analytics transport.
- The canonical non-monetary, video-filtered request used publication-bounded
  measurement dates 2026-09-29 through 2026-09-29. It completed HTTP 200 with
  zero rows and zero retries. No absent metric was zero-filled; the truthful
  status is `EMPTY_VALID_PROVIDER_RESPONSE` / insufficient data, with no
  performance judgment.
- Performance observation `obs-ea5b7d61d0a7` and `analytics_report`
  `art-analytics-report-ea5b7d61d0a7` preserve project/content/workflow,
  final-media ID and SHA-256, published-report ID, provider video, channel, and
  analytics-provider lineage. The explicit classification
  `PROGRAM_04_LIVE_CANARY_EXCLUDED_FROM_NORMAL_PRODUCTION_KPIS` excludes this
  private validation item from normal production KPI aggregates.
- Analytics accounting settled exactly once from 0/1 to 1/1. No upload or
  media budget changed, and no upload, media, LLM, Research, learning, or
  next-cycle action occurred. Phase 7 learning remains separately authorized;
  Program 4 is not yet `LIVE_CANARY_PASS`.

### Phase 7 local evidence-bound learning and live-canary exit

- On 2026-09-29 one local deterministic evaluation consumed no provider,
  analytics, media, upload, LLM, Research, or social call. It loaded live
  observation `obs-ea5b7d61d0a7`, verified its empty metrics and full canonical
  lineage, and preserved the explicit private-canary KPI exclusion.
- Learning `learn-01ecc33b989b` records `PROCESS_VALIDATION=VALIDATED` and
  `CONTENT_PERFORMANCE=INSUFFICIENT_DATA`. Its cited-metric set is empty. The
  only conclusions are that the publication/analytics chain and identity join
  worked, the provider returned a valid empty response, and performance cannot
  be evaluated.
- Recommendation `rec-a1b07efbdc83` is evidence-bound and requests no automatic
  fetch or execution. Proposal `ncp-294f1942f013` remains
  `AWAITS_OWNER_DECISION`, has no approval ID, names no topic, and created no
  workflow.
- Phases 0–7 now satisfy the bounded live exit. Program 4 is
  `LIVE_CANARY_PASS_WITH_FUTURE_WAN_DEPLOYMENT_BLOCKER` under the canonical
  status `LIVE_CANARY_PASS`. Future Wan submissions remain forbidden until the
  hardened endpoint and persistent receipts are verified. The next action is
  Owner Program-4 closure review; Program 5 is not started.

## OWNER FINAL CLOSURE (2026-09-29)

- The Owner accepts the provider-free certification and bounded live canary and
  closes Program 4 at canonical status `LIVE_CANARY_PASS`. This is not
  `FULL_PRODUCTION_AUTONOMOUS`, `PUBLIC_PUBLICATION_READY`, or
  `FUTURE_WAN_READY`.
- Verified closed-loop lineage is: canary-scoped TTS receipt/hash and canonical
  media inputs → `scene_visual_artifact` → audited `scene_video_clip` →
  `final_media_artifact` → private `published_report` → live
  `performance_observation` → `learning_record` → evidence-bound
  recommendation → proposal `ncp-294f1942f013` in
  `AWAITS_OWNER_DECISION`. Cross-ledger TTS identity and SHA-256 are bound into
  the final-media artifact; no unsupported metric or next-cycle execution
  exists.
- Preserved limitations: Mohamed is canary-only, not the final brand voice;
  current creative quality is pipeline-canary evidence rather than permanent
  brand certification; Phase-3 provider identity is
  `OWNER_ATTESTED_NOT_PROVIDER_VERIFIED`; public publication is unproven and
  unauthorized; the immediate private analytics response contained no rows;
  and this canary remains excluded from normal production KPI aggregates.
- Wan source hardening remains `PROVIDER_FREE_PASS`: submission ACK 300000ms,
  generation 900000ms, polling 4000ms, status 30000ms, result download
  120000ms, no blind retry, and exactly-once accounting. Deployment remains
  `NOT_PROVEN`. Future Wan submissions stay prohibited until the owned handler,
  immutable image/source digest parity, persistent RunPod volume and receipt
  directory, durable receipt lookup, deployed client-execution correlation,
  and endpoint readiness are verified.
- Program 5 is now the active registry pointer with status `NOT_STARTED`; the
  next action is `PROGRAM_05_KICKOFF`. Neither the next-cycle proposal nor any
  Program-5 work is approved by this closure.

### Final Programs 1–5 reconciliation — 2026-09-30

The paragraph above is immutable Program-4 closure-time context. Program 5
subsequently reached `LIVE_OWNER_PASS` and Owner `CLOSED`; proposal
`ncp-294f1942f013` subsequently moved to `OWNER_DEFERRED` without creating or
starting a workflow. No new program is active or automatically authorized.
