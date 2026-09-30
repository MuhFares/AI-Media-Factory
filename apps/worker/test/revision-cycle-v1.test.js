/**
 * REVISION CYCLE V1 — real persistent-worker fixtures (provider-free).
 *
 * Proves the governed revision cycle end-to-end on the isolated test DB:
 *  - PENDING task + explicit owner AUTHORIZE_REVISION (durable, idempotent,
 *    exactly-once dispatch, concurrency-safe)
 *  - targeted Writer revision consuming the authoritative Review findings
 *    (new execution identities; prior artifacts immutable; no upstream replay)
 *  - downstream SEO/Brand regeneration from the LATEST artifacts
 *  - fresh Review routing for all four verdicts:
 *      approved / human_review_required -> PRE_PRODUCTION_OWNER_GATE PENDING
 *      changes_requested                -> NEW durable revision task
 *      blocked                          -> durable blocked business state
 *  - technical failure remains technical FAILED (task FAILED, no auto-retry)
 *  - duplicate queue delivery cannot duplicate revised artifacts
 *
 * Review verdicts and (in one case) the Writer revision are frozen OpenRouter
 * SSE fixtures; no live provider call is made. Planner/Research inputs are
 * reused (never replayed).
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
} from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { buildDefaultEngine, createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";
import { canonicalResearchPayload, canonicalResearchResults, isResearchPrompt } from "./canonical-production-fixtures.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const GATE = "pre-production-owner-gate";
const fixtureAudioUrl = `data:audio/wav;base64,${(
  await readFile(new URL("../../../output/tts-benchmark/voicetut-short.wav", import.meta.url))
).toString("base64")}`;

// ---------------------------------------------------------------------------
// Frozen provider fixtures (the only fetch consumers in these tests).
// ---------------------------------------------------------------------------

let currentReview = null;
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
  findings: [{ id: "FIND-001", title: "Expand the practical step", category: "correctness", severity: "medium", description: "The content omits the practical application.", recommendation: "Add the practical application and a concluding takeaway." }],
  recommendations: [{ priority: "medium", description: "Expand the content to cover the practical step and conclusion." }],
  metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" },
});

const sse = (payload) => new Response(
  `data: ${JSON.stringify({ id: "gen-revision", model: "dots-studio/dots-3-note-preview:free", choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
  { status: 200, headers: { "x-request-id": "revision-fixture" } },
);

// Captured frozen-writer prompts (only populated by the frozen-writer test).
let writerPrompts = null;
let frozenWriterWorkflowId = null;

function installFrozenFetch() {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const userPrompt = String(body.messages?.[1]?.content ?? "");
    if (isResearchPrompt(userPrompt)) return sse(canonicalResearchPayload(userPrompt));
    if (writerPrompts !== null && userPrompt.includes("Writing objective")) {
      writerPrompts.push(userPrompt);
      if (currentWriterReport === null) currentWriterReport = await buildFrozenWriterReport(persistence, frozenWriterWorkflowId);
      return sse(currentWriterReport);
    }
    return sse(currentReview);
  };
}

// Frozen writer report builder — echoes the exact allowed sources of the
// durable brief so the response passes WriterAgent validation.
let currentWriterReport = null;
async function buildFrozenWriterReport(persistence, workflowId) {
  const artifacts = await persistence.listArtifacts(workflowId);
  const brief = [...artifacts].reverse().find((a) => a.kind === "evidence_backed_content_brief" && a.status === "completed");
  const payload = brief.payload;
  const allowedIds = new Set((payload.claims ?? []).filter((c) => c.status === "SUPPORTED").flatMap((c) => c.sourceIds ?? []));
  const allowed = (payload.researchSources ?? []).filter((s) => allowedIds.has(s.sourceId));
  return {
    contentId: "00000000-0000-4000-8000-0000000000WR",
    taskDescription: "Write content for writer",
    objective: "Revised objective",
    title: "Revised title",
    content: "Revised content body addressing the review findings.",
    summary: "Revised summary.",
    sourceReferences: allowed.map((s) => ({ sourceId: s.sourceId, title: s.title, url: s.url })),
    status: "completed",
    metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: brief.artifactId },
  };
}

// ---------------------------------------------------------------------------
// In-test media capability boundary (no real media provider is invoked).
// ---------------------------------------------------------------------------

function mediaBoundary(counts) {
  const success = (request, output, extra = {}) => ({
    status: "success",
    resultId: `${request.capabilityId}-${request.requestId}`,
    capabilityId: request.capabilityId,
    output,
    evidence: { evidenceId: `e-${request.requestId}`, capabilityId: request.capabilityId, agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, providerInvoked: true, resultStatus: "success", ...extra },
  });
  return {
    boundary: {
      executeCapability: async (request) => {
        counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1;
        const i = request.input ?? {};
        if (request.capabilityId === "web.search") return success(request, { results: canonicalResearchResults });
        if (request.capabilityId === "tts.generate") return success(request, { audioUrl: fixtureAudioUrl, audioId: "narration-fixture", providerId: "mock-tts", durationMs: 12640, audioIntegrity: "VALID" });
        if (request.capabilityId === "timeline.plan") return success(request, { timelineId: "timeline-revision", narrationDurationMs: i.narrationDurationMs, sceneIds: ["scene-001", "scene-002", "scene-003"] });
        if (request.capabilityId === "image.generate") return success(request, { imageId: `image-${i.sceneId}`, url: `file:///${i.sceneId}.png`, providerId: "mock-image" });
        return success(request, {});
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Isolated test-database fixtures.
// ---------------------------------------------------------------------------

let pool;
let persistence;
let queue;
let control;
let dispatcher;

async function resetTables() {
  assertTestDatabaseIsolation();
  await pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
             workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions,
             control_approvals, control_commands, review_revision_tasks, revision_dispatches,
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
  dispatcher = new PostgresRevisionDispatcher(pool, persistence);
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

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

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
    // Production-parity wiring: the same canonical control-plane resolution
    // the shared production bootstrap uses.
    resolveCommandConfiguration: (projectId) => control.agentConfigurationMap(projectId),
  });
}

/** Run the produce workflow to a durable changes_requested revision task. */
async function setupRevisionScenario(label, options = {}) {
  const id = runId();
  const workflowId = `wf-rev-${label}-${id}`;
  const projectId = `proj-rev-${label}-${id}`;
  const commandId = `command-rev-${label}-${id}`;
  frozenWriterWorkflowId = workflowId;
  currentWriterReport = null;
  currentReview = reviewReport("changes_requested", 1);
  // Canonical control-plane stage policy for this fixture project: the
  // revision dispatcher resolves and injects this map (review via AGENT
  // scope; writer optionally via AGENT scope for frozen-writer fixtures;
  // seo/brand intentionally left to ambient deterministic).
  await control.saveConfigurationEvent({ scopeType: "AGENT", scopeId: `${projectId}:review`, provider: "openrouter", model: "dots-studio/dots-3-note-preview:free", action: "SET", rationale: "fixture: frozen review route" });
  if (options.configureWriter) {
    await control.saveConfigurationEvent({ scopeType: "AGENT", scopeId: `${projectId}:writer`, provider: "openrouter", model: "dots-studio/dots-3-note-preview:free", action: "SET", rationale: "fixture: frozen writer route" });
  }
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "Produce the provider-free fixture video", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  await queue.submit({ submissionKey: `rev:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "Produce the provider-free fixture video" } });
  await queue.enqueue(workflowId, `rev:${workflowId}`);

  const counts = {};
  const worker = makeWorker(counts);
  assert.equal(await worker.runOnce(), true, "setup produce run completes");

  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "REVISION_REQUIRED");
  const tasks = await control.listReviewRevisionTasks(projectId);
  assert.equal(tasks.length, 1, "one PENDING revision task after changes_requested");
  assert.equal(tasks[0].status, "PENDING");
  assert.equal(tasks[0].revisionVersion, 0);
  const artifacts = await persistence.listArtifacts(workflowId);
  return {
    workflowId, projectId, commandId, counts,
    task: tasks[0],
    priorArtifacts: new Map(artifacts.map((a) => [a.artifactId, JSON.stringify(a.payload)])),
    priorReviewArtifactId: tasks[0].reviewArtifactId,
    priorPlannerAttempts: instance.steps.filter((s) => ["planner-initial", "research", "planner-synthesis"].includes(s.stepId)).map((s) => `${s.stepId}:${s.attempts}`),
  };
}

async function authorize(setup) {
  const result = await dispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner", rationale: "Owner authorizes Revision Cycle V1" });
  assert.equal(result.created, true, "first authorization dispatches");
  assert.equal(result.revisionVersion, 1);
  assert.ok(result.jobId > 0);
  // The dispatcher injects the canonical control-plane stage configuration
  // (the same GLOBAL→PROJECT→AGENT resolution the production worker uses).
  const instance = await persistence.loadWorkflow(setup.workflowId);
  const canonical = await control.agentConfigurationMap(setup.projectId);
  assert.deepEqual(instance.context.data.controlAgentOverrides, canonical, "revision context carries the canonical stage configuration");
  return result;
}

const commandRow = async (setup) => (await control.listCommands(setup.projectId)).find((c) => c.command_id === setup.commandId);

const gateRunning = async (workflowId) => {
  const w = await persistence.loadWorkflow(workflowId);
  return w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === GATE)?.status === "running";
};

const revisionArtifactsOf = async (workflowId) => {
  const artifacts = await persistence.listArtifacts(workflowId);
  const byKind = (kind) => artifacts.filter((a) => a.kind === kind);
  const revised = (kind) => byKind(kind).find((a) => a.payload?.revision?.revisionTaskId !== undefined);
  const prior = (kind) => byKind(kind).find((a) => a.payload?.revision === undefined);
  return { artifacts, byKind, revised, prior };
};

async function assertPriorArtifactsImmutable(setup) {
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  for (const [artifactId, payload] of setup.priorArtifacts) {
    const current = artifacts.find((a) => a.artifactId === artifactId);
    assert.ok(current, `prior artifact ${artifactId} still present`);
    assert.equal(JSON.stringify(current.payload), payload, `prior artifact ${artifactId} payload unchanged`);
  }
}

async function assertNoUpstreamReplay(setup, revisionStart) {
  const executions = (await persistence.listExecutionProvenance(setup.workflowId)).filter((r) => r.startedAt >= revisionStart);
  const agents = new Set(executions.map((r) => r.agentId));
  for (const agent of agents) assert.ok(["writer", "seo", "brand", "review"].includes(agent), `no upstream replay: unexpected ${agent}`);
  for (const agent of ["writer", "seo", "brand", "review"]) assert.ok(agents.has(agent), `revised stage ran: ${agent}`);
  const instance = await persistence.loadWorkflow(setup.workflowId);
  const plannerAttempts = instance.steps.filter((s) => ["planner-initial", "research", "planner-synthesis"].includes(s.stepId)).map((s) => `${s.stepId}:${s.attempts}`);
  assert.deepEqual(plannerAttempts, setup.priorPlannerAttempts, "planner/research steps were not replayed");
}

async function assertNoMediaWork(setup) {
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  for (const kind of ["scene_plan", "narration_artifact", "timeline_plan", "scene_visual_artifact", "visual_semantic_review", "visual_technical_qa", "wan_authorization", "scene_video_clip", "final_media_artifact"]) {
    assert.equal(artifacts.some((a) => a.kind === kind), false, `no ${kind} during revision cycle`);
  }
  for (const capability of ["tts.generate", "timeline.plan", "image.generate", "video.generate", "media.compose"]) {
    assert.equal(setup.counts[capability] ?? 0, 0, `no ${capability} provider call during revision cycle`);
  }
}

// ---------------------------------------------------------------------------
// CASE A — fresh Review approved -> PRE_PRODUCTION_OWNER_GATE PENDING.
// ---------------------------------------------------------------------------

test("revision cycle with approved fresh review stops at the pre-production owner gate", { timeout: 120000 }, async () => {
  const setup = await setupRevisionScenario("approve");
  currentReview = reviewReport("approved", 2);
  await authorize(setup);
  assert.equal((await commandRow(setup)).status, "REVISION_AUTHORIZED", "command shows the owner authorization");

  const revisionStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "pre-production owner gate pending");

  const { revised, prior } = await revisionArtifactsOf(setup.workflowId);
  for (const kind of ["writer_report", "seo_report", "brand_report", "review_report"]) {
    assert.ok(prior(kind), `prior ${kind} retained`);
    assert.ok(revised(kind), `revised ${kind} persisted`);
    assert.equal((await revisionArtifactsOf(setup.workflowId)).byKind(kind).length, 2, `exactly one revised ${kind}`);
    assert.equal(revised(kind).payload.revision.revisionTaskId, setup.task.taskId, `revised ${kind} carries the revision task lineage`);
    assert.equal(revised(kind).payload.revision.sourceReviewArtifactId, setup.priorReviewArtifactId, `revised ${kind} carries the source review artifact`);
    assert.notEqual(revised(kind).artifactId, prior(kind).artifactId, `revised ${kind} has a new identity`);
  }
  await assertPriorArtifactsImmutable(setup);
  await assertNoUpstreamReplay(setup, revisionStart);
  await assertNoMediaWork(setup);

  // Fresh Review consumed the REVISED writer artifact and completed technically.
  const freshReviewExecution = (await persistence.listExecutionProvenance(setup.workflowId))
    .filter((r) => r.agentId === "review" && r.startedAt >= revisionStart)
    .find((r) => r.configuration?.lifecycleState === "COMPLETED");
  assert.ok(freshReviewExecution, "fresh review execution COMPLETED");
  assert.equal(freshReviewExecution.configuration.context.artifact.artifactId, revised("writer_report").artifactId, "fresh review consumed the revised writer");
  assert.equal(freshReviewExecution.configuration.revisionExecution.revisionTaskId, setup.task.taskId, "fresh review carries the revision marker");

  // PENDING pre-production approval; no director; task COMPLETED.
  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "pre-production approval created");
  const approval = await control.getApproval(approvalId);
  assert.equal(approval.agentRecommendation.gateType, "PRE_PRODUCTION_CONTENT_APPROVAL");
  assert.equal(approval.agentRecommendation.reviewArtifactId, revised("review_report").artifactId);
  assert.equal(approval.ownerDecision, null);
  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.steps.find((s) => s.stepId === "director")?.status, "pending", "director not started");
  await waitForDb(async () => (await control.getReviewRevisionTask(setup.task.taskId))?.status === "COMPLETED", "source revision task completed at the gate");
  assert.equal((await commandRow(setup)).status, "REVIEW_APPROVED", "command shows the fresh review result");

  // Teardown: owner REJECT at the gate lets the worker settle (no other owner action authorized here).
  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
  assert.equal((await persistence.loadWorkflow(setup.workflowId)).state, "FAILED");
});

// ---------------------------------------------------------------------------
// CASE B — fresh Review human_review_required -> same gate, PENDING.
// ---------------------------------------------------------------------------

test("revision cycle with human_review_required fresh review stops at the pre-production owner gate", { timeout: 120000 }, async () => {
  const setup = await setupRevisionScenario("human");
  currentReview = reviewReport("human_review_required", 3);
  await authorize(setup);
  const revisionStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "pre-production owner gate pending");

  const { revised } = await revisionArtifactsOf(setup.workflowId);
  assert.ok(revised("review_report"), "fresh review artifact persisted");
  assert.equal(revised("review_report").payload.status, "human_review_required");
  await assertPriorArtifactsImmutable(setup);
  await assertNoUpstreamReplay(setup, revisionStart);
  await assertNoMediaWork(setup);

  const approvalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  const approval = await control.getApproval(approvalId);
  assert.equal(approval.agentRecommendation.reviewArtifactId, revised("review_report").artifactId, "approval linked to the fresh review artifact");
  await waitForDb(async () => (await control.getReviewRevisionTask(setup.task.taskId))?.status === "COMPLETED", "task completed");
  assert.equal((await commandRow(setup)).status, "REVIEW_HUMAN_REVIEW_REQUIRED", "command shows the fresh review result");

  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// CASE C — fresh Review changes_requested -> NEW durable revision task.
// ---------------------------------------------------------------------------

test("revision cycle with changes_requested fresh review creates a new durable revision task", { timeout: 120000 }, async () => {
  const setup = await setupRevisionScenario("changes");
  currentReview = reviewReport("changes_requested", 4);
  await authorize(setup);
  const revisionStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true, "revision run terminates at REVISION_REQUIRED");

  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "REVISION_REQUIRED");
  const { revised } = await revisionArtifactsOf(setup.workflowId);
  assert.ok(revised("review_report"), "fresh review artifact persisted");
  await assertPriorArtifactsImmutable(setup);
  await assertNoUpstreamReplay(setup, revisionStart);
  await assertNoMediaWork(setup);

  const tasks = await control.listReviewRevisionTasks(setup.projectId);
  assert.equal(tasks.length, 2, "a NEW revision task exists alongside the source task");
  const sourceTask = tasks.find((t) => t.taskId === setup.task.taskId);
  const nextTask = tasks.find((t) => t.taskId !== setup.task.taskId);
  assert.equal(sourceTask.status, "COMPLETED", "source task completed");
  assert.equal(nextTask.status, "PENDING", "next task awaits an explicit owner authorization");
  assert.equal(nextTask.reviewArtifactId, revised("review_report").artifactId, "next task links the fresh review artifact");
  assert.equal(nextTask.reviewExecutionId, revised("review_report").payload.revision.sourceReviewExecutionId === undefined ? nextTask.reviewExecutionId : nextTask.reviewExecutionId);
  assert.equal(nextTask.writerArtifactId, revised("writer_report").artifactId, "next task links the REVISED writer (latest artifact)");
  assert.equal(nextTask.seoArtifactId, revised("seo_report").artifactId, "next task links the revised seo");
  assert.equal(nextTask.brandArtifactId, revised("brand_report").artifactId, "next task links the revised brand");
  assert.ok(nextTask.findings.length > 0 && nextTask.recommendations.length > 0, "next task retains findings/recommendations");
  assert.equal((await control.listApprovals(setup.projectId)).filter((a) => a.targetId === `${setup.workflowId}:${GATE}`).length, 0, "no pre-production approval");

  const command = await commandRow(setup);
  assert.equal(command.status, "REVISION_REQUIRED");
  assert.equal(command.visible_result.reviewArtifactId, revised("review_report").artifactId);

  // No automatic revision loop: nothing else is queued.
  const openJobs = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1 AND status IN ('queued','running')`, [setup.workflowId]);
  assert.equal(openJobs.rows[0].n, 0, "no automatic revision dispatch");
});

