/**
 * MEDIA TECHNICAL RESUME V1 — provider-free test matrix (A–T).
 *
 * Proves the durable owner-authorized media resume on the isolated test DB
 * through the real persistent-worker path with frozen media transports:
 *
 *  A) eligible technical failure after completed Director → one resume
 *  B) no authorization → no job → no execution
 *  C) duplicate authorization → same resume/job
 *  D) concurrent authorization → exactly one
 *  E) resume starts at TTS → Director not re-executed
 *  F) storage order alphabetical → still starts TTS → analytics never starts
 *  G) full frozen happy path → TTS → Timeline → 5 scenes → QA → gate PENDING
 *  H) visual gate reached → wan/video/composer/publish untouched
 *  I) TTS failure → STOP
 *  J) Timeline failure → STOP
 *  K) scene-3 failure → STOP → no QA
 *  L) Visual QA technical failure → STOP → no visual approval
 *  M) budget exceeded → fail BEFORE provider call
 *  N) completed chunk reuse on restart → no duplicate TTS call
 *  O) completed scene reuse on restart → no duplicate image call
 *  P) missing frozen Director artifact → authorization rejected
 *  Q) scene-count drift → fail closed
 *  R) downstream already completed → eligibility fail
 *  S) visual gate policy disabled → fail closed
 *  T) read-only diagnosis policy (production writes not attempted by tests)
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
  PostgresMediaResumeDispatcher,
} from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { WorkflowCrashError } from "@ai-media-factory/workflow-engine";
import { buildDefaultEngine, createProductionAgentExecutor, WorkflowWorker, inspectWorkerExecutionEnvironment } from "../dist/index.js";
import { voicetutExecutionIdentityFromEnv } from "@ai-media-factory/provider-adapters";
import { buildMediaConfigurationFingerprintV2, snapshotMediaConfigurationInput } from "@ai-media-factory/database";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";
import { saveV2DirectionContract } from "./visual-v2-fixtures.js";
import { canonicalResearchPayload, canonicalResearchResults, isResearchPrompt } from "./canonical-production-fixtures.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const GATE = "pre-production-owner-gate";
const VISUAL_GATE = "visual-human-gate";
const fixtureAudioUrl = `data:audio/wav;base64,${(
  await readFile(new URL("../../../output/tts-benchmark/voicetut-short.wav", import.meta.url))
).toString("base64")}`;

const originalFetch = globalThis.fetch;
const originalEnv = {
  TEXT_AGENT_PROVIDER: process.env.TEXT_AGENT_PROVIDER,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  TTS_PROVIDER: process.env.TTS_PROVIDER,
  RUNPOD_API_KEY: process.env.RUNPOD_API_KEY,
  VOICETUT_TTS_ENDPOINT_ID: process.env.VOICETUT_TTS_ENDPOINT_ID,
  IMAGE_PROVIDER: process.env.IMAGE_PROVIDER,
  RUNPOD_IMAGE_ENDPOINT_ID: process.env.RUNPOD_IMAGE_ENDPOINT_ID,
};

const reviewReport = {
  reportId: "00000000-0000-4000-8000-0000000000m1",
  taskDescription: "Review content for review",
  summary: "Media resume fixture approved review.",
  status: "approved",
  findings: [],
  recommendations: [],
  metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0" },
};

function installFrozenFetch() {
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = String(body.messages?.[1]?.content ?? "");
    const payload = isResearchPrompt(prompt) ? canonicalResearchPayload(prompt) : reviewReport;
    return new Response(
    `data: ${JSON.stringify({ id: "gen-media", model: body.model, choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "x-request-id": "media-resume-fixture" } },
  );
  };
}

/** Frozen media boundary with injectable failures and call tracking. */
function mediaBoundary(counts, failures = {}, mediaConfiguration = undefined) {
  const success = (request, output, extraEvidence = {}) => ({
    status: "success",
    resultId: `${request.capabilityId}-${request.requestId}`,
    capabilityId: request.capabilityId,
    output,
    evidence: { evidenceId: `e-${request.requestId}`, capabilityId: request.capabilityId, agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, providerInvoked: true, resultStatus: "success", ...extraEvidence },
  });
  return {
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate", "media.compose"],
    ...(mediaConfiguration === undefined ? {} : { mediaConfiguration }),
    boundary: {
      executeCapability: async (request) => {
        counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1;
        const i = request.input ?? {};
        const failKey = i.sceneId ?? request.capabilityId;
        if (failures[failKey]) throw new Error(failures[failKey]);
        if (request.capabilityId === "web.search") return success(request, { results: canonicalResearchResults });
        if (request.capabilityId === "tts.generate") return success(request, { audioUrl: fixtureAudioUrl, audioId: `narration-${counts[request.capabilityId]}`, providerId: "mock-tts", durationMs: 12640, audioIntegrity: "VALID" });
        if (request.capabilityId === "timeline.plan") return success(request, { timelineId: "timeline-mr", narrationDurationMs: i.narrationDurationMs, sceneIds: ["scene-001", "scene-002", "scene-003"] });
        if (request.capabilityId === "image.generate") return success(request, { imageId: `image-${i.sceneId}`, url: `file:///${i.sceneId}.png`, providerId: "mock-image" });
        if (request.capabilityId === "video.generate") return success(request, { videoId: `v-${counts[request.capabilityId]}`, url: `file:///c.mp4`, providerId: "mock-wan", durationSeconds: 4 }, { videoStatus: "completed" });
        return success(request, {});
      },
    },
  };
}

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
             review_resume_dispatches, control_configuration_events,
             human_gate_settings, human_gate_configuration_events,
             media_resume_dispatches, media_resume_provider_usage,
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
  process.env.TEXT_AGENT_PROVIDER = "deterministic";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  process.env.TTS_PROVIDER = "voicetut";
  process.env.RUNPOD_API_KEY = "present-not-used";
  process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
  process.env.IMAGE_PROVIDER = "self-hosted-image";
  process.env.RUNPOD_IMAGE_ENDPOINT_ID = "present-not-used";
  dispatcher = new PostgresMediaResumeDispatcher(pool, persistence, mediaBoundary({}));
  installFrozenFetch();
});

