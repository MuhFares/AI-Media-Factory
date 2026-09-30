import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createPool, migrate, ArtifactIntegrityRepairStore, artifactPayloadHash,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

test("G/H/I: research artifact repair is audited, idempotent, state-preserving, and budget-neutral", async () => {
  assertTestDatabaseIsolation();
  const pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  const suffix = randomUUID();
  const workflowId = `wf-artifact-repair-${suffix}`;
  const artifactId = `art-${workflowId}-research`;
  const repairId = `repair-${suffix}`;
  const now = new Date().toISOString();
  const prior = { candidateStories: [{ candidateId: "candidate-1", supportingEvidenceIds: [] }], evidenceQuality: { viableCandidates: 1 } };
  const repaired = { candidateStories: [{ candidateId: "candidate-1", supportingEvidenceIds: ["evidence-1"] }], evidenceQuality: { viableCandidates: 0 } };
  try {
    await pool.query(
      `INSERT INTO workflow_instances(workflow_id,definition_id,definition_version,state,context,ready,created_at,updated_at)
       VALUES($1,'test',1,'PAUSED','{}','[]',$2,$2)`, [workflowId, now],
    );
    await pool.query(
      `INSERT INTO workflow_steps(workflow_id,step_id,status,attempts) VALUES($1,'research','COMPLETED',1)`, [workflowId],
    );
    await pool.query(
      `INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at)
       VALUES($1,$2,'research_report','research','corr','completed',$3::jsonb,'application/json','v1',$4)`,
      [artifactId, workflowId, JSON.stringify(prior), now],
    );
    await pool.query(
      `INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at)
       VALUES($1,'PRE_MEDIA_PHASE','research',11,0,11,0,TRUE,$2),($1,'PRE_MEDIA_PHASE','text_agent',23,0,23,0,TRUE,$2)
       ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=EXCLUDED.limit_count,reserved_count=0,consumed_count=EXCLUDED.consumed_count,updated_at=EXCLUDED.updated_at`,
      [workflowId, now],
    );
    const beforeBudget = await pool.query(`SELECT call_kind,limit_count,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id=$1 ORDER BY call_kind`, [workflowId]);
    const store = new ArtifactIntegrityRepairStore(pool);
    const input = {
      repairId, artifactId, workflowId, recoveryExecutionId: `recovery-${suffix}`,
      repairKind: "RESEARCH_LINEAGE_AND_GATE_CONSISTENCY_V1",
      authorizationRef: "OWNER:MORROWAY_RESEARCH_V2_ARTIFACT_LINEAGE_AND_GATE_CONSISTENCY_REMEDIATION_V1",
      evidenceRef: "provider-free-test", expectedPriorPayloadHash: artifactPayloadHash(prior), repairedPayload: repaired,
    };
    const first = await store.repairResearchArtifact(input);
    const replay = await store.repairResearchArtifact(input);
    assert.equal(first.outcome, "APPLIED");
    assert.equal(first.mutated, true);
    assert.equal(replay.outcome, "ALREADY_REPAIRED");
    assert.equal(replay.mutated, false);
    const history = await pool.query(`SELECT prior_payload,repaired_payload,receipt FROM artifact_integrity_repairs WHERE repair_id=$1`, [repairId]);
    assert.equal(history.rowCount, 1);
    assert.deepEqual(history.rows[0].prior_payload, prior);
    assert.equal(history.rows[0].receipt.mode, "AUDITED_IN_PLACE_REVISION");
    const state = await pool.query(`SELECT state FROM workflow_instances WHERE workflow_id=$1`, [workflowId]);
    const step = await pool.query(`SELECT status FROM workflow_steps WHERE workflow_id=$1 AND step_id='research'`, [workflowId]);
    assert.equal(state.rows[0].state, "PAUSED");
    assert.equal(step.rows[0].status, "COMPLETED");
    const afterBudget = await pool.query(`SELECT call_kind,limit_count,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id=$1 ORDER BY call_kind`, [workflowId]);
    assert.deepEqual(afterBudget.rows, beforeBudget.rows);
  } finally {
    await pool.query(`DELETE FROM artifact_integrity_repairs WHERE workflow_id=$1`, [workflowId]);
    await pool.query(`DELETE FROM artifacts WHERE workflow_id=$1`, [workflowId]);
    await pool.query(`DELETE FROM workflow_steps WHERE workflow_id=$1`, [workflowId]);
    await pool.query(`DELETE FROM workflow_instances WHERE workflow_id=$1`, [workflowId]);
    await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=$1`, [workflowId]);
    await pool.end();
  }
});
