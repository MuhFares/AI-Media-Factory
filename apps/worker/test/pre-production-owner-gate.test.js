/**
 * PRE_PRODUCTION_OWNER_GATE — real persistent-worker fixtures (provider-free).
 *
 * Proves the durable owner gate between Review and Director:
 *  - approved / human_review_required Review → PENDING owner approval, no media work
 *  - changes_requested / blocked Review → durable revision/blocked states, no gate approval
 *  - explicit owner APPROVE resumes exactly once; director starts only after approval
 *  - owner REJECT durably stops production; REQUEST_ITERATION routes to a durable
 *    revision task linked to the review package
 *  - the later visual-human-gate remains a separate, independent approval
 *  - duplicate / concurrent owner decisions cannot resume the workflow twice
 *  - legacy persisted definitions are upgraded with the gate before (re)start
 *
 * Review verdicts are frozen OpenRouter SSE fixtures (no live provider call);
 * every other text stage runs on the deterministic responder, and media
 * capabilities run against an in-test boundary. All tests run against the
 * isolated ai_media_factory_test database.
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
} from "@ai-media-factory/database";
import {
  directiveToWorkflowDefinition,
  withPreProductionOwnerGate,
  PRE_PRODUCTION_OWNER_GATE_STEP_ID,
} from "@ai-media-factory/orchestrator";
import { buildDefaultEngine, createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation, truncateAll } from "./helpers.js";
import { withV2ContractFixture } from "./visual-v2-fixtures.js";
import { canonicalResearchPayload, canonicalResearchResults, isResearchPrompt } from "./canonical-production-fixtures.js";

assertTestDatabaseIsolation();

const GATE = PRE_PRODUCTION_OWNER_GATE_STEP_ID;
const definition = directiveToWorkflowDefinition("produce");
const fixtureAudioUrl = `data:audio/wav;base64,${(
  await readFile(new URL("../../../output/tts-benchmark/voicetut-short.wav", import.meta.url))
).toString("base64")}`;

// ---------------------------------------------------------------------------
// Frozen review provider (the only fetch consumer in these fixtures).
// ---------------------------------------------------------------------------

let currentReview = null;
let reviewFetchCalls = 0;
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
  metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" },
});

globalThis.fetch = async (_url, options) => {
  reviewFetchCalls += 1;
  const body = JSON.parse(options.body);
  const prompt = String(body.messages?.[1]?.content ?? "");
  const payload = isResearchPrompt(prompt) ? canonicalResearchPayload(prompt) : currentReview;
  return new Response(
    `data: ${JSON.stringify({ id: "gen-ppog", model: body.model, choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage: { prompt_tokens: 8, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "x-request-id": "ppog-review" } },
  );
};

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
        if (request.capabilityId === "timeline.plan") return success(request, { timelineId: "timeline-ppog", narrationDurationMs: i.narrationDurationMs, sceneIds: ["scene-001", "scene-002", "scene-003"] });
        if (request.capabilityId === "image.generate") return success(request, { imageId: `image-${i.sceneId}`, url: `file:///${i.sceneId}.png`, providerId: "mock-image" });
        if (request.capabilityId === "video.generate") return success(request, { videoId: `video-${counts[request.capabilityId]}`, url: `file:///clip-${counts[request.capabilityId]}.mp4`, providerId: "mock-wan", durationSeconds: 4 }, { videoStatus: "completed" });
        if (request.capabilityId === "media.compose") return success(request, { mediaId: "final-media", output: { path: "file:///final.mp4", mimeType: "video/mp4", bytes: 1, sha256: "fixture" }, final: { durationMs: 12640, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" }, composition: { strategy: "shortest", videoCopied: false } });
        if (request.capabilityId === "publish.youtube") return success(request, { publicationId: "mock-publication", url: "https://example.test/publication", publishedAt: new Date().toISOString(), providerId: "mock-publisher", idempotencyKey: "mock-publish-key" }, { platform: "youtube" });
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

async function resetTables() {
  await truncateAll(pool);
  await pool.query(`TRUNCATE control_approvals, control_commands, review_revision_tasks,
                    execution_provenance, execution_lifecycle_events, execution_failure_fallback_events,
                    provider_publications, provider_upload_sessions RESTART IDENTITY CASCADE`);
}

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await resetTables();
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  process.env.TEXT_AGENT_PROVIDER = "deterministic";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
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
  const executor = withV2ContractFixture(createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts) }), persistence);
  return new WorkflowWorker({
    queue,
    persistence,
    executor,
    pollMs: 10,
    control,
    resolveCommandConfiguration: async () => ({
      review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free", source: "AGENT" },
    }),
  });
}

async function submitWorkflow({ workflowId, projectId, commandId, ownerMessage = "Produce the provider-free fixture video", submitDefinition = definition }) {
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage, selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  await queue.submit({ submissionKey: `ppog:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition: submitDefinition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage } });
  await queue.enqueue(workflowId, `ppog:${workflowId}`);
}

const commandStatus = async (projectId, commandId) => (await control.listCommands(projectId)).find((c) => c.command_id === commandId);

const gateRunning = async (workflowId, stepId) => {
  const w = await persistence.loadWorkflow(workflowId);
  return w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === stepId)?.status === "running";
};

async function reviewArtifactOf(workflowId) {
  const artifacts = await persistence.listArtifacts(workflowId);
  return artifacts.find((a) => a.kind === "review_report");
}

async function assertNoMediaWork(workflowId, counts) {
  const artifacts = await persistence.listArtifacts(workflowId);
  for (const kind of ["scene_plan", "narration_artifact", "timeline_plan", "scene_visual_artifact", "visual_semantic_review", "visual_technical_qa", "wan_authorization", "scene_video_clip", "final_media_artifact"]) {
    assert.equal(artifacts.some((a) => a.kind === kind), false, `no ${kind} before owner approval`);
  }
  for (const capability of ["tts.generate", "timeline.plan", "image.generate", "video.generate", "media.compose", "publish.youtube"]) {
    assert.equal(counts[capability] ?? 0, 0, `no ${capability} provider call before owner approval`);
  }
  const provenance = await persistence.listExecutionProvenance(workflowId);
  assert.equal(
    provenance.some((row) => ["director", "tts", "timeline", "scene-image", "video", "composer"].includes(row.agentId)),
    false,
    "no media stage execution before owner approval",
  );
}

// ---------------------------------------------------------------------------
// CASE A + E + H — approved review, owner APPROVE, separate visual gate,
// duplicate decision delivery.
// ---------------------------------------------------------------------------

test("approved review stops at the pre-production owner gate; media starts only after owner APPROVE; the visual gate stays separate", { timeout: 120000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-approve-${id}`;
  const projectId = `proj-ppog-approve-${id}`;
  const commandId = `command-ppog-approve-${id}`;
  currentReview = reviewReport("approved", 1);
  const counts = {};
  await submitWorkflow({ workflowId, projectId, commandId });
  const worker = makeWorker(counts);
  const run = worker.runOnce();

  // Approved Review: artifact persisted, execution completed, workflow stopped at the gate.
  await waitForDb(() => gateRunning(workflowId, GATE), "pre-production owner gate pending");
  const gated = await persistence.loadWorkflow(workflowId);
  assert.equal(gated.steps.find((s) => s.stepId === "director")?.status, "pending", "director not started");
  const review = await reviewArtifactOf(workflowId);
  assert.ok(review, "exactly one review artifact persisted");
  assert.equal(review.status, "completed");
  assert.equal(review.payload.status, "approved");
  await assertNoMediaWork(workflowId, counts);
  const reviewProvenance = (await persistence.listExecutionProvenance(workflowId)).filter((row) => row.agentId === "review");
  assert.equal(reviewProvenance.length, 1);
  assert.equal(reviewProvenance[0].status, "success");

  // Durable PENDING owner approval with a distinct control-plane gate type.
  const approvalId = `approval-${workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "pre-production approval created");
  const approval = await control.getApproval(approvalId);
  assert.equal(approval.targetType, "workflow_gate");
  assert.equal(approval.targetId, `${workflowId}:${GATE}`);
  assert.equal(approval.agentRecommendation.gateType, "PRE_PRODUCTION_CONTENT_APPROVAL");
  assert.equal(approval.agentRecommendation.reviewArtifactId, review.artifactId);
  assert.equal(typeof approval.agentRecommendation.reviewExecutionId, "string");

  await waitForDb(async () => (await commandStatus(projectId, commandId))?.status === "REVIEW_APPROVED", "command reflects the approved review");

  // Explicit owner APPROVE: director starts only now, exactly once.
  await control.decideApproval(approvalId, "APPROVE", "Owner approved the reviewed content package.");
  await waitForDb(() => gateRunning(workflowId, "visual-human-gate"), "visual human gate after owner approval");
  const afterApproval = await persistence.loadWorkflow(workflowId);
  assert.equal(afterApproval.steps.find((s) => s.stepId === GATE)?.status, "completed");
  const directorProvenance = (await persistence.listExecutionProvenance(workflowId)).filter((row) => row.agentId === "director");
  assert.equal(directorProvenance.length, 1, "director starts exactly once after owner approval");
  assert.equal(counts["tts.generate"] ?? 0, 1);
  assert.equal(counts["timeline.plan"] ?? 0, 1);
  assert.equal(counts["image.generate"] ?? 0, 3);
  assert.equal(counts["video.generate"] ?? 0, 0, "no Wan work before the visual gate");

  // The visual gate is a separate, still-pending approval: the pre-production
  // approval does not approve it.
  const visualApprovalId = `approval-${workflowId}-visual-human-gate`;
  await waitForDb(async () => (await control.getApproval(visualApprovalId))?.status === "PENDING", "visual gate approval created");
  const visualApproval = await control.getApproval(visualApprovalId);
  assert.equal(visualApproval.agentRecommendation.gateType, "POST_VISUAL_QA_APPROVAL");
  assert.equal(visualApproval.ownerDecision, null, "pre-production approval does not approve the visual gate");
  const decidedPreProduction = await control.getApproval(approvalId);
  assert.equal(decidedPreProduction.status, "DECIDED");
  assert.equal(decidedPreProduction.ownerDecision, "APPROVE");

  // Duplicate owner decision delivery cannot resume the workflow twice.
  await control.decideApproval(approvalId, "APPROVE", "Duplicate owner decision delivery.");
  await new Promise((r) => setTimeout(r, 400));
  assert.equal((await persistence.listExecutionProvenance(workflowId)).filter((row) => row.agentId === "director").length, 1, "duplicate approval does not restart director");

  // Terminate the run at the visual gate: owner REJECT durably stops production.
  await control.decideApproval(visualApprovalId, "REJECT", "Visual QA rejection stops production.");
  assert.equal(await run, true);
  const final = await persistence.loadWorkflow(workflowId);
  assert.equal(final.state, "FAILED");
  assert.equal(counts["video.generate"] ?? 0, 0, "reject starts no Wan work");
  assert.equal(reviewFetchCalls > 0, true, "frozen review provider was used");
});

// ---------------------------------------------------------------------------
// CASE B — human_review_required review also stops at the gate.
// ---------------------------------------------------------------------------

test("human_review_required review reaches the pre-production owner gate with a linked review artifact", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-human-${id}`;
  const projectId = `proj-ppog-human-${id}`;
  const commandId = `command-ppog-human-${id}`;
  currentReview = reviewReport("human_review_required", 2);
  const counts = {};
  await submitWorkflow({ workflowId, projectId, commandId });
  const worker = makeWorker(counts);
  const run = worker.runOnce();

  await waitForDb(() => gateRunning(workflowId, GATE), "pre-production owner gate pending for human_review_required");
  const review = await reviewArtifactOf(workflowId);
  assert.ok(review);
  assert.equal(review.payload.status, "human_review_required");
  assert.equal(review.status, "completed");
  await assertNoMediaWork(workflowId, counts);

  const approvalId = `approval-${workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  const approval = await control.getApproval(approvalId);
  assert.equal(approval.agentRecommendation.reviewArtifactId, review.artifactId, "approval is linked to the review artifact");
  await waitForDb(async () => (await commandStatus(projectId, commandId))?.status === "REVIEW_HUMAN_REVIEW_REQUIRED", "command reflects human review");

  await control.decideApproval(approvalId, "REJECT", "Owner rejects the package after human review.");
  assert.equal(await run, true);
  const final = await persistence.loadWorkflow(workflowId);
  assert.equal(final.state, "FAILED");
  assert.equal(final.steps.find((s) => s.stepId === "director")?.status, "pending", "director never starts");
});

// ---------------------------------------------------------------------------
// CASE C — changes_requested bypasses the gate and routes to revision-required.
// ---------------------------------------------------------------------------

test("changes_requested review routes to the durable revision state and never creates a pre-production approval", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-changes-${id}`;
  const projectId = `proj-ppog-changes-${id}`;
  const commandId = `command-ppog-changes-${id}`;
  currentReview = reviewReport("changes_requested", 3);
  const counts = {};
  await submitWorkflow({ workflowId, projectId, commandId });
  const worker = makeWorker(counts);
  assert.equal(await worker.runOnce(), true);

  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "REVISION_REQUIRED");
  const review = await reviewArtifactOf(workflowId);
  assert.ok(review, "review artifact persisted for the negative verdict");
  await assertNoMediaWork(workflowId, counts);

  const tasks = await control.listReviewRevisionTasks(projectId);
  assert.equal(tasks.length, 1, "one durable revision task");
  assert.equal(tasks[0].reviewStatus, "changes_requested");
  assert.equal(tasks[0].reviewArtifactId, review.artifactId);
  assert.equal(tasks[0].status, "PENDING");
  const artifacts = await persistence.listArtifacts(workflowId);
  for (const kind of ["writer_report", "seo_report", "brand_report"]) {
    assert.ok(artifacts.some((a) => a.kind === kind), `revision task lineage retains ${kind}`);
  }
  assert.equal(tasks[0].writerArtifactId, artifacts.find((a) => a.kind === "writer_report").artifactId);
  assert.equal(tasks[0].seoArtifactId, artifacts.find((a) => a.kind === "seo_report").artifactId);
  assert.equal(tasks[0].brandArtifactId, artifacts.find((a) => a.kind === "brand_report").artifactId);

  const approvals = (await control.listApprovals(projectId)).filter((a) => a.targetId === `${workflowId}:${GATE}`);
  assert.equal(approvals.length, 0, "no pre-production approval is created");
  const command = await commandStatus(projectId, commandId);
  assert.equal(command.status, "REVISION_REQUIRED");
  assert.equal(command.visible_result.kind, "REVIEW_BUSINESS_OUTCOME");
  const submission = await queue.loadSubmissionByWorkflow(workflowId);
  assert.equal(submission.status, "revision_required");

  // Duplicate job delivery is idempotent: no duplicate artifacts, tasks, or approvals.
  await queue.enqueue(workflowId, `ppog:${workflowId}`);
  const worker2 = makeWorker(counts);
  assert.equal(await worker2.runOnce(), true);
  assert.equal((await control.listReviewRevisionTasks(projectId)).length, 1, "revision task is not duplicated");
  assert.equal((await reviewArtifactOf(workflowId)).artifactId, review.artifactId, "review artifact is not duplicated");
});

// ---------------------------------------------------------------------------
// CASE D — blocked bypasses the gate and routes to the durable blocked state.
// ---------------------------------------------------------------------------

test("blocked review routes to the durable blocked business state without a pre-production approval", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-blocked-${id}`;
  const projectId = `proj-ppog-blocked-${id}`;
  const commandId = `command-ppog-blocked-${id}`;
  currentReview = reviewReport("blocked", 4);
  const counts = {};
  await submitWorkflow({ workflowId, projectId, commandId });
  const worker = makeWorker(counts);
  assert.equal(await worker.runOnce(), true);

  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "BUSINESS_BLOCKED");
  const review = await reviewArtifactOf(workflowId);
  assert.ok(review, "review artifact persisted for the blocked verdict");
  await assertNoMediaWork(workflowId, counts);

  assert.equal((await control.listReviewRevisionTasks(projectId)).length, 0, "no revision task");
  assert.equal((await control.listApprovals(projectId)).filter((a) => a.targetId === `${workflowId}:${GATE}`).length, 0, "no pre-production approval");
  const command = await commandStatus(projectId, commandId);
  assert.equal(command.status, "BUSINESS_BLOCKED");
  const submission = await queue.loadSubmissionByWorkflow(workflowId);
  assert.equal(submission.status, "business_blocked");
});

// ---------------------------------------------------------------------------
// CASE F — owner REJECT at the pre-production gate durably stops production.
// ---------------------------------------------------------------------------

test("owner REJECT at the pre-production gate durably stops production before any media work", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-reject-${id}`;
  const projectId = `proj-ppog-reject-${id}`;
  const commandId = `command-ppog-reject-${id}`;
  currentReview = reviewReport("approved", 5);
  const counts = {};
  await submitWorkflow({ workflowId, projectId, commandId });
  const worker = makeWorker(counts);
  const run = worker.runOnce();

  await waitForDb(() => gateRunning(workflowId, GATE), "pre-production owner gate pending");
  const approvalId = `approval-${workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "Owner rejects the content package.");
  assert.equal(await run, true);

  const final = await persistence.loadWorkflow(workflowId);
  assert.equal(final.state, "FAILED");
  assert.equal(final.steps.find((s) => s.stepId === GATE)?.status, "failed");
  await assertNoMediaWork(workflowId, counts);
  assert.equal((await control.listReviewRevisionTasks(projectId)).length, 0, "reject creates no revision task");
  const decided = await control.getApproval(approvalId);
  assert.equal(decided.status, "DECIDED");
  assert.equal(decided.ownerDecision, "REJECT");
  assert.equal((await commandStatus(projectId, commandId)).status, "FAILED");
  const submission = await queue.loadSubmissionByWorkflow(workflowId);
  assert.equal(submission.status, "failed");
});

// ---------------------------------------------------------------------------
// CASE G — owner REQUEST_ITERATION routes to a durable revision task.
// ---------------------------------------------------------------------------

test("owner REQUEST_ITERATION at the pre-production gate routes to a durable revision task with owner feedback", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-iterate-${id}`;
  const projectId = `proj-ppog-iterate-${id}`;
  const commandId = `command-ppog-iterate-${id}`;
  currentReview = reviewReport("approved", 6);
  const counts = {};
  await submitWorkflow({ workflowId, projectId, commandId });
  const worker = makeWorker(counts);
  const run = worker.runOnce();

  await waitForDb(() => gateRunning(workflowId, GATE), "pre-production owner gate pending");
  const approvalId = `approval-${workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REQUEST_ITERATION", "Tighten the hook and re-run the review.");
  assert.equal(await run, true);

  const final = await persistence.loadWorkflow(workflowId);
  assert.equal(final.state, "REVISION_REQUIRED");
  assert.equal(final.steps.find((s) => s.stepId === GATE)?.status, "failed");
  await assertNoMediaWork(workflowId, counts);

  const review = await reviewArtifactOf(workflowId);
  const tasks = await control.listReviewRevisionTasks(projectId);
  assert.equal(tasks.length, 1, "one durable owner-iteration revision task");
  assert.equal(tasks[0].reviewStatus, "owner_iteration_requested");
  assert.equal(tasks[0].reviewArtifactId, review.artifactId, "task is linked to the review artifact");
  assert.match(tasks[0].summary, /Tighten the hook and re-run the review\./, "owner feedback is preserved");
  assert.equal(tasks[0].status, "PENDING");

  const command = await commandStatus(projectId, commandId);
  assert.equal(command.status, "REVISION_REQUIRED");
  assert.equal(command.visible_result.kind, "OWNER_ITERATION_REQUESTED");
  assert.equal(command.visible_result.reviewArtifactId, review.artifactId);
  const submission = await queue.loadSubmissionByWorkflow(workflowId);
  assert.equal(submission.status, "revision_required");
});

// ---------------------------------------------------------------------------
// CASE I — concurrent duplicate owner approvals resume exactly once.
// ---------------------------------------------------------------------------

test("concurrent duplicate owner approvals resume the workflow exactly once", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-concurrent-${id}`;
  const counts = {};
  const directorRuns = { count: 0 };
  const executor = withV2ContractFixture(createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts) }), persistence);
  const bound = executor.executeAgentStep.bind(executor);
  executor.executeAgentStep = async (step, context) => {
    if (step.id === "director") directorRuns.count += 1;
    return bound(step, context);
  };
  const engine = buildDefaultEngine({ persistence, executor, definitionLoader: async () => definition });
  await engine.start({ workflowId, definition, trigger: { directive: "produce", contentTopic: "Egypt travel. Ancient history.", language: "en", voice: "fixture" }, correlationId: `corr-${workflowId}`, brandId: null });
  await waitForDb(() => gateRunning(workflowId, GATE), "pre-production owner gate pending");

  const decision = { workflowId, stepId: GATE, outcome: "approved", approver: "owner", note: "concurrent decision", decidedAt: new Date().toISOString() };
  await Promise.all([
    engine.signalApproval(workflowId, decision),
    engine.signalApproval(workflowId, { ...decision, note: "concurrent decision (duplicate)" }),
  ]);
  await waitForDb(() => gateRunning(workflowId, "visual-human-gate"), "visual gate after concurrent approvals");
  assert.equal(directorRuns.count, 1, "CONCURRENT_RESUME = EXACTLY_ONE");

  // A later duplicate delivery is an explicit no-op.
  await engine.signalApproval(workflowId, decision);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(directorRuns.count, 1, "duplicate approval delivery does not resume again");

  await engine.signalApproval(workflowId, { workflowId, stepId: "visual-human-gate", outcome: "rejected", approver: "owner", note: "stop", decidedAt: new Date().toISOString() });
  await waitForDb(async () => (await persistence.loadWorkflow(workflowId))?.state === "FAILED", "workflow failed after visual rejection");
});

// ---------------------------------------------------------------------------
// Legacy definition upgrade — engine resume path (the V6 recovery shape).
// ---------------------------------------------------------------------------

test("a legacy paused workflow resumed with the upgraded definition stops at the pre-production owner gate", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-legacy-${id}`;
  const correlationId = `corr-${workflowId}`;
  const legacy = {
    ...definition,
    steps: definition.steps
      .filter((step) => step.id !== GATE)
      .map((step) => (step.id === "review" ? { ...step, next: "director" } : step)),
  };
  for (const [artifactId, kind, producerAgent, payload] of [
    [`art-${workflowId}-writer`, "writer_report", "writer", { title: "title", content: "content", status: "completed" }],
    [`art-${workflowId}-seo`, "seo_report", "seo", { optimizedTitle: "title", status: "completed" }],
    [`art-${workflowId}-brand`, "brand_report", "brand", { status: "approved" }],
  ]) {
    await persistence.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", contentType: "application/json", schemaVersion: "1.0", createdAt: new Date().toISOString(), payload });
  }
  const completedUpstream = ["planner-initial", "research", "planner-synthesis", "writer", "seo", "brand"];
  const now = new Date().toISOString();
  await persistence.saveWorkflow({
    workflowId,
    definitionId: legacy.id,
    definitionVersion: legacy.version,
    state: "PAUSED",
    context: { workflowId, correlationId, brandId: null, outputs: {}, data: { directive: "produce", contentTopic: "Egypt travel. Ancient history.", language: "en", voice: "fixture" } },
    steps: legacy.steps.map((step) => ({ stepId: step.id, status: completedUpstream.includes(step.id) ? "completed" : "pending", attempts: 0, startedAt: null, finishedAt: completedUpstream.includes(step.id) ? now : null })),
    ready: ["review"],
    lastCheckpointRef: null,
    createdAt: now,
    updatedAt: now,
  });

  const counts = {};
  const executor = withV2ContractFixture(createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts) }), persistence);
  const engine = buildDefaultEngine({ persistence, executor, definitionLoader: async () => withPreProductionOwnerGate(legacy) });
  await engine.resume(workflowId);
  await waitForDb(() => gateRunning(workflowId, GATE), "legacy workflow stopped at the upgraded gate");
  const gated = await persistence.loadWorkflow(workflowId);
  assert.equal(gated.steps.find((s) => s.stepId === GATE)?.status, "running");
  assert.equal(gated.steps.find((s) => s.stepId === "director")?.status, "pending", "director not started");
  await assertNoMediaWork(workflowId, counts);

  await engine.signalApproval(workflowId, { workflowId, stepId: GATE, outcome: "rejected", approver: "owner", note: "stop", decidedAt: new Date().toISOString() });
  await waitForDb(async () => (await persistence.loadWorkflow(workflowId))?.state === "FAILED", "legacy workflow failed after rejection");
});

// ---------------------------------------------------------------------------
// Legacy definition upgrade — worker start path.
// ---------------------------------------------------------------------------

test("a legacy produce submission is upgraded with the pre-production owner gate before execution", { timeout: 90000 }, async () => {
  const id = runId();
  const workflowId = `wf-ppog-legacy-start-${id}`;
  const projectId = `proj-ppog-legacy-start-${id}`;
  const commandId = `command-ppog-legacy-start-${id}`;
  currentReview = reviewReport("approved", 7);
  const counts = {};
  const legacy = {
    ...definition,
    steps: definition.steps
      .filter((step) => step.id !== GATE)
      .map((step) => (step.id === "review" ? { ...step, next: "director" } : step)),
  };
  await submitWorkflow({ workflowId, projectId, commandId, submitDefinition: legacy });
  const worker = makeWorker(counts);
  const run = worker.runOnce();

  await waitForDb(() => gateRunning(workflowId, GATE), "legacy submission stopped at the pre-production gate");
  await assertNoMediaWork(workflowId, counts);
  const approvalId = `approval-${workflowId}-${GATE}`;
  await waitForDb(async () => (await control.getApproval(approvalId))?.status === "PENDING", "approval created");
  await control.decideApproval(approvalId, "REJECT", "Stop the legacy run at the new gate.");
  assert.equal(await run, true);
  assert.equal((await persistence.loadWorkflow(workflowId)).state, "FAILED");
});
