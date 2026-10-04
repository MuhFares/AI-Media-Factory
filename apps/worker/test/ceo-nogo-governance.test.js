import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore } from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation, truncateAll } from "./helpers.js";

assertTestDatabaseIsolation();

const PROJECT = "morroway";
const definition = directiveToWorkflowDefinition("produce-pre-media");
let pool, persistence, queue, control;
const workflows = [];
const nowIso = () => new Date().toISOString();

function artifact(workflowId, stepId, kind, payload) {
  return {
    artifactId: `art-${workflowId}-${stepId}`, kind, producerAgent: stepId === "scenes" ? "director" : stepId === "owner-pre-media-gate" ? "owner" : stepId,
    workflowId, correlationId: `corr-${workflowId}`, status: "completed", payload,
    contentType: "application/json", schemaVersion: "1.0", createdAt: nowIso(),
  };
}

function stubExecutor(decision, calls) {
  return {
    async executeAgentStep(step, context) {
      calls.push(step.id);
      const wf = context.workflowId;
      if (step.id === "orchestrator") {
        return { status: "completed", output: {}, artifact: artifact(wf, "orchestrator", "execution_plan", { stage: "INITIAL_CONTENT_PLAN" }) };
      }
      if (step.id === "research") {
        return { status: "completed", output: {}, artifact: artifact(wf, "research", "research_report", { status: "insufficient_evidence", candidateStories: [], sources: [], citations: [] }) };
      }
      if (step.id === "ceo-recommendation") {
        return { status: "completed", output: { decision }, artifact: artifact(wf, "ceo-recommendation", "ceo_recommendation", { decision, rationale: "fixture", eligibleCandidateIds: [], warnings: [] }) };
      }
      const kinds = { "planner-synthesis": "evidence_backed_content_brief", writer: "writer_report", scenes: "scene_plan", "visual-direction": "visual_direction_contract", review: "review_report", "phase1-qa": "final_technical_qa" };
      return { status: "completed", output: {}, artifact: artifact(wf, step.id, kinds[step.id] ?? `${step.id}_report`, { fixture: true }) };
    },
  };
}

function newWorker(executor) {
  return new WorkflowWorker({ queue, persistence, executor, control, pollMs: 5, resolveCommandConfiguration: async () => ({}) });
}

async function submitWorkflow(suffix) {
  const workflowId = `wf-nogo-${suffix}-${Date.now().toString(36)}`;
  await queue.submit({
    submissionKey: `nogo-fixture:${workflowId}`, workflowId, directive: "produce-pre-media",
    correlationId: `corr-${workflowId}`, brandId: PROJECT, definition,
    commandContext: { projectId: PROJECT, productionPhase: "PRE_MEDIA_PHASE", budgetPhase: "PRE_MEDIA_PHASE" }, status: "submitted",
  });
  await queue.enqueue(workflowId, `nogo-fixture:${workflowId}`);
  workflows.push(workflowId);
  return workflowId;
}

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
  await pool.query(`DELETE FROM production_call_reservations WHERE project_id='morroway'`);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  await control.registerProject({ projectId: PROJECT, displayName: "Morroway", createdBy: "test", metadata: {} });
});

after(async () => {
  if (pool) {
    if (workflows.length) {
      await pool.query(`DELETE FROM production_call_reservations WHERE workflow_id = ANY($1::text[])`, [workflows]);
      await pool.query(`DELETE FROM workflow_jobs WHERE workflow_id = ANY($1::text[])`, [workflows]);
      await pool.query(`DELETE FROM workflow_submissions WHERE workflow_id = ANY($1::text[])`, [workflows]);
      await pool.query(`DELETE FROM artifacts WHERE workflow_id = ANY($1::text[])`, [workflows]);
      await pool.query(`DELETE FROM control_approvals WHERE target_id LIKE ANY($1::text[])`, [workflows.map((w) => `${w}%`)]);
      await pool.query(`DELETE FROM workflow_instances WHERE workflow_id = ANY($1::text[])`, [workflows]);
    }
    await pool.end();
  }
});

