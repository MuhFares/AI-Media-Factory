/**
 * PHASE 0 — DURABILITY / REGRESSION SUITE (single aggregate).
 *
 * One suite covering every Phase 0 durability concern against real PostgreSQL:
 *   persistence  — create → persist → reload for workflows/artifacts/evidence/
 *                  capability executions/decisions
 *   checkpoint   — durable checkpoint save + latest-load
 *   lineage      — parentArtifact links survive reload
 *   idempotency  — replaying a write never duplicates the row
 *   recovery     — DefaultRecoveryManager rebuilds a runnable instance from the
 *                  durable store + latest checkpoint (no re-run of completed)
 *   restart      — full chaos: kill engine → new engine → resume → COMPLETED,
 *                  each stage executed exactly once
 *
 * Requires a reachable PostgreSQL at DATABASE_URL
 * (default: postgresql://postgres@127.0.0.1:5432/ai_media_factory).
 */

import { test, before, after } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import {
  DefaultWorkflowEngine,
  DefaultScheduler,
  DefaultWorkflowStateMachine,
  DefaultTimeoutController,
  DefaultWorkflowRetryPolicy,
  DefaultBranchRouter,
  DefaultStepExecutor,
  DefaultCheckpointCoordinator,
  DefaultRecoveryManager,
  DefaultCompensationRunner,
  DefaultApprovalCoordinator,
  DefaultDeadLetterSink,
  DefaultAuditTrail,
  DefaultWorkflowLogger,
  DefaultWorkflowMetrics,
  DefaultWorkflowEventBridge,
  WorkflowCrashError,
  workflow,
} from "@ai-media-factory/workflow-engine";
import { createPool, migrate, PostgresPersistence } from "@ai-media-factory/database";
import { TEST_DATABASE_URL } from "./helpers.js";

const CONN = TEST_DATABASE_URL;
let persistence;

async function newPersistence() {
  const pool = createPool({ connectionString: CONN });
  await migrate(pool);
  return new PostgresPersistence(pool);
}

async function truncateAll() {
  const pool = createPool({ connectionString: CONN });
  await migrate(pool);
  await pool.query(
    `TRUNCATE workflow_instances, workflow_steps, workflow_checkpoints,
            artifacts, capability_executions, execution_evidence, decisions
     RESTART IDENTITY CASCADE`
  );
  await pool.end();
}

// ---- fixtures ---------------------------------------------------------------

