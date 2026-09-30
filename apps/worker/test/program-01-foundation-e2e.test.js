import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { CANONICAL_STAGE_CATALOG, decideCeoResearchMode, validateArtifactContract } from "@ai-media-factory/shared";
import { WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation, truncateAll } from "./helpers.js";

assertTestDatabaseIsolation();
const realFetch = globalThis.fetch;
let pool;
let persistence;
let queue;
const approvals = new Map();
const control = {
  async updateCommand() {},
  async createApproval(input) { const row = { ...input, ownerDecision: null, ownerRationale: null, decidedAt: null }; approvals.set(input.approvalId, row); return row; },
  async getApproval(id) { return approvals.get(id) ?? null; },
};

before(async () => {
  globalThis.fetch = async () => { throw new Error("PROGRAM_01_PROVIDER_BOUNDARY_FORBIDDEN"); };
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
});
after(async () => { globalThis.fetch = realFetch; await pool.end(); });

function payloadFor(stageId, eligible) {
  switch (stageId) {
    case "orchestrator": return { planId: "plan-1", objective: "fixture", tasks: [], stage: "INITIAL_CONTENT_PLAN" };
    case "research": return eligible
      ? { summary: "Two institutional sources corroborate the candidate.", evidenceStatus: "USABLE", candidateStories: [{ candidateId: "candidate-1", factualVerification: "STRONG", recommendedForProduction: true, supportingEvidenceIds: ["evidence-1"], evidenceLineageValidated: true }], sources: [{ sourceId: "source-1" }] }
      : { summary: "No candidate met the evidence threshold.", evidenceStatus: "INSUFFICIENT_EVIDENCE", candidateStories: [], sources: [] };
    case "ceo-recommendation": return { ...decideCeoResearchMode(eligible ? payloadFor("research", true) : payloadFor("research", false)), rationale: eligible ? "Evidence gate passed." : "No eligible candidate; return to Owner.", warnings: [] };
    case "planner-synthesis": return { objective: "Produce only the eligible candidate", finalAngle: "Verified angle", claims: [], evidenceRefs: ["evidence-1"], hookDirection: "Lead with the verified historical contrast", writerInstructions: [] };
    case "writer": return { title: "Verified story", content: "Evidence-backed script", summary: "summary", sourceReferences: ["source-1"], status: "completed" };
    case "scenes": return { scenes: [{ sceneId: "scene-1", visualPrompt: "documented setting" }], sceneIds: ["scene-1"] };
    case "visual-direction": return { version: 2, scenes: [{ sceneId: "scene-1", subject: "documented setting" }], providerNeutral: true };
    case "review": return { reportId: "review-1", taskDescription: "Review", status: "approved", summary: "approved", findings: [], recommendations: [] };
    case "phase1-qa": return { reportId: "qa-1", objective: "QA", status: "passed", summary: "passed", testResults: [], executionEvidencePresent: true };
    default: throw new Error(`unexpected stage ${stageId}`);
  }
}

function executor(eligible) {
  return {
    async executeAgentStep(step, context) {
      const definition = CANONICAL_STAGE_CATALOG[step.id];
      assert.ok(definition, `canonical stage ${step.id}`);
      const payload = payloadFor(step.id, eligible);
      const previous = context.data.previousArtifact;
      const artifact = {
        artifactId: `art-${context.workflowId}-${step.id}`, kind: definition.outputArtifactKind,
        producerAgent: step.agent, workflowId: context.workflowId, correlationId: context.correlationId ?? "",
        status: "completed", payload, contentType: "application/json", schemaVersion: "1", createdAt: "2026-09-27T00:00:00.000Z",
        ...(previous && typeof previous === "object" ? { parentArtifact: previous } : {}),
      };
      if (["research_report", "ceo_recommendation", "evidence_backed_content_brief", "writer_report", "scene_plan", "visual_direction_contract"].includes(artifact.kind)) validateArtifactContract({ artifact, expectedWorkflowId: context.workflowId });
      context.data.previousArtifact = { artifactId: artifact.artifactId, kind: artifact.kind };
      if (step.id === "ceo-recommendation" && payload.decision !== "ADVANCE") context.data.boundedExecution = { stopAfterStepId: step.id, reason: `CEO_${payload.decision}`, authorization: "CANONICAL_EVIDENCE_GATE", recoveryExecutionId: null };
      return { status: "completed", output: payload, artifact };
    },
  };
}

async function dispatch(name, eligible) {
  const workflowId = `wf-program-01-${name}-${Date.now().toString(36)}`;
  await queue.submit({ submissionKey: `program-01:${workflowId}`, workflowId, directive: "produce-pre-media", correlationId: `corr-${workflowId}`, brandId: "program-01-test", definition: directiveToWorkflowDefinition("produce-pre-media") });
  await queue.enqueue(workflowId, `program-01:${workflowId}`);
  const worker = new WorkflowWorker({ queue, persistence, executor: executor(eligible), control, resolveCommandConfiguration: async () => ({}), pollMs: 5 });
  assert.equal(await worker.runOnce(), true);
  const reservations = await pool.query(`SELECT reservation_id FROM production_call_reservations WHERE workflow_id=$1`, [workflowId]);
  return { workflowId, submission: await queue.loadSubmissionByWorkflow(workflowId), instance: await persistence.loadWorkflow(workflowId), artifacts: await persistence.listArtifacts(workflowId), reservationCount: reservations.rowCount ?? 0 };
}

test("M: E2E-01 eligible Research traverses real queue/worker/engine/DB to canonical Brief without provider calls", async () => {
  const result = await dispatch("eligible", true);
  assert.ok(result.artifacts.some((item) => item.kind === "ceo_recommendation"));
  assert.ok(result.artifacts.some((item) => item.kind === "evidence_backed_content_brief"));
  assert.equal(result.instance.state, "AWAITING_APPROVAL");
  assert.equal(result.submission.status, "owner_pre_media_review_required");
  assert.equal(result.reservationCount, 0);
  assert.ok(approvals.has(`approval-${result.workflowId}-owner-pre-media-gate`));
});

test("N: E2E-01 insufficient Research stops at CEO without fabricating a Brief", async () => {
  const result = await dispatch("insufficient", false);
  assert.ok(result.artifacts.some((item) => item.kind === "ceo_recommendation"));
  assert.equal(result.artifacts.some((item) => item.kind === "evidence_backed_content_brief"), false);
  assert.equal(result.instance.state, "PAUSED");
  assert.equal(result.submission.status, "bounded_stop");
  assert.equal(result.reservationCount, 0);
  assert.ok(approvals.has(`approval-${result.workflowId}-ceo-recommendation`));
});

test("O: E2E-04 completes the canonical pre-media chain with no unresolved stage or artifact-kind mismatch", async () => {
  const result = await dispatch("e2e04", true);
  const kinds = result.artifacts.map((item) => item.kind);
  assert.deepEqual(kinds, ["execution_plan", "research_report", "ceo_recommendation", "evidence_backed_content_brief", "writer_report", "scene_plan", "visual_direction_contract", "review_report", "qa_report"]);
  assert.equal(kinds.includes("hook_concepts"), false);
  assert.equal(kinds.includes("visual_direction_plan"), false);
});