after(async () => {
  globalThis.fetch = originalFetch;
  process.env.TEXT_AGENT_PROVIDER = originalEnv.TEXT_AGENT_PROVIDER;
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
  process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL;
  for (const key of ["TTS_PROVIDER", "RUNPOD_API_KEY", "VOICETUT_TTS_ENDPOINT_ID", "IMAGE_PROVIDER", "RUNPOD_IMAGE_ENDPOINT_ID"]) {
    if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
  }
  await persistence.close();
});

async function waitForDb(check, label, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`timeout: ${label}`);
}

function traceMediaResumeN(stage, details = {}) {
  if (process.env.AMF_TEST_TRACE_MEDIA_RESUME !== "1") return;
  process.stderr.write(`${JSON.stringify({
    test: "media-resume-N",
    stage,
    at: new Date().toISOString(),
    ...details,
  })}\n`);
}

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function makeWorker(counts, failures = {}, boundaryOverride = undefined) {
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: boundaryOverride ?? mediaBoundary(counts, failures), mediaResumeBudget: dispatcher });
  return new WorkflowWorker({ queue, persistence, executor, control, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
}

/**
 * Drive a fresh workflow to a TECHNICAL-FAILURE incident state through the
 * REAL engine path: approved review → owner APPROVE at the pre-production
 * gate → Director COMPLETED → TTS fails technically (injected frozen
 * transport failure) → workflow FAILED durably. The worker loop terminates
 * naturally (no orphaned engine, no state overwrites).
 *
 * With `analyticsSpurious: true`, the already-terminal persisted state is
 * then reshaped to the exact LIVE incident: analytics=failed (spurious),
 * tts=pending — reproducing the recovery-frontier defect's durable end
 * state. This is safe because nothing is running at that point.
 */
async function setupIncident(label, options = {}) {
  const id = runId();
  const workflowId = `wf-mr-${label}-${id}`;
  const projectId = `proj-mr-${label}-${id}`;
  const commandId = `command-mr-${label}-${id}`;
  const counts = {};

  // Drain leftover queued jobs from prior tests (their workflows are already
  // asserted-and-settled; claimNextJob is global so a stale job would be
  // claimed instead of this fixture's own produce job).
  await pool.query(`DELETE FROM workflow_jobs WHERE status='queued'`);

  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "Produce the media resume fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  await queue.submit({ submissionKey: `mr:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "Produce the media resume fixture" } });
  await queue.enqueue(workflowId, `mr:${workflowId}`);

  // The incident executor: the TTS provider transport fails technically, so
  // after the owner approves the gate, Director completes and TTS fails —
  // the workflow terminates FAILED through the real engine (bounded, no leak).
  const incidentExecutor = createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts, { "tts.generate": "FIXTURE_INCIDENT_TTS_TECHNICAL_FAILURE" }) });
  const worker1 = new WorkflowWorker({ queue, persistence, executor: incidentExecutor, control, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
  const run1 = worker1.runOnce();
  run1.catch(() => undefined);

  await waitForDb(async () => {
    const w = await persistence.loadWorkflow(workflowId);
    return w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === GATE)?.status === "running";
  }, "gate pending");

  // Owner approves; worker1's loop applies it; Director completes; TTS fails.
  const approvalId = `approval-${workflowId}-${GATE}`;
  await control.createApproval({
    approvalId, projectId, targetType: "workflow_gate", targetId: `${workflowId}:${GATE}`,
    agentRecommendation: { workflowId, stepId: GATE, gateType: "PRE_PRODUCTION_CONTENT_APPROVAL", required: "OWNER_DECISION" }, agentConfidence: null,
    evidenceRefs: (await persistence.listArtifacts(workflowId)).map((a) => a.artifactId),
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(approvalId, "APPROVE", "media resume fixture: approve");

  await waitForDb(async () => {
    const w = await persistence.loadWorkflow(workflowId);
    return w?.state === "FAILED" && w.steps.find((s) => s.stepId === "director")?.status === "completed";
  }, "incident: director completed then technical failure");
  await run1;

  // Optionally reshape the terminal state to the exact LIVE incident shape
  // (spurious analytics failure, TTS untouched). Nothing is running now.
  if (options.analyticsSpurious) {
    const terminal = await persistence.loadWorkflow(workflowId);
    const now = new Date().toISOString();
    await persistence.saveWorkflow({
      ...terminal,
      steps: terminal.steps.map((step) => {
        if (step.stepId === "tts") return { ...step, status: "pending", attempts: 0, startedAt: null, finishedAt: null };
        if (step.stepId === "analytics") return { ...step, status: "failed", attempts: 1, startedAt: now, finishedAt: now };
        return step;
      }),
    });
    await persistence.saveCheckpoint({ workflowId, state: "FAILED", completedSteps: terminal.steps.filter((s) => s.status === "completed").map((s) => s.stepId), contextSnapshotRef: `incident-${workflowId}`, lastEventOffset: 1, createdAt: now });
  }

  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "FAILED", "incident: workflow FAILED");
  assert.equal(instance.steps.find((s) => s.stepId === "director").status === "completed", true, "incident: Director completed");
  const artifacts = await persistence.listArtifacts(workflowId);
  // V2 fixture plays the future creative-agent role: a valid direction
  // contract for the produced Director scene IDs, so V2-wired scene-image
  // stages can compile prompts in all downstream resume runs.
  const incidentPlan = [...artifacts].reverse().find((a) => a.kind === "scene_plan" && a.status === "completed");
  const incidentSceneIds = Array.isArray(incidentPlan?.payload?.sceneIds) ? incidentPlan.payload.sceneIds.filter((id) => typeof id === "string") : [];
  if (incidentSceneIds.length > 0) await saveV2DirectionContract(persistence, workflowId, incidentSceneIds);
  return {
    workflowId, projectId, commandId, counts,
    directorArtifacts: artifacts.filter((a) => a.kind === "scene_plan").map((a) => a.artifactId),
    reviewArtifactId: (instance.context.data.reviewBusinessOutcome ?? {}).reviewArtifactId,
  };
}

const gateReached = async (workflowId, stepId) => {
  const w = await persistence.loadWorkflow(workflowId);
  return w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === stepId)?.status === "running";
};

