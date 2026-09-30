/**
 * END-TO-END incident regression (real PG adapter ordering).
 *
 * Reproduces the 2026-09-14 live incident: a workflow persisted at the
 * pre-production gate (AWAITING_APPROVAL) is resumed by a COLD worker through
 * the canonical process() → engine.resume() path. With the defect, recovery
 * injected the alphabetically-first pending stage (analytics) into the
 * frontier and it executed in parallel with director, failing the workflow.
 * With the fix, the frontier continues from the gate's successor only:
 * Director → TTS → Timeline → Scene Image → Visual QA → Visual Human Gate
 * PENDING, with analytics never started.
 */

import { test } from "node:test";
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
import { buildDefaultEngine, createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";
import { withV2ContractFixture } from "./visual-v2-fixtures.js";
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

function traceColdResume(stage, detail = {}) {
  if (process.env.AMF_TEST_TRACE_COLD_RESUME !== "1") return;
  process.stderr.write(`${JSON.stringify({
    test: "cold-resume-gate-frontier-regression",
    stage,
    at: new Date().toISOString(),
    ...detail,
  })}\n`);
}

const reviewReport = {
  reportId: "00000000-0000-4000-8000-0000000000aa",
  taskDescription: "Review content for review",
  summary: "Incident regression approved review.",
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
      `data: ${JSON.stringify({ id: "gen-incident", model: body.model, choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "x-request-id": "incident-fixture" } },
    );
  };
}

function mediaBoundary(counts) {
  const success = (request, output, extraEvidence = {}) => ({
    status: "success",
    resultId: `${request.capabilityId}-${request.requestId}`,
    capabilityId: request.capabilityId,
    output,
    evidence: { evidenceId: `e-${request.requestId}`, capabilityId: request.capabilityId, agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, providerInvoked: true, resultStatus: "success", ...extraEvidence },
  });
  return {
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate", "media.compose"],
    boundary: {
      executeCapability: async (request) => {
        counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1;
        const i = request.input ?? {};
        if (request.capabilityId === "web.search") return success(request, { results: canonicalResearchResults });
        if (request.capabilityId === "tts.generate") return success(request, { audioUrl: fixtureAudioUrl, audioId: "narration-incident", providerId: "mock-tts", durationMs: 12640, audioIntegrity: "VALID" });
        if (request.capabilityId === "timeline.plan") return success(request, { timelineId: "timeline-incident", narrationDurationMs: i.narrationDurationMs, sceneIds: ["scene-001", "scene-002", "scene-003"] });
        if (request.capabilityId === "image.generate") return success(request, { imageId: `image-${i.sceneId}`, url: `file:///${i.sceneId}.png`, providerId: "mock-image" });
        return success(request, {});
      },
    },
  };
}

