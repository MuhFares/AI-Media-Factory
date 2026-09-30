/**
 * REVIEW_ONLY_TECHNICAL_RESUME — real persistent-worker fixtures (provider-free).
 *
 * Proves the governed review-only resume end-to-end on the isolated test DB:
 *  - eligibility guard (fail-closed): technical failure required; business
 *    verdicts NOT eligible; missing/later review artifacts NOT eligible
 *  - explicit owner AUTHORIZE_REVIEW_RESUME (durable, idempotent, exactly-once,
 *    concurrency-safe, restart-safe)
 *  - ONLY the Review executes: Writer/SEO/Brand are never re-executed
 *  - the FROZEN input package (exact artifact ids) is enforced at execution
 *  - fresh Review routing for all four verdicts (A–D) + technical failures (E–G)
 *  - the Review model resolves through the canonical control plane (model A
 *    then model B fixture; no ambient fallback)
 *  - duplicate queue delivery cannot duplicate the fresh Review artifact
 *  - revision version is NOT incremented (this is not a content revision)
 *
 * All provider transports are frozen fetch fixtures; no live provider call.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
  ControlPlaneStore,
  PostgresRevisionDispatcher,
  PostgresReviewResumeDispatcher,
} from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";
import { canonicalResearchPayload, canonicalResearchResults, isResearchPrompt } from "./canonical-production-fixtures.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const GATE = "pre-production-owner-gate";
const fixtureAudioUrl = `data:audio/wav;base64,${(
  await readFile(new URL("../../../output/tts-benchmark/voicetut-short.wav", import.meta.url))
).toString("base64")}`;

const WRITER_MODEL = "openai/gpt-oss-20b:free";
const REVIEW_MODEL_A = "dots-studio/dots-3-note-preview:free";
const REVIEW_MODEL_B = "meta-llama/llama-3.3-70b:free";

const originalFetch = globalThis.fetch;
const originalEnv = {
  TEXT_AGENT_PROVIDER: process.env.TEXT_AGENT_PROVIDER,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
};

const reviewReport = (status, sequence) => ({
  reportId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
  taskDescription: "Review content for review",
  summary: `Frozen ${status} review verdict.`,
  status,
  findings: [],
  recommendations: [],
  metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0" },
});

const sse = (payload, requestedModel) => new Response(
  `data: ${JSON.stringify({ id: "gen-resume", model: requestedModel, choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { "x-request-id": "resume-fixture" } },
);

let currentReview = null;
let reviewFetchMode = "valid"; // valid | parse | structural | semantic
let fetchCounts = { writer: 0, review: 0, other: 0 };
let frozenWriterWorkflowId = null;

function installFrozenFetch() {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = String(body.messages?.[1]?.content ?? "");
    if (isResearchPrompt(prompt)) {
      fetchCounts.other += 1;
      return sse(canonicalResearchPayload(prompt), body.model);
    }
    if (prompt.includes("Writing objective")) {
      fetchCounts.writer += 1;
      return sse(await buildFrozenWriterReport(persistence, frozenWriterWorkflowId), body.model);
    }
    if (prompt.includes("ReviewReport") || prompt.includes("review")) {
      fetchCounts.review += 1;
      if (reviewFetchMode === "parse") return sse("this is not json", body.model);
      if (reviewFetchMode === "structural") return sse({ no: "valid", review: "shape" }, body.model);
      if (reviewFetchMode === "semantic") return sse({ ...reviewReport("approved", 999), taskDescription: "WRONG task description" }, body.model);
      return sse(currentReview, body.model);
    }
    fetchCounts.other += 1;
    return sse({}, body.model);
  };
}

async function buildFrozenWriterReport(persistence, workflowId) {
  const artifacts = await persistence.listArtifacts(workflowId);
  const brief = [...artifacts].reverse().find((a) => a.kind === "evidence_backed_content_brief" && a.status === "completed");
  const payload = brief.payload;
  const allowedIds = new Set((payload.claims ?? []).filter((c) => c.status === "SUPPORTED").flatMap((c) => c.sourceIds ?? []));
  const allowed = (payload.researchSources ?? []).filter((s) => allowedIds.has(s.sourceId));
  return {
    contentId: "00000000-0000-4000-8000-0000000000WR",
    taskDescription: "Write content for writer",
    objective: "Resume fixture objective",
    title: "Resume fixture title",
    content: "Revised content body for the review resume fixture.",
    summary: "Resume fixture summary.",
    sourceReferences: allowed.map((s) => ({ sourceId: s.sourceId, title: s.title, url: s.url })),
    status: "completed",
    metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: brief.artifactId },
  };
}

function mediaBoundary(counts) {
  const success = (request, output) => ({
    status: "success",
    resultId: `${request.capabilityId}-${request.requestId}`,
    capabilityId: request.capabilityId,
    output,
    evidence: { evidenceId: `e-${request.requestId}`, capabilityId: request.capabilityId, agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, providerInvoked: true, resultStatus: "success" },
  });
  return {
    boundary: {
      executeCapability: async (request) => {
        counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1;
        if (request.capabilityId === "web.search") return success(request, { results: canonicalResearchResults });
        return success(request, {});
      },
    },
  };
}

let pool;
let persistence;
let queue;
let control;
let revisionDispatcher;
let resumeDispatcher;

async function resetTables() {
  assertTestDatabaseIsolation();
  await pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
             workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions,
             control_approvals, control_commands, review_revision_tasks, revision_dispatches,
             review_resume_dispatches, control_configuration_events,
             execution_provenance, execution_lifecycle_events, execution_failure_fallback_events,
             workflow_recovery_dispatches, provider_publications, provider_upload_sessions
      RESTART IDENTITY CASCADE`,
  );
}

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await resetTables();
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  revisionDispatcher = new PostgresRevisionDispatcher(pool, persistence);
  resumeDispatcher = new PostgresReviewResumeDispatcher(pool, persistence);
  process.env.TEXT_AGENT_PROVIDER = "deterministic";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  installFrozenFetch();
});

after(async () => {
  globalThis.fetch = originalFetch;
  process.env.TEXT_AGENT_PROVIDER = originalEnv.TEXT_AGENT_PROVIDER;
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
  process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL;
  await persistence.close();
});

async function waitForDb(check, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timeout: ${label}`);
}

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function makeWorker(counts) {
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts) });
  return new WorkflowWorker({
    queue,
    persistence,
    executor,
    pollMs: 10,
    control,
    resolveCommandConfiguration: (projectId) => control.agentConfigurationMap(projectId),
  });
}

/**
 * Drive a full revision cycle to a TECHNICAL review failure:
 * produce (changes_requested) -> revision vN (frozen writer + deterministic
 * seo/brand succeed; review fails technically).
 */