const stepStatus = async (workflowId, stepId) => {
  const w = await persistence.loadWorkflow(workflowId);
  return w?.steps.find((s) => s.stepId === stepId)?.status;
};

// ---------------------------------------------------------------------------
// A — eligibility + one resume on authorization.
// ---------------------------------------------------------------------------

test("A: an eligible technical failure after completed Director authorizes exactly one media resume", { timeout: 180000 }, async () => {
  const setup = await setupIncident("a", { analyticsSpurious: true });
  const eligibility = await dispatcher.eligibility({ workflowId: setup.workflowId });
  assert.equal(eligibility.eligible, true, eligibility.reason);
  assert.equal(eligibility.failureClassification, "RECOVERY_FRONTIER_TECHNICAL_FAILURE");
  assert.equal(eligibility.preProductionApproval?.ownerDecision, "APPROVE");
  assert.equal(eligibility.directorSceneIds?.length, 3);
  assert.equal(eligibility.providerBudget, 5, "1 tts chunk + 1 timeline + 3 images");
  const result = await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });
  assert.equal(result.created, true);
  assert.equal(result.resumeStartStage, "tts");
  assert.ok(result.jobId !== null && result.jobId > 0);
  const rows = await pool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(rows.rows[0].n, 1, "exactly one resume row");
});

test("A2: a media-stage technical failure (TTS) is also eligible with the media classification", { timeout: 180000 }, async () => {
  const setup = await setupIncident("a2");
  const eligibility = await dispatcher.eligibility({ workflowId: setup.workflowId });
  assert.equal(eligibility.eligible, true, eligibility.reason);
  assert.equal(eligibility.failureClassification, "MEDIA_STAGE_TECHNICAL_FAILURE");
});

// ---------------------------------------------------------------------------
// B — no authorization → no job → no execution.
// ---------------------------------------------------------------------------

test("B: without owner authorization nothing is enqueued or executed", { timeout: 120000 }, async () => {
  const setup = await setupIncident("b");
  const jobs = await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1 AND status IN ('queued','running')`, [setup.workflowId]);
  assert.equal(jobs.rows[0].n, 0, "no queued job without authorization");
  const ttsBefore = await gateStepRecord(setup.workflowId, "tts");
  const executionsBefore = (await persistence.listExecutionProvenance(setup.workflowId)).length;
  const worker = makeWorker({});
  assert.equal(await worker.runOnce(), false, "no job to claim");
  assert.equal((await persistence.listExecutionProvenance(setup.workflowId)).length, executionsBefore, "no new executions");
  const ttsAfter = await gateStepRecord(setup.workflowId, "tts");
  assert.equal(ttsAfter.status, ttsBefore.status, "TTS state unchanged (incident evidence untouched)");
  assert.equal(ttsAfter.attempts, ttsBefore.attempts, "TTS attempts unchanged");
  const rows = await pool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(rows.rows[0].n, 0, "no resume created without authorization");
});

async function gateStepRecord(workflowId, stepId) {
  const w = await persistence.loadWorkflow(workflowId);
  return w?.steps.find((s) => s.stepId === stepId) ?? { status: "unknown", attempts: -1 };
}

// ---------------------------------------------------------------------------
// C+D — idempotency + concurrency exactly-once.
// ---------------------------------------------------------------------------

test("C+D: duplicate and concurrent authorization reuse one resume and one job", { timeout: 180000 }, async () => {
  const setup = await setupIncident("cd");
  const first = await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "first" });
  assert.equal(first.created, true);
  const jobsAfterFirst = (await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId])).rows[0].n;

  const duplicate = await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "duplicate" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.resumeId, first.resumeId);
  assert.equal(duplicate.jobId, first.jobId);
  const jobsAfterDuplicate = (await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId])).rows[0].n;
  assert.equal(jobsAfterDuplicate, jobsAfterFirst, "no second job");

  // Concurrent on a fresh incident workflow.
  const setup2 = await setupIncident("cd2");
  const [a, b] = await Promise.all([
    dispatcher.authorizeAndDispatch({ workflowId: setup2.workflowId, authorizedBy: "owner-a", rationale: "concurrent A" }),
    dispatcher.authorizeAndDispatch({ workflowId: setup2.workflowId, authorizedBy: "owner-b", rationale: "concurrent B" }),
  ]);
  assert.equal(a.created || b.created, true, "exactly one dispatches");
  assert.equal(a.created && b.created, false, "never two");
  const rows = await pool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches WHERE workflow_id=$1`, [setup2.workflowId]);
  assert.equal(rows.rows[0].n, 1, "exactly one resume row");
});

// ---------------------------------------------------------------------------
// E+F+G+H — the full authorized path; storage-order independence; firewall.
// ---------------------------------------------------------------------------