// ---------------------------------------------------------------------------
// CASE D — fresh Review blocked -> durable blocked business state.
// ---------------------------------------------------------------------------

test("revision cycle with blocked fresh review routes to the durable blocked state", { timeout: 120000 }, async () => {
  const setup = await setupRevisionScenario("blocked");
  currentReview = reviewReport("blocked", 5);
  await authorize(setup);
  const revisionStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true, "revision run terminates at BUSINESS_BLOCKED");

  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "BUSINESS_BLOCKED");
  const { revised } = await revisionArtifactsOf(setup.workflowId);
  assert.ok(revised("review_report"), "fresh review artifact persisted");
  await assertPriorArtifactsImmutable(setup);
  await assertNoUpstreamReplay(setup, revisionStart);
  await assertNoMediaWork(setup);
  assert.equal((await control.listReviewRevisionTasks(setup.projectId)).length, 1, "no new revision task for a blocked verdict");
  assert.equal((await control.getReviewRevisionTask(setup.task.taskId)).status, "COMPLETED", "source task completed");
  assert.equal((await commandRow(setup)).status, "BUSINESS_BLOCKED");
});

// ---------------------------------------------------------------------------
// Idempotency, concurrency, duplicate delivery.
// ---------------------------------------------------------------------------

test("revision authorization is idempotent, concurrency-safe, and duplicate delivery cannot duplicate revised artifacts", { timeout: 120000 }, async () => {
  const setup = await setupRevisionScenario("idempotent");

  // Concurrent owner authorization: exactly one dispatch.
  const [a, b] = await Promise.all([
    dispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner-a", rationale: "concurrent authorization A" }),
    dispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner-b", rationale: "concurrent authorization B" }),
  ]);
  assert.equal(a.created || b.created, true, "exactly one concurrent caller dispatched");
  assert.equal(a.created && b.created, false, "never two dispatches");
  const dispatchRows = await pool.query(`SELECT * FROM revision_dispatches WHERE task_id=$1`, [setup.task.taskId]);
  assert.equal(dispatchRows.rows.length, 1, "exactly one durable dispatch row");
  const jobsAfterAuthorize = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(jobsAfterAuthorize.rows[0].n, 2, "one produce job + one revision job only");

  // Duplicate sequential authorization after dispatch: no-op.
  const duplicate = await dispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner", rationale: "duplicate authorization" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.dispatchId, dispatchRows.rows[0].dispatch_id);
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM revision_dispatches WHERE task_id=$1`, [setup.task.taskId])).rows[0].n, 1, "still one dispatch row");
  const task = await control.getReviewRevisionTask(setup.task.taskId);
  assert.equal(task.status, "IN_PROGRESS", "task is in progress");

  // Run the revision (fresh review changes_requested -> terminal).
  currentReview = reviewReport("changes_requested", 6);
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true);
  const { byKind } = await revisionArtifactsOf(setup.workflowId);
  assert.equal(byKind("writer_report").length, 2, "one revised writer artifact");
  assert.equal(byKind("review_report").length, 2, "one fresh review artifact");
  assert.equal((await control.listReviewRevisionTasks(setup.projectId)).length, 2, "one next revision task");

  // Duplicate queue delivery after the terminal state: no duplicated artifacts or tasks.
  await queue.enqueue(setup.workflowId, `rev:${setup.workflowId}`);
  const worker2 = makeWorker(setup.counts);
  assert.equal(await worker2.runOnce(), true);
  const after = await revisionArtifactsOf(setup.workflowId);
  assert.equal(after.byKind("writer_report").length, 2, "duplicate delivery creates no duplicate revised writer");
  assert.equal(after.byKind("seo_report").length, 2, "duplicate delivery creates no duplicate revised seo");
  assert.equal(after.byKind("review_report").length, 2, "duplicate delivery creates no duplicate review");
  assert.equal((await control.listReviewRevisionTasks(setup.projectId)).length, 2, "duplicate delivery creates no duplicate task");

  // A COMPLETED source task can never launch again.
  const completed = await control.getReviewRevisionTask(setup.task.taskId);
  assert.equal(completed.status, "COMPLETED");
  const relaunch = await dispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner", rationale: "attempted relaunch" });
  assert.equal(relaunch.created, false, "COMPLETED task cannot re-launch");
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM revision_dispatches WHERE task_id=$1`, [setup.task.taskId])).rows[0].n, 1, "no new dispatch");
});

