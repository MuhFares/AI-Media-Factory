import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createPool,
  migrate,
  ResearchTerminalReconciliationStore,
  assertTerminalNonAdvancingSynthesis,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

async function seed(pool) {
  const suffix = randomUUID();
  const projectId = `project-terminal-${suffix}`;
  const contentId = `content-terminal-${suffix}`;
  const workflowId = `wf-terminal-${suffix}`;
  const correlationId = `corr-terminal-${suffix}`;
  const recoveryExecutionId = `recovery-terminal-${suffix}`;
  const synthesisResponseId = `gen-terminal-${suffix}`;
  const synthesisFingerprint = "a".repeat(64);
  const now = Date.now();
  const iso = (offset) => new Date(now + offset).toISOString();
  const synthesis = {
    reportId: `report-${suffix}`,
    taskId: "research-research",
    stage: "research",
    summary: "The available material does not substantiate the proposed historical scene.",
    candidateStories: [],
    sources: [],
    citations: [],
    confidence: 0.03,
    evidenceRisks: ["The scene lacks relevant source support."],
    status: "insufficient_evidence",
  };
  await pool.query(
    `INSERT INTO workflow_instances(workflow_id,definition_id,definition_version,state,context,ready,created_at,updated_at)
     VALUES($1,'test',1,'FAILED',$2::jsonb,'[]'::jsonb,$3,$3)`,
    [workflowId, JSON.stringify({ brandId: projectId, workflowId, correlationId, data: { projectId, contentId, currentStage: "research" }, outputs: {} }), iso(0)],
  );
  for (const [stepId, status] of [["research", "failed"], ["ceo-recommendation", "pending"], ["planner-synthesis", "pending"], ["writer", "pending"], ["scenes", "pending"], ["visual-direction", "pending"]]) {
    await pool.query(`INSERT INTO workflow_steps(workflow_id,step_id,status,attempts,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6)`,
      [workflowId, stepId, status, stepId === "research" ? 1 : 0, stepId === "research" ? iso(1) : null, stepId === "research" ? iso(9) : null]);
  }
  await pool.query(
    `INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at)
     VALUES($1,$2,'execution_plan','orchestrator',$3,'completed','{}'::jsonb,'application/json','1',$4)`,
    [`art-${workflowId}-orchestrator`, workflowId, correlationId, iso(0)],
  );
  const job = await pool.query(
    `INSERT INTO workflow_jobs(workflow_id,submission_key,status,attempts,error,created_at,updated_at)
     VALUES($1,$2,'failed',1,'workflow ended FAILED',$3,$3) RETURNING job_id`,
    [workflowId, `submission-${suffix}`, iso(0)],
  );
  const sourceJobId = Number(job.rows[0].job_id);
  await pool.query(
    `INSERT INTO workflow_recovery_dispatches
     (authorization_key,workflow_id,submission_key,recovery_execution_id,recovery_of_execution_id,original_execution_id,
      recovery_reason,authorization_status,job_id,created_at,dispatch_status)
     VALUES($1,$2,$3,$4,$5,$5,'fixture','OWNER_APPROVED',$6,$7,'DISPATCHED')`,
    [`auth-${suffix}`, workflowId, `submission-${suffix}`, recoveryExecutionId, `original-${suffix}`, sourceJobId, iso(0)],
  );
  await pool.query(
    `INSERT INTO execution_provenance
     (execution_id,workflow_id,correlation_id,agent_id,stage,capability,provider,model,runtime,prompt_version,
      configuration_fingerprint,started_at,completed_at,latency_ms,status,usage,cost_kind,cost,currency,artifact_ids,
      parent_execution_ids,attempt_number,provider_request_id,error_classification,configuration)
     VALUES($1,$2,$3,'research','research',NULL,NULL,NULL,'node','v1','fixture',$4,$5,10,'failed','{}'::jsonb,
      'UNKNOWN',NULL,NULL,'[]'::jsonb,'[]'::jsonb,1,$6,'LOCAL_EXECUTION_FAILED','{}'::jsonb)`,
    [recoveryExecutionId, workflowId, correlationId, iso(0), iso(10), synthesisResponseId],
  );
  const retrievalTimes = [iso(2), iso(4), iso(6), iso(8)];
  for (let index = 0; index < 4; index += 1) {
    const ordinal = index + 1;
    const key = `${workflowId}:research:retrieval:${ordinal}`;
    await pool.query(
      `INSERT INTO execution_lifecycle_events(execution_id,workflow_id,stage,state,occurred_at,attempt_number,metadata)
       VALUES($1,$2,'research','CAPABILITY_TRANSPORT_STARTED',$3,1,$4::jsonb),
             ($1,$2,'research','CAPABILITY_RESULT_RECEIVED',$5,1,$4::jsonb)`,
      [recoveryExecutionId, workflowId, iso(index * 2 + 1), JSON.stringify({ idempotencyKey: key, reservationId: `reservation-${ordinal}` }), retrievalTimes[index]],
    );
    if (index < 2) {
      const resultId = `result-${suffix}-${ordinal}`;
      const evidenceId = `evidence-${suffix}-${ordinal}`;
      const payload = { resultId, output: { query: `query ${ordinal}`, results: [] } };
      await pool.query(
        `INSERT INTO capability_executions(result_id,workflow_id,correlation_id,capability_id,agent_id,status,evidence_id,idempotency_key,executed_at,payload)
         VALUES($1,$2,$3,'web.search','research','success',$4,$1,$5,$6::jsonb)`,
        [resultId, workflowId, correlationId, evidenceId, retrievalTimes[index], JSON.stringify(payload)],
      );
      await pool.query(
        `INSERT INTO execution_evidence(evidence_id,workflow_id,correlation_id,capability_id,agent_id,executed_at,succeeded,idempotency_key,payload)
         VALUES($1,$2,$3,'web.search','research',$4,TRUE,$1,$5::jsonb)`,
        [evidenceId, workflowId, correlationId, retrievalTimes[index], JSON.stringify(payload)],
      );
    }
  }
  await pool.query(
    `INSERT INTO execution_lifecycle_events(execution_id,workflow_id,stage,state,occurred_at,attempt_number,metadata)
     VALUES($1,$2,'research','VALIDATING',$3,1,$4::jsonb),
           ($1,$2,'research','FAILED',$5,1,$6::jsonb)`,
    [recoveryExecutionId, workflowId, iso(9), JSON.stringify({ providerRequestId: synthesisResponseId,
      parsedPayloadFingerprint: synthesisFingerprint, httpStatus: 200, finishReason: "stop",
      sanitizedVisibleResponse: JSON.stringify(synthesis) }), iso(10),
      JSON.stringify({ failureMessage: "CAPABILITY_EVIDENCE_PERSISTENCE_FAILED:web.search", errorClassification: "LOCAL_EXECUTION_FAILED" })],
  );
  for (const [callKind, limit, consumed] of [["research", 4, 4], ["text_agent", 10, 3], ["image_generation", 1, 0]]) {
    await pool.query(
      `INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at)
       VALUES($1,'MORROWAY_PRODUCTION_CYCLE_01_PRE_MEDIA',$2,$3,0,$4,0,TRUE,$5)`,
      [projectId, callKind, limit, consumed, iso(0)],
    );
  }
  return { suffix, projectId, contentId, workflowId, correlationId, recoveryExecutionId, synthesisResponseId, synthesisFingerprint, sourceJobId };
}