test("E+F+G+L. CEO NO-GO halts before Writer with business-valid terminal state", async () => {
  const calls = [];
  const workflowId = await submitWorkflow("halt");
  assert.equal(await newWorker(stubExecutor("NO_PRODUCTION_CANDIDATE", calls)).runOnce(), true);
  assert.ok(!calls.includes("writer") && !calls.includes("scenes") && !calls.includes("visual-direction"), `downstream executed: ${calls}`);
  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "PAUSED");
  assert.equal(instance.context.data.boundedExecution.reason, "CEO_NO_PRODUCTION_CANDIDATE");
  const kinds = (await persistence.listArtifacts(workflowId)).map((a) => a.kind);
  assert.ok(kinds.includes("execution_plan") && kinds.includes("research_report") && kinds.includes("ceo_recommendation"));
  for (const forbidden of ["writer_report", "scene_plan", "visual_direction_contract", "evidence_backed_content_brief"]) {
    assert.ok(!kinds.includes(forbidden), `forbidden artifact present: ${forbidden}`);
  }
  const submission = await queue.loadSubmissionByWorkflow(workflowId);
  assert.equal(submission.status, "bounded_stop");
  const jobs = await pool.query(`SELECT status FROM workflow_jobs WHERE workflow_id=$1`, [workflowId]);
  assert.ok(jobs.rows.every((j) => j.status === "succeeded"));
});

test("H. Owner review package holds Research + CEO evidence with a pending decision", async () => {
  const calls = [];
  const workflowId = await submitWorkflow("package");
  await newWorker(stubExecutor("NO_PRODUCTION_CANDIDATE", calls)).runOnce();
  const approval = await control.getApproval(`approval-${workflowId}-ceo-recommendation`);
  assert.ok(approval);
  assert.equal(approval.status, "PENDING");
  const refs = Array.isArray(approval.evidenceRefs) ? approval.evidenceRefs : JSON.parse(approval.evidenceRefs ?? "[]");
  assert.ok(refs.includes(`art-${workflowId}-research`));
  assert.ok(refs.includes(`art-${workflowId}-ceo-recommendation`));
  const recommendation = approval.agentRecommendation && typeof approval.agentRecommendation === "object" ? approval.agentRecommendation : JSON.parse(approval.agentRecommendation ?? "{}");
  assert.equal(recommendation.decision, "NO_PRODUCTION_CANDIDATE");
});

test("J+K. redelivery never advances past NO-GO and spends no budget", async () => {
  const calls = [];
  const workflowId = await submitWorkflow("redeliver");
  const worker = newWorker(stubExecutor("HOLD", calls));
  assert.equal(await worker.runOnce(), true);
  const firstArtifacts = await persistence.listArtifacts(workflowId);
  assert.equal(await worker.runOnce(), false);
  await queue.enqueue(workflowId, `nogo-fixture:${workflowId}`);
  assert.equal(await worker.runOnce(), true);
  assert.ok(!calls.includes("writer"), `writer executed on redelivery: ${calls}`);
  const after = await persistence.loadWorkflow(workflowId);
  assert.equal(after.state, "PAUSED");
  assert.equal((await persistence.listArtifacts(workflowId)).length, firstArtifacts.length);
  const reservations = await pool.query(`SELECT count(*)::int n FROM production_call_reservations WHERE workflow_id=$1`, [workflowId]);
  assert.equal(reservations.rows[0].n, 0);
  const approvals = await pool.query(`SELECT count(*)::int n FROM control_approvals WHERE approval_id=$1`, [`approval-${workflowId}-ceo-recommendation`]);
  assert.equal(approvals.rows[0].n, 1);
});

test("I. positive ADVANCE path still reaches Writer and the Owner gate", async () => {
  const calls = [];
  const workflowId = await submitWorkflow("positive");
  assert.equal(await newWorker(stubExecutor("ADVANCE", calls)).runOnce(), true);
  assert.ok(calls.includes("writer"));
  assert.ok(calls.includes("visual-direction"));
  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "AWAITING_APPROVAL");
  assert.equal(instance.context.data.boundedExecution, undefined);
});