async function setupFailedReviewScenario(label, { reviewModel = REVIEW_MODEL_A } = {}) {
  const id = runId();
  const workflowId = `wf-resume-${label}-${id}`;
  const projectId = `proj-resume-${label}-${id}`;
  const commandId = `command-resume-${label}-${id}`;
  frozenWriterWorkflowId = workflowId;
  fetchCounts = { writer: 0, review: 0, other: 0 };
  reviewFetchMode = "valid";
  currentReview = reviewReport("changes_requested", 1);

  await control.saveConfigurationEvent({ scopeType: "AGENT", scopeId: `${projectId}:review`, provider: "openrouter", model: reviewModel, action: "SET", rationale: "fixture: review route" });
  await control.saveConfigurationEvent({ scopeType: "AGENT", scopeId: `${projectId}:writer`, provider: "openrouter", model: WRITER_MODEL, action: "SET", rationale: "fixture: frozen writer route" });
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "Produce the review resume fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  await queue.submit({ submissionKey: `res:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "Produce the review resume fixture" } });
  await queue.enqueue(workflowId, `res:${workflowId}`);

  // 1. produce -> changes_requested -> PENDING revision task
  const counts = {};
  const worker1 = makeWorker(counts);
  assert.equal(await worker1.runOnce(), true);
  const tasks = await control.listReviewRevisionTasks(projectId);
  assert.equal(tasks.length, 1, "PENDING revision task after produce");
  const task = tasks[0];

  // 2. authorize the revision; the writer runs frozen, seo/brand deterministic,
  //    the review fails technically (parse failure).
  await revisionDispatcher.authorizeAndDispatch({ taskId: task.taskId, authorizedBy: "owner", rationale: "fixture revision" });
  reviewFetchMode = "parse";
  const worker2 = makeWorker(counts);
  assert.equal(await worker2.runOnce(), true);
  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "FAILED", "revision run fails technically at the review");
  const settled = await control.getReviewRevisionTask(task.taskId);
  assert.equal(settled.status, "FAILED");

  // 3. Collect the frozen package state for assertions.
  const artifacts = await persistence.listArtifacts(workflowId);
  const workflowCreated = (await persistence.loadWorkflow(workflowId)).createdAt;
  const revisionArtifacts = (kind) => artifacts.filter((a) => a.kind === kind && a.payload?.revision?.revisionTaskId === task.taskId);
  const failedReviewExecution = (await persistence.listExecutionProvenance(workflowId))
    .filter((r) => r.agentId === "review" && r.startedAt > workflowCreated)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .find((r) => r.status === "failed");
  assert.ok(failedReviewExecution, "failed review execution exists");
  return {
    workflowId, projectId, commandId, counts, task: settled,
    frozenWriterArtifactId: revisionArtifacts("writer_report").at(-1).artifactId,
    frozenSeoArtifactId: revisionArtifacts("seo_report").at(-1).artifactId,
    frozenBrandArtifactId: revisionArtifacts("brand_report").at(-1).artifactId,
    failedReviewExecutionId: failedReviewExecution.executionId,
    priorArtifacts: new Map(artifacts.map((a) => [a.artifactId, JSON.stringify(a.payload)])),
  };
}