// ---------------------------------------------------------------------------
// Technical failure during the fresh Review.
// ---------------------------------------------------------------------------

test("a technical failure during the fresh review remains technical FAILED and settles the task FAILED", { timeout: 120000 }, async () => {
  const setup = await setupRevisionScenario("failure");
  let reviewFetchCalls = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (String(body.messages?.[1]?.content ?? "").includes("Writing objective")) return sse(await buildFrozenWriterReport(persistence, setup.workflowId));
    reviewFetchCalls += 1;
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: "this is not json" }, finish_reason: "stop" }], usage: {} })}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "x-request-id": "parse-failure" } });
  };
  await authorize(setup);
  const revisionStart = new Date().toISOString();
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true, "revision run terminates at FAILED");

  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "FAILED");
  assert.equal(reviewFetchCalls, 1, "exactly one provider submission, no retry");
  const { revised, byKind } = await revisionArtifactsOf(setup.workflowId);
  assert.equal(byKind("review_report").length, 1, "no fresh review artifact for a technical failure");
  assert.ok(revised("writer_report"), "revised writer artifact persisted before the failure");
  await assertPriorArtifactsImmutable(setup);
  await assertNoUpstreamReplay(setup, revisionStart);
  await assertNoMediaWork(setup);
  assert.equal((await control.getReviewRevisionTask(setup.task.taskId)).status, "FAILED", "task settled FAILED (technical)");
  assert.equal((await control.listReviewRevisionTasks(setup.projectId)).length, 1, "no business revision task from a technical failure");
  assert.equal((await commandRow(setup)).status, "FAILED", "command accurately shows the technical failure");

  const failedExecution = (await persistence.listExecutionProvenance(setup.workflowId))
    .filter((r) => r.agentId === "review" && r.startedAt >= revisionStart).at(-1);
  assert.equal(failedExecution.status, "failed");
  assert.equal(failedExecution.configuration.lifecycleState, "JSON_PARSE_FAILED");

  // Owner may explicitly re-authorize after reviewing the technical failure.
  installFrozenFetch();
  currentReview = reviewReport("approved", 9);
  const reauthorize = await dispatcher.authorizeAndDispatch({ taskId: setup.task.taskId, authorizedBy: "owner", rationale: "re-authorize after reviewed technical failure" });
  assert.equal(reauthorize.created, true, "re-authorization dispatches a new version");
  assert.equal(reauthorize.revisionVersion, 2, "new revision version");
  assert.equal((await pool.query(`SELECT count(*)::int AS n FROM revision_dispatches WHERE task_id=$1`, [setup.task.taskId])).rows[0].n, 2, "second dispatch row for v2");

  // Drain the v2 cycle to a terminal state so no job is left queued.
  const drainWorker = makeWorker(setup.counts);
  const drainRun = drainWorker.runOnce();
  await waitForDb(() => gateRunning(setup.workflowId), "v2 revision reaches the gate");
  const v2ApprovalId = `approval-${setup.workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(v2ApprovalId))?.status === "PENDING", "v2 approval created");
  await control.decideApproval(v2ApprovalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await drainRun, true);
  assert.equal((await control.getReviewRevisionTask(setup.task.taskId)).status, "COMPLETED", "task completes on the v2 cycle");
});

// ---------------------------------------------------------------------------
// Frozen provider Writer revision — revision directive reaches the prompt.
// ---------------------------------------------------------------------------

test("the frozen provider Writer revision receives the authoritative revision directive and produces a new lineage-carrying artifact", { timeout: 120000 }, async () => {
  writerPrompts = [];
  try {
    const setup = await setupRevisionScenario("frozenwriter", { configureWriter: true });
    frozenWriterWorkflowId = setup.workflowId;
    currentReview = reviewReport("approved", 7);
    await authorize(setup);
    const revisionStart = new Date().toISOString();
    const worker = makeWorker(setup.counts);
    const run = worker.runOnce();
    await waitForDb(() => gateRunning(setup.workflowId), "pre-production owner gate pending");

    assert.equal(writerPrompts.length, 2, "original + revised writer provider calls");
    const revisionPrompt = writerPrompts[1];
    assert.match(revisionPrompt, /REVISION DIRECTIVE/, "revision directive reaches the provider prompt");
    assert.ok(revisionPrompt.includes(setup.task.taskId), "revision task identity in the prompt");
    assert.ok(revisionPrompt.includes("Expand the practical step"), "review findings in the prompt");
    assert.ok(revisionPrompt.includes("Expand the content to cover the practical step"), "review recommendations in the prompt");

    const { revised, prior } = await revisionArtifactsOf(setup.workflowId);
    assert.ok(revised("writer_report"), "revised writer artifact persisted via the frozen provider path");
    assert.equal(revised("writer_report").payload.content, "Revised content body addressing the review findings.");
    assert.equal(revised("writer_report").payload.revision.revisionTaskId, setup.task.taskId);
    assert.notEqual(revised("writer_report").artifactId, prior("writer_report").artifactId);
    await assertPriorArtifactsImmutable(setup);
    await assertNoUpstreamReplay(setup, revisionStart);

    // The revised writer's durable provenance carries the revision context.
    const writerExecution = (await persistence.listExecutionProvenance(setup.workflowId))
      .filter((r) => r.agentId === "writer" && r.startedAt >= revisionStart).at(-1);
    assert.equal(writerExecution.configuration.revisionExecution.revisionTaskId, setup.task.taskId);
    assert.equal(writerExecution.configuration.revision.reviewArtifactId, setup.priorReviewArtifactId);
    assert.equal(writerExecution.configuration.revision.priorWriterArtifactId, prior("writer_report").artifactId);

    const approvalId = `approval-${setup.workflowId}-${GATE}`;
    await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
    await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
    assert.equal(await run, true);
  } finally {
    writerPrompts = null;
    currentWriterReport = null;
  }
});

// ---------------------------------------------------------------------------
// Control-plane visibility of the task lifecycle.
// ---------------------------------------------------------------------------

test("the revision task lifecycle is visible through the control plane", { timeout: 60000 }, async () => {
  const setup = await setupRevisionScenario("visibility");
  let listed = (await control.listReviewRevisionTasks(setup.projectId)).find((t) => t.taskId === setup.task.taskId);
  assert.equal(listed.status, "PENDING");
  assert.equal(listed.authorizedBy, null);
  assert.ok(listed.findings.length > 0, "findings retained for owner visibility");

  await authorize(setup);
  listed = (await control.listReviewRevisionTasks(setup.projectId)).find((t) => t.taskId === setup.task.taskId);
  assert.equal(listed.status, "IN_PROGRESS");
  assert.equal(listed.authorizedBy, "owner");
  assert.equal(listed.revisionVersion, 1);
  assert.ok(listed.authorizedAt !== null);

  currentReview = reviewReport("blocked", 8);
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true);
  listed = (await control.listReviewRevisionTasks(setup.projectId)).find((t) => t.taskId === setup.task.taskId);
  assert.equal(listed.status, "COMPLETED");
  assert.ok(listed.completedAt !== null);
  // Source data remains auditable after the lifecycle transitions.
  assert.equal(listed.findings.length, (await control.getReviewRevisionTask(setup.task.taskId)).findings.length);
});
