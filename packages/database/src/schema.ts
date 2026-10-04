/**
 * PostgreSQL schema for durable workflow persistence.
 *
 * Idempotency discipline (Phase 0):
 *  - workflow_instances / workflow_steps: upsert (single source of truth).
 *  - artifacts:          unique artifact_id → ON CONFLICT DO NOTHING.
 *  - capability_executions / execution_evidence: unique idempotency_key →
 *    ON CONFLICT DO NOTHING (replays never duplicate successful work).
 *  - workflow_checkpoints: append-only; latest = highest seq.
 *  - decisions:          unique decision_id → ON CONFLICT DO NOTHING.
 */

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS workflow_instances (
  workflow_id        TEXT PRIMARY KEY,
  definition_id      TEXT NOT NULL,
  definition_version INT  NOT NULL,
  state              TEXT NOT NULL,
  context            JSONB NOT NULL,
  ready              JSONB NOT NULL,
  last_checkpoint_ref TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  workflow_id TEXT NOT NULL,
  step_id     TEXT NOT NULL,
  status      TEXT NOT NULL,
  attempts    INT  NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT,
  PRIMARY KEY (workflow_id, step_id)
);

CREATE TABLE IF NOT EXISTS workflow_checkpoints (
  id                  BIGSERIAL PRIMARY KEY,
  workflow_id         TEXT NOT NULL,
  state               TEXT NOT NULL,
  completed_steps     JSONB NOT NULL,
  context_snapshot_ref TEXT NOT NULL,
  last_event_offset   INT NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_workflow
  ON workflow_checkpoints (workflow_id, id);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id          TEXT PRIMARY KEY,
  workflow_id          TEXT NOT NULL,
  kind                 TEXT NOT NULL,
  producer_agent       TEXT NOT NULL,
  correlation_id       TEXT,
  status               TEXT NOT NULL,
  payload              JSONB NOT NULL,
  content_type         TEXT NOT NULL,
  schema_version       TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  parent_artifact_id   TEXT,
  parent_artifact_kind TEXT
);
CREATE INDEX IF NOT EXISTS idx_artifacts_workflow ON artifacts (workflow_id);