async function authorizeResume(setup, rationale = "Owner authorizes the review-only technical resume") {
  return resumeDispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner", rationale });
}

const commandRow = async (setup) => (await control.listCommands(setup.projectId)).find((c) => c.command_id === setup.commandId);

const gateRunning = async (workflowId) => {
  const w = await persistence.loadWorkflow(workflowId);
  return w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === GATE)?.status === "running";
};

async function assertOnlyReviewExecuted(setup, resumeStart, label) {
  const executions = (await persistence.listExecutionProvenance(setup.workflowId)).filter((r) => r.startedAt >= resumeStart);
  for (const execution of executions) {
    assert.equal(execution.agentId, "review", `${label}: only the review executes (found ${execution.agentId})`);
  }
  assert.ok(executions.length >= 1, `${label}: the review executed`);
  const instance = await persistence.loadWorkflow(setup.workflowId);
  for (const step of ["writer", "seo", "brand"]) {
    const record = instance.steps.find((s) => s.stepId === step);
    assert.equal(record.status, "completed", `${label}: ${step} remains completed`);
    assert.equal(record.attempts, 1, `${label}: ${step} not re-attempted`);
  }
  for (const step of ["planner-initial", "research", "planner-synthesis"]) {
    const record = instance.steps.find((s) => s.stepId === step);
    assert.equal(record.status, "completed", `${label}: ${step} preserved`);
  }
}

async function assertFrozenPackageUsed(setup, resumeStart, label) {
  const reviewExecution = (await persistence.listExecutionProvenance(setup.workflowId))
    .filter((r) => r.agentId === "review" && r.startedAt >= resumeStart).at(-1);
  const ctx = reviewExecution?.configuration?.context;
  assert.ok(ctx, `${label}: review execution context retained`);
  assert.equal(ctx.artifact.artifactId, setup.frozenWriterArtifactId, `${label}: FROZEN writer used`);
  assert.equal(ctx.references.seo.artifactId, setup.frozenSeoArtifactId, `${label}: FROZEN seo used`);
  assert.equal(ctx.references.brand.artifactId, setup.frozenBrandArtifactId, `${label}: FROZEN brand used`);
}

