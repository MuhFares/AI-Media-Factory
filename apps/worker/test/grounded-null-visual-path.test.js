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
    artifactId: `art-${workflowId}-${stepId}`, kind, producerAgent: stepId === "scenes" ? "director" : stepId,
    workflowId, correlationId: `corr-${workflowId}`, status: "completed", payload,
    contentType: "application/json", schemaVersion: "1.0", createdAt: nowIso(),
  };
}

const GROUNDED_RESEARCH = {
  reportId: "33333333-3333-4333-8333-333333333333", taskId: "research-research", stage: "research",
  taskDescription: "Simulated grounded synthesis with null visual.", summary: "One supported candidate.",
  candidateStories: [{ candidateId: "candidate-1", topic: "Simulated Cairo subject", sourceIds: [1] }],
  sources: [{ id: 1, title: "Fixture source", url: "https://example.test/fixture", snippet: "Documented fixture." }],
  confidence: 0.85, citations: [{ sourceId: 1, text: "Documented fixture." }], evidenceRisks: [],
  status: "grounded", visual: null,
  metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
};

function stubExecutor(mode, calls) {
  return {
    async executeAgentStep(step, context) {
      calls.push(step.id);
      const wf = context.workflowId;
      if (step.id === "orchestrator") {
        return { status: "completed", output: {}, artifact: artifact(wf, "orchestrator", "execution_plan", { stage: "INITIAL_CONTENT_PLAN" }) };
      }
      if (step.id === "research") {
        const payload = mode === "negative"
          ? { ...GROUNDED_RESEARCH, candidateStories: [], status: "insufficient_evidence", confidence: 0.05, visual: null }
          : GROUNDED_RESEARCH;
        return { status: "completed", output: {}, artifact: artifact(wf, "research", "research_report", payload) };
      }
      if (step.id === "ceo-recommendation") {
        const decision = mode === "negative" ? "NO_PRODUCTION_CANDIDATE" : "ADVANCE";
        return { status: "completed", output: { decision }, artifact: artifact(wf, "ceo-recommendation", "ceo_recommendation", { decision, rationale: "simulation", eligibleCandidateIds: [], warnings: [] }) };
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
  const workflowId = `wf-nullvis-${suffix}-${Date.now().toString(36)}`;
  await queue.submit({
    submissionKey: `nullvis-fixture:${workflowId}`, workflowId, directive: "produce-pre-media",
    correlationId: `corr-${workflowId}`, brandId: PROJECT, definition,
    commandContext: { projectId: PROJECT, productionPhase: "PRE_MEDIA_PHASE", budgetPhase: "PRE_MEDIA_PHASE" }, status: "submitted",
  });
  await queue.enqueue(workflowId, `nullvis-fixture:${workflowId}`);
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

test("positive: grounded null-visual research persists, ADVANCE flows to the Owner gate, visual direction builds without research visual", async () => {
  const calls = [];
  const workflowId = await submitWorkflow("positive");
  assert.equal(await newWorker(stubExecutor("positive", calls)).runOnce(), true);
  const kinds = (await persistence.listArtifacts(workflowId)).map((a) => a.kind);
  for (const kind of ["execution_plan", "research_report", "ceo_recommendation", "evidence_backed_content_brief", "writer_report", "scene_plan", "visual_direction_contract"]) {
    assert.ok(kinds.includes(kind), `missing artifact kind ${kind}`);
  }
  const research = (await persistence.listArtifacts(workflowId)).find((a) => a.kind === "research_report");
  assert.equal(research.status, "completed");
  // Canonical neutral visual is absent or null: the research agent normalizes
  // null to absent (proven in the synthesis contract suite); the stub emits
  // the raw null form and the pipeline must tolerate either.
  assert.ok(research.payload.visual === null || !("visual" in research.payload), "visual must stay canonically neutral");
  assert.ok(calls.includes("visual-direction"), "visual direction must build from the scene plan without research visual");
  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "AWAITING_APPROVAL");
});

test("negative: insufficient null-visual research plus NO-GO keeps the certified bounded stop", async () => {
  const calls = [];
  const workflowId = await submitWorkflow("negative");
  assert.equal(await newWorker(stubExecutor("negative", calls)).runOnce(), true);
  assert.ok(!calls.includes("writer"));
  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "PAUSED");
  assert.equal(instance.context.data.boundedExecution.reason, "CEO_NO_PRODUCTION_CANDIDATE");
  const approval = await control.getApproval(`approval-${workflowId}-ceo-recommendation`);
  assert.equal(approval.status, "PENDING");
});