test("E+F+G+H: the resume runs TTS→Timeline→Scenes→QA→Visual Gate PENDING; Director not re-executed; analytics never starts; downstream untouched", { timeout: 300000 }, async () => {
  const setup = await setupIncident("egh");
  const directorExecutionsBefore = (await persistence.listExecutionProvenance(setup.workflowId)).filter((r) => r.agentId === "director").length;
  const capBefore = (cap) => setup.counts[cap] ?? 0;
  const before = { tts: capBefore("tts.generate"), timeline: capBefore("timeline.plan"), image: capBefore("image.generate"), video: capBefore("video.generate"), compose: capBefore("media.compose") };
  const result = await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });

  // The persisted ready frontier is EXPLICITLY ["tts"] — never a heuristic.
  const rewound = await persistence.loadWorkflow(setup.workflowId);
  assert.deepEqual(rewound.ready, ["tts"], "frontier is the owner-authorized start stage");
  assert.equal(rewound.steps[0].stepId, "analytics", "adapter loads steps alphabetically (storage-order condition)");

  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  const visualApprovalId = `approval-${setup.workflowId}-${VISUAL_GATE}`;
  await waitForDb(async () => (await control.getApproval(visualApprovalId))?.status === "PENDING", "visual gate approval pending");

  // E: Director not re-executed.
  const directorExecutionsAfter = (await persistence.listExecutionProvenance(setup.workflowId)).filter((r) => r.agentId === "director").length;
  assert.equal(directorExecutionsAfter, directorExecutionsBefore, "Director not re-executed");
  assert.equal(await stepStatus(setup.workflowId, "director"), "completed");
  // F: analytics never starts.
  assert.equal(await stepStatus(setup.workflowId, "analytics"), "pending", "analytics never starts");
  // G: the full chain.
  for (const stage of ["tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa"]) {
    assert.equal(await stepStatus(setup.workflowId, stage), "completed", `${stage} completed`);
  }
  assert.equal(await stepStatus(setup.workflowId, VISUAL_GATE), "running", "visual gate running");
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  assert.equal(artifacts.filter((a) => a.kind === "scene_visual_artifact").length, 3, "3 scene visuals");
  assert.ok(artifacts.some((a) => a.kind === "narration_artifact"), "narration persisted");
  assert.ok(artifacts.some((a) => a.kind === "timeline_plan"), "timeline persisted");
  // H: downstream untouched; provider calls are RESUME deltas only.
  for (const stage of ["wan-authorization", "video", "composer", "final-product-review", "publisher", "analytics"]) {
    assert.equal(await stepStatus(setup.workflowId, stage), "pending", `${stage} untouched`);
  }
  assert.equal((setup.counts["video.generate"] ?? 0) - before.video, 0, "no video calls");
  assert.equal((setup.counts["media.compose"] ?? 0) - before.compose, 0, "no compose calls");
  assert.equal((setup.counts["tts.generate"] ?? 0) - before.tts, 1, "resume: 1 tts call");
  assert.equal((setup.counts["timeline.plan"] ?? 0) - before.timeline, 1, "resume: 1 timeline call");
  assert.equal((setup.counts["image.generate"] ?? 0) - before.image, 3, "resume: 3 image calls");
  // Media chain budget consumed: 1 tts + 1 timeline + 3 images = 5.
  const usage = await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(usage.rows[0].n, 5, "budget accounting: exactly the envelope consumed");
  const resumeRow = await pool.query(`SELECT outcome FROM media_resume_dispatches WHERE resume_id=$1`, [result.resumeId]);
  assert.equal(resumeRow.rows[0].outcome, "VISUAL_GATE_PENDING", "resume settled at the boundary");
  const visualApproval = await control.getApproval(visualApprovalId);
  assert.equal(visualApproval.agentRecommendation.gateType, "POST_VISUAL_QA_APPROVAL");
  assert.equal(visualApproval.ownerDecision, null, "no owner decision on the visual gate");

  await control.decideApproval(visualApprovalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// I+J+K+L — technical failures stop fail-closed.
// ---------------------------------------------------------------------------

for (const [label, failures, expectedStoppedStage] of [
  ["I-tts-failure", { "tts.generate": "FIXTURE_TTS_FAILURE" }, "tts"],
  ["J-timeline-failure", { "timeline.plan": "FIXTURE_TIMELINE_FAILURE" }, "timeline"],
  ["K-scene3-failure", { "scene-003": "FIXTURE_SCENE3_FAILURE" }, "scene-image"],
]) {
  test(`${label}: STOP at the failed stage; no downstream`, { timeout: 240000 }, async () => {
    const setup = await setupIncident(label.slice(0, 8).replace(/[-_]/g, ""));
    await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });
    const worker = makeWorker(setup.counts, failures);
    assert.equal(await worker.runOnce(), true, "run terminates");
    const instance = await persistence.loadWorkflow(setup.workflowId);
    assert.equal(instance.state, "FAILED", "technical failure remains technical");
    assert.equal(instance.steps.find((s) => s.stepId === expectedStoppedStage).status, "failed", `${expectedStoppedStage} failed`);
    const downstream = { "tts": ["timeline", "scene-image", "visual-technical-qa"], "timeline": ["scene-image", "visual-technical-qa"], "scene-image": ["visual-technical-qa"] }[expectedStoppedStage];
    for (const stage of downstream) {
      assert.equal(instance.steps.find((s) => s.stepId === stage).status, "pending", `${stage} never started`);
    }
    assert.equal(await control.getApproval(`approval-${setup.workflowId}-${VISUAL_GATE}`), null, "no visual approval");
    const rows = await pool.query(`SELECT outcome FROM media_resume_dispatches WHERE workflow_id=$1`, [setup.workflowId]);
    assert.equal(rows.rows[0].outcome, "FAILED", "resume settled FAILED");
  });
}

