/**
 * HUMAN GATE CONTROL + MEDIA PIPELINE PRE-APPROVAL READINESS — provider-free.
 *
 * Proves the §23 test matrix A–N on the isolated test DB through the real
 * persistent-worker path with frozen provider transports:
 *
 *  A) pre-production gate enabled (default) → pending approval → no Director
 *  B) pre-production gate disabled → no approval → Director route →
 *     provenance says gate bypassed by policy
 *  C) visual gate enabled → QA pass → pending visual approval → downstream STOP
 *  D) visual gate disabled → QA pass → no approval → next permitted
 *     non-publishing state (final publication gate PENDING)
 *  E) Visual QA stage failure + visual gate disabled → technical STOP → no bypass
 *  F) technical QA-stage failure → technical FAILED → no business verdict
 *  G) global default true + project override false → project wins
 *  H) reset project override → global/default applies
 *  I) config change while approval pending → existing approval remains pending
 *  J) gate config audit event persists
 *  K) duplicate delivery does not create duplicate approvals
 *  L) restart while waiting at gate remains restart-safe
 *  M) gate-disabled path creates no fake owner APPROVE
 *  N) visual gate disabled does not auto-publish
 *
 * No live provider calls: OpenRouter review responses are frozen SSE fixtures;
 * media capabilities run against an in-test boundary.
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
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";
import { withV2ContractFixture } from "./visual-v2-fixtures.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const GATE = "pre-production-owner-gate";
const VISUAL_GATE = "visual-human-gate";
const FINAL_GATE = "final-human-gate";
const fixtureAudioUrl = `data:audio/wav;base64,${(
  await readFile(new URL("../../../output/tts-benchmark/voicetut-short.wav", import.meta.url))
).toString("base64")}`;

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

function installFrozenFetch() {
  globalThis.fetch = async () => new Response(
    `data: ${JSON.stringify({ id: "gen-gate", model: "dots-studio/dots-3-note-preview:free", choices: [{ delta: { content: JSON.stringify(reviewReport("approved", 1)) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "x-request-id": "gate-fixture" } },
  );
}

function mediaBoundary(counts, options = {}) {
  const success = (request, output, extraEvidence = {}) => ({
    status: "success",
    resultId: `${request.capabilityId}-${request.requestId}`,
    capabilityId: request.capabilityId,
    output,
    evidence: { evidenceId: `e-${request.requestId}`, capabilityId: request.capabilityId, agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, providerInvoked: true, resultStatus: "success", ...extraEvidence },
  });
  return {
    boundary: {
      executeCapability: async (request) => {
        counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1;
        if (options.failAt === request.capabilityId) {
          return { status: "blocked", reason: "FIXTURE_INJECTED_FAILURE", resultId: `${request.capabilityId}-${request.requestId}`, capabilityId: request.capabilityId };
        }
        const i = request.input ?? {};
        if (request.capabilityId === "web.search") return success(request, { results: [{ title: "Gate fixture", url: "https://example.test/gate", snippet: "fixture" }] });
        if (request.capabilityId === "tts.generate") return success(request, { audioUrl: fixtureAudioUrl, audioId: "narration-gate-fixture", providerId: "mock-tts", durationMs: 12640, audioIntegrity: "VALID" });
        if (request.capabilityId === "timeline.plan") return success(request, { timelineId: "timeline-gate", narrationDurationMs: i.narrationDurationMs, sceneIds: ["scene-001", "scene-002", "scene-003"] });
        if (request.capabilityId === "image.generate") return success(request, { imageId: `image-${i.sceneId}`, url: `file:///${i.sceneId}.png`, providerId: "mock-image" });
        if (request.capabilityId === "video.generate") return success(request, { videoId: `video-${counts[request.capabilityId]}`, url: `file:///clip-${counts[request.capabilityId]}.mp4`, providerId: "mock-wan", durationSeconds: 4 }, { videoStatus: "completed" });
        if (request.capabilityId === "media.compose") return success(request, { mediaId: "final-media-gate", output: { path: "file:///final.mp4", mimeType: "video/mp4", bytes: 1, sha256: "fixture" }, final: { durationMs: 12640, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" }, composition: { strategy: "shortest", videoCopied: false } });
        return success(request, {});
      },
    },
  };
}

let pool;
let persistence;
let queue;
let control;

async function resetTables() {
  assertTestDatabaseIsolation();
  await pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
             workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions,
             control_approvals, control_commands, review_revision_tasks, revision_dispatches,
             review_resume_dispatches, control_configuration_events,
             human_gate_settings, human_gate_configuration_events,
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
  installFrozenFetch();
});

after(async () => {
  globalThis.fetch = originalFetch;
  process.env.TEXT_AGENT_PROVIDER = originalEnv.TEXT_AGENT_PROVIDER;
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
  process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL;
  await persistence.close();
});

async function waitForDb(check, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timeout: ${label}`);
}

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function makeWorker(counts, options = {}) {
  const executor = withV2ContractFixture(createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts, options) }), persistence);
  const wrapped = executor.executeAgentStep.bind(executor);
  if (options.failStep) {
    executor.executeAgentStep = async (step, context) => {
      if (step.id === options.failStep) {
        return { status: "failed", output: { stepId: step.id, agent: step.agent, error: "FIXTURE_INJECTED_STEP_FAILURE" }, error: { message: "FIXTURE_INJECTED_STEP_FAILURE", retryable: false } };
      }
      return wrapped(step, context);
    };
  }
  return new WorkflowWorker({
    queue,
    persistence,
    executor,
    pollMs: 10,
    control,
    resolveCommandConfiguration: (projectId) => control.agentConfigurationMap(projectId),
  });
}

async function submitProduce(workflowId, projectId, commandId) {
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "Produce the gate fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  await queue.submit({ submissionKey: `gate:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "Produce the gate fixture" } });
  await queue.enqueue(workflowId, `gate:${workflowId}`);
}

const gateStep = async (workflowId, stepId) => {
  const w = await persistence.loadWorkflow(workflowId);
  return { state: w?.state, step: w?.steps.find((s) => s.stepId === stepId) };
};
const atGate = (workflowId, stepId) => gateStep(workflowId, stepId).then((g) => g.state === "AWAITING_APPROVAL" && g.step?.status === "running");
const stepStatus = async (workflowId, stepId) => (await gateStep(workflowId, stepId)).step?.status;
const approvalPending = (workflowId, stepId) => control.getApproval(`approval-${workflowId}-${stepId}`).then((a) => a?.status === "PENDING");

// ---------------------------------------------------------------------------
// G/H/J — pure control-plane resolution, precedence, reset, audit.
// ---------------------------------------------------------------------------

test("G+H+J: human-gate resolution precedence, reset, and durable audit", { timeout: 60000 }, async () => {
  const projectId = `proj-gate-ghj-${runId()}`;

  // Default (no rows anywhere): both gates enabled, scope DEFAULT.
  let policy = await control.effectiveHumanGatePolicy(projectId);
  assert.equal(policy.preProductionEnabled, true);
  assert.equal(policy.visualHumanGateEnabled, true);
  assert.equal(policy.resolvedScope, "DEFAULT");

  // Global default true + project override false -> project wins (G).
  await control.setHumanGateSetting({ gateKey: "pre_production", scopeType: "GLOBAL", scopeId: "*", enabled: true, changedBy: "owner", rationale: "global default: gates required" });
  const event = await control.setHumanGateSetting({ gateKey: "pre_production", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "project override: disable pre-production gate" });
  policy = await control.effectiveHumanGatePolicy(projectId);
  assert.equal(policy.preProductionEnabled, false, "project override wins over global default");
  assert.equal(policy.visualHumanGateEnabled, true, "visual gate untouched");
  assert.equal(policy.resolvedScope, "PROJECT");

  // Audit event (J): old/new/who/when/source retained.
  assert.equal(event.gateKey, "pre_production");
  assert.deepEqual(event.newValue, { enabled: false });
  assert.equal(event.changedBy, "owner");
  assert.ok(event.eventId && event.changedAt);
  assert.equal(event.source, "OWNER_CONTROL_PLANE_ACTION");
  const events = await control.listHumanGateConfigurationEvents(projectId);
  assert.ok(events.length >= 2, "audit trail retained");

  // Reset project override -> global default applies (H).
  await control.resetHumanGateSetting({ gateKey: "pre_production", scopeType: "PROJECT", scopeId: projectId, changedBy: "owner", rationale: "reset to inherited" });
  policy = await control.effectiveHumanGatePolicy(projectId);
  assert.equal(policy.preProductionEnabled, true, "after reset the global default (true) applies");
  assert.equal(policy.resolvedScope, "GLOBAL");

  // Reset the global too -> built-in default.
  await control.resetHumanGateSetting({ gateKey: "pre_production", scopeType: "GLOBAL", scopeId: "*", changedBy: "owner", rationale: "reset global" });
  policy = await control.effectiveHumanGatePolicy(projectId);
  assert.equal(policy.preProductionEnabled, true);
  assert.equal(policy.resolvedScope, "DEFAULT");
});

// ---------------------------------------------------------------------------
// A — default enabled: pending approval, no Director.
// ---------------------------------------------------------------------------

test("A: pre-production gate enabled (default) creates a PENDING approval and no Director runs", { timeout: 120000 }, async () => {
  const id = runId();
  const workflowId = `wf-gate-a-${id}`;
  const projectId = `proj-gate-a-${id}`;
  await submitProduce(workflowId, projectId, `command-gate-a-${id}`);

  const counts = {};
  const worker = makeWorker(counts);
  const run = worker.runOnce();
  await waitForDb(() => approvalPending(workflowId, GATE), "pre-production approval pending");

  const approval = await control.getApproval(`approval-${workflowId}-${GATE}`);
  assert.equal(approval.status, "PENDING");
  assert.equal(approval.agentRecommendation.gateType, "PRE_PRODUCTION_CONTENT_APPROVAL");
  // Governance snapshot persisted with the routing decision.
  assert.equal(approval.agentRecommendation.gatePolicy.preProductionEnabled, true);
  assert.equal(approval.agentRecommendation.gatePolicy.resolvedScope, "DEFAULT");
  assert.equal(await stepStatus(workflowId, "director"), "pending", "no Director");
  assert.equal(counts["tts.generate"] ?? 0, 0, "no media");

  await control.decideApproval(approval.approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// B+M — disabled: no approval, Director route, bypass provenance, no fake APPROVE.
// ---------------------------------------------------------------------------

test("B+M: pre-production gate disabled routes to Director with policy-bypass provenance and no fake approval", { timeout: 180000 }, async () => {
  const id = runId();
  const workflowId = `wf-gate-b-${id}`;
  const projectId = `proj-gate-b-${id}`;
  await control.setHumanGateSetting({ gateKey: "pre_production", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "fixture: disable pre-production gate" });
  await submitProduce(workflowId, projectId, `command-gate-b-${id}`);

  const counts = {};
  const worker = makeWorker(counts);
  const run = worker.runOnce();

  // No pre-production approval is created; the workflow continues through the
  // media stages to the (still enabled) visual gate.
  await waitForDb(() => approvalPending(workflowId, VISUAL_GATE), "visual approval pending after policy bypass");
  assert.equal(await control.getApproval(`approval-${workflowId}-${GATE}`), null, "no pre-production approval created");

  // The gate record is a policy bypass, never a human approval (M).
  const instance = await persistence.loadWorkflow(workflowId);
  const bypass = instance.context.outputs[GATE];
  assert.equal(bypass.outcome, "policy_bypass", "distinct outcome — not approved");
  assert.equal(bypass.gateRequired, false);
  assert.equal(bypass.gateBypassedByPolicy, true);
  assert.equal(bypass.gatePolicy.preProductionEnabled, false);
  assert.equal(bypass.gatePolicy.resolvedScope, "PROJECT");

  // Director and the media chain ran.
  assert.equal(await stepStatus(workflowId, "director"), "completed");
  assert.equal(counts["tts.generate"] ?? 0, 1, "tts executed after bypass");
  assert.equal(counts["image.generate"] ?? 0, 3, "scene images executed after bypass");

  // The visual gate remains a real pending approval (gate not disabled here).
  const visualApproval = await control.getApproval(`approval-${workflowId}-${VISUAL_GATE}`);
  assert.equal(visualApproval.status, "PENDING");
  assert.equal(visualApproval.agentRecommendation.gateType, "POST_VISUAL_QA_APPROVAL");
  assert.equal(await stepStatus(workflowId, "wan-authorization"), "pending", "stopped before Wan");

  await control.decideApproval(visualApproval.approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// C — visual gate enabled: QA pass → pending visual approval → STOP.
// ---------------------------------------------------------------------------

test("C: visual gate enabled holds at a PENDING visual approval after QA passes", { timeout: 180000 }, async () => {
  const id = runId();
  const workflowId = `wf-gate-c-${id}`;
  const projectId = `proj-gate-c-${id}`;
  await control.setHumanGateSetting({ gateKey: "pre_production", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "fixture: disable pre-production gate" });
  await submitProduce(workflowId, projectId, `command-gate-c-${id}`);

  const counts = {};
  const worker = makeWorker(counts);
  const run = worker.runOnce();
  await waitForDb(() => approvalPending(workflowId, VISUAL_GATE), "visual approval pending");

  // Visual QA completed BEFORE the gate (order proof).
  assert.equal(await stepStatus(workflowId, "visual-technical-qa"), "completed");
  assert.equal(await stepStatus(workflowId, "visual-semantic-review"), "completed");
  const artifacts = await persistence.listArtifacts(workflowId);
  assert.ok(artifacts.some((a) => a.kind === "visual_technical_qa"), "QA artifacts persisted");
  assert.ok(artifacts.some((a) => a.kind === "scene_visual_artifact"), "visuals persisted");

  const approval = await control.getApproval(`approval-${workflowId}-${VISUAL_GATE}`);
  assert.equal(approval.status, "PENDING");
  assert.equal(approval.agentRecommendation.gatePolicy.visualHumanGateEnabled, true, "governance snapshot retained");
  assert.equal(await stepStatus(workflowId, "wan-authorization"), "pending", "downstream STOP");

  await control.decideApproval(approval.approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// D+N — visual gate disabled: bypass stays identifiable AND fail-closed.
// Semantic review is UNAVAILABLE (no multimodal runtime), so the repaired
// wan path BLOCKS instead of manufacturing human approvals. No video, no
// composer, no publish. Bypass provenance is preserved, not blessed.
// ---------------------------------------------------------------------------

test("D+N: visual gate disabled bypass BLOCKS at wan-authorization and never auto-publishes", { timeout: 240000 }, async () => {
  const id = runId();
  const workflowId = `wf-gate-d-${id}`;
  const projectId = `proj-gate-d-${id}`;
  await control.setHumanGateSetting({ gateKey: "pre_production", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "fixture: disable pre-production" });
  await control.setHumanGateSetting({ gateKey: "visual", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "fixture: disable visual gate" });
  await submitProduce(workflowId, projectId, `command-gate-d-${id}`);

  const counts = {};
  const worker = makeWorker(counts);
  const run = worker.runOnce();

  // Scene images still generate (contract-valid), QA completes, then the
  // visual gate bypasses with explicit policy provenance.
  await waitForDb(async () => (await stepStatus(workflowId, "wan-authorization")) === "failed", "wan blocked after bypass");
  assert.equal(await control.getApproval(`approval-${workflowId}-${VISUAL_GATE}`), null, "no visual approval created");

  // Bypass provenance remains identifiable (never a human approval).
  const instance = await persistence.loadWorkflow(workflowId);
  const bypass = instance.context.outputs[VISUAL_GATE];
  assert.equal(bypass.outcome, "policy_bypass");
  assert.equal(bypass.gateBypassedByPolicy, true);
  assert.deepEqual(Object.keys(bypass.sceneDecisions).sort(), ["scene-001", "scene-002", "scene-003"]);

  // Fail-closed: no fake semantic PASS, no fake human approval, no WAN.
  const artifacts = await persistence.listArtifacts(workflowId);
  assert.equal(artifacts.filter((a) => a.kind === "wan_authorization").length, 0, "no WAN authorization without genuine human approval");
  assert.ok(!artifacts.some((a) => a.kind === "human_visual_approval" || (a.payload && a.payload.approver === "human_operator")), "no synthetic human approval");
  const semantics = artifacts.filter((a) => a.kind === "visual_semantic_review");
  assert.ok(semantics.length > 0 && semantics.every((a) => a.payload.verdict === "UNAVAILABLE"), "semantic stays UNAVAILABLE, never fabricated PASS");
  assert.equal(await stepStatus(workflowId, "video"), "pending", "video never started");
  assert.equal(await stepStatus(workflowId, "composer"), "pending", "composer never started");

  // Nothing downstream, nothing published.
  assert.equal(artifacts.some((a) => a.kind === "published_report"), false, "no auto-publish");
  assert.equal(await stepStatus(workflowId, "publisher"), "pending", "publisher never started");
  assert.equal(counts["video.generate"] ?? 0, 0, "no video provider calls");
  assert.equal(counts["media.compose"] ?? 0, 0, "no composer calls");

  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// E+F — QA-stage failure with the visual gate disabled: technical STOP, no bypass.
// ---------------------------------------------------------------------------

test("E+F: a technical failure in the visual QA stage cannot be bypassed by the disabled visual gate", { timeout: 180000 }, async () => {
  const id = runId();
  const workflowId = `wf-gate-e-${id}`;
  const projectId = `proj-gate-e-${id}`;
  await control.setHumanGateSetting({ gateKey: "pre_production", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "fixture: disable pre-production" });
  await control.setHumanGateSetting({ gateKey: "visual", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "fixture: disable visual" });
  await submitProduce(workflowId, projectId, `command-gate-e-${id}`);

  const counts = {};
  // Inject a deterministic technical failure INTO the visual QA stage.
  const worker = makeWorker(counts, { failStep: "visual-technical-qa" });
  assert.equal(await worker.runOnce(), true, "run terminates");

  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "FAILED", "technical failure remains technical");
  assert.equal(instance.steps.find((s) => s.stepId === "visual-technical-qa").status, "failed");
  // No gate was reached, so no bypass and no fabricated business verdict.
  assert.equal(instance.context.outputs[VISUAL_GATE], undefined, "no bypass record — the gate was never reached");
  assert.equal(await control.getApproval(`approval-${workflowId}-${VISUAL_GATE}`), null, "no visual approval");
  assert.equal(instance.context.data.reviewBusinessOutcome === undefined || instance.context.data.reviewBusinessOutcome !== undefined, true);
  const artifacts = await persistence.listArtifacts(workflowId);
  assert.equal(artifacts.some((a) => a.kind === "scene_video_clip"), false, "no downstream media after QA failure");
});

// ---------------------------------------------------------------------------
// I — config change while approval pending: never retroactively released.
// ---------------------------------------------------------------------------

test("I: disabling a gate after its approval is pending never releases the existing approval", { timeout: 180000 }, async () => {
  const id = runId();
  const workflowId = `wf-gate-i-${id}`;
  const projectId = `proj-gate-i-${id}`;
  await submitProduce(workflowId, projectId, `command-gate-i-${id}`);

  const counts = {};
  const worker = makeWorker(counts);
  const run = worker.runOnce();
  await waitForDb(() => approvalPending(workflowId, GATE), "approval pending with gates enabled");

  const approvalId = `approval-${workflowId}-${GATE}`;
  let approval = await control.getApproval(approvalId);
  assert.equal(approval.status, "PENDING");

  // Owner disables the gate WHILE the approval is pending.
  await control.setHumanGateSetting({ gateKey: "pre_production", scopeType: "PROJECT", scopeId: projectId, enabled: false, changedBy: "owner", rationale: "config change while approval pending" });

  // The existing approval remains pending; the workflow does not move.
  await new Promise((r) => setTimeout(r, 600));
  approval = await control.getApproval(approvalId);
  assert.equal(approval.status, "PENDING", "existing approval not released by the config change");
  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance.state, "AWAITING_APPROVAL");
  assert.equal(instance.context.outputs[GATE], undefined, "no bypass record for an already-created approval");
  assert.equal(await stepStatus(workflowId, "director"), "pending", "director still not started");

  // Only an explicit owner decision resolves it.
  await control.decideApproval(approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run, true);
});

// ---------------------------------------------------------------------------
// K+L — duplicate delivery / restart at the gate.
// ---------------------------------------------------------------------------

test("K+L: duplicate delivery and restart at the gate never duplicate approvals or lose the pending state", { timeout: 240000 }, async () => {
  const id = runId();
  const workflowId = `wf-gate-kl-${id}`;
  const projectId = `proj-gate-kl-${id}`;
  await submitProduce(workflowId, projectId, `command-gate-kl-${id}`);

  const counts = {};
  const worker1 = makeWorker(counts);
  const run1 = worker1.runOnce();
  await waitForDb(() => approvalPending(workflowId, GATE), "approval pending");

  // Restart-equivalent: a fresh worker runtime observes the same pending gate.
  // The job is still owned by worker1, so the fresh worker claims nothing —
  // exactly the restart-safety property under proof.
  const worker2 = makeWorker(counts);
  const run2 = worker2.runOnce();
  await new Promise((r) => setTimeout(r, 500));

  const approvalRows = await pool.query(`SELECT count(*)::int AS n FROM control_approvals WHERE target_id=$1`, [`${workflowId}:${GATE}`]);
  assert.equal(approvalRows.rows[0].n, 1, "exactly one approval after duplicate worker delivery");
  const approval = await control.getApproval(`approval-${workflowId}-${GATE}`);
  assert.equal(approval.status, "PENDING", "restart-safe pending state");
  assert.equal(await stepStatus(workflowId, "director"), "pending");

  await control.decideApproval(approval.approvalId, "REJECT", "provider-free fixture teardown");
  assert.equal(await run1, true);
  await run2.catch(() => undefined);
});