async function assertPriorArtifactsImmutable(setup) {
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  for (const [artifactId, payload] of setup.priorArtifacts) {
    const current = artifacts.find((a) => a.artifactId === artifactId);
    assert.ok(current, `prior artifact ${artifactId} still present`);
    assert.equal(JSON.stringify(current.payload), payload, `prior artifact ${artifactId} payload unchanged`);
  }
}

async function assertNoMediaWork(setup) {
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  for (const kind of ["scene_plan", "narration_artifact", "timeline_plan", "scene_visual_artifact", "wan_authorization", "scene_video_clip", "final_media_artifact"]) {
    assert.equal(artifacts.some((a) => a.kind === kind), false, `no ${kind}`);
  }
}

// ---------------------------------------------------------------------------
// CASE A — approved: gate PENDING, frozen package, no content re-execution.
// ---------------------------------------------------------------------------

test("review resume with approved verdict stops at the pre-production owner gate using the frozen package", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("approve");
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 2);
  const resume = await authorizeResume(setup);
  assert.equal(resume.created, true);
  assert.equal(resume.revisionVersion, setup.task.revisionVersion, "NO revision version increment");
  assert.equal(resume.resumeAttempt, 1);
  assert.equal(resume.frozenWriterArtifactId, setup.frozenWriterArtifactId);
  assert.equal(resume.frozenSeoArtifactId, setup.frozenSeoArtifactId);
  assert.equal(resume.frozenBrandArtifactId, setup.frozenBrandArtifactId);
  assert.equal((await commandRow(setup)).status, "REVIEW_RESUME_AUTHORIZED");

  const resumeStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "gate pending");

  await assertOnlyReviewExecuted(setup, resumeStart, "A");
  await assertFrozenPackageUsed(setup, resumeStart, "A");
  await assertPriorArtifactsImmutable(setup);
  await assertNoMediaWork(setup);

  const artifacts = await persistence.listArtifacts(setup.workflowId);
  const freshReview = artifacts.filter((a) => a.kind === "review_report" && a.createdAt > setup.task.createdAt).at(-1);
  assert.ok(freshReview, "fresh review artifact persisted");
  assert.equal(freshReview.payload.status, "approved");
  assert.equal(freshReview.payload.reviewResume.resumeId, resume.resumeId, "review artifact carries the resume lineage");
  assert.equal(freshReview.payload.reviewResume.failedReviewExecutionId, setup.failedReviewExecutionId);
  assert.equal(freshReview.payload.reviewResume.frozenWriterArtifactId, setup.frozenWriterArtifactId);
  assert.equal(freshReview.payload.revision.revisionTaskId, setup.task.taskId, "revision lineage preserved");

  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  const approval = await control.getApproval(approvalId);
  assert.equal(approval.agentRecommendation.gateType, "PRE_PRODUCTION_CONTENT_APPROVAL");
  assert.equal(approval.agentRecommendation.reviewArtifactId, freshReview.artifactId);
  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.steps.find((s) => s.stepId === "director")?.status, "pending", "director not started");
  await waitForDb(async () => (await control.getReviewRevisionTask(setup.task.taskId))?.status === "COMPLETED", "task completed at the gate");

  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// CASE B — human_review_required: same gate, PENDING.
// ---------------------------------------------------------------------------

test("review resume with human_review_required verdict stops at the pre-production owner gate", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("human");
  reviewFetchMode = "valid";
  currentReview = reviewReport("human_review_required", 3);
  await authorizeResume(setup);
  const resumeStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "gate pending");
  await assertOnlyReviewExecuted(setup, resumeStart, "B");
  await assertFrozenPackageUsed(setup, resumeStart, "B");
  await assertNoMediaWork(setup);
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  const freshReview = artifacts.filter((a) => a.kind === "review_report" && a.createdAt > setup.task.createdAt).at(-1);
  assert.equal(freshReview.payload.status, "human_review_required");
  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// CASE C — changes_requested: NEW revision task, no automatic loop.
// ---------------------------------------------------------------------------