-- Provider-neutral durable binary location. Artifact identity and lineage stay
-- in artifacts; transport and replaceable storage location live here.
CREATE TABLE IF NOT EXISTS artifact_storage_records (
  storage_record_id   TEXT PRIMARY KEY,
  artifact_id         TEXT NOT NULL REFERENCES artifacts(artifact_id),
  sha256              TEXT NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  byte_count          BIGINT NOT NULL CHECK (byte_count > 0),
  mime_type           TEXT NOT NULL,
  storage_class       TEXT NOT NULL CHECK (storage_class IN ('EPHEMERAL_WORK','CANONICAL_DURABLE','HISTORICAL_EVIDENCE','PUBLISHED_MEDIA','REGENERABLE_CACHE')),
  storage_provider    TEXT NOT NULL,
  storage_key         TEXT NOT NULL,
  local_cache_path    TEXT,
  source_execution_id TEXT NOT NULL,
  project_id          TEXT NOT NULL,
  content_id          TEXT,
  created_at          TEXT NOT NULL,
  retention_class     TEXT NOT NULL,
  durability_status   TEXT NOT NULL CHECK (durability_status IN ('PENDING','VERIFIED','CORRUPT','MISSING')),
  verified_at         TEXT,
  is_current          BOOLEAN NOT NULL DEFAULT TRUE,
  receipt             JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_artifact_storage_current
  ON artifact_storage_records (artifact_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_artifact_storage_project
  ON artifact_storage_records (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifact_storage_sha256
  ON artifact_storage_records (sha256);
CREATE INDEX IF NOT EXISTS idx_artifact_storage_location
  ON artifact_storage_records (storage_provider, storage_key);

-- Append-only audit history for narrowly authorized artifact integrity repairs.
-- The artifact keeps its canonical identity; the complete prior and repaired
-- payloads plus hashes make the in-place revision reviewable and replay-safe.
CREATE TABLE IF NOT EXISTS artifact_integrity_repairs (
  repair_id          TEXT PRIMARY KEY,
  artifact_id        TEXT NOT NULL,
  workflow_id        TEXT NOT NULL,
  recovery_execution_id TEXT NOT NULL,
  repair_kind        TEXT NOT NULL,
  prior_payload      JSONB NOT NULL,
  repaired_payload   JSONB NOT NULL,
  prior_payload_hash TEXT NOT NULL,
  repaired_payload_hash TEXT NOT NULL,
  receipt            JSONB NOT NULL,
  created_at         TEXT NOT NULL,
  UNIQUE (artifact_id, repair_kind)
);
CREATE INDEX IF NOT EXISTS idx_artifact_integrity_repairs_workflow
  ON artifact_integrity_repairs (workflow_id, created_at);

CREATE TABLE IF NOT EXISTS capability_executions (
  result_id      TEXT PRIMARY KEY,
  workflow_id    TEXT NOT NULL,
  correlation_id TEXT,
  capability_id  TEXT NOT NULL,
  agent_id       TEXT NOT NULL,
  status         TEXT NOT NULL,
  evidence_id    TEXT,
  idempotency_key TEXT,
  executed_at    TEXT NOT NULL,
  payload        JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_capability_executions_idem
  ON capability_executions (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS execution_evidence (
  evidence_id     TEXT PRIMARY KEY,
  workflow_id     TEXT NOT NULL,
  correlation_id  TEXT,
  capability_id   TEXT NOT NULL,
  agent_id        TEXT NOT NULL,
  executed_at     TEXT NOT NULL,
  succeeded       BOOLEAN NOT NULL,
  idempotency_key TEXT,
  payload         JSONB NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_execution_evidence_idem
  ON execution_evidence (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS execution_provenance (
  execution_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  correlation_id TEXT,
  agent_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  capability TEXT,
  provider TEXT,
  model TEXT,
  runtime TEXT,
  prompt_version TEXT,
  configuration_fingerprint TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  latency_ms BIGINT NOT NULL,
  status TEXT NOT NULL,
  usage JSONB,
  cost_kind TEXT NOT NULL,
  cost NUMERIC,
  currency TEXT,
  artifact_ids JSONB NOT NULL,
  parent_execution_ids JSONB NOT NULL,
  attempt_number INT NOT NULL,
  provider_request_id TEXT,
  provider_job_id TEXT,
  error_classification TEXT,
  configuration JSONB,
  failure_metadata JSONB
);
ALTER TABLE execution_provenance ADD COLUMN IF NOT EXISTS failure_metadata JSONB;
CREATE INDEX IF NOT EXISTS idx_execution_provenance_workflow ON execution_provenance (workflow_id, started_at);
CREATE INDEX IF NOT EXISTS idx_execution_provenance_correlation ON execution_provenance (correlation_id);
CREATE INDEX IF NOT EXISTS idx_execution_provenance_model ON execution_provenance (provider, model, agent_id);

CREATE TABLE IF NOT EXISTS execution_lifecycle_events (
  event_id BIGSERIAL PRIMARY KEY,
  execution_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  state TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  attempt_number INT NOT NULL,
  metadata JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_lifecycle_events_execution
  ON execution_lifecycle_events (execution_id, event_id);

CREATE TABLE IF NOT EXISTS execution_failure_fallback_events (
  event_id BIGSERIAL PRIMARY KEY,
  execution_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempt_number INT NOT NULL,
  occurred_at TEXT NOT NULL,
  metadata JSONB NOT NULL,
  UNIQUE (execution_id, attempt_number, stage)
);
CREATE INDEX IF NOT EXISTS idx_execution_failure_fallback_events_execution
  ON execution_failure_fallback_events (execution_id, event_id);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id    TEXT PRIMARY KEY,
  kind           TEXT NOT NULL,
  workflow_id    TEXT,
  correlation_id TEXT,
  cycle          INT,
  payload        JSONB NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_workflow ON decisions (workflow_id);

-- AMF Control Plane: owner-facing governance records. These are append-only
-- events; the original agent recommendation is deliberately immutable.
CREATE TABLE IF NOT EXISTS control_approvals (
  approval_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  agent_recommendation JSONB NOT NULL,
  agent_confidence TEXT,
  evidence_refs JSONB NOT NULL,
  owner_decision TEXT,
  owner_rationale TEXT,
  status TEXT NOT NULL,
  supersedes TEXT,
  superseded_by TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_control_approvals_project ON control_approvals (project_id, created_at DESC);

-- A valid changes_requested Review is a durable business handoff, not a
-- provider/validation failure. The Review artifact and source lineage are
-- immutable references; duplicate worker delivery cannot duplicate the task.
CREATE TABLE IF NOT EXISTS review_revision_tasks (
  task_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  command_id TEXT,
  project_id TEXT,
  correlation_id TEXT,
  review_execution_id TEXT,
  review_artifact_id TEXT NOT NULL,
  writer_artifact_id TEXT NOT NULL,
  seo_artifact_id TEXT NOT NULL,
  brand_artifact_id TEXT NOT NULL,
  status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  summary TEXT NOT NULL,
  findings JSONB NOT NULL,
  recommendations JSONB NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (workflow_id, review_artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_review_revision_tasks_project ON review_revision_tasks (project_id, created_at DESC);

-- Revision Cycle V1: owner-authorized task lifecycle. The task row is the
-- durable authorization record (PENDING -> AUTHORIZED -> IN_PROGRESS ->
-- COMPLETED / FAILED). Source findings/recommendations stay immutable.
ALTER TABLE review_revision_tasks ADD COLUMN IF NOT EXISTS revision_version INT NOT NULL DEFAULT 0;
ALTER TABLE review_revision_tasks ADD COLUMN IF NOT EXISTS authorized_at TEXT;
ALTER TABLE review_revision_tasks ADD COLUMN IF NOT EXISTS authorized_by TEXT;
ALTER TABLE review_revision_tasks ADD COLUMN IF NOT EXISTS completed_at TEXT;

-- Revision Cycle V1: exactly-once durable dispatch. The unique dispatch_id
-- (task + version) means duplicate or concurrent owner authorization can never
-- rewind/enqueue the revision more than once per authorized version.
CREATE TABLE IF NOT EXISTS revision_dispatches (
  dispatch_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  revision_version INT NOT NULL,
  reason TEXT NOT NULL,
  authorization_status TEXT NOT NULL,
  job_id BIGINT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revision_dispatches_task ON revision_dispatches (task_id);

-- REVIEW_ONLY_TECHNICAL_RESUME: owner-authorized retry of ONLY the Review
-- stage of a revision cycle whose Writer/SEO/Brand are canonical COMPLETED
-- and whose Review failed technically before persisting a valid artifact.
-- The frozen input package (exact Writer/SEO/Brand artifact ids) is captured
-- at authorization time so the Review package cannot drift. The unique
-- resume_id (task + version + attempt) means duplicate or concurrent owner
-- authorization can never rewind/enqueue the resume more than once per
-- authorized attempt. This is NOT a revision version increment.
CREATE TABLE IF NOT EXISTS review_resume_dispatches (
  resume_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  revision_version INT NOT NULL,
  resume_attempt INT NOT NULL,
  failed_review_execution_id TEXT NOT NULL,
  frozen_writer_artifact_id TEXT NOT NULL,
  frozen_seo_artifact_id TEXT NOT NULL,
  frozen_brand_artifact_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  authorization_status TEXT NOT NULL,
  job_id BIGINT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_review_resume_dispatches_task ON review_resume_dispatches (task_id, revision_version);
-- One failed Review execution represents one Owner authorization opportunity.
-- Historical rows predate this invariant and deliberately remain immutable;
-- NULL permits those rows to coexist, while every new dispatch persists the
-- deterministic identity and is protected across processes.
ALTER TABLE review_resume_dispatches ADD COLUMN IF NOT EXISTS idempotency_identity TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_resume_idempotency_identity
  ON review_resume_dispatches (idempotency_identity)
  WHERE idempotency_identity IS NOT NULL;

-- Execution-scoped temporary Review model override provenance for a review
-- resume. Nullable: absent = the canonical control-plane configuration is
-- used as-is. Present = an owner-authorized TEMPORARY_VALIDATION override for
-- THIS resume execution only; persistent policy is never modified.
ALTER TABLE review_resume_dispatches ADD COLUMN IF NOT EXISTS review_override_provider TEXT;
ALTER TABLE review_resume_dispatches ADD COLUMN IF NOT EXISTS review_override_model TEXT;
ALTER TABLE review_resume_dispatches ADD COLUMN IF NOT EXISTS review_override_scope TEXT;

-- Human-gate governance settings (Media Pipeline Pre-Approval Readiness V1).
-- Two logically distinct gates are owner-configurable:
--   pre_production : human approval of the content package before media production
--   visual         : human approval after automated Visual QA
-- Resolution: PROJECT override -> GLOBAL setting -> built-in default (TRUE).
-- Rows are only written by explicit owner control-plane action; absence of a
-- row means "inherit". Changing a setting never retroactively releases an
-- existing pending approval (approvals are snapshots of the policy that was
-- effective when the gate was reached).
CREATE TABLE IF NOT EXISTS human_gate_settings (
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  gate_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope_type, scope_id, gate_key)
);

-- Durable audit for every human-gate configuration change. Append-only.
CREATE TABLE IF NOT EXISTS human_gate_configuration_events (
  event_id TEXT PRIMARY KEY,
  gate_key TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  old_value JSONB,
  new_value JSONB,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  source TEXT NOT NULL,
  rationale TEXT NOT NULL,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_human_gate_config_events_scope ON human_gate_configuration_events (scope_id, changed_at DESC);

-- MEDIA TECHNICAL RESUME V1: owner-authorized resume of the media segment
-- (TTS -> ... -> Visual Human Gate) of a failed workflow whose Director
-- stage completed and whose failure was technical (e.g. the recovery-
-- frontier incident). The frozen resume package (exact artifact identities,
-- scene plan, gate-policy snapshot, provider budget, downstream boundary)
-- is captured at authorization time. The unique resume_id (workflow + start
-- stage + attempt) means duplicate or concurrent authorization can never
-- rewind/enqueue more than once per authorized attempt.
CREATE TABLE IF NOT EXISTS media_resume_dispatches (
  resume_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  source_failed_job_id BIGINT,
  failure_classification TEXT NOT NULL,
  resume_attempt INT NOT NULL,
  resume_start_stage TEXT NOT NULL,
  pre_production_approval_id TEXT NOT NULL,
  review_artifact_id TEXT NOT NULL,
  writer_artifact_id TEXT NOT NULL,
  seo_artifact_id TEXT NOT NULL,
  brand_artifact_id TEXT NOT NULL,
  director_artifact_id TEXT NOT NULL,
  director_lineage_artifact_id TEXT,
  director_scene_ids JSONB NOT NULL,
  gate_policy_snapshot JSONB NOT NULL,
  provider_budget INT NOT NULL,
  downstream_boundary TEXT NOT NULL,
  authorization_status TEXT NOT NULL,
  authorized_by TEXT NOT NULL,
  rationale TEXT NOT NULL,
  authorized_at TEXT NOT NULL,
  job_id BIGINT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS idx_media_resume_dispatches_workflow ON media_resume_dispatches (workflow_id, resume_attempt);

-- MEDIA CAPABILITY PREFLIGHT V1: the safe configuration fingerprint frozen
-- at authorization time (non-secret identity of the effective media runtime:
-- capability registration set + provider selectors). Enables later drift
-- detection between what was authorized and what executes.
ALTER TABLE media_resume_dispatches ADD COLUMN IF NOT EXISTS configuration_fingerprint TEXT;

-- TIMELINE-START RESUME EXTENSION: exact frozen R6 TTS checkpoint for a
-- future timeline-start resume that reuses completed TTS 3/3. Stored as a
-- single JSON package so the production row remains auditable and the null
-- value cleanly distinguishes TTS-start resumes (which have no frozen TTS).
ALTER TABLE media_resume_dispatches ADD COLUMN IF NOT EXISTS frozen_tts_package JSONB;

-- Per-stage provider-submission accounting for a media resume. Every
-- attempted provider call is recorded BEFORE submission; the budget
-- enforcer rejects an attempt that would exceed the authorized envelope.
CREATE TABLE IF NOT EXISTS media_resume_provider_usage (
  usage_id BIGSERIAL PRIMARY KEY,
  resume_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  item_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_resume_provider_usage_resume ON media_resume_provider_usage (resume_id, stage);

-- TIMELINE EXACTLY-ONCE STAGE CLAIMS (R7 hardening): one logical execution
-- claim per (resume_id, stage, item_id). The first claimant executes (and is
-- the only one that may consume budget for the claim); duplicate or recovery
-- delivery observes the durable claim state instead of re-executing.
-- item_id is '' for whole-step claims (timeline) — never NULL so the primary
-- key stays exact. States: CLAIMED (open) -> COMPLETED | FAILED | BLOCKED.
CREATE TABLE IF NOT EXISTS media_stage_claims (
  resume_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  item_id TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL,
  outcome TEXT,
  error TEXT,
  budget_consumed BOOLEAN NOT NULL DEFAULT FALSE,
  claimed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (resume_id, stage, item_id)
);

-- PERSISTENT WORKER PRESENCE (R7 hardening): startup build identity for
-- pre-authorization build-parity checks. One row per worker instance;
-- last_heartbeat_at proves liveness. Non-media operational metadata.
CREATE TABLE IF NOT EXISTS amf_worker_presence (
  worker_instance_id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  launcher TEXT NOT NULL,
  node_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_heartbeat_at TEXT NOT NULL
);
ALTER TABLE amf_worker_presence ADD COLUMN IF NOT EXISTS process_id INTEGER;
ALTER TABLE amf_worker_presence ADD COLUMN IF NOT EXISTS singleton_key TEXT;
ALTER TABLE amf_worker_presence ADD COLUMN IF NOT EXISTS worker_role TEXT;

CREATE TABLE IF NOT EXISTS control_configuration_events (
  event_id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  action TEXT NOT NULL,
  rationale TEXT NOT NULL,
  previous_value JSONB,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_control_configuration_scope ON control_configuration_events (scope_type, scope_id, created_at DESC);

CREATE TABLE IF NOT EXISTS control_commands (
  command_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  owner_message TEXT NOT NULL,
  selected_agents JSONB NOT NULL,
  context JSONB NOT NULL,
  task_classification TEXT NOT NULL,
  workflow_id TEXT,
  status TEXT NOT NULL,
  visible_result JSONB,
  synthesis JSONB,
  artifact_refs JSONB NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_control_commands_project ON control_commands (project_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Canonical Project Registry (Slice 8 domain remediation).
-- Project Hub membership is POSITIVE: a project appears only because it is
-- registered here — never merely because an operational row carries its id.
-- Operational records (submissions/approvals/commands) belong UNDER a
-- project; they cannot create one. Morroway is seeded as the canonical
-- reference project; future business projects appear only through explicit
-- registration. Test/fixture namespaces keep working for tests without
-- ever becoming portfolio projects.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS control_projects (
  project_id   TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
-- Program 5: business metadata + update tracking (additive; existing rows keep NULLs).
ALTER TABLE control_projects ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE control_projects ADD COLUMN IF NOT EXISTS updated_at TEXT;
INSERT INTO control_projects (project_id, display_name, status, created_by, created_at)
SELECT 'morroway', 'Morroway', 'ACTIVE', 'canonical-seed-v1', '2026-09-18T22:39:34.000Z'
WHERE NOT EXISTS (SELECT 1 FROM control_projects WHERE project_id = 'morroway');

-- Program 5: canonical channel registry + credential bindings.
-- Channels are external publishing destinations owned by exactly one project.
-- Credential bindings are OPAQUE references (labels/handles); raw secrets
-- never enter these tables. Additive only.
CREATE TABLE IF NOT EXISTS channels (
  channel_id          TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL,
  platform            TEXT NOT NULL,
  external_channel_id TEXT,
  handle              TEXT,
  display_name        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'PENDING',
  capabilities        JSONB NOT NULL DEFAULT '{}',
  verified_at         TEXT,
  verification_note   TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_channels_project ON channels (project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS credential_bindings (
  binding_id   TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  channel_id   TEXT,
  provider     TEXT NOT NULL,
  credential_ref TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cred_project ON credential_bindings (project_id);

-- Program 5 credential health.  Raw credential material never enters these
-- tables: checks persist only an opaque binding identity plus safe verifier
-- classifications/fingerprints. request_key provides exactly-once Owner action
-- semantics even when a browser repeats a request.
CREATE TABLE IF NOT EXISTS credential_health_checks (
  check_id        TEXT PRIMARY KEY,
  request_key     TEXT NOT NULL UNIQUE,
  project_id      TEXT NOT NULL,
  binding_id      TEXT NOT NULL,
  channel_id      TEXT,
  provider        TEXT NOT NULL,
  action          TEXT NOT NULL,
  status          TEXT NOT NULL,
  result          JSONB,
  actor           TEXT NOT NULL,
  reason          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  completed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_credential_health_checks_project
  ON credential_health_checks(project_id,created_at DESC);
CREATE TABLE IF NOT EXISTS credential_binding_health (
  binding_id                    TEXT PRIMARY KEY,
  project_id                    TEXT NOT NULL,
  channel_id                    TEXT,
  provider                      TEXT NOT NULL,
  health_state                  TEXT NOT NULL,
  scope_state                   TEXT NOT NULL,
  channel_identity_state        TEXT NOT NULL,
  verified_external_channel_id  TEXT,
  reason_code                   TEXT,
  evidence_fingerprint          TEXT NOT NULL,
  last_verified_at              TEXT NOT NULL,
  fresh_until                   TEXT NOT NULL,
  check_id                      TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credential_binding_health_project
  ON credential_binding_health(project_id,updated_at DESC);

-- -----------------------------------------------------------------------------
-- Phase 1: async workflow submission + job queue (Postgres-backed).
--  - workflow_submissions: durable, idempotent submission record keyed by the
--    caller's idempotency identity (submission_key). Re-submitting the same key
--    never creates a second workflow.
--  - workflow_jobs: at-least-once durable queue. A worker claims a queued job
--    (running), acks it (succeeded/failed); orphaned running jobs are reclaimed
--    after a worker crash so they can be re-processed idempotently.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_submissions (
  submission_key TEXT PRIMARY KEY,
  workflow_id    TEXT NOT NULL,
  directive      TEXT NOT NULL,
  correlation_id TEXT,
  brand_id       TEXT,
  definition     JSONB NOT NULL,
  command_context JSONB,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
ALTER TABLE workflow_submissions ADD COLUMN IF NOT EXISTS command_context JSONB;
CREATE INDEX IF NOT EXISTS idx_workflow_submissions_workflow ON workflow_submissions (workflow_id);

CREATE TABLE IF NOT EXISTS workflow_jobs (
  job_id         BIGSERIAL PRIMARY KEY,
  workflow_id    TEXT NOT NULL,
  submission_key TEXT NOT NULL,
  status         TEXT NOT NULL,          -- queued | running | succeeded | failed
  attempts       INT  NOT NULL DEFAULT 0,
  claimed_at     TEXT,
  error          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_status ON workflow_jobs (status);
CREATE INDEX IF NOT EXISTS idx_workflow_jobs_workflow ON workflow_jobs (workflow_id);
-- Program 3: a running job carries the claiming worker and an independent job
-- lease heartbeat. Long provider/media waits remain owned while the worker is
-- healthy; reclamation requires both job lease expiry and dead/stale worker.
ALTER TABLE workflow_jobs ADD COLUMN IF NOT EXISTS claimed_by_worker TEXT;
ALTER TABLE workflow_jobs ADD COLUMN IF NOT EXISTS lease_heartbeat_at TEXT;
ALTER TABLE workflow_jobs ADD COLUMN IF NOT EXISTS lease_kind TEXT NOT NULL DEFAULT 'STANDARD';

-- Owner-authorized recoveries are a separate durable command from the original
-- workflow submission.  The authorization key is the idempotency boundary: a
-- duplicate dispatch must return the same new execution and must not enqueue a
-- second provider-capable job.
CREATE TABLE IF NOT EXISTS workflow_recovery_dispatches (
  authorization_key TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  submission_key TEXT NOT NULL,
  recovery_execution_id TEXT NOT NULL,
  recovery_of_execution_id TEXT NOT NULL,
  original_execution_id TEXT NOT NULL,
  recovery_reason TEXT NOT NULL,
  authorization_status TEXT NOT NULL,
  job_id BIGINT,
  created_at TEXT NOT NULL
);
ALTER TABLE workflow_recovery_dispatches ADD COLUMN IF NOT EXISTS dispatch_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE workflow_recovery_dispatches ADD COLUMN IF NOT EXISTS dispatch_error_code TEXT;
ALTER TABLE workflow_recovery_dispatches ADD COLUMN IF NOT EXISTS reconciled_at TEXT;
ALTER TABLE workflow_recovery_dispatches ADD COLUMN IF NOT EXISTS reconciliation JSONB NOT NULL DEFAULT '{}';
UPDATE workflow_recovery_dispatches SET dispatch_status='DISPATCHED' WHERE job_id IS NOT NULL AND dispatch_status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS idx_workflow_recovery_execution ON workflow_recovery_dispatches (recovery_execution_id);

-- Research V2 targeted-verification-only dispatches.  These jobs reuse the
-- canonical queue but never rewind or resume the normal Research workflow.
CREATE TABLE IF NOT EXISTS targeted_verification_dispatches (
  dispatch_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  selected_candidate_ids JSONB NOT NULL,
  verification_objectives JSONB NOT NULL DEFAULT '{}',
  max_verification_retrieval_calls INTEGER NOT NULL CHECK(max_verification_retrieval_calls > 0),
  max_reevaluation_text_calls INTEGER NOT NULL CHECK(max_reevaluation_text_calls = 1),
  authorization_status TEXT NOT NULL,
  status TEXT NOT NULL,
  job_id BIGINT,
  revision_id TEXT,
  error_code TEXT,
  provenance JSONB NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_targeted_verification_job
  ON targeted_verification_dispatches(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_targeted_verification_workflow
  ON targeted_verification_dispatches(workflow_id, created_at);

-- Reevaluation-only recovery after all candidate-specific retrievals have
-- completed. This is deliberately distinct from a targeted retrieval
-- dispatch: it may create one text reservation and can never enqueue another
-- web.search leg.
CREATE TABLE IF NOT EXISTS targeted_verification_reevaluation_recoveries (
  recovery_id TEXT PRIMARY KEY,
  authorization_key TEXT NOT NULL UNIQUE,
  source_dispatch_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  selected_candidate_ids JSONB NOT NULL,
  max_reevaluation_text_calls INTEGER NOT NULL CHECK(max_reevaluation_text_calls = 1),
  status TEXT NOT NULL,
  job_id BIGINT,
  revision_id TEXT,
  route_snapshot JSONB,
  error_code TEXT,
  provenance JSONB NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_targeted_reevaluation_recovery_job
  ON targeted_verification_reevaluation_recoveries(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_targeted_reevaluation_recovery_source
  ON targeted_verification_reevaluation_recoveries(source_dispatch_id, created_at);

-- -----------------------------------------------------------------------------
-- Phase 2: durable provider publishing record (publish.youtube).
--  - provider_publications: single source of truth for the outcome of a logical
--    publication keyed by the capability idempotency key. A completed entry is
--    terminal: a failed write may upgrade to completed, but a completed entry is
--    never downgraded, so a replayed publish after a worker crash returns the
--    provider-confirmed publication id instead of publishing a duplicate.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provider_publications (
  idempotency_key TEXT PRIMARY KEY,
  status          TEXT NOT NULL,          -- completed | failed
  provider_id     TEXT NOT NULL,
  publication_id  TEXT,
  url             TEXT,
  published_at    TEXT,
  error_code      TEXT,
  error_message   TEXT,
  workflow_id     TEXT,
  asset_id        TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
-- Visibility-aware publicStatus (Program 1 Workstream A): provider-confirmed
-- visibility, nullable for pre-existing rows (fail closed to NOT_PUBLISHED).
ALTER TABLE provider_publications ADD COLUMN IF NOT EXISTS visibility TEXT;
-- Single verified backfill: the M4 private validation record (Owner-verified
-- PRIVATE in YouTube Studio; no other rows touched, never re-interpreted).
UPDATE provider_publications SET visibility='private'
 WHERE idempotency_key='m4-private-youtube-art-wf-1789233193749-gvydpiah-final-media'
   AND visibility IS NULL;

-- Crash-safe resumable upload sessions keyed by the publishing adapter's stable
-- per-logical-publication marker. A "pending" row stores the provider session
-- URI so a replayed publication resumes the same upload; "completed" is terminal.
CREATE TABLE IF NOT EXISTS provider_upload_sessions (
  marker          TEXT PRIMARY KEY,
  status          TEXT NOT NULL,          -- pending | completed | failed
  provider_id     TEXT,
  session_uri     TEXT,
  publication_id  TEXT,
  url             TEXT,
  published_at    TEXT,
  error_code      TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
ALTER TABLE provider_upload_sessions ADD COLUMN IF NOT EXISTS final_media_artifact_id TEXT;
ALTER TABLE provider_upload_sessions ADD COLUMN IF NOT EXISTS final_media_sha256 TEXT;
ALTER TABLE provider_upload_sessions ADD COLUMN IF NOT EXISTS transport_type TEXT;
ALTER TABLE provider_upload_sessions ADD COLUMN IF NOT EXISTS transport_fingerprint TEXT;

-- Provider-neutral voice catalog. Provider facts and project evaluations are
-- kept separate in JSONB so unknown metadata remains null/unknown.
CREATE TABLE IF NOT EXISTS voice_catalog (
  id                    TEXT PRIMARY KEY,
  provider              TEXT NOT NULL,
  provider_voice_id     TEXT NOT NULL,
  display_name          TEXT,
  model                 TEXT,
  language              TEXT,
  locale                TEXT,
  gender                TEXT,
  accent                TEXT,
  dialect               TEXT,
  style                 TEXT,
  description           TEXT,
  recommended_use_cases JSONB,
  is_available          TEXT NOT NULL,
  is_default            BOOLEAN NOT NULL DEFAULT FALSE,
  automation_eligible  BOOLEAN NOT NULL,
  production_status     TEXT NOT NULL,
  metadata_confidence   TEXT NOT NULL,
  metadata_source       JSONB NOT NULL,
  project_evaluation    JSONB,
  first_verified_at     TEXT,
  last_verified_at      TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE (provider, provider_voice_id, model)
);

-- Governed Visual Iteration V1: creative downstream revision of generated
-- visuals while the approved content package stays valid. First-class domain
-- entity — NOT a media resume, recovery, R9, or content revision. Lineage is
-- frozen explicitly at creation (never "latest" resolution inside the store).
CREATE TABLE IF NOT EXISTS visual_iterations (
  visual_iteration_id         TEXT PRIMARY KEY,
  workflow_id                 TEXT NOT NULL,
  content_id                  TEXT NOT NULL,
  iteration_number            INT NOT NULL,
  source_visual_approval_id   TEXT NOT NULL,
  source_visual_gate_state    TEXT NOT NULL,
  owner_decision              TEXT,
  owner_rationale             TEXT,
  status                      TEXT NOT NULL,
  created_at                  TEXT NOT NULL,
  authorized_at               TEXT,
  completed_at                TEXT,
  source_writer_artifact_id   TEXT,
  source_brand_artifact_id    TEXT,
  source_review_artifact_id   TEXT,
  source_director_artifact_id TEXT,
  source_narration_artifact_id TEXT,
  source_timeline_artifact_id TEXT,
  source_visual_artifact_ids  JSONB NOT NULL DEFAULT '[]',
  source_semantic_qa_artifact_ids JSONB NOT NULL DEFAULT '[]',
  source_technical_qa_artifact_ids JSONB NOT NULL DEFAULT '[]',
  visual_direction_contract_artifact_id TEXT,
  scene_contract_artifact_ids JSONB NOT NULL DEFAULT '[]',
  compiled_prompt_artifact_ids JSONB NOT NULL DEFAULT '[]',
  scenes_to_keep              JSONB NOT NULL DEFAULT '[]',
  scenes_to_regenerate        JSONB NOT NULL DEFAULT '[]',
  proposed_image_budget       INT NOT NULL DEFAULT 0,
  authorized_image_budget     INT NOT NULL DEFAULT 0,
  used_image_budget           INT NOT NULL DEFAULT 0,
  authorization_id            TEXT,
  authorization_evidence      JSONB,
  provider_configuration_snapshot JSONB,
  build_identity_snapshot     JSONB,
  human_gate_policy_snapshot  JSONB,
  prompt_owner_gate_approval_id TEXT,
  updated_at                  TEXT NOT NULL,
  UNIQUE (workflow_id, iteration_number),
  UNIQUE (source_visual_approval_id)
);
CREATE INDEX IF NOT EXISTS idx_visual_iterations_workflow ON visual_iterations (workflow_id);

-- Visual Director execution ledger: canonical append-only aliases for every
-- governed creative-LLM submission. Prevents repeat-collision ambiguity
-- ("Attempt 3" twice): identity is (authorization_ref, submission_ordinal)
-- plus the unique provider-side execution ID. Rows are never updated or
-- deleted; backfilled history is marked as such and never renames artifacts.
CREATE TABLE IF NOT EXISTS visual_director_attempts (
  visual_director_attempt_id TEXT PRIMARY KEY,
  workflow_id                TEXT NOT NULL,
  authorization_ref          TEXT NOT NULL,
  submission_ordinal         INT NOT NULL,
  execution_id               TEXT UNIQUE,
  input_artifact_id          TEXT,
  evidence_artifact_id       TEXT,
  provider                   TEXT,
  requested_model            TEXT,
  actual_model               TEXT,
  transport                  TEXT,
  reasoning_config           JSONB,
  max_tokens                 INT,
  http_status                INT,
  finish_reason              TEXT,
  visible_bytes              INT,
  reasoning_tokens           INT,
  validation_outcome         TEXT,
  canonical_contract_artifact_id TEXT,
  source                     TEXT NOT NULL,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE (authorization_ref, submission_ordinal)
);
CREATE INDEX IF NOT EXISTS idx_visual_director_attempts_workflow ON visual_director_attempts (workflow_id);

-- Platform validation acceptance (in-band PENDING): validation_accepted_for_e2e
-- is the only owner-gated forward that satisfies the platform validation
-- path. It MUST NOT satisfy production publication authorization. This table
-- records the owner's durable acceptance of the current visuals for validation
-- only — with explicit binding to the iteration/contract/prompts/gate/target
-- — and defaults hard to not-production-approved. No migration fabricates a
-- historical acceptance; existing rows stay unclassified.
CREATE TABLE IF NOT EXISTS visual_validation_acceptances (
  acceptance_id           TEXT PRIMARY KEY,
  workflow_id             TEXT NOT NULL,
  visual_iteration_id     TEXT NOT NULL,
  gate_approval_id        TEXT NOT NULL,
  kind                    TEXT NOT NULL DEFAULT 'validation_accepted_for_e2e',
  contract_artifact_id    TEXT,
  prompt_plan_artifact_id TEXT,
  target_capability       TEXT,
  evidence_refs           JSONB NOT NULL DEFAULT '[]',
  decided_at              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  UNIQUE (workflow_id)
);
CREATE INDEX IF NOT EXISTS idx_visual_validation_acceptances_workflow ON visual_validation_acceptances (workflow_id);

-- Strategic Operating Layer V1: first-class governed strategic entities.
-- Lifecycle: DRAFT -> PROPOSED -> ACTIVE -> SUPERSEDED, plus RETIRED.
-- Versions are immutable rows; activation never mutates history (new version
-- -> approval -> activation -> old version superseded). Source file artifacts
-- are referenced, never deleted or rewritten by this layer.
CREATE TABLE IF NOT EXISTS strategic_entities (
  entity_id               TEXT PRIMARY KEY,
  project_id              TEXT NOT NULL,
  entity_type             TEXT NOT NULL,
  entity_key              TEXT NOT NULL,
  version                 INT NOT NULL,
  status                  TEXT NOT NULL,
  payload                 JSONB NOT NULL,
  schema_version          TEXT NOT NULL,
  source_artifact_ids     JSONB NOT NULL DEFAULT '[]',
  supersedes_version      INT,
  created_by              TEXT NOT NULL,
  created_at              TEXT NOT NULL,
  activated_at            TEXT,
  activated_by_approval_id TEXT,
  UNIQUE (project_id, entity_type, entity_key, version)
);
CREATE INDEX IF NOT EXISTS idx_strategic_entities_project ON strategic_entities (project_id, entity_type, entity_key, status);

-- Append-only activation audit: every ACTIVE transition records its approval.
CREATE TABLE IF NOT EXISTS strategic_activations (
  activation_id          TEXT PRIMARY KEY,
  entity_id              TEXT NOT NULL,
  project_id             TEXT NOT NULL,
  entity_type            TEXT NOT NULL,
  entity_key             TEXT NOT NULL,
  version                INT NOT NULL,
  approval_id            TEXT NOT NULL,
  activated_by           TEXT NOT NULL,
  activated_at           TEXT NOT NULL,
  previous_active_version INT
);
CREATE INDEX IF NOT EXISTS idx_strategic_activations_entity ON strategic_activations (entity_id, activated_at DESC);

-- Immutable strategic context snapshots frozen at execution boundary.
CREATE TABLE IF NOT EXISTS strategic_context_snapshots (
  snapshot_id      TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  task_class       TEXT NOT NULL,
  agent_id         TEXT,
  entity_refs      JSONB NOT NULL,
  context          JSONB NOT NULL,
  context_hash     TEXT NOT NULL,
  resolver_version TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_strategic_snapshots_project ON strategic_context_snapshots (project_id, created_at DESC);

-- Request-iteration continuation audit: which Owner REQUEST_ITERATION
-- decision (with its rationale snapshot) produced which revised PROPOSED
-- version. Append-only; one row per new version slot. Grants nothing.
CREATE TABLE IF NOT EXISTS strategic_iterations (
  iteration_id       TEXT PRIMARY KEY,
  project_id         TEXT NOT NULL,
  entity_type        TEXT NOT NULL,
  entity_key         TEXT NOT NULL,
  prior_version      INT NOT NULL,
  new_entity_id      TEXT NOT NULL,
  new_version        INT NOT NULL,
  source_decision_id TEXT NOT NULL,
  owner_rationale    TEXT NOT NULL,
  created_by         TEXT NOT NULL,
  created_at         TEXT NOT NULL,
  UNIQUE (project_id, entity_type, entity_key, new_version)
);
CREATE INDEX IF NOT EXISTS idx_strategic_iterations_decision ON strategic_iterations (source_decision_id);

-- Strategic lineage pointer on execution provenance (nullable: pre-layer
-- executions simply have no snapshot; history is never backfilled).
ALTER TABLE execution_provenance ADD COLUMN IF NOT EXISTS strategic_snapshot_id TEXT;

-- Governed learning loop (M2). Append-only: no UPDATE/DELETE paths exist in
-- the store. Idempotency via deterministic IDs + ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS performance_observations (
  observation_id       TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL,
  workflow_id          TEXT,
  artifact_id          TEXT,
  publication_id       TEXT,
  experiment_id        TEXT,
  lineage_kind         TEXT NOT NULL,
  window_start         TEXT,
  window_end           TEXT,
  metrics              JSONB NOT NULL,
  metric_provenance    TEXT NOT NULL,
  transport_provenance TEXT NOT NULL,
  observed_at          TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_perf_obs_project ON performance_observations (project_id, created_at DESC);
-- Program 5: channel attribution on observations (nullable; absent stays absent).
-- Kept adjacent to the table creation so fresh-database bootstrap applies in order.
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS channel_id TEXT;
-- Program 4 canonical media/publication join. Nullable for historical and
-- validation-fixture observations; required by the governed-run store contract.
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS content_id TEXT;
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS published_report_id TEXT;
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS final_media_sha256 TEXT;
ALTER TABLE performance_observations ADD COLUMN IF NOT EXISTS analytics_provider_id TEXT;
CREATE TABLE IF NOT EXISTS learning_records (
  learning_id            TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL,
  source_observation_ids JSONB NOT NULL,
  experiment_id          TEXT,
  finding                TEXT NOT NULL,
  evidence               JSONB NOT NULL,
  validation_only        INTEGER NOT NULL DEFAULT 0,
  supersedes             TEXT,
  created_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learning_project ON learning_records (project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS next_cycle_recommendations (
  recommendation_id TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  learning_id       TEXT NOT NULL,
  proposal          TEXT NOT NULL,
  rationale         TEXT NOT NULL,
  evidence          JSONB NOT NULL,
  requires_owner_decision INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ncr_project ON next_cycle_recommendations (project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS next_cycle_proposals (
  proposal_id       TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL,
  recommendation_id TEXT NOT NULL,
  summary           TEXT NOT NULL,
  approval_id       TEXT,
  status            TEXT NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ncp_project ON next_cycle_proposals (project_id, created_at DESC);

-- Program 2 Workstream A: canonical content items (business objects).
-- References canonical truth; duplicates nothing. Additive only.
CREATE TABLE IF NOT EXISTS content_items (
  content_id       TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL,
  channel          TEXT NOT NULL DEFAULT 'youtube',
  format           TEXT NOT NULL DEFAULT 'short',
  title            TEXT NOT NULL,
  objective        TEXT NOT NULL,
  topic            TEXT,
  notes            TEXT,
  constraints      TEXT,
  seed_artifact_id TEXT,
  workflow_id      TEXT,
  experiment_id    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_project ON content_items (project_id, created_at DESC);
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS production_brief JSONB NOT NULL DEFAULT '{}';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS publication_metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS final_review_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS canonical_final_artifact_id TEXT;

CREATE TABLE IF NOT EXISTS content_revision_requests (
  revision_id TEXT PRIMARY KEY, content_id TEXT NOT NULL, project_id TEXT NOT NULL,
  workflow_id TEXT, layer TEXT NOT NULL, target_artifact_id TEXT, previous_artifact_id TEXT,
  owner_feedback TEXT NOT NULL, reason TEXT NOT NULL, resulting_action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_revision_content ON content_revision_requests (content_id, created_at DESC);
CREATE TABLE IF NOT EXISTS content_visual_quality_reviews (
  review_id TEXT PRIMARY KEY, content_id TEXT NOT NULL, project_id TEXT NOT NULL,
  workflow_id TEXT, artifact_id TEXT NOT NULL, scene_id TEXT, technical_qa JSONB NOT NULL,
  semantic_qa TEXT NOT NULL, semantic_notes TEXT, owner_acceptance TEXT NOT NULL DEFAULT 'PENDING',
  owner_feedback TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (content_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS idx_content_visual_review ON content_visual_quality_reviews (content_id, created_at DESC);
CREATE TABLE IF NOT EXISTS content_review_decisions (
  decision_id TEXT PRIMARY KEY, content_id TEXT NOT NULL, project_id TEXT NOT NULL,
  workflow_id TEXT, decision TEXT NOT NULL, rationale TEXT NOT NULL,
  final_artifact_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_review_decision ON content_review_decisions (content_id, created_at DESC);
CREATE TABLE IF NOT EXISTS publication_preparations (
  preparation_id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE,
  content_id TEXT NOT NULL, project_id TEXT NOT NULL, workflow_id TEXT NOT NULL,
  channel_id TEXT NOT NULL, binding_id TEXT, artifact_id TEXT NOT NULL,
  visibility TEXT NOT NULL, metadata JSONB NOT NULL, route_state TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PREPARED', authorization_approval_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_publication_preparation_content ON publication_preparations (content_id, created_at DESC);

-- Program 3 Content Factory V2: canonical subject/character identity graph.
-- Metadata only: image bytes stay in canonical artifacts, referenced by ID.
-- Append-only ethos: approvals and supersessions recorded, never rewritten.
CREATE TABLE IF NOT EXISTS subject_profiles (
  subject_id   TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  description  TEXT NOT NULL,
  traits       JSONB NOT NULL DEFAULT '{}',
  wardrobe     JSONB NOT NULL DEFAULT '{}',
  negatives    JSONB NOT NULL DEFAULT '[]',
  style_context TEXT,
  voice_id     TEXT,
  status       TEXT NOT NULL DEFAULT 'DRAFT',
  approved_by  TEXT,
  approved_at  TEXT,
  approval_rationale TEXT,
  supersedes   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subject_project ON subject_profiles (project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS subject_reference_assets (
  reference_id TEXT PRIMARY KEY,
  subject_id   TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  artifact_id  TEXT NOT NULL,
  reference_kind TEXT NOT NULL,
  approved     INTEGER NOT NULL DEFAULT 0,
  approved_by  TEXT,
  approved_at  TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE (subject_id, artifact_id, reference_kind)
);
CREATE INDEX IF NOT EXISTS idx_refasset_subject ON subject_reference_assets (subject_id);
-- Program 3 Scene System V2: durable scene specs with subject bindings.
-- One row per (content, scene); idempotent upsert by callers is allowed,
-- but generation inputs are never silently downgraded downstream.
CREATE TABLE IF NOT EXISTS scene_specs (
  scene_id     TEXT NOT NULL,
  content_id   TEXT NOT NULL,
  project_id   TEXT NOT NULL,
  sequence     INTEGER NOT NULL,
  duration_ms  INTEGER,
  purpose      TEXT,
  script_ref   TEXT,
  visual       TEXT,
  subjects     JSONB NOT NULL DEFAULT '[]',
  environment  TEXT,
  shot         TEXT,
  camera_angle TEXT,
  movement     TEXT,
  continuity   JSONB NOT NULL DEFAULT '[]',
  reference_ids JSONB NOT NULL DEFAULT '[]',
  intent       JSONB NOT NULL DEFAULT '{}',
  audio_ref    TEXT,
  status       TEXT NOT NULL DEFAULT 'PLANNED',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (content_id, scene_id)
);
CREATE INDEX IF NOT EXISTS idx_scene_content ON scene_specs (content_id, sequence);

-- Program 6 Governed Automation: canonical automation domain. Additive only.
-- Fail-closed defaults are enforced in the store (automation.ts), not in DDL:
-- no policy row == automation DISABLED for that project. Existing projects
-- never become automated by migration. Morroway has no policy row unless an
-- Owner explicitly creates one.
--  - automation_policies: one row per project describing how far automation
--    may progress (level, allowed/human-gated operation classes, provider,
--    budget, publication, next-cycle policy).
--  - automation_call_budgets: count-based hard budgets per project+call-kind.
--    Monetary price stays UNKNOWN; enforcement is on counts.
--  - automation_jobs: governed scheduler foundation for INTERNAL platform
--    jobs only (evaluation, checkpoints, resume, measurement scheduling,
--    learning, recovery). Never a social-publishing scheduler.
--  - automation_events: append-only audit trail answering WHAT/WHY/WHICH
--    policy/project/authority/budget/result for every automatic action.
--  - automation_attention: deterministic Owner attention items (no LLM
--    sentiment). Resolved explicitly, never auto-cleared by new work.
CREATE TABLE IF NOT EXISTS automation_policies (
  project_id         TEXT PRIMARY KEY,
  enabled            INTEGER NOT NULL DEFAULT 0,
  level              TEXT NOT NULL DEFAULT 'L0_MANUAL',
  allowed_ops        JSONB NOT NULL DEFAULT '[]',
  human_gated_ops    JSONB NOT NULL DEFAULT '[]',
  provider_policy    JSONB NOT NULL DEFAULT '{"mode":"DENY_ALL"}',
  publication_policy TEXT NOT NULL DEFAULT 'PREPARE_ONLY',
  next_cycle_policy  TEXT NOT NULL DEFAULT 'OWNER_START_ONLY',
  updated_by         TEXT NOT NULL DEFAULT 'owner',
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_call_budgets (
  project_id   TEXT NOT NULL,
  call_kind    TEXT NOT NULL,
  limit_count  INTEGER NOT NULL,
  used_count   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (project_id, call_kind)
);
ALTER TABLE automation_call_budgets ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 0;
ALTER TABLE automation_call_budgets ADD COLUMN IF NOT EXISTS limit_kind TEXT NOT NULL DEFAULT 'HARD';
ALTER TABLE automation_call_budgets ADD COLUMN IF NOT EXISTS cost_kind TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE automation_call_budgets ADD COLUMN IF NOT EXISTS known_unit_cost_usd NUMERIC;

INSERT INTO channels (channel_id,project_id,platform,external_channel_id,handle,display_name,status,capabilities,verified_at,verification_note,created_at,updated_at)
SELECT 'channel-morroway-youtube','morroway','youtube','UCA5ECzcK_96akfUT5fQUT3A','@morrowaystudio','Morroway','VERIFIED',
       '{"publishing":true,"analytics":true,"source":"OWNER_CONFIRMED_ENABLEMENT_V1"}'::jsonb,
       '2026-09-24T00:00:00.000Z','Owner-confirmed canonical identity; restored locally without provider call.',
       '2026-09-24T00:00:00.000Z','2026-09-24T00:00:00.000Z'
WHERE EXISTS (SELECT 1 FROM control_projects WHERE project_id='morroway')
  AND NOT EXISTS (SELECT 1 FROM channels WHERE project_id='morroway' AND platform='youtube' AND external_channel_id='UCA5ECzcK_96akfUT5fQUT3A');

INSERT INTO automation_call_budgets (project_id,call_kind,limit_count,used_count,updated_at,max_retries,limit_kind,cost_kind,known_unit_cost_usd)
SELECT 'morroway',v.call_kind,v.limit_count,0,'2026-09-24T00:00:00.000Z',v.max_retries,'HARD',v.cost_kind,v.known_unit_cost_usd
FROM (VALUES
  ('research',1,0,'UNKNOWN',NULL::numeric), ('text_agent',5,0,'UNKNOWN',NULL::numeric),
  ('image_generation',3,0,'KNOWN',0.005::numeric), ('video_generation',3,0,'UNKNOWN',NULL::numeric),
  ('voice_generation',1,0,'UNKNOWN',NULL::numeric), ('private_upload',1,0,'UNKNOWN',NULL::numeric)
) AS v(call_kind,limit_count,max_retries,cost_kind,known_unit_cost_usd)
WHERE EXISTS (SELECT 1 FROM control_projects WHERE project_id='morroway')
ON CONFLICT (project_id,call_kind) DO NOTHING;
CREATE TABLE IF NOT EXISTS automation_jobs (
  job_id          TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL,
  job_type        TEXT NOT NULL,
  due_at          TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'PENDING',
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  idempotency_key TEXT NOT NULL,
  payload         JSONB NOT NULL DEFAULT '{}',
  last_outcome    JSONB,
  next_eligible_at TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_jobs_idem ON automation_jobs (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_automation_jobs_project ON automation_jobs (project_id, state, due_at);
CREATE TABLE IF NOT EXISTS automation_events (
  event_id      TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,
  subject_type  TEXT,
  subject_id    TEXT,
  what          TEXT NOT NULL,
  why           JSONB NOT NULL DEFAULT '{}',
  policy_ref    JSONB NOT NULL DEFAULT '{}',
  authority_ref JSONB NOT NULL DEFAULT '{}',
  budget_ref    JSONB NOT NULL DEFAULT '{}',
  result        JSONB NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_events_project ON automation_events (project_id, created_at DESC);
CREATE TABLE IF NOT EXISTS automation_attention (
  attention_id  TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,
  subject_type  TEXT,
  subject_id    TEXT,
  detail        JSONB NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'OPEN',
  created_at    TEXT NOT NULL,
  resolved_at   TEXT
);
CREATE INDEX IF NOT EXISTS idx_automation_attention_project ON automation_attention (project_id, status, created_at DESC);

-- OpenRouter Model Intelligence V1: current catalog is mutable; price snapshots are immutable evidence.
CREATE TABLE IF NOT EXISTS provider_model_catalog_refreshes (
  refresh_id TEXT PRIMARY KEY, provider TEXT NOT NULL, source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL,
  response_hash TEXT NOT NULL, model_count INTEGER NOT NULL, metadata JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS provider_model_price_snapshots (
  price_snapshot_id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_model_id TEXT NOT NULL, refresh_id TEXT NOT NULL,
  retrieved_at TEXT NOT NULL, pricing_raw JSONB NOT NULL, pricing_normalized JSONB NOT NULL, pricing_hash TEXT NOT NULL,
  UNIQUE (provider, provider_model_id, pricing_hash)
);
CREATE TABLE IF NOT EXISTS provider_model_catalog (
  provider TEXT NOT NULL, provider_model_id TEXT NOT NULL, canonical_slug TEXT, canonical_name TEXT NOT NULL, author TEXT,
  description TEXT, context_length INTEGER, architecture JSONB NOT NULL DEFAULT '{}', input_modalities JSONB NOT NULL DEFAULT '[]', output_modalities JSONB NOT NULL DEFAULT '[]', supported_parameters JSONB NOT NULL DEFAULT '[]', capabilities JSONB NOT NULL DEFAULT '{}', benchmark_metadata JSONB,
  pricing_raw JSONB NOT NULL DEFAULT '{}', price_class TEXT NOT NULL DEFAULT 'UNKNOWN', availability TEXT NOT NULL DEFAULT 'AVAILABLE',
  source_url TEXT NOT NULL, retrieved_at TEXT NOT NULL, refresh_id TEXT NOT NULL, raw_metadata JSONB NOT NULL,
  content_hash TEXT NOT NULL, pricing_hash TEXT NOT NULL, capability_hash TEXT NOT NULL, description_hash TEXT NOT NULL, current_price_snapshot_id TEXT,
  PRIMARY KEY (provider, provider_model_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_model_catalog_price ON provider_model_catalog (provider, availability, price_class);
CREATE TABLE IF NOT EXISTS amf_model_evaluations (
  evaluation_id TEXT PRIMARY KEY, provider TEXT NOT NULL, provider_model_id TEXT NOT NULL, benchmark_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'NOT_EVALUATED', evidence JSONB NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
ALTER TABLE execution_provenance ADD COLUMN IF NOT EXISTS provider_model_snapshot_id TEXT;
ALTER TABLE execution_provenance ADD COLUMN IF NOT EXISTS estimated_cost NUMERIC;
ALTER TABLE execution_provenance ADD COLUMN IF NOT EXISTS actual_calculable_cost NUMERIC;
ALTER TABLE execution_provenance ADD COLUMN IF NOT EXISTS provider_billed_cost NUMERIC;
ALTER TABLE execution_provenance ADD COLUMN IF NOT EXISTS cost_evidence JSONB;

-- AMF-MRB execution runtime. Benchmark state is deliberately isolated from production workflows/routing.
CREATE TABLE IF NOT EXISTS model_benchmark_runs (
  benchmark_run_id TEXT PRIMARY KEY, dataset_version TEXT NOT NULL, catalog_snapshot_id TEXT NOT NULL,
  candidate_plan_version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT,
  completed_at TEXT, authorization_state TEXT NOT NULL DEFAULT 'NOT_AUTHORIZED', hard_spend_cap_usd NUMERIC NOT NULL,
  reserved_spend_usd NUMERIC NOT NULL DEFAULT 0, calculable_spend_usd NUMERIC NOT NULL DEFAULT 0,
  provider_billed_spend_usd NUMERIC, current_stage TEXT, stop_reason TEXT, created_by TEXT NOT NULL,
  provenance JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS model_benchmark_fixtures (
  dataset_version TEXT NOT NULL, task_id TEXT NOT NULL, fixture_version TEXT NOT NULL, role TEXT NOT NULL,
  system_instructions TEXT NOT NULL, user_prompt TEXT NOT NULL, structured_inputs JSONB NOT NULL,
  constraints JSONB NOT NULL, expected_output_contract JSONB NOT NULL, evaluation_contract JSONB NOT NULL,
  max_input_tokens INTEGER NOT NULL, max_output_tokens INTEGER NOT NULL, fixture_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, provenance JSONB NOT NULL DEFAULT '{}', PRIMARY KEY(dataset_version,task_id)
);
CREATE TABLE IF NOT EXISTS model_benchmark_executions (
  execution_id TEXT PRIMARY KEY, benchmark_run_id TEXT NOT NULL REFERENCES model_benchmark_runs(benchmark_run_id),
  stage TEXT NOT NULL, task_id TEXT NOT NULL, role TEXT NOT NULL, agent TEXT NOT NULL, exact_model_id TEXT NOT NULL,
  normalized_model_family TEXT NOT NULL, route_variant TEXT NOT NULL, provider TEXT NOT NULL, fixture_version TEXT NOT NULL,
  prompt_hash TEXT NOT NULL, input_hash TEXT NOT NULL, expected_contract_version TEXT NOT NULL,
  price_snapshot_id TEXT REFERENCES provider_model_price_snapshots(price_snapshot_id), status TEXT NOT NULL,
  attempt_number INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT NOT NULL UNIQUE, reserved_cost NUMERIC,
  estimated_cost NUMERIC, actual_calculable_cost NUMERIC, provider_billed_cost NUMERIC, started_at TEXT,
  completed_at TEXT, latency_ms INTEGER, input_tokens INTEGER, output_tokens INTEGER, reasoning_tokens INTEGER,
  provider_usage JSONB, failure_class TEXT, failure_message_sanitized TEXT, raw_response_artifact_id TEXT,
  normalized_response_artifact_id TEXT, evaluation_id TEXT, provenance JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_model_benchmark_exec_run ON model_benchmark_executions(benchmark_run_id,stage,status);
CREATE TABLE IF NOT EXISTS model_benchmark_artifacts (
  artifact_id TEXT PRIMARY KEY, benchmark_run_id TEXT NOT NULL REFERENCES model_benchmark_runs(benchmark_run_id),
  execution_id TEXT REFERENCES model_benchmark_executions(execution_id), task_id TEXT, exact_model_id TEXT,
  dataset_version TEXT NOT NULL, artifact_kind TEXT NOT NULL, content JSONB NOT NULL, content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL, provenance JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS model_benchmark_evidence (
  evaluation_id TEXT PRIMARY KEY, benchmark_run_id TEXT NOT NULL REFERENCES model_benchmark_runs(benchmark_run_id),
  execution_id TEXT NOT NULL REFERENCES model_benchmark_executions(execution_id), task_id TEXT NOT NULL,
  exact_model_id TEXT NOT NULL, hard_fail BOOLEAN NOT NULL DEFAULT FALSE, weighted_score NUMERIC,
  dimension_scores JSONB NOT NULL, deterministic_checks JSONB NOT NULL, evidence JSONB NOT NULL,
  created_at TEXT NOT NULL, provenance JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS model_benchmark_blind_candidates (
  benchmark_run_id TEXT NOT NULL REFERENCES model_benchmark_runs(benchmark_run_id), task_id TEXT NOT NULL,
  blind_candidate_id TEXT NOT NULL, execution_id TEXT NOT NULL REFERENCES model_benchmark_executions(execution_id),
  mapping_secret_hash TEXT NOT NULL, finalized BOOLEAN NOT NULL DEFAULT FALSE, created_at TEXT NOT NULL,
  PRIMARY KEY(benchmark_run_id,task_id,blind_candidate_id), UNIQUE(benchmark_run_id,task_id,execution_id)
);
CREATE TABLE IF NOT EXISTS model_benchmark_owner_reviews (
  review_id TEXT PRIMARY KEY, benchmark_run_id TEXT NOT NULL, task_id TEXT NOT NULL, blind_candidate_id TEXT NOT NULL,
  dimension_scores JSONB NOT NULL, notes TEXT, reviewed_at TEXT NOT NULL, reviewer_type TEXT NOT NULL,
  finalized BOOLEAN NOT NULL DEFAULT FALSE, weighted_score NUMERIC, qualification TEXT,
  provenance JSONB NOT NULL DEFAULT '{}',
  FOREIGN KEY(benchmark_run_id,task_id,blind_candidate_id) REFERENCES model_benchmark_blind_candidates(benchmark_run_id,task_id,blind_candidate_id)
);
ALTER TABLE model_benchmark_owner_reviews ADD COLUMN IF NOT EXISTS weighted_score NUMERIC;
ALTER TABLE model_benchmark_owner_reviews ADD COLUMN IF NOT EXISTS qualification TEXT;
CREATE TABLE IF NOT EXISTS model_benchmark_finalists (
  benchmark_run_id TEXT NOT NULL REFERENCES model_benchmark_runs(benchmark_run_id), task_id TEXT NOT NULL,
  exact_model_id TEXT NOT NULL, rank INTEGER NOT NULL, decision TEXT NOT NULL, reason JSONB NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY(benchmark_run_id,task_id,exact_model_id)
);
-- Versioned, proposal-derived production model routing. This is distinct from benchmark evidence.
CREATE TABLE IF NOT EXISTS production_model_routing_versions (
  routing_version_id TEXT PRIMARY KEY, profile TEXT NOT NULL, scope_type TEXT NOT NULL, project_id TEXT,
  benchmark_run_id TEXT NOT NULL REFERENCES model_benchmark_runs(benchmark_run_id), dataset_version TEXT NOT NULL,
  decision_source TEXT NOT NULL, owner_decision TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT FALSE,
  activated_at TEXT, deactivated_at TEXT, provenance JSONB NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_production_model_routing_scope
  ON production_model_routing_versions(scope_type, COALESCE(project_id,'')) WHERE active;
CREATE TABLE IF NOT EXISTS production_model_routing_entries (
  routing_version_id TEXT NOT NULL REFERENCES production_model_routing_versions(routing_version_id), role TEXT NOT NULL,
  primary_model_id TEXT, fallback_model_id TEXT, economy_model_id TEXT, premium_escalation_model_id TEXT,
  price_snapshot_ids JSONB NOT NULL DEFAULT '{}', evidence JSONB NOT NULL DEFAULT '{}', active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(routing_version_id,role)
);

-- Pilot Phase call envelopes are configuration ceilings, not execution
-- authority. Reservations are acquired atomically before provider transport.
CREATE TABLE IF NOT EXISTS production_phase_call_budgets (
  project_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  call_kind TEXT NOT NULL,
  limit_count INTEGER NOT NULL CHECK (limit_count >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  consumed_count INTEGER NOT NULL DEFAULT 0 CHECK (consumed_count >= 0),
  max_retries INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id,phase,call_kind)
);
CREATE TABLE IF NOT EXISTS production_call_reservations (
  reservation_id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  phase TEXT NOT NULL,
  stage TEXT NOT NULL,
  role TEXT NOT NULL,
  call_kind TEXT NOT NULL,
  call_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  provider_submission_started BOOLEAN NOT NULL DEFAULT FALSE,
  routing_version_id TEXT,
  exact_model_id TEXT,
  price_snapshot_id TEXT,
  estimated_cost_usd NUMERIC,
  calculable_cost_usd NUMERIC,
  provider_billed_cost_usd NUMERIC,
  provider_billed_cost_kind TEXT NOT NULL DEFAULT 'UNKNOWN',
  reserved_at TEXT NOT NULL,
  reconciled_at TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_production_call_reservations_workflow
  ON production_call_reservations(workflow_id,reserved_at);

-- Program 5 Owner Autonomy.  These rows record Owner-facing product actions;
-- they do not duplicate workflow, routing, budget, channel, or learning truth.
-- The canonical domain tables remain authoritative and this log supplies the
-- immutable who/when/why envelope required by the control platform.
CREATE TABLE IF NOT EXISTS owner_control_audit_events (
  event_id       TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  action         TEXT NOT NULL,
  subject_type   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  actor          TEXT NOT NULL,
  reason         TEXT NOT NULL,
  before_state   JSONB,
  after_state    JSONB,
  metadata       JSONB NOT NULL DEFAULT '{}',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_owner_control_audit_project
  ON owner_control_audit_events(project_id,created_at DESC);

CREATE TABLE IF NOT EXISTS next_cycle_owner_decisions (
  decision_id    TEXT PRIMARY KEY,
  proposal_id    TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  decision       TEXT NOT NULL CHECK (decision IN ('APPROVE','REJECT','DEFER','REQUEST_CHANGES')),
  rationale      TEXT NOT NULL,
  actor          TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  UNIQUE(proposal_id)
);
CREATE INDEX IF NOT EXISTS idx_next_cycle_owner_decisions_project
  ON next_cycle_owner_decisions(project_id,created_at DESC);
INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at)
SELECT 'morroway','PRE_MEDIA_PHASE',v.call_kind,v.limit_count,0,0,0,TRUE,'2026-09-25T00:00:00.000Z'
FROM (VALUES ('research',1),('text_agent',10)) AS v(call_kind,limit_count)
WHERE EXISTS (SELECT 1 FROM control_projects WHERE project_id='morroway')
ON CONFLICT(project_id,phase,call_kind) DO NOTHING;
`;