function makeInstance(workflowId, state = "RUNNING") {
  const now = new Date().toISOString();
  return {
    workflowId,
    definitionId: "content-pipeline",
    definitionVersion: 1,
    state,
    context: { workflowId, correlationId: "corr-1", brandId: "brand-1", outputs: {}, data: { objective: "x" } },
    steps: [
      { stepId: "planner", status: "completed", attempts: 1, startedAt: now, finishedAt: now },
      { stepId: "research", status: "pending", attempts: 0, startedAt: null, finishedAt: null },
    ],
    ready: ["research"],
    lastCheckpointRef: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeArtifact(artifactId, workflowId, parent = undefined) {
  const art = {
    artifactId,
    kind: "research_report",
    producerAgent: "research",
    workflowId,
    correlationId: "corr-1",
    status: "completed",
    payload: { reportId: artifactId, taskDescription: "t", summary: "s", sources: [] },
    contentType: "application/json",
    schemaVersion: "1.0.0",
    createdAt: new Date().toISOString(),
  };
  return parent === undefined ? art : { ...art, parentArtifact: parent };
}

// ---- chaos fixture (restart) ------------------------------------------------

const KIND_BY_STEP = { planner: "execution_plan", research: "research_report", writer: "writer_report", seo: "seo_report" };
const PARENT_BY_STEP = { research: "planner", writer: "research", seo: "writer" };

let chaosShared;

function buildDefinition() {
  return workflow()
    .id("content-pipeline-chaos")
    .version(1)
    .trigger("event", "ExecutiveDirective")
    .entryStep("planner")
    .timeoutSeconds(300)
    .addAgentStep({ id: "planner", agent: "planner", emits: "PlanCompleted", next: "research" })
    .addAgentStep({ id: "research", agent: "research", emits: "ResearchCompleted", next: "writer" })
    .addAgentStep({ id: "writer", agent: "writer", emits: "WriteCompleted", next: "seo" })
    .addAgentStep({ id: "seo", agent: "seo", emits: "SEOCompleted" })
    .build();
}

function makeArtifact2(stepId, agent, workflowId, correlationId) {
  const parent = PARENT_BY_STEP[stepId] ? chaosShared.artifacts[PARENT_BY_STEP[stepId]] : undefined;
  const artifact = {
    artifactId: `art-${stepId}`,
    kind: KIND_BY_STEP[stepId],
    producerAgent: agent,
    workflowId,
    correlationId,
    status: "completed",
    payload: { reportId: `art-${stepId}`, objective: "ship", status: "completed" },
    contentType: "application/json",
    schemaVersion: "1.0.0",
    createdAt: new Date().toISOString(),
  };
  if (parent) artifact.parentArtifact = { artifactId: parent.artifactId, kind: parent.kind };
  chaosShared.artifacts[stepId] = artifact;
  return artifact;
}

function makeExecutor(crashOn) {
  return {
    async executeAgentStep(step, context) {
      if (crashOn.has(step.id)) {
        throw new WorkflowCrashError(`simulated crash during ${step.id}`);
      }
      chaosShared.executions.push(step.id);
      const artifact = makeArtifact2(step.id, step.agent, context.workflowId, context.correlationId);
      return { status: "completed", output: { reportId: artifact.artifactId }, artifact };
    },
  };
}

function buildEngine(persistence, executor, definition) {
  const scheduler = new DefaultScheduler();
  const stateMachine = new DefaultWorkflowStateMachine();
  const timeoutController = new DefaultTimeoutController();
  const retryPolicy = new DefaultWorkflowRetryPolicy();
  const branchRouter = new DefaultBranchRouter();
  const checkpointCoordinator = new DefaultCheckpointCoordinator(persistence);
  const recoveryManager = new DefaultRecoveryManager(checkpointCoordinator, persistence, async () => definition);
  const stepExecutor = new DefaultStepExecutor(
    executor,
    branchRouter,
    scheduler,
    timeoutController,
    retryPolicy,
    checkpointCoordinator,
    async (id) => persistence.loadWorkflow(id),
    stateMachine
  );
  const compensationRunner = new DefaultCompensationRunner(async () => null, async () => {});
  const approvalCoordinator = new DefaultApprovalCoordinator(async () => {});
  const eventBridge = new DefaultWorkflowEventBridge(async () => {});
  const deadLetterSink = new DefaultDeadLetterSink(eventBridge);
  const auditTrail = new DefaultAuditTrail();
  const logger = new DefaultWorkflowLogger();
  const metrics = new DefaultWorkflowMetrics();
  return new DefaultWorkflowEngine(
    stepExecutor,
    scheduler,
    stateMachine,
    checkpointCoordinator,
    recoveryManager,
    compensationRunner,
    approvalCoordinator,
    deadLetterSink,
    auditTrail,
    logger,
    metrics,
    eventBridge,
    persistence,
    async () => definition
  );
}

async function waitForState(engine, workflowId, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const inst = await engine.describe(workflowId);
    if (inst && inst.state === expected) return inst;
    await new Promise((r) => setTimeout(r, 25));
  }
  const inst = await engine.describe(workflowId);
  throw new Error(`Timed out waiting for state ${expected}; got ${inst?.state}`);
}

// ---- lifecycle --------------------------------------------------------------

before(async () => {
  await truncateAll();
  persistence = await newPersistence();
});

after(async () => {
  await persistence.close();
});

// =============================================================================
// 1) PERSISTENCE — create → persist → reload
// =============================================================================
test("durability: workflow, artifact, evidence, capability, decision persist → reload", async () => {
  const wf = makeInstance("wf-d1");
  await persistence.saveWorkflow(wf);
  const loaded = await persistence.loadWorkflow(wf.workflowId);
  ok(loaded, "workflow must reload");
  strictEqual(loaded.definitionId, "content-pipeline");
  strictEqual(loaded.state, "RUNNING");
  strictEqual(loaded.steps.length, 2);
  strictEqual(loaded.steps[0].stepId, "planner");
  strictEqual(loaded.steps[0].status, "completed");
  deepStrictEqual(loaded.ready, ["research"]);
  strictEqual(loaded.context.correlationId, "corr-1");

  const art = makeArtifact("art-d1", wf.workflowId);
  await persistence.saveArtifact(art);
  const arts = await persistence.listArtifacts(wf.workflowId);
  strictEqual(arts.length, 1);
  strictEqual(arts[0].artifactId, "art-d1");
  strictEqual(arts[0].kind, "research_report");

  await persistence.saveExecutionEvidence({
    evidenceId: "ev-d1",
    workflowId: wf.workflowId,
    correlationId: "corr-1",
    capabilityId: "publish",
    agentId: "publisher",
    executedAt: new Date().toISOString(),
    succeeded: true,
    idempotencyKey: "publish-idem-d1",
    payload: { url: "https://x" },
  });
  const evidence = await persistence.listExecutionEvidence(wf.workflowId);
  strictEqual(evidence.length, 1);
  strictEqual(evidence[0].idempotencyKey, "publish-idem-d1");

  await persistence.saveCapabilityExecution({
    resultId: "cap-d1",
    workflowId: wf.workflowId,
    correlationId: "corr-1",
    capabilityId: "render_video",
    agentId: "video",
    status: "success",
    evidenceId: "ev-d1",
    idempotencyKey: "render-idem-d1",
    executedAt: new Date().toISOString(),
    payload: { videoId: "v1" },
  });
  const caps = await persistence.listCapabilityExecutions(wf.workflowId);
  strictEqual(caps.length, 1);
  strictEqual(caps[0].status, "success");

  await persistence.saveDecision({
    decisionId: "dec-d1",
    kind: "executive_directive",
    workflowId: wf.workflowId,
    correlationId: "corr-1",
    cycle: 1,
    payload: { objective: "ship" },
    createdAt: new Date().toISOString(),
  });
  const decisions = await persistence.listDecisions(wf.workflowId);
  strictEqual(decisions.length, 1);
  strictEqual(decisions[0].kind, "executive_directive");
});

// =============================================================================
// 2) CHECKPOINT — durable save + latest-load
// =============================================================================
test("durability: checkpoint save → latest reload preserves state & completed steps", async () => {
  const wf = makeInstance("wf-d2");
  await persistence.saveWorkflow(wf);
  await persistence.saveCheckpoint({
    workflowId: wf.workflowId,
    state: "RUNNING",
    completedSteps: ["planner"],
    contextSnapshotRef: "ctx-d2",
    lastEventOffset: 1,
    createdAt: new Date().toISOString(),
  });
  const cp = await persistence.loadLatestCheckpoint(wf.workflowId);
  ok(cp, "checkpoint must reload");
  strictEqual(cp.state, "RUNNING");
  deepStrictEqual(cp.completedSteps, ["planner"]);
  strictEqual(cp.lastEventOffset, 1);
});

// =============================================================================
// 3) LINEAGE — parentArtifact preserved across reload
// =============================================================================
test("durability: parentArtifact lineage preserved after reload", async () => {
  const wf = makeInstance("wf-d3");
  await persistence.saveWorkflow(wf);
  const plan = makeArtifact("plan-d3", wf.workflowId);
  await persistence.saveArtifact(plan);
  const child = makeArtifact("child-d3", wf.workflowId, { artifactId: plan.artifactId, kind: plan.kind });
  await persistence.saveArtifact(child);
  const arts = await persistence.listArtifacts(wf.workflowId);
  strictEqual(arts.length, 2);
  const loadedChild = arts.find((a) => a.artifactId === "child-d3");
  ok(loadedChild.parentArtifact, "lineage link must survive reload");
  strictEqual(loadedChild.parentArtifact.artifactId, "plan-d3");
  strictEqual(loadedChild.parentArtifact.kind, "research_report");
});

// =============================================================================
// 4) IDEMPOTENCY — replaying a write never duplicates the row
// =============================================================================
test("durability: artifact & capability-execution writes are idempotent on replay", async () => {
  const wf = makeInstance("wf-d4");
  await persistence.saveWorkflow(wf);

  const art = makeArtifact("art-d4", wf.workflowId);
  await persistence.saveArtifact(art);
  await persistence.saveArtifact(art);
  await persistence.saveArtifact(art);
  strictEqual((await persistence.listArtifacts(wf.workflowId)).length, 1);

  const rec = {
    resultId: "cap-d4",
    workflowId: wf.workflowId,
    correlationId: "corr-1",
    capabilityId: "publish",
    agentId: "publisher",
    status: "success",
    evidenceId: "ev-d4",
    idempotencyKey: "publish-idem-d4",
    executedAt: new Date().toISOString(),
    payload: { url: "https://x" },
  };
  await persistence.saveCapabilityExecution(rec);
  await persistence.saveCapabilityExecution(rec);
  strictEqual((await persistence.listCapabilityExecutions(wf.workflowId)).length, 1);
});

// =============================================================================
// 5) RECOVERY — DefaultRecoveryManager rebuilds from durable store + checkpoint
// =============================================================================
test("durability: recovery preserves completed, re-queues in-flight, restores frontier", async () => {
  const wf = makeInstance("wf-d5");
  // Crash during research: planner done, research left "running" (in-flight).
  const crashed = { ...wf, steps: [
    { stepId: "planner", status: "completed", attempts: 1, startedAt: "t", finishedAt: "t" },
    { stepId: "research", status: "running", attempts: 1, startedAt: "t", finishedAt: null },
    { stepId: "writer", status: "pending", attempts: 0, startedAt: null, finishedAt: null },
    { stepId: "seo", status: "pending", attempts: 0, startedAt: null, finishedAt: null },
  ], ready: ["research"] };
  await persistence.saveWorkflow(crashed);
  await persistence.saveCheckpoint({
    workflowId: wf.workflowId,
    state: "RUNNING",
    completedSteps: ["planner"],
    contextSnapshotRef: "ctx-d5",
    lastEventOffset: 1,
    createdAt: new Date().toISOString(),
  });

  const checkpointCoordinator = new DefaultCheckpointCoordinator(persistence);
  const recoveryManager = new DefaultRecoveryManager(checkpointCoordinator, persistence, async () => null);
  const recovered = await recoveryManager.recover(wf.workflowId);

  ok(recovered, "recovery must return an instance");
  const byId = Object.fromEntries(recovered.steps.map((s) => [s.stepId, s]));
  strictEqual(byId.planner.status, "completed", "completed step never re-runs");
  strictEqual(byId.research.status, "pending", "in-flight step re-queued for idempotent re-run");
  strictEqual(byId.writer.status, "pending");
  strictEqual(byId.seo.status, "pending");
  deepStrictEqual(recovered.ready, ["research"], "ready frontier restored to next pending step");
});

// =============================================================================
// 6) RESTART — kill engine → new engine → resume → COMPLETED (no duplication)
// =============================================================================
test("durability: kill → restart → resume → complete without duplication", async () => {
  const definition = buildDefinition();
  chaosShared = { executions: [], artifacts: {}, crashOn1: new Set(["research", "writer", "seo"]) };

  // ---- lifecycle 1: start, executes Planner, crashes during Research --------
  const persistence1 = await newPersistence();
  const engine1 = buildEngine(persistence1, makeExecutor(chaosShared.crashOn1), definition);

  const input = { definition, trigger: { directive: "plan" }, correlationId: "corr-chaos", brandId: "brand-1" };
  const started = await engine1.start(input);
  const workflowId = started.workflowId;

  await waitForState(engine1, workflowId, "RUNNING");
  await new Promise((r) => setTimeout(r, 200));
  const plannerArtifact = (await persistence1.listArtifacts(workflowId)).find((a) => a.artifactId === "art-planner");
  ok(plannerArtifact, "planner artifact persisted before crash");
  strictEqual(chaosShared.executions.filter((e) => e === "planner").length, 1, "planner executed once in life 1");

  // ---- kill engine1 (process death: tear down its pool) ---------------------
  await persistence1.close();

  // ---- lifecycle 2: brand-new engine on a brand-new pool, resume ------------
  const persistence2 = await newPersistence();
  const engine2 = buildEngine(persistence2, makeExecutor(new Set()), definition);

  const resumed = await engine2.resume(workflowId);
  ok(resumed, "workflow resumed after restart");

  const completed = await waitForState(engine2, workflowId, "COMPLETED");
  strictEqual(completed.state, "COMPLETED");

  strictEqual(chaosShared.executions.filter((e) => e === "planner").length, 1, "planner executed exactly once total");
  strictEqual(chaosShared.executions.filter((e) => e === "research").length, 1, "research executed exactly once");
  strictEqual(chaosShared.executions.filter((e) => e === "writer").length, 1, "writer executed exactly once");
  strictEqual(chaosShared.executions.filter((e) => e === "seo").length, 1, "seo executed exactly once");

  const artifacts = await persistence2.listArtifacts(workflowId);
  strictEqual(artifacts.length, 4, "exactly four unique artifacts");
  const byId = Object.fromEntries(artifacts.map((a) => [a.artifactId, a]));
  ok(byId["art-planner"], "planner artifact present");
  ok(byId["art-research"]?.parentArtifact?.artifactId === "art-planner", "research lineage intact");
  ok(byId["art-writer"]?.parentArtifact?.artifactId === "art-research", "writer lineage intact");
  ok(byId["art-seo"]?.parentArtifact?.artifactId === "art-writer", "seo lineage intact");

  const finalInst = await persistence2.loadWorkflow(workflowId);
  ok(finalInst);
  strictEqual(finalInst.state, "COMPLETED");
  strictEqual(finalInst.steps.length, 4);
  ok(finalInst.steps.every((s) => s.status === "completed"), "all stages completed after resume");

  await persistence2.close();
});