test("review resume with changes_requested verdict creates a NEW revision task and stops", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("changes");
  reviewFetchMode = "valid";
  currentReview = reviewReport("changes_requested", 4);
  await authorizeResume(setup);
  const resumeStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true);

  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "REVISION_REQUIRED");
  await assertOnlyReviewExecuted(setup, resumeStart, "C");
  await assertFrozenPackageUsed(setup, resumeStart, "C");
  await assertNoMediaWork(setup);

  const tasks = await control.listReviewRevisionTasks(setup.projectId);
  assert.equal(tasks.length, 2, "a NEW revision task exists");
  const sourceTask = tasks.find((t) => t.taskId === setup.task.taskId);
  const nextTask = tasks.find((t) => t.taskId !== setup.task.taskId);
  assert.equal(sourceTask.status, "COMPLETED", "source task completed at the business boundary");
  assert.equal(nextTask.status, "PENDING", "next task awaits an explicit owner authorization");
  assert.equal(nextTask.revisionVersion, 0, "next task is a fresh revision cycle");
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  const freshReview = artifacts.filter((a) => a.kind === "review_report" && a.createdAt > setup.task.createdAt).at(-1);
  assert.equal(nextTask.reviewArtifactId, freshReview.artifactId, "next task links the fresh review");
  assert.equal(nextTask.writerArtifactId, setup.frozenWriterArtifactId, "next task links the frozen (current) writer");
  assert.equal(nextTask.seoArtifactId, setup.frozenSeoArtifactId, "next task links the frozen (current) seo");
  assert.equal(nextTask.brandArtifactId, setup.frozenBrandArtifactId, "next task links the frozen (current) brand");
  assert.equal((await control.listApprovals(setup.projectId)).filter((a) => a.targetId === `${setup.workflowId}:${GATE}`).length, 0, "no gate approval");
  const openJobs = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1 AND status IN ('queued','running')`, [setup.workflowId]);
  assert.equal(openJobs.rows[0].n, 0, "no automatic next cycle");
  // A new review resume is NOT eligible: the source task is COMPLETED.
  await assert.rejects(() => authorizeResume(setup, "should be rejected"), /REVIEW_RESUME_NOT_ELIGIBLE:task_status_COMPLETED/);
});

// ---------------------------------------------------------------------------
// CASE D — blocked: durable BUSINESS_BLOCKED.
// ---------------------------------------------------------------------------

test("review resume with blocked verdict routes to the durable blocked state", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("blocked");
  reviewFetchMode = "valid";
  currentReview = reviewReport("blocked", 5);
  await authorizeResume(setup);
  const resumeStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true);
  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "BUSINESS_BLOCKED");
  await assertOnlyReviewExecuted(setup, resumeStart, "D");
  await assertNoMediaWork(setup);
  assert.equal((await control.getReviewRevisionTask(setup.task.taskId)).status, "COMPLETED");
  assert.equal((await control.listReviewRevisionTasks(setup.projectId)).length, 1, "no new revision task");
});

// ---------------------------------------------------------------------------
// CASES E–G — technical failures remain technical; no business outcome.
// ---------------------------------------------------------------------------

for (const [mode, expectedClassification] of [["parse", "JSON_PARSE_FAILED"], ["structural", "STRUCTURAL_VALIDATION_FAILED"], ["semantic", "SEMANTIC_VALIDATION_FAILED"]]) {
  test(`review resume with ${mode} failure remains a technical failure and allows a later explicit re-authorization`, { timeout: 120000 }, async () => {
    const setup = await setupFailedReviewScenario(`tech-${mode}`);
    reviewFetchMode = mode;
    await authorizeResume(setup);
    const resumeStart = new Date().toISOString();
    const worker = makeWorker(setup.counts);
    assert.equal(await worker.runOnce(), true);

    const instance = await persistence.loadWorkflow(setup.workflowId);
    assert.equal(instance.state, "FAILED", `${mode}: workflow FAILED (technical)`);
    await assertOnlyReviewExecuted(setup, resumeStart, mode);
    await assertNoMediaWork(setup);
    const artifacts = await persistence.listArtifacts(setup.workflowId);
    assert.equal(artifacts.filter((a) => a.kind === "review_report" && a.createdAt > setup.task.createdAt).length, 0, `${mode}: no fresh review artifact`);
    const task = await control.getReviewRevisionTask(setup.task.taskId);
    assert.equal(task.status, "FAILED", `${mode}: task settles FAILED (technical)`);
    assert.equal((await control.listReviewRevisionTasks(setup.projectId)).length, 1, `${mode}: no business revision task`);
    const failedExecution = (await persistence.listExecutionProvenance(setup.workflowId)).filter((r) => r.agentId === "review" && r.startedAt >= resumeStart).at(-1);
    assert.equal(failedExecution.status, "failed");
    assert.equal(failedExecution.configuration.lifecycleState, expectedClassification);

    // A second technical failure permits exactly one more explicit attempt (r2).
    const reauthorize = await authorizeResume(setup, "owner re-authorizes after reviewing the second technical failure");
    assert.equal(reauthorize.created, true);
    assert.equal(reauthorize.resumeAttempt, 2, "next resume attempt r2");
    assert.equal(reauthorize.revisionVersion, setup.task.revisionVersion, "still no version increment");
    // Drain r2 to a terminal state with a valid verdict.
    reviewFetchMode = "valid";
    currentReview = reviewReport("approved", 6);
    const worker2 = makeWorker(setup.counts);
    const run2 = worker2.runOnce();
    await waitForDb(() => gateRunning(setup.workflowId), "r2 gate pending");
    const approvalId = `approval-${setup.workflowId}-${GATE}`;
    await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "r2 approval created");
    await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
    assert.equal(await run2, true);
    assert.equal((await control.getReviewRevisionTask(setup.task.taskId)).status, "COMPLETED");
  });
}

// ---------------------------------------------------------------------------
// CASE H — duplicate authorization: idempotent.
// ---------------------------------------------------------------------------

test("duplicate review resume authorization is idempotent (same dispatch, no second job)", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("dup");
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 7);
  const first = await authorizeResume(setup);
  assert.equal(first.created, true);
  const jobsAfterFirst = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId]);

  // Duplicate while the resume is active (task IN_PROGRESS).
  const duplicate = await authorizeResume(setup, "duplicate authorization");
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.resumeId, first.resumeId);
  assert.equal(duplicate.jobId, first.jobId);
  const rows = await pool.query(`SELECT count(*)::int AS n FROM review_resume_dispatches WHERE task_id=$1`, [setup.task.taskId]);
  assert.equal(rows.rows[0].n, 1, "exactly one resume row");
  const jobsAfterDuplicate = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(jobsAfterDuplicate.rows[0].n, jobsAfterFirst.rows[0].n, "no second queue job");

  // Drain to a terminal state.
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "gate pending");
  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// CASE I — concurrent authorization: exactly one dispatch.
// ---------------------------------------------------------------------------

test("concurrent review resume authorization results in exactly one dispatch", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("concurrent");
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 8);
  const jobsBefore = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId]);
  const [a, b] = await Promise.all([
    resumeDispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner-a", rationale: "concurrent A" }),
    resumeDispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner-b", rationale: "concurrent B" }),
  ]);
  assert.equal(a.created || b.created, true, "exactly one concurrent caller dispatched");
  assert.equal(a.created && b.created, false, "never two dispatches");
  assert.equal(a.resumeId, b.resumeId, "losing caller replays the canonical dispatch");
  assert.equal(a.jobId, b.jobId, "both callers observe the same canonical job");
  const rows = await pool.query(`SELECT count(*)::int AS n FROM review_resume_dispatches WHERE task_id=$1`, [setup.task.taskId]);
  assert.equal(rows.rows[0].n, 1, "exactly one resume row");
  const jobs = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(jobs.rows[0].n - jobsBefore.rows[0].n, 1, "resume job enqueued exactly once");
  const taskAfter = await control.getReviewRevisionTask(setup.task.taskId);
  assert.equal(taskAfter.status, "IN_PROGRESS", "winning mutation preserves the pending revision task");

  // Drain.
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "gate pending");
  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// CASE J — duplicate queue delivery: no duplicate review artifacts.
// ---------------------------------------------------------------------------

test("duplicate queue delivery after the resume terminal state creates no duplicate review artifact", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("dupjob");
  reviewFetchMode = "valid";
  currentReview = reviewReport("changes_requested", 9);
  await authorizeResume(setup);
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true);
  const artifactsAfter = async () => (await persistence.listArtifacts(setup.workflowId)).filter((a) => a.kind === "review_report").length;
  const tasksAfter = async () => (await control.listReviewRevisionTasks(setup.projectId)).length;
  const reviews = await artifactsAfter();
  const tasks = await tasksAfter();

  await queue.enqueue(setup.workflowId, `res:${setup.workflowId}`);
  const worker2 = makeWorker(setup.counts);
  assert.equal(await worker2.runOnce(), true);
  assert.equal(await artifactsAfter(), reviews, "no duplicate review artifact");
  assert.equal(await tasksAfter(), tasks, "no duplicate revision task");
});

// ---------------------------------------------------------------------------
// CASE K — restart between dispatch and execution.
// ---------------------------------------------------------------------------

test("a restart between resume dispatch and execution runs only the review from the frozen package", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("restart");
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 10);
  const resume = await authorizeResume(setup);

  // Simulate the restart: a completely fresh worker runtime claims the job.
  const resumeStart = new Date().toISOString();
  const worker = makeWorker(setup.counts); // fresh construction = new process equivalent
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "gate pending after restart");
  await assertOnlyReviewExecuted(setup, resumeStart, "K");
  await assertFrozenPackageUsed(setup, resumeStart, "K");
  await assertPriorArtifactsImmutable(setup);
  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
  assert.equal((await control.getReviewRevisionTask(setup.task.taskId)).status, "COMPLETED");
});

// ---------------------------------------------------------------------------
// MODEL POLICY FIXTURE (§13) — canonical resolution, model A then model B.
// ---------------------------------------------------------------------------

test("the review resume model resolves through the canonical control plane (model A, then model B; no ambient fallback)", { timeout: 120000 }, async () => {
  // Scenario 1: review AGENT override = model A.
  const setupA = await setupFailedReviewScenario("modelA", { reviewModel: REVIEW_MODEL_A });
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 11);
  const resumeA = await authorizeResume(setupA);
  assert.equal(resumeA.created, true);
  const resumeAStart = new Date().toISOString();
  const workerA = makeWorker(setupA.counts);
  const runA = workerA.runOnce();
  await waitForDb(() => gateRunning(setupA.workflowId), "model A gate pending");
  const execA = (await persistence.listExecutionProvenance(setupA.workflowId)).filter((r) => r.agentId === "review" && r.startedAt >= resumeAStart).at(-1);
  assert.equal(execA.configuration.requestedModel, REVIEW_MODEL_A, "resume resolves model A");
  assert.equal(execA.provider, "openrouter");
  const approvalA = `approval-${setupA.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalA))?.status === "PENDING", "model A approval");
  await control.decideApproval(approvalA, "REJECT", "teardown");
  assert.equal(await runA, true);

  // Scenario 2: a DIFFERENT project with review AGENT override = model B.
  const setupB = await setupFailedReviewScenario("modelB", { reviewModel: REVIEW_MODEL_B });
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 12);
  const resumeB = await authorizeResume(setupB);
  assert.equal(resumeB.created, true);
  const resumeBStart = new Date().toISOString();
  const workerB = makeWorker(setupB.counts);
  const runB = workerB.runOnce();
  await waitForDb(() => gateRunning(setupB.workflowId), "model B gate pending");
  const execB = (await persistence.listExecutionProvenance(setupB.workflowId)).filter((r) => r.agentId === "review" && r.startedAt >= resumeBStart).at(-1);
  assert.equal(execB.configuration.requestedModel, REVIEW_MODEL_B, "resume resolves model B after the explicit configuration change");
  assert.equal(execB.provider, "openrouter");
  const approvalB = `approval-${setupB.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalB))?.status === "PENDING", "model B approval");
  await control.decideApproval(approvalB, "REJECT", "teardown");
  assert.equal(await runB, true);
});

// ---------------------------------------------------------------------------
// ELIGIBILITY GUARD (§6, §7) — fail-closed cases.
// ---------------------------------------------------------------------------

test("the eligibility guard fails closed for business outcomes, later review artifacts, and missing frozen artifacts", { timeout: 120000 }, async () => {
  // 1. Business verdict not eligible: a task whose review produced a valid
  //    business verdict settles COMPLETED (proven in case C); here we verify a
  //    FAILED task whose latest review SUCCEEDED technically is rejected.
  const setup = await setupFailedReviewScenario("guard");
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 13);
  await authorizeResume(setup);
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "gate pending");
  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "teardown");
  assert.equal(await run, true);
  await assert.rejects(() => authorizeResume(setup, "completed task"), /REVIEW_RESUME_NOT_ELIGIBLE:task_status_COMPLETED/);

  // 2. Later review artifact: seed a review_report artifact created after the
  //    failed execution — the resume must fail closed before any dispatch.
  const setup2 = await setupFailedReviewScenario("guard2");
  const failedExecution = (await persistence.listExecutionProvenance(setup2.workflowId)).filter((r) => r.executionId === setup2.failedReviewExecutionId)[0];
  await persistence.saveArtifact({
    artifactId: `art-${setup2.workflowId}-later-review`,
    kind: "review_report",
    producerAgent: "review",
    workflowId: setup2.workflowId,
    correlationId: `corr-${setup2.workflowId}`,
    status: "completed",
    payload: reviewReport("approved", 14),
    contentType: "application/json",
    schemaVersion: "1.0",
    createdAt: new Date(Date.parse(failedExecution.startedAt) + 60_000).toISOString(),
  });
  await assert.rejects(() => authorizeResume(setup2, "later review exists"), /REVIEW_RESUME_NOT_ELIGIBLE:LATER_REVIEW_ARTIFACT_EXISTS/);
  const rows = await pool.query(`SELECT count(*)::int AS n FROM review_resume_dispatches WHERE task_id=$1`, [setup2.task.taskId]);
  assert.equal(rows.rows[0].n, 0, "no resume dispatch was created");

  // 3. Missing frozen artifact: delete the revised brand artifact's revision
  //    linkage by seeding a scenario without revised artifacts. A task with a
  //    failed review but no frozen-package artifacts must fail closed.
  const setup3 = await setupFailedReviewScenario("guard3");
  await pool.query(`DELETE FROM artifacts WHERE artifact_id=$1`, [setup3.frozenBrandArtifactId]);
  await assert.rejects(() => authorizeResume(setup3, "missing brand"), /REVIEW_RESUME_NOT_ELIGIBLE:FROZEN_BRAND_ARTIFACT_MISSING/);
});

// ---------------------------------------------------------------------------
// REVISION V1 IMMUTABILITY — the failed review execution is never mutated.
// ---------------------------------------------------------------------------

test("the failed review execution and prior revision artifacts remain unchanged across the resume", { timeout: 120000 }, async () => {
  const setup = await setupFailedReviewScenario("immutable");
  const failedBefore = (await persistence.listExecutionProvenance(setup.workflowId)).find((r) => r.executionId === setup.failedReviewExecutionId);
  reviewFetchMode = "valid";
  currentReview = reviewReport("approved", 15);
  await authorizeResume(setup);
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "gate pending");
  const failedAfter = (await persistence.listExecutionProvenance(setup.workflowId)).find((r) => r.executionId === setup.failedReviewExecutionId);
  assert.deepEqual(JSON.stringify(failedAfter.configuration), JSON.stringify(failedBefore.configuration), "failed review execution unchanged");
  assert.equal(failedAfter.status, failedBefore.status);
  await assertPriorArtifactsImmutable(setup);
  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "teardown");
  assert.equal(await run, true);
});