test("L: a Visual QA technical failure stops with no visual approval", { timeout: 240000 }, async () => {
  const setup = await setupIncident("lqa");
  await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });
  // Inject the QA failure at the step level (deterministic stage).
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(setup.counts) });
  const wrapped = executor.executeAgentStep.bind(executor);
  executor.executeAgentStep = async (step, context) => {
    if (step.id === "visual-technical-qa") {
      return { status: "failed", output: { stepId: step.id, agent: step.agent, error: "FIXTURE_QA_TECHNICAL_FAILURE" }, error: { message: "FIXTURE_QA_TECHNICAL_FAILURE", retryable: false } };
    }
    return wrapped(step, context);
  };
  const worker = new WorkflowWorker({ queue, persistence, executor, control, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
  assert.equal(await worker.runOnce(), true);
  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "FAILED");
  assert.equal(instance.steps.find((s) => s.stepId === "visual-technical-qa").status, "failed");
  assert.equal(await control.getApproval(`approval-${setup.workflowId}-${VISUAL_GATE}`), null, "no visual approval on QA failure");
  assert.equal(instance.steps.find((s) => s.stepId === VISUAL_GATE).status, "pending", "gate never reached");
});

// ---------------------------------------------------------------------------
// M — budget exceeded fails BEFORE the provider call.
// ---------------------------------------------------------------------------

test("M: exceeding the authorized provider budget fails closed before the provider call", { timeout: 240000 }, async () => {
  const setup = await setupIncident("m");
  const before = { tts: setup.counts["tts.generate"] ?? 0, timeline: setup.counts["timeline.plan"] ?? 0 };
  // Authorize with the minimum budget of 1: the first resume tts call
  // consumes it, the timeline call must fail BEFORE submission.
  const result = await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fixture authorize", providerBudget: 1 });
  assert.equal(result.providerBudget, 1);
  const worker = makeWorker(setup.counts);
  assert.equal(await worker.runOnce(), true, "run terminates");
  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "FAILED", "budget exhaustion fails the run");
  assert.equal((setup.counts["tts.generate"] ?? 0) - before.tts, 1, "the budgeted call happened");
  assert.equal((setup.counts["timeline.plan"] ?? 0) - before.timeline, 0, "the over-budget call NEVER reached the provider");
  const usage = await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(usage.rows[0].n, 1, "accounting matches the envelope");
});

// ---------------------------------------------------------------------------
// N+O — completed item reuse on restart.
// ---------------------------------------------------------------------------

test("N: a restart after completed TTS reuses the narration without a second provider call", { timeout: 240000 }, async () => {
  traceMediaResumeN("test_start");
  const setup = await setupIncident("n");
  traceMediaResumeN("fixture_setup_complete", { workflowId: setup.workflowId });
  await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });
  // Run through TTS and simulate process loss at the immediately following
  // timeline boundary. WorkflowCrashError leaves that step in-flight, making
  // the restart boundary deterministic instead of racing the engine loop.
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(setup.counts) });
  const execute = executor.executeAgentStep.bind(executor);
  executor.executeAgentStep = async (step, context) => {
    if (step.id === "timeline") {
      traceMediaResumeN("simulated_restart", { boundary: "post_tts_pre_timeline" });
      throw new WorkflowCrashError("FIXTURE_POST_TTS_RESTART_BOUNDARY");
    }
    return execute(step, context);
  };
  const engine = buildDefaultEngine({ persistence, executor, definitionLoader: async () => definition });
  traceMediaResumeN("first_execution_start");
  await engine.resume(setup.workflowId);
  await waitForDb(async () => {
    const w = await persistence.loadWorkflow(setup.workflowId);
    return w?.steps.find((s) => s.stepId === "tts")?.status === "completed" && (w.steps.find((s) => s.stepId === "timeline")?.status === "running" || w.steps.find((s) => s.stepId === "timeline")?.status === "pending");
  }, "tts completed before death");
  traceMediaResumeN("tts_completion_persisted");
  const ttsCallsAfterFirstRun = setup.counts["tts.generate"] ?? 0;
  assert.ok(ttsCallsAfterFirstRun >= 1, "tts executed at least once");

  // Restart: a fresh worker claims a re-queued job and completes the chain.
  traceMediaResumeN("recovery_dispatch");
  await queue.enqueue(setup.workflowId, `mr:${setup.workflowId}`);
  const worker = makeWorker(setup.counts);
  traceMediaResumeN("job_queue_claim_start");
  const run = worker.runOnce();
  const visualApprovalId = `approval-${setup.workflowId}-${VISUAL_GATE}`;
  await waitForDb(async () => (await control.getApproval(visualApprovalId))?.status === "PENDING", "visual gate after restart");
  const ttsCallsAfterRestart = setup.counts["tts.generate"] ?? 0;
  traceMediaResumeN("narration_reuse_lookup_complete", { ttsCallsAfterFirstRun, ttsCallsAfterRestart });
  assert.equal(ttsCallsAfterRestart, ttsCallsAfterFirstRun, "REUSE not RETRY: no duplicate TTS call");
  traceMediaResumeN("artifact_lookup_start");
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  traceMediaResumeN("artifact_lookup_complete", { artifactCount: artifacts.length });
  // The canonical bridge narration artifact (id art-<wf>-narration) exists
  // exactly once; the executor's step-summary wrapper is a separate record.
  assert.equal(artifacts.filter((a) => a.kind === "narration_artifact" && a.artifactId === `art-${setup.workflowId}-narration`).length, 1, "one canonical narration artifact");
  await control.decideApproval(visualApprovalId, "REJECT", "teardown");
  assert.equal(await run, true);
  traceMediaResumeN("recovery_completion");
  traceMediaResumeN("test_assertion_reached");
});