async function cleanup(pool, fixture) {
  await pool.query(`DELETE FROM owner_control_audit_events WHERE project_id=$1`, [fixture.projectId]);
  await pool.query(`DELETE FROM execution_lifecycle_events WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM execution_provenance WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM execution_evidence WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM capability_executions WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM workflow_recovery_dispatches WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM workflow_jobs WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM artifacts WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM workflow_steps WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM workflow_instances WHERE workflow_id=$1`, [fixture.workflowId]);
  await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=$1`, [fixture.projectId]);
}

test("A-M: terminal Research reconciliation is truthful, provider-free, budget-neutral, and idempotent", async () => {
  assertTestDatabaseIsolation();
  const pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  const fixture = await seed(pool);
  const store = new ResearchTerminalReconciliationStore(pool);
  const input = {
    projectId: fixture.projectId,
    contentId: fixture.contentId,
    workflowId: fixture.workflowId,
    correlationId: fixture.correlationId,
    sourceRecoveryExecutionId: fixture.recoveryExecutionId,
    sourceJobId: fixture.sourceJobId,
    synthesisResponseId: fixture.synthesisResponseId,
    synthesisFingerprint: fixture.synthesisFingerprint,
    expectedSemanticOutcome: "NO_PRODUCTION_CANDIDATE",
    reason: "Provider-free terminal reconciliation fixture.",
    ownerAuthorization: "OWNER_AUTHORIZED_TEST",
    ownerActor: "owner-test",
    idempotencyIdentity: `terminal-reconciliation-${fixture.suffix}`,
    identityCollisionRemediationRef: "research-evidence-identity-remediation-v1",
  };
  try {
    await assert.rejects(store.reconcile({ ...input, synthesisFingerprint: "b".repeat(64) }), /SYNTHESIS_FINGERPRINT_MISMATCH/);
    await assert.rejects(store.reconcile({ ...input, workflowId: `wrong-${fixture.workflowId}` }), /WORKFLOW_NOT_FOUND/);
    assert.throws(() => assertTerminalNonAdvancingSynthesis({ status: "completed", summary: "eligible", candidateStories: [{ candidateId: "c1" }], sources: [] }), /SYNTHESIS_NOT_TERMINAL_NON_ADVANCING/);
    await assert.rejects(store.reconcile({ ...input, synthesisResponseId: "missing-synthesis" }), /SYNTHESIS_NOT_FOUND/);

    const budgetBefore = (await pool.query(`SELECT call_kind,limit_count,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id=$1 ORDER BY call_kind`, [fixture.projectId])).rows;
    const rowsBefore = {
      results: Number((await pool.query(`SELECT count(*)::int AS count FROM capability_executions WHERE workflow_id=$1`, [fixture.workflowId])).rows[0].count),
      evidence: Number((await pool.query(`SELECT count(*)::int AS count FROM execution_evidence WHERE workflow_id=$1`, [fixture.workflowId])).rows[0].count),
      received: Number((await pool.query(`SELECT count(*)::int AS count FROM execution_lifecycle_events WHERE workflow_id=$1 AND state='CAPABILITY_RESULT_RECEIVED'`, [fixture.workflowId])).rows[0].count),
    };
    const applied = await store.reconcile(input);
    assert.equal(applied.outcome, "APPLIED");
    assert.equal(applied.mutated, true);
    assert.deepEqual(applied.retrievals.map((row) => row.state), [
      "AVAILABLE", "AVAILABLE", "TRANSPORT_SUCCEEDED_PAYLOAD_UNAVAILABLE", "TRANSPORT_SUCCEEDED_PAYLOAD_UNAVAILABLE",
    ]);
    assert.equal(applied.retrievals[2].resultId, null);
    assert.equal(applied.retrievals[3].evidenceId, null);

    const artifact = (await pool.query(`SELECT payload FROM artifacts WHERE artifact_id=$1`, [applied.artifactId])).rows[0].payload;
    assert.deepEqual(artifact.candidateStories, []);
    assert.deepEqual(artifact.sources, []);
    assert.equal(artifact.semanticOutcome, "NO_PRODUCTION_CANDIDATE");
    assert.equal(artifact.evidenceStatus, "INSUFFICIENT_EVIDENCE_WITH_PARTIAL_PERSISTENCE");
    assert.equal(artifact.terminalReconciliation.missingPayloadsFabricated, false);
    assert.equal(artifact.ceoEligible, false);

    const rowsAfter = {
      results: Number((await pool.query(`SELECT count(*)::int AS count FROM capability_executions WHERE workflow_id=$1`, [fixture.workflowId])).rows[0].count),
      evidence: Number((await pool.query(`SELECT count(*)::int AS count FROM execution_evidence WHERE workflow_id=$1`, [fixture.workflowId])).rows[0].count),
      received: Number((await pool.query(`SELECT count(*)::int AS count FROM execution_lifecycle_events WHERE workflow_id=$1 AND state='CAPABILITY_RESULT_RECEIVED'`, [fixture.workflowId])).rows[0].count),
    };
    assert.deepEqual(rowsAfter, rowsBefore);
    const budgetAfter = (await pool.query(`SELECT call_kind,limit_count,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id=$1 ORDER BY call_kind`, [fixture.projectId])).rows;
    assert.deepEqual(budgetAfter, budgetBefore);

    const replay = await store.reconcile(input);
    assert.equal(replay.outcome, "ALREADY_RECONCILED");
    assert.equal(replay.mutated, false);
    assert.equal(replay.artifactId, applied.artifactId);
    assert.equal(Number((await pool.query(`SELECT count(*)::int AS count FROM owner_control_audit_events WHERE project_id=$1`, [fixture.projectId])).rows[0].count), 1);
    assert.equal(Number((await pool.query(`SELECT count(*)::int AS count FROM artifacts WHERE workflow_id=$1 AND kind='research_report'`, [fixture.workflowId])).rows[0].count), 1);

    const state = (await pool.query(`SELECT state,ready FROM workflow_instances WHERE workflow_id=$1`, [fixture.workflowId])).rows[0];
    assert.equal(state.state, "BUSINESS_BLOCKED");
    assert.deepEqual(state.ready, []);
    const steps = (await pool.query(`SELECT step_id,status FROM workflow_steps WHERE workflow_id=$1`, [fixture.workflowId])).rows;
    assert.equal(steps.find((row) => row.step_id === "research").status, "completed");
    assert.equal(steps.find((row) => row.step_id === "ceo-recommendation").status, "pending");
  } finally {
    await cleanup(pool, fixture);
    await pool.end();
  }
});
