/**
 * GOVERNED VISUAL ITERATION V1 — worker lifecycle (isolated test DB).
 *
 * Proves the production reaction to a visual-gate REQUEST_ITERATION:
 * a VisualIteration is created (frozen lineage, REQUESTED), NEVER a
 * ReviewRevisionTask / media resume / R9; duplicate delivery is idempotent;
 * missing store fails closed; zero provider calls throughout.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
  ControlPlaneStore,
  VisualIterationStore,
} from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const VISUAL_GATE = "visual-human-gate";

let pool;
let persistence;
let queue;
let control;
let visualIterations;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  visualIterations = new VisualIterationStore(pool);
});
after(async () => { await persistence.close(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const now = () => new Date().toISOString();

function boundary(counts) {
  return {
    executeCapability: async (request) => {
      counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1;
      return { status: "success", resultId: request.requestId, capabilityId: request.capabilityId, output: {}, evidence: { evidenceId: "e", succeeded: true } };
    },
  };
}

async function fixtureAtVisualGate(label) {
  const workflowId = `wf-vi-${label}-${runId()}`;
  const projectId = `proj-vi-${label}-${runId()}`;
  const commandId = `cmd-vi-${label}-${runId()}`;
  await pool.query(`DELETE FROM workflow_jobs WHERE status='queued'`);
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "visual iteration fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: now() });
  await queue.submit({ submissionKey: `vi:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "visual iteration fixture" } });
  const completedUpstream = ["planner-initial", "planner-synthesis", "research", "writer", "seo", "brand", "review", "pre-production-owner-gate", "director", "tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa"];
  await pool.query(
    `INSERT INTO workflow_instances (workflow_id, definition_id, definition_version, state, context, ready, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$7) ON CONFLICT (workflow_id) DO UPDATE SET state=$4, context=$5, ready=$6, updated_at=$7`,
    [workflowId, definition.id, definition.version, "AWAITING_APPROVAL",
      JSON.stringify({ data: { directive: "produce", reviewBusinessOutcome: { reviewArtifactId: `art-${workflowId}-review`, status: "approved" } }, brandId: projectId, correlationId: `corr-${workflowId}`, directive: "produce", outputs: {} }),
      JSON.stringify(["visual-human-gate"]), now()],
  );
  for (const step of definition.steps) {
    const status = completedUpstream.includes(step.id) ? "completed" : step.id === VISUAL_GATE ? "running" : "pending";
    await pool.query(`INSERT INTO workflow_steps (workflow_id, step_id, status, attempts, started_at, finished_at) VALUES ($1,$2,$3,1,$4,$4) ON CONFLICT (workflow_id, step_id) DO UPDATE SET status=$3`, [workflowId, step.id, status, now()]);
  }
  const art = async (artifactId, kind, payload) => persistence.saveArtifact({
    artifactId, kind, producerAgent: kind, workflowId, correlationId: `corr-${workflowId}`,
    status: "completed", payload, contentType: "application/json", schemaVersion: "1.0", createdAt: now(),
  });
  await art(`art-${workflowId}-review`, "review_report", { status: "approved", summary: "fixture", findings: [], recommendations: [] });
  await art(`art-${workflowId}-writer`, "writer_report", { contentId: `content-${workflowId}`, content: "fixture script" });
  await art(`art-${workflowId}-seo`, "seo_report", { status: "completed" });
  await art(`art-${workflowId}-brand`, "brand_report", { status: "approved" });
  await art(`art-${workflowId}-director`, "scene_plan", { planId: "p", sceneIds: ["scene-001", "scene-002"] });
  await art(`art-${workflowId}-narration`, "narration_artifact", { voice: "Mohamed" });
  await art(`art-${workflowId}-timeline`, "timeline_plan", { timelineId: "tl" });
  for (const sceneId of ["scene-001", "scene-002"]) {
    await art(`art-${workflowId}-${sceneId}-visual`, "scene_visual_artifact", { sceneId, integrityStatus: "VALID" });
    await art(`art-${workflowId}-${sceneId}-visual-semantic`, "visual_semantic_review", { sceneId, verdict: "UNAVAILABLE" });
    await art(`art-${workflowId}-${sceneId}-visual-qa`, "visual_technical_qa", { sceneId, verdict: "PASS" });
  }
  const jobId = await queue.enqueue(workflowId, `vi:${workflowId}`);
  const approvalId = `approval-${workflowId}-${VISUAL_GATE}`;
  await control.createApproval({
    approvalId, projectId, targetType: "workflow_gate", targetId: `${workflowId}:${VISUAL_GATE}`,
    agentRecommendation: { workflowId, stepId: VISUAL_GATE, gateType: "POST_VISUAL_QA_APPROVAL", required: "OWNER_DECISION" },
    agentConfidence: null, evidenceRefs: [], status: "PENDING", supersedes: null, supersededBy: null, createdAt: now(),
  });
  return { workflowId, projectId, commandId, jobId, approvalId, counts: {} };
}

async function waitFor(check, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout: ${label}`);
}

test("visual-gate REQUEST_ITERATION creates a VisualIteration, never a ReviewRevisionTask", async () => {
  const fix = await fixtureAtVisualGate("create");
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: boundary(fix.counts) });
  const worker = new WorkflowWorker({ queue, persistence, executor, control, visualIterations, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
  const run = worker.runOnce();
  run.catch(() => undefined);
  await control.decideApproval(fix.approvalId, "REQUEST_ITERATION", "owner requests visual iteration (fixture)");
  assert.equal(await run, true);
  const iteration = await visualIterations.getBySourceApproval(fix.approvalId);
  assert.ok(iteration, "VisualIteration created by the production path");
  assert.equal(iteration.status, "REQUESTED");
  assert.equal(iteration.iterationNumber, 1);
  assert.equal(iteration.ownerDecision, "REQUEST_VISUAL_ITERATION");
  assert.equal(iteration.lineage.sourceReviewArtifactId, `art-${fix.workflowId}-review`, "approved review frozen exactly");
  assert.equal(iteration.lineage.sourceDirectorArtifactId, `art-${fix.workflowId}-director`);
  assert.deepEqual(iteration.lineage.sourceVisualArtifactIds.sort(), [`art-${fix.workflowId}-scene-001-visual`, `art-${fix.workflowId}-scene-002-visual`]);
  assert.deepEqual(iteration.scenesToKeep, [], "dispositions undetermined at request");
  assert.deepEqual(iteration.scenesToRegenerate, [], "dispositions undetermined at request");
  assert.equal(iteration.proposedImageBudget, 0, "no budget proposed at request");
  assert.equal(iteration.authorizedImageBudget, 0, "no budget authorized");
  const tasks = await pool.query(`SELECT * FROM review_revision_tasks WHERE workflow_id='${fix.workflowId}'`);
  assert.equal(tasks.rowCount, 0, "NO ReviewRevisionTask for visual iteration");
  const resumes = await pool.query(`SELECT * FROM media_resume_dispatches WHERE workflow_id='${fix.workflowId}'`);
  assert.equal(resumes.rowCount, 0, "no media resume created");
  const instance = await persistence.loadWorkflow(fix.workflowId);
  assert.equal(instance.state, "REVISION_REQUIRED");
  for (const id of ["tts.generate", "timeline.plan", "image.generate", "video.generate", "media.compose"]) {
    assert.equal(fix.counts[id] ?? 0, 0, `no ${id} provider call`);
  }
});

test("duplicate delivery observes the existing VisualIteration (exactly-once)", async () => {
  const fix = await fixtureAtVisualGate("dup");
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: boundary(fix.counts) });
  const deps = { queue, persistence, executor, control, visualIterations, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) };
  const run1 = new WorkflowWorker(deps).runOnce();
  run1.catch(() => undefined);
  await control.decideApproval(fix.approvalId, "REQUEST_ITERATION", "fixture");
  assert.equal(await run1, true);
  const first = await visualIterations.getBySourceApproval(fix.approvalId);
  // Second job for the same workflow replays the completion path.
  const jobId2 = await queue.enqueue(fix.workflowId, `vi:${fix.workflowId}`);
  assert.ok(jobId2);
  const run2 = new WorkflowWorker(deps).runOnce();
  assert.equal(await run2, true);
  const listed = await visualIterations.listByWorkflow(fix.workflowId);
  assert.equal(listed.length, 1, "exactly one iteration despite duplicate delivery");
  assert.equal(listed[0].visualIterationId, first.visualIterationId);
});

test("missing visual-iteration store fails closed without side effects", async () => {
  const fix = await fixtureAtVisualGate("nostore");
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: boundary(fix.counts) });
  const worker = new WorkflowWorker({ queue, persistence, executor, control, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
  const run = worker.runOnce();
  run.catch(() => undefined);
  await control.decideApproval(fix.approvalId, "REQUEST_ITERATION", "fixture");
  assert.equal(await run, true);
  const jobs = await pool.query(`SELECT status FROM workflow_jobs WHERE workflow_id='${fix.workflowId}' ORDER BY job_id DESC LIMIT 1`);
  assert.equal(jobs.rows[0]?.status, "failed");
  assert.equal(await visualIterations.getBySourceApproval(fix.approvalId), null, "no iteration without the store");
});
