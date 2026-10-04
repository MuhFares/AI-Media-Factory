import type pg from "pg";

export const WAN_SUPERVISED_EXECUTION_MIGRATION_ID = "wan-supervised-single-scene-execution-v1";

export const WAN_SUPERVISED_EXECUTION_DDL = `
CREATE TABLE IF NOT EXISTS wan_supervised_executions (
  wan_execution_id TEXT PRIMARY KEY,
  idempotency_identity TEXT NOT NULL UNIQUE,
  project_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  workflow_id TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  source_visual_artifact_id TEXT NOT NULL,
  source_visual_sha256 TEXT NOT NULL,
  client_execution_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  endpoint_id TEXT NOT NULL,
  model_config JSONB NOT NULL DEFAULT '{}',
  provider_job_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('AUTHORIZED','SUBMISSION_STARTED','ACKNOWLEDGED','GENERATING','COMPLETED','FAILED','MANUAL_RECONCILIATION_REQUIRED')),
  owner_actor TEXT NOT NULL,
  owner_rationale TEXT NOT NULL,
  authorization_id TEXT NOT NULL UNIQUE,
  budget_claim_id TEXT NOT NULL UNIQUE,
  budget_state TEXT NOT NULL CHECK (budget_state IN ('RESERVED','CONSUMED','RELEASED')),
  provider_post_count INTEGER NOT NULL DEFAULT 0 CHECK (provider_post_count BETWEEN 0 AND 1),
  submission_started_at TEXT,
  acknowledged_at TEXT,
  completed_at TEXT,
  failure_class TEXT,
  reconciliation_state TEXT NOT NULL DEFAULT 'NONE',
  output_evidence JSONB,
  claimed_by_worker TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wan_supervised_unresolved_scene
  ON wan_supervised_executions(project_id,workflow_id,scene_id)
  WHERE state NOT IN ('COMPLETED','FAILED');
CREATE INDEX IF NOT EXISTS idx_wan_supervised_claim
  ON wan_supervised_executions(state,created_at);
CREATE INDEX IF NOT EXISTS idx_wan_supervised_project
  ON wan_supervised_executions(project_id,updated_at DESC);
`;

export async function applyWanSupervisedExecutionMigration(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(WAN_SUPERVISED_EXECUTION_DDL);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