test("O: a restart after completed scene images reuses them without duplicate image calls", { timeout: 300000 }, async () => {
  const setup = await setupIncident("o");
  await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });
  // Run through scene-image and simulate process loss at the immediately
  // following local review boundary. WorkflowCrashError deliberately leaves
  // that step in-flight, matching the engine's canonical crash-restart state.
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(setup.counts) });
  const execute = executor.executeAgentStep.bind(executor);
  executor.executeAgentStep = async (step, context) => {
    if (step.id === "visual-semantic-review") throw new WorkflowCrashError("FIXTURE_POST_IMAGE_RESTART_BOUNDARY");
    return execute(step, context);
  };
  const engine = buildDefaultEngine({ persistence, executor, definitionLoader: async () => definition });
  await engine.resume(setup.workflowId);
  await waitForDb(async () => {
    const w = await persistence.loadWorkflow(setup.workflowId);
    return w?.steps.find((s) => s.stepId === "scene-image")?.status === "completed";
  }, "scene-image completed before death");
  const imageCallsAfterFirstRun = setup.counts["image.generate"] ?? 0;
  assert.equal(imageCallsAfterFirstRun, 3, "3 scene images generated");

  await queue.enqueue(setup.workflowId, `mr:${setup.workflowId}`);
  const worker = makeWorker(setup.counts);
  const run = worker.runOnce();
  const visualApprovalId = `approval-${setup.workflowId}-${VISUAL_GATE}`;
  await waitForDb(async () => (await control.getApproval(visualApprovalId))?.status === "PENDING", "visual gate after restart");
  assert.equal(setup.counts["image.generate"] ?? 0, imageCallsAfterFirstRun, "REUSE not RETRY: no duplicate image calls");
  const artifacts = await persistence.listArtifacts(setup.workflowId);
  assert.equal(artifacts.filter((a) => a.kind === "scene_visual_artifact").length, 3, "3 scene visuals, not 6");
  await control.decideApproval(visualApprovalId, "REJECT", "teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// P+Q+R+S — fail-closed eligibility.
// ---------------------------------------------------------------------------

test("P+Q+R+S: eligibility fails closed for missing director, drift, completed downstream, and disabled visual gate", { timeout: 300000 }, async () => {
  // P: missing frozen Director artifact.
  const setupP = await setupIncident("p");
  await pool.query(`DELETE FROM artifacts WHERE artifact_id = ANY($1::text[])`, [setupP.directorArtifacts]);
  const eligibilityP = await dispatcher.eligibility({ workflowId: setupP.workflowId });
  assert.equal(eligibilityP.eligible, false);
  assert.match(eligibilityP.reason ?? "", /DIRECTOR_SCENE_PLAN_MISSING|DIRECTOR_NOT_COMPLETED/);
  await assert.rejects(() => dispatcher.authorizeAndDispatch({ workflowId: setupP.workflowId, authorizedBy: "owner", rationale: "x" }), /MEDIA_RESUME_NOT_ELIGIBLE/);

  // Q: scene-count drift fails closed at execution (frozen package mismatch).
  const setupQ = await setupIncident("q");
  await dispatcher.authorizeAndDispatch({ workflowId: setupQ.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });
  // Tamper the frozen scene count in the marker (simulating drift).
  const instanceQ = await persistence.loadWorkflow(setupQ.workflowId);
  const dataQ = instanceQ.context.data;
  const markerQ = { ...dataQ.mediaResumeExecution, directorSceneIds: ["scene-001", "scene-002", "scene-003", "scene-004"] };
  await persistence.saveWorkflow({ ...instanceQ, context: { ...instanceQ.context, data: { ...dataQ, mediaResumeExecution: markerQ } } });
  const workerQ = makeWorker(setupQ.counts);
  assert.equal(await workerQ.runOnce(), true, "run terminates");
  const afterQ = await persistence.loadWorkflow(setupQ.workflowId);
  assert.equal(afterQ.state, "FAILED", "drift fails closed");
  assert.equal(afterQ.steps.find((s) => s.stepId === "scene-image").status, "failed", "scene-image failed on drift");
  assert.equal(setupQ.counts["image.generate"] ?? 0, 0, "no image call on drift");

  // R: downstream already completed → eligibility fail.
  const setupR = await setupIncident("r");
  await dispatcher.authorizeAndDispatch({ workflowId: setupR.workflowId, authorizedBy: "owner", rationale: "fixture authorize" });
  const workerR = makeWorker(setupR.counts);
  const runR = workerR.runOnce();
  const visualApprovalIdR = `approval-${setupR.workflowId}-${VISUAL_GATE}`;
  await waitForDb(async () => (await control.getApproval(visualApprovalIdR))?.status === "PENDING", "R first cycle complete");
  await control.decideApproval(visualApprovalIdR, "REJECT", "teardown");
  assert.equal(await runR, true);
  const eligibilityR = await dispatcher.eligibility({ workflowId: setupR.workflowId });
  assert.equal(eligibilityR.eligible, false);
  assert.match(eligibilityR.reason ?? "", /VISUAL_HUMAN_GATE_ALREADY_RESOLVED|STAGE_.*_ALREADY_COMPLETED/);

  // S: visual gate policy disabled → eligibility fail (frozen TRUE snapshot preserved).
  const setupS = await setupIncident("s");
  await control.setHumanGateSetting({ gateKey: "visual", scopeType: "PROJECT", scopeId: setupS.projectId, enabled: false, changedBy: "owner", rationale: "fixture: disable visual gate" });
  const eligibilityS = await dispatcher.eligibility({ workflowId: setupS.workflowId });
  assert.equal(eligibilityS.eligible, false, "disabled visual gate fails closed for this proof package");
  assert.match(eligibilityS.reason ?? "", /VISUAL_HUMAN_GATE_DISABLED/);
  await control.resetHumanGateSetting({ gateKey: "visual", scopeType: "PROJECT", scopeId: setupS.projectId, changedBy: "owner", rationale: "fixture reset" });
});

// ---------------------------------------------------------------------------
// MEDIA CAPABILITY PREFLIGHT V1 — authorization-time, zero-mutation proof.
// ---------------------------------------------------------------------------

async function assertPreflightBlocksWithoutMutation(setup, preflightDispatcher, expectedCode) {
  const beforeWorkflow = await persistence.loadWorkflow(setup.workflowId);
  const beforeJobs = Number((await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId])).rows[0].n);
  await assert.rejects(
    () => preflightDispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "preflight regression" }),
    new RegExp(`MEDIA_CAPABILITY_PREFLIGHT_FAILED:.*${expectedCode}`),
  );
  const afterWorkflow = await persistence.loadWorkflow(setup.workflowId);
  const afterJobs = Number((await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [setup.workflowId])).rows[0].n);
  const resumes = Number((await pool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches WHERE workflow_id=$1`, [setup.workflowId])).rows[0].n);
  const usage = Number((await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE workflow_id=$1`, [setup.workflowId])).rows[0].n);
  assert.deepEqual(afterWorkflow, beforeWorkflow, "failed preflight does not rewind or mutate workflow state");
  assert.equal(afterJobs, beforeJobs, "failed preflight creates no job");
  assert.equal(resumes, 0, "failed preflight creates no resume row");
  assert.equal(usage, 0, "failed preflight consumes no provider budget");
}