test("cold worker resume at a persisted pending gate continues the media chain from the gate successor only (analytics incident regression)", { timeout: 240000 }, async () => {
  let pool;
  try {
    pool = createPool({ connectionString: TEST_DATABASE_URL });
    await migrate(pool);
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
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const control = new ControlPlaneStore(pool);
    process.env.TEXT_AGENT_PROVIDER = "deterministic";
    process.env.OPENROUTER_API_KEY = "test";
    process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
    process.env.TTS_PROVIDER = "voicetut";
    process.env.RUNPOD_API_KEY = "present-not-used";
    process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
    process.env.IMAGE_PROVIDER = "self-hosted-image";
    process.env.RUNPOD_IMAGE_ENDPOINT_ID = "present-not-used";
    installFrozenFetch();

    const workflowId = "wf-incident-regression";
    const projectId = "proj-incident-regression";
    const commandId = "command-incident-regression";
    await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "Produce the incident regression fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
    await queue.submit({ submissionKey: `inc:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "Produce the incident regression fixture" } });
    await queue.enqueue(workflowId, `inc:${workflowId}`);

    const counts = {};
    const executor = withV2ContractFixture(createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts) }), persistence);
    const executeAgentStep = executor.executeAgentStep.bind(executor);
    executor.executeAgentStep = async (step, context) => {
      const outcome = await executeAgentStep(step, context);
      if (outcome.status === "failed") {
        traceColdResume("step_failed", { stepId: step.id, agent: step.agent, error: outcome.error?.message ?? null });
      }
      return outcome;
    };

    // Phase 1: run the workflow to the persisted gate state (the pre-incident
    // condition) WITHOUT a polling worker loop — the engine reaches
    // AWAITING_APPROVAL and persists; the "worker process" then dies.
    const engine1 = buildDefaultEngine({ persistence, executor, definitionLoader: async () => definition });
    traceColdResume("first_execution_start", { workflowId });
    await engine1.start({
      workflowId, definition,
      trigger: { directive: "produce", contentTopic: "Incident regression fixture", language: "en", voice: "fixture", commandId, commandType: "START_GOVERNED_TASK" },
      correlationId: `corr-${workflowId}`, brandId: projectId,
    });
    const approvalId = `approval-${workflowId}-${GATE}`;
    const deadline1 = Date.now() + 60000;
    while (Date.now() < deadline1) {
      const w = await persistence.loadWorkflow(workflowId);
      if (w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === GATE)?.status === "running") break;
      if (w?.state === "FAILED") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const persisted = await persistence.loadWorkflow(workflowId);
    if (process.env.AMF_TEST_TRACE_COLD_RESUME === "1") {
      const provenance = await persistence.listExecutionProvenance(workflowId);
      const decisions = await persistence.listDecisions(workflowId);
      traceColdResume("pre_restart_state", {
        workflowState: persisted?.state ?? null,
        ready: persisted?.ready ?? [],
        steps: persisted?.steps.map((step) => ({ stepId: step.stepId, status: step.status, attempts: step.attempts })) ?? [],
        provenance: provenance.map((row) => ({
          executionId: row.executionId,
          agentId: row.agentId,
          stage: row.stage,
          status: row.status,
          errorClassification: row.errorClassification,
          lifecycleState: row.configuration && typeof row.configuration === "object" && !Array.isArray(row.configuration)
            ? row.configuration.lifecycleState ?? null
            : null,
        })),
        policyDecisions: decisions.filter((row) => row.kind === "production_policy").map((row) => ({ decisionId: row.decisionId, status: row.status })),
        capabilityCounts: counts,
      });
    }
    assert.equal(persisted.state, "AWAITING_APPROVAL", "workflow persisted at the gate");
    assert.equal(persisted.steps.find((s) => s.stepId === GATE).status, "running");
    assert.equal(persisted.steps[0].stepId, "analytics", "adapter loads steps alphabetically (incident condition)");
    // The owner approval row exists exactly as the worker would create it.
    await control.createApproval({
      approvalId, projectId, targetType: "workflow_gate", targetId: `${workflowId}:${GATE}`,
      agentRecommendation: { workflowId, stepId: GATE, gateType: "PRE_PRODUCTION_CONTENT_APPROVAL", required: "OWNER_DECISION" }, agentConfidence: null,
      evidenceRefs: (await persistence.listArtifacts(workflowId)).map((a) => a.artifactId),
      status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
    });
    // The owner approves while the worker is down (the incident timing).
    await control.decideApproval(approvalId, "APPROVE", "incident regression: approve the content package");

    // Phase 2: the COLD worker claims the queued job and resumes through the
    // canonical process() → engine.resume() path — the exact incident path.
    const worker = new WorkflowWorker({ queue, persistence, executor, control, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
    const run = worker.runOnce();
    const deadline2 = Date.now() + 180000;
    while (Date.now() < deadline2) {
      const w = await persistence.loadWorkflow(workflowId);
      const visualPending = w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === VISUAL_GATE)?.status === "running";
      if (visualPending && (await control.getApproval(`approval-${workflowId}-${VISUAL_GATE}`))?.status === "PENDING") break;
      if (w?.state === "FAILED") break;
      await new Promise((r) => setTimeout(r, 25));
    }

    const final = await persistence.loadWorkflow(workflowId);
    if (process.env.AMF_TEST_TRACE_COLD_RESUME === "1") {
      const artifacts = await persistence.listArtifacts(workflowId);
      traceColdResume("post_cold_resume_state", {
        workflowState: final?.state ?? null,
        ready: final?.ready ?? [],
        steps: final?.steps.map((step) => ({ stepId: step.stepId, status: step.status, attempts: step.attempts })) ?? [],
        blockedArtifacts: artifacts.filter((artifact) => artifact.status === "blocked").map((artifact) => ({
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          payload: artifact.payload,
        })),
        capabilityCounts: counts,
      });
    }
    if (final?.state === "FAILED") await run;
    assert.equal(final.state, "AWAITING_APPROVAL", "the chain reaches the visual human gate (the incident outcome was FAILED)");
    assert.equal(final.steps.find((s) => s.stepId === "analytics").status, "pending", "analytics NEVER started");
    assert.equal(final.steps.find((s) => s.stepId === "analytics").attempts, 0, "analytics never attempted");
    assert.equal(final.steps.find((s) => s.stepId === "director").status, "completed");
    assert.equal(final.steps.find((s) => s.stepId === "tts").status, "completed");
    assert.equal(final.steps.find((s) => s.stepId === "timeline").status, "completed");
    assert.equal(final.steps.find((s) => s.stepId === "scene-image").status, "completed");
    assert.equal(final.steps.find((s) => s.stepId === "visual-technical-qa").status, "completed");
    assert.equal(final.steps.find((s) => s.stepId === "wan-authorization").status, "pending", "stopped before Wan");
    const visualApproval = await control.getApproval(`approval-${workflowId}-${VISUAL_GATE}`);
    assert.equal(visualApproval.status, "PENDING");
    assert.equal(visualApproval.agentRecommendation.gateType, "POST_VISUAL_QA_APPROVAL");
    assert.equal(visualApproval.ownerDecision, null);
    assert.equal(counts["tts.generate"] ?? 0, 1, "one tts chunk");
    assert.equal(counts["timeline.plan"] ?? 0, 1, "one timeline plan");
    assert.equal(counts["image.generate"] ?? 0, 3, "one image per scene");
    assert.equal(counts["video.generate"] ?? 0, 0, "no video");
    assert.equal(counts["media.compose"] ?? 0, 0, "no composer");

    // Teardown: reject the visual gate to settle the run.
    await control.decideApproval(`approval-${workflowId}-${VISUAL_GATE}`, "REJECT", "provider-free fixture teardown");
    assert.equal(await run, true);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.TEXT_AGENT_PROVIDER = originalEnv.TEXT_AGENT_PROVIDER;
    process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
    process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL;
    for (const key of ["TTS_PROVIDER", "RUNPOD_API_KEY", "VOICETUT_TTS_ENDPOINT_ID", "IMAGE_PROVIDER", "RUNPOD_IMAGE_ENDPOINT_ID"]) {
      if (originalEnv[key] === undefined) delete process.env[key]; else process.env[key] = originalEnv[key];
    }
    if (pool) await pool.end();
  }
});
