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
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
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
`;