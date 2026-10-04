/**
 * Dispatcher-level preflight authorization hardening (isolated test DB, zero-network).
 *
 * Proves the exact R6 defect at the authorization boundary:
 *   timeline.plan registered but timeline caller not authorized
 *   => authorizeAndDispatch FAILS before any durable mutation, job, budget or provider call.
 *
 * Then with the repaired grant => PASS (authorization creates a resume).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, PostgresMediaResumeDispatcher } from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { createCapabilityRegistry } from "../../../packages/tool-framework/dist/index.js";
import { PROVIDER_CAPABILITIES, DEFAULT_PROVIDER_GRANTS } from "../../../packages/provider-adapters/dist/wiring/registry.js";
import { truncateAll, TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";
import { canonicalResearchPayload, canonicalResearchResults, isResearchPrompt } from "./canonical-production-fixtures.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const reviewReport = {
  reportId: "00000000-0000-4000-8000-000000000001", taskDescription: "Review", summary: "approved", status: "approved", findings: [], recommendations: [],
  metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0" },
};

let pool; let persistence; let queue; let control;
const originalFetch = globalThis.fetch;

function boundaryWithGrants(grants) {
  const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants });
  return {
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate", "media.compose"],
    resolver,
    workerExecutionEnvironment: { status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null },
    workerRuntime: { mode: "PERSISTENT_PRODUCTION_WORKER", launcherClassification: "test", instanceId: "test", nodeVersion: process.version },
    mediaConfiguration: { ttsEndpointIdentityHash: "hash-fixture", ttsBaseHost: "api.runpod.ai" },
  };
}

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
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
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const prompt = String(body.messages?.[1]?.content ?? "");
    const payload = isResearchPrompt(prompt) ? canonicalResearchPayload(prompt) : reviewReport;
    return new Response(
      `data: ${JSON.stringify({ id: "gen-media", model: body.model, choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage: { prompt_tokens: 9, completion_tokens: 12, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
      { status: 200, headers: { "x-request-id": "fixture" } },
    );
  };
});

after(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.TEXT_AGENT_PROVIDER;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.TTS_PROVIDER;
  delete process.env.RUNPOD_API_KEY;
  delete process.env.VOICETUT_TTS_ENDPOINT_ID;
  delete process.env.IMAGE_PROVIDER;
  delete process.env.RUNPOD_IMAGE_ENDPOINT_ID;
  await persistence.close();
});

async function waitFor(check, label, ms = 90000) {
  const d = Date.now() + ms;
  while (Date.now() < d) { if (await check()) return; await new Promise(r => setTimeout(r, 25)); }
  throw new Error(`timeout: ${label}`);
}

async function setupIncident(label) {
  await pool.query(`DELETE FROM workflow_jobs WHERE status='queued'`);
  const workflowId = `wf-auth-${label}-${Date.now().toString(36)}`;
  const projectId = `proj-auth-${label}-${Date.now().toString(36)}`;
  const commandId = `cmd-auth-${label}-${Date.now().toString(36)}`;
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  await queue.submit({ submissionKey: `auth:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "fixture" } });
  await queue.enqueue(workflowId, `auth:${workflowId}`);
  const counts = {};
  const mediaBoundary = (c, failures = {}) => ({
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate", "media.compose"],
    resolver: createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS }),
    boundary: {
      executeCapability: async (req) => {
        c[req.capabilityId] = (c[req.capabilityId] ?? 0) + 1;
        const f = failures[req.input?.sceneId ?? req.capabilityId];
        if (f) throw new Error(f);
        if (req.capabilityId === "web.search") return { status: "success", resultId: req.requestId, capabilityId: req.capabilityId, output: { results: canonicalResearchResults }, evidence: { evidenceId: `e-${req.requestId}`, succeeded: true, providerInvoked: true } };
        if (req.capabilityId === "tts.generate") return { status: "success", resultId: req.requestId, capabilityId: req.capabilityId, output: { audioUrl: `data:audio/wav;base64,${Buffer.from("RIFF****WAVE").toString("base64")}`, audioId: "a" }, evidence: { evidenceId: "e", succeeded: true, providerInvoked: true } };
        if (req.capabilityId === "timeline.plan") return { status: "success", resultId: req.requestId, capabilityId: req.capabilityId, output: { timelineId: "tl" }, evidence: { evidenceId: "e", succeeded: true, providerInvoked: false } };
        if (req.capabilityId === "image.generate") return { status: "success", resultId: req.requestId, capabilityId: req.capabilityId, output: { imageId: "i", url: "file:///x.png" }, evidence: { evidenceId: "e", succeeded: true, providerInvoked: true } };
        return { status: "success", resultId: req.requestId, capabilityId: req.capabilityId, output: {}, evidence: { evidenceId: "e", succeeded: true } };
      },
    },
  });
  const incidentExecutor = createProductionAgentExecutor({ persistence, providerBoundary: mediaBoundary(counts, { "tts.generate": "INCIDENT_TTS_FAIL" }) });
  const w1 = new WorkflowWorker({ queue, persistence, executor: incidentExecutor, control, pollMs: 10, resolveCommandConfiguration: p => control.agentConfigurationMap(p) });
  const run = w1.runOnce(); run.catch(() => {});
  await waitFor(async () => {
    const w = await persistence.loadWorkflow(workflowId);
    return w?.state === "AWAITING_APPROVAL" && w.steps.find(s => s.stepId === "pre-production-owner-gate")?.status === "running";
  }, "gate");
  const approvalId = `approval-${workflowId}-pre-production-owner-gate`;
  await control.createApproval({ approvalId, projectId, targetType: "workflow_gate", targetId: `${workflowId}:pre-production-owner-gate`, agentRecommendation: { workflowId, stepId: "pre-production-owner-gate" }, agentConfidence: null, evidenceRefs: [], status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString() });
  await control.decideApproval(approvalId, "APPROVE", "fixture");
  await waitFor(async () => {
    const w = await persistence.loadWorkflow(workflowId);
    return w?.state === "FAILED" && w.steps.find(s => s.stepId === "director")?.status === "completed";
  }, "failed");
  await run;
  return { workflowId, projectId };
}

test("timeline caller not authorized => dispatcher fails before resume/job/budget/provider", async () => {
  const { workflowId } = await setupIncident("auth-fail");
  const oldGrants = DEFAULT_PROVIDER_GRANTS.filter(g => !(g.agentId === "timeline" && g.capabilityIds.includes("timeline.plan")));
  const boundary = boundaryWithGrants(oldGrants);
  const dispatcher = new PostgresMediaResumeDispatcher(pool, persistence, boundary);
  const pre = dispatcher.preflight();
  assert.equal(pre.pass, false);
  assert.ok(pre.failureCodes.includes("TIMELINE_CALLER_NOT_AUTHORIZED"));
  const beforeWorkflow = await persistence.loadWorkflow(workflowId);
  const beforeJobs = Number((await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [workflowId])).rows[0].n);
  await assert.rejects(() => dispatcher.authorizeAndDispatch({ workflowId, authorizedBy: "owner", rationale: "auth must fail" }), /MEDIA_CAPABILITY_PREFLIGHT_FAILED.*TIMELINE_CALLER_NOT_AUTHORIZED/);
  const afterWorkflow = await persistence.loadWorkflow(workflowId);
  const afterJobs = Number((await pool.query(`SELECT count(*)::int AS n FROM workflow_jobs WHERE workflow_id=$1`, [workflowId])).rows[0].n);
  const resumes = Number((await pool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches WHERE workflow_id=$1`, [workflowId])).rows[0].n);
  const usage = Number((await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE workflow_id=$1`, [workflowId])).rows[0].n);
  assert.deepEqual(afterWorkflow, beforeWorkflow);
  assert.equal(afterJobs, beforeJobs);
  assert.equal(resumes, 0);
  assert.equal(usage, 0);
});

test("repaired grant => dispatcher authorizes and creates resume/job", async () => {
  const { workflowId } = await setupIncident("auth-pass");
  const boundary = boundaryWithGrants(DEFAULT_PROVIDER_GRANTS);
  const dispatcher = new PostgresMediaResumeDispatcher(pool, persistence, boundary);
  const pre = dispatcher.preflight();
  assert.equal(pre.pass, true);
  const result = await dispatcher.authorizeAndDispatch({ workflowId, authorizedBy: "owner", rationale: "auth must pass" });
  assert.equal(result.created, true);
  assert.equal(result.resumeStartStage, "tts");
  assert.ok(result.jobId !== null);
});