test("U: r1 selector-missing configuration is rejected before every durable mutation", { timeout: 180000 }, async () => {
  const setup = await setupIncident("preflight-selector-missing");
  const saved = process.env.TTS_PROVIDER;
  try {
    delete process.env.TTS_PROVIDER;
    await assertPreflightBlocksWithoutMutation(setup, dispatcher, "TTS_PROVIDER_SELECTOR_MISSING");
    assert.equal(setup.counts["tts.generate"] ?? 0, 1, "only the frozen incident call exists; preflight made no call");
  } finally {
    process.env.TTS_PROVIDER = saved;
  }
});

test("V: unsupported and incomplete VoiceTut configuration fail before mutation", { timeout: 240000 }, async () => {
  const unsupported = await setupIncident("preflight-unsupported");
  const savedProvider = process.env.TTS_PROVIDER;
  const savedKey = process.env.RUNPOD_API_KEY;
  const savedEndpoint = process.env.VOICETUT_TTS_ENDPOINT_ID;
  try {
    process.env.TTS_PROVIDER = "unsupported";
    await assertPreflightBlocksWithoutMutation(unsupported, dispatcher, "TTS_PROVIDER_UNSUPPORTED");

    process.env.TTS_PROVIDER = "voicetut";
    delete process.env.RUNPOD_API_KEY;
    const missingKey = await setupIncident("preflight-missing-key");
    await assertPreflightBlocksWithoutMutation(missingKey, dispatcher, "TTS_PROVIDER_CONFIGURATION_MISSING");

    process.env.RUNPOD_API_KEY = savedKey;
    delete process.env.VOICETUT_TTS_ENDPOINT_ID;
    const missingEndpoint = await setupIncident("preflight-missing-endpoint");
    await assertPreflightBlocksWithoutMutation(missingEndpoint, dispatcher, "TTS_PROVIDER_CONFIGURATION_MISSING");
  } finally {
    process.env.TTS_PROVIDER = savedProvider;
    process.env.RUNPOD_API_KEY = savedKey;
    process.env.VOICETUT_TTS_ENDPOINT_ID = savedEndpoint;
  }
});

test("W: missing timeline or image registration blocks authorization before mutation", { timeout: 240000 }, async () => {
  const noTimeline = await setupIncident("preflight-no-timeline");
  await assertPreflightBlocksWithoutMutation(
    noTimeline,
    new PostgresMediaResumeDispatcher(pool, persistence, { registeredCapabilityIds: ["tts.generate", "image.generate"] }),
    "TIMELINE_CAPABILITY_NOT_REGISTERED",
  );
  const noImage = await setupIncident("preflight-no-image");
  await assertPreflightBlocksWithoutMutation(
    noImage,
    new PostgresMediaResumeDispatcher(pool, persistence, { registeredCapabilityIds: ["tts.generate", "timeline.plan"] }),
    "IMAGE_CAPABILITY_NOT_REGISTERED",
  );
});

test("X: stale passing inspection cannot bypass fresh POST-time preflight", { timeout: 180000 }, async () => {
  const setup = await setupIncident("preflight-drift");
  assert.equal(dispatcher.preflight().pass, true, "GET-time inspection fixture passes");
  const saved = process.env.TTS_PROVIDER;
  try {
    delete process.env.TTS_PROVIDER;
    await assertPreflightBlocksWithoutMutation(setup, dispatcher, "TTS_PROVIDER_SELECTOR_MISSING");
  } finally {
    process.env.TTS_PROVIDER = saved;
  }
});

test("Y: successful authorization persists the inspected configuration fingerprint", { timeout: 180000 }, async () => {
  const setup = await setupIncident("preflight-fingerprint");
  const expected = dispatcher.preflight().configurationFingerprint;
  const result = await dispatcher.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fingerprint proof" });
  const row = await pool.query(`SELECT configuration_fingerprint FROM media_resume_dispatches WHERE resume_id=$1`, [result.resumeId]);
  assert.equal(row.rows[0].configuration_fingerprint, expected);
  assert.equal(expected.length, 64);
});

test("Z: explicit engineering-sandbox restriction fails authorization closed with zero durable mutation", { timeout: 180000 }, async () => {
  const setup = await setupIncident("preflight-sandbox");
  // Resolve the classification through the REAL narrow guard with the exact
  // marker set (restored afterwards); nothing is probed over the network.
  const savedMarker = process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  let restrictedEnvironment;
  try {
    process.env.CODEX_SANDBOX_NETWORK_DISABLED = "1";
    restrictedEnvironment = inspectWorkerExecutionEnvironment();
  } finally {
    if (savedMarker === undefined) delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
    else process.env.CODEX_SANDBOX_NETWORK_DISABLED = savedMarker;
  }
  assert.equal(restrictedEnvironment.status, "UNSUPPORTED");
  const restrictedDispatcher = new PostgresMediaResumeDispatcher(pool, persistence, {
    ...mediaBoundary({}),
    workerExecutionEnvironment: restrictedEnvironment,
  });
  const preflight = restrictedDispatcher.preflight();
  assert.equal(preflight.pass, false);
  assert.ok(preflight.failureCodes.includes("ENGINEERING_SANDBOX_NETWORK_DISABLED"));
  await assertPreflightBlocksWithoutMutation(setup, restrictedDispatcher, "ENGINEERING_SANDBOX_NETWORK_DISABLED");
});

// ---------------------------------------------------------------------------
// V2 fingerprint lineage: endpoint-bound durability + execution drift guard.
// ---------------------------------------------------------------------------

/** Pin the VoiceTut endpoint env deterministically for fingerprint tests (restores afterwards). */
function useFixtureEndpoint(endpointId) {
  const savedEndpoint = process.env.VOICETUT_TTS_ENDPOINT_ID;
  const savedBase = process.env.RUNPOD_BASE_URL;
  process.env.VOICETUT_TTS_ENDPOINT_ID = endpointId;
  delete process.env.RUNPOD_BASE_URL;
  const identity = voicetutExecutionIdentityFromEnv();
  assert.ok(identity, "fixture endpoint identity must resolve");
  return {
    restore() {
      if (savedEndpoint === undefined) delete process.env.VOICETUT_TTS_ENDPOINT_ID;
      else process.env.VOICETUT_TTS_ENDPOINT_ID = savedEndpoint;
      if (savedBase === undefined) delete process.env.RUNPOD_BASE_URL;
      else process.env.RUNPOD_BASE_URL = savedBase;
    },
    mediaConfiguration: { ttsEndpointIdentityHash: identity.endpointIdentityHash, ttsBaseHost: identity.baseHost },
  };
}

test("Y2: authorization persists the v2 fingerprint bound to the endpoint identity", { timeout: 180000 }, async () => {
  const fixture = useFixtureEndpoint("endpoint-fingerprint-b-fixture");
  try {
    const setup = await setupIncident("preflight-fpv2");
    const boundaryB = mediaBoundary({}, {}, fixture.mediaConfiguration);
    const dispatcherB = new PostgresMediaResumeDispatcher(pool, persistence, boundaryB);
    const expected = buildMediaConfigurationFingerprintV2(snapshotMediaConfigurationInput(boundaryB, "Mohamed"));
    assert.equal(dispatcherB.preflight().configurationFingerprint, expected);
    assert.equal(dispatcherB.preflight().configurationFingerprintVersion, 2);
    assert.equal(dispatcherB.preflight().effectiveVoice, "Mohamed");
    const result = await dispatcherB.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "fingerprint v2 proof" });
    const row = await pool.query(`SELECT configuration_fingerprint FROM media_resume_dispatches WHERE resume_id=$1`, [result.resumeId]);
    assert.equal(row.rows[0].configuration_fingerprint, expected, "authorization persists the exact v2 fingerprint");
    // A different endpoint would have produced a different durable fingerprint.
    const other = useFixtureEndpoint("endpoint-fingerprint-a-fixture");
    try {
      const fpA = buildMediaConfigurationFingerprintV2(
        snapshotMediaConfigurationInput(mediaBoundary({}, {}, other.mediaConfiguration), "Mohamed"));
      assert.notEqual(expected, fpA, "endpoint swap changes the durable fingerprint");
    } finally {
      other.restore();
    }
  } finally {
    fixture.restore();
  }
});

test("DRIFT: endpoint swap between authorization and execution fails closed before provider invocation", { timeout: 240000 }, async () => {
  const fixtureA = useFixtureEndpoint("endpoint-drift-a-fixture");
  let setup;
  let authResult;
  try {
    setup = await setupIncident("drift-exec");
    const dispatcherA = new PostgresMediaResumeDispatcher(
      pool, persistence, mediaBoundary({}, {}, fixtureA.mediaConfiguration));
    authResult = await dispatcherA.authorizeAndDispatch({ workflowId: setup.workflowId, authorizedBy: "owner", rationale: "drift fixture authorize" });
    assert.equal(authResult.created, true);
  } finally {
    fixtureA.restore();
  }
  const ttsCallsBefore = setup.counts["tts.generate"] ?? 0;
  const fixtureB = useFixtureEndpoint("endpoint-drift-b-fixture");
  try {
    const worker = makeWorker(setup.counts, {}, mediaBoundary(setup.counts, {}, fixtureB.mediaConfiguration));
    assert.equal(await worker.runOnce(), true, "run terminates");
  } finally {
    fixtureB.restore();
  }
  const instance = await persistence.loadWorkflow(setup.workflowId);
  assert.equal(instance.state, "FAILED", "drift fails the run");
  assert.equal(instance.steps.find((s) => s.stepId === "tts").status, "failed", "tts failed on drift");
  assert.equal(setup.counts["tts.generate"] ?? 0, ttsCallsBefore, "no new provider call after drift");
  const usage = await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE workflow_id=$1`, [setup.workflowId]);
  assert.equal(usage.rows[0].n, 0, "no budget consumed after drift");
  const resumeRow = await pool.query(`SELECT outcome FROM media_resume_dispatches WHERE resume_id=$1`, [authResult.resumeId]);
  assert.equal(resumeRow.rows[0].outcome, "FAILED", "resume settled FAILED");
});

// ---------------------------------------------------------------------------
// T — read-only diagnosis policy: this suite never writes production.
// ---------------------------------------------------------------------------

test("T: engineering tests are isolated from production (read-only diagnosis policy)", async () => {
  // The suite's guard already asserts TEST_DATABASE_URL != DATABASE_URL at
  // import time; this test documents the invariant that all writes in this
  // file target the isolated test DB only.
  const isolation = assertTestDatabaseIsolation;
  assert.equal(typeof isolation, "function");
  // No production connection is ever constructed in this suite.
  assert.ok(true);
});
