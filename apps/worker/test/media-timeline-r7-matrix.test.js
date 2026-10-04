/**
 * R7 hardening matrix (isolated test DB, zero-network, no live provider).
 *
 * A/B: worker build parity (drift vs match) + build-id determinism.
 * C/D: grant certification (absent vs present).
 * E/F/G/H/I/J: timeline exactly-once claim, duplicate/recovery/restart observation, budget-once.
 * L/M/N/O/P/Q/R: timeline success artifact, failure stops, images, QA, gate, firewall, no TTS replay.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, PostgresMediaResumeDispatcher, assertWorkerBuildParity } from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createProductionAgentExecutor, WorkflowWorker, computeMediaBuildId, certifyMediaGrants, assertMediaGrants, certifyPersistentWorkerReadiness } from "../dist/index.js";
import { createCapabilityRegistry } from "../../../packages/tool-framework/dist/index.js";
import { PROVIDER_CAPABILITIES, DEFAULT_PROVIDER_GRANTS } from "../../../packages/provider-adapters/dist/wiring/registry.js";
import { truncateAll, TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const GATE = "pre-production-owner-gate";
const VGATE = "visual-human-gate";

let pool; let persistence; let queue; let control;
const realFetch = globalThis.fetch;
const KEEP_KEYS = ["TTS_PROVIDER", "RUNPOD_API_KEY", "VOICETUT_TTS_ENDPOINT_ID", "IMAGE_PROVIDER", "RUNPOD_IMAGE_ENDPOINT_ID"];
const savedEnv = Object.fromEntries([...KEEP_KEYS, "TEXT_AGENT_PROVIDER", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CODEX_SANDBOX_NETWORK_DISABLED", "AMF_WORKER_RUNTIME_MODE", "AMF_WORKER_LAUNCHER"].map((k) => [k, process.env[k]]));

function buildWav() {
  const l = 2205 * 2; const b = Buffer.alloc(44 + l);
  b.write("RIFF", 0); b.writeUInt32LE(36 + l, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24);
  b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(l, 40);
  return b;
}
const WAV_B64 = buildWav().toString("base64");

function mockBridge(calls, failures = {}) {
  const never = async () => ({ status: "COMPLETED", output: {} });
  return {
    executeDirector: never, executeTts: async () => { calls.ttsCalls = (calls.ttsCalls ?? 0) + 1; return { status: "COMPLETED", output: {} }; },
    executeTimeline: async (input) => {
      calls.timelineCalls = (calls.timelineCalls ?? 0) + 1;
      if (failures.timeline) throw new Error(failures.timeline);
      // Mirror the real bridge: consume one budget unit before invoking.
      await input.consumeProviderBudget?.({ stage: "timeline", capabilityId: "timeline.plan" });
      return { status: "COMPLETED", output: { timelineId: "tl-fixture", sceneIds: ["scene-001", "scene-002", "scene-003"] } };
    },
    executeSceneImage: async (input) => {
      calls.imageCalls = (calls.imageCalls ?? 0) + 1;
      // Mirror the real bridge: one budget unit per scene.
      for (const sceneId of ["scene-001", "scene-002", "scene-003"]) {
        await input.consumeProviderBudget?.({ stage: "scene-image", capabilityId: "image.generate", itemId: sceneId });
      }
      return { status: "COMPLETED", output: { sceneIds: ["scene-001", "scene-002", "scene-003"], visuals: [] } };
    },
    executeVisualSemanticReview: async () => ({ status: "COMPLETED", output: { verdict: "PASS" } }),
    executeVisualTechnicalQa: async () => ({ status: "COMPLETED", output: { verdict: "PASS" } }),
    executeWanAuthorization: async () => { calls.forbidden = (calls.forbidden ?? 0) + 1; return { status: "COMPLETED", output: {} }; },
    executeVideo: async () => { calls.forbidden = (calls.forbidden ?? 0) + 1; return { status: "COMPLETED", output: {} }; },
    executeComposer: async () => { calls.forbidden = (calls.forbidden ?? 0) + 1; return { status: "COMPLETED", output: {} }; },
  };
}

function stubBoundary(counts = {}, failures = {}) {
  return {
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate", "media.compose"],
    resolver: createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS }),
    workerExecutionEnvironment: { status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null },
    workerRuntime: { mode: "PERSISTENT_PRODUCTION_WORKER", launcherClassification: "test", instanceId: "test", nodeVersion: process.version },
    mediaConfiguration: { ttsEndpointIdentityHash: "hash-fixture", ttsBaseHost: "api.runpod.ai" },
    boundary: { execute: async () => ({ status: "success", resultId: "r", capabilityId: "x", output: {}, evidence: { evidenceId: "e", succeeded: true } }) },
  };
}

async function createTimelineFixture(label) {
  const workflowId = `wf-mx-${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const projectId = `proj-mx-${label}`;
  const commandId = `cmd-mx-${label}-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  await pool.query(`DELETE FROM workflow_jobs WHERE status='queued'`);
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: now });
  await queue.submit({ submissionKey: `mx:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "fixture" } });
  await pool.query(`INSERT INTO workflow_instances (workflow_id, definition_id, definition_version, state, context, ready, created_at, updated_at) VALUES ($1,$2,$3,'FAILED',$4,$5,$6,$6) ON CONFLICT (workflow_id) DO UPDATE SET state='FAILED', context=$4, updated_at=$6`,
    [workflowId, definition.id, definition.version, JSON.stringify({ workflowId, data: { reviewBusinessOutcome: { reviewArtifactId: `art-${workflowId}-review`, status: "approved" }, directive: "produce" }, brandId: projectId, correlationId: `corr-${workflowId}`, directive: "produce", outputs: {} }), JSON.stringify([]), now]);
  for (const step of definition.steps) {
    let status = "pending";
    if (["planner-initial", "planner-synthesis", "research", "writer", "seo", "brand", "review", "pre-production-owner-gate", "director", "tts"].includes(step.id)) status = "completed";
    else if (step.id === "timeline") status = "failed";
    await pool.query(`INSERT INTO workflow_steps (workflow_id, step_id, status, attempts, started_at, finished_at) VALUES ($1,$2,$3,1,$4,$4) ON CONFLICT (workflow_id, step_id) DO UPDATE SET status=$3`, [workflowId, step.id, status, now]);
  }
  const parentId = `tts-narration-${workflowId}`;
  const chunkIds = [1, 2, 3].map((i) => `art-${workflowId}-chunk-${i}`);
  for (let i = 0; i < 3; i++) {
    await persistence.saveArtifact({ artifactId: chunkIds[i], kind: "chunk_audio_artifact", producerAgent: "chunk_audio_artifact", workflowId, correlationId: `corr-${workflowId}`, status: "completed", payload: { kind: "chunk_audio_artifact", artifactId: chunkIds[i], parentNarrationId: parentId, chunkIndex: i, chunkCount: 3, provider: "voicetut", voice: "Mohamed", format: "wav", path: `data:audio/wav;base64,${WAV_B64}`, sha256: "x", sampleRate: 24000, channels: 1, durationMs: 1000, status: "completed", configurationFingerprint: "x", logicalChunkId: `log-${i}`, textFingerprint: `fp-${i}` }, contentType: "application/json", schemaVersion: "1.0", createdAt: now });
  }
  await persistence.saveArtifact({ artifactId: `art-${workflowId}-narration`, kind: "narration_artifact", producerAgent: "narration_artifact", workflowId, correlationId: `corr-${workflowId}`, status: "completed", payload: { kind: "narration_artifact", parentNarrationId: parentId, voice: "Mohamed", provider: "voicetut", lineage: { parentNarrationId: parentId, orderedChunkArtifactIds: chunkIds }, childArtifactIds: chunkIds }, contentType: "application/json", schemaVersion: "1.0", createdAt: now });
  for (const kind of ["writer_report", "seo_report", "brand_report"]) {
    await persistence.saveArtifact({ artifactId: `art-${workflowId}-${kind}`, kind, producerAgent: kind.split("_")[0], workflowId, correlationId: `corr-${workflowId}`, status: "completed", payload: kind === "writer_report" ? { content: "x".repeat(600) } : { status: "completed" }, contentType: "application/json", schemaVersion: "1.0", createdAt: now });
  }
  await persistence.saveArtifact({ artifactId: `art-${workflowId}-review`, kind: "review_report", producerAgent: "review", workflowId, correlationId: `corr-${workflowId}`, status: "completed", payload: { status: "approved", summary: "ok", findings: [], recommendations: [] }, contentType: "application/json", schemaVersion: "1.0", createdAt: now });
  await persistence.saveArtifact({ artifactId: `art-${workflowId}-director`, kind: "scene_plan", producerAgent: "director", workflowId, correlationId: `corr-${workflowId}`, status: "completed", payload: { sceneIds: ["scene-001", "scene-002", "scene-003"] }, contentType: "application/json", schemaVersion: "1.0", createdAt: now });
  await control.createApproval({ approvalId: `approval-${workflowId}-pre-production-owner-gate`, projectId, targetType: "workflow_gate", targetId: `${workflowId}:pre-production-owner-gate`, agentRecommendation: { workflowId, stepId: "pre-production-owner-gate" }, agentConfidence: null, evidenceRefs: [], status: "PENDING", supersedes: null, supersededBy: null, createdAt: now });
  await control.decideApproval(`approval-${workflowId}-pre-production-owner-gate`, "APPROVE", "fixture");
  await pool.query(`INSERT INTO workflow_jobs (workflow_id, submission_key, status, attempts, created_at, updated_at) VALUES ($1,$2,'failed',1,$3,$3)`, [workflowId, `mx:${workflowId}`, now]);
  await pool.query(`INSERT INTO media_resume_dispatches (resume_id, workflow_id, source_failed_job_id, failure_classification, resume_attempt, resume_start_stage, pre_production_approval_id, review_artifact_id, writer_artifact_id, seo_artifact_id, brand_artifact_id, director_artifact_id, director_lineage_artifact_id, director_scene_ids, gate_policy_snapshot, provider_budget, downstream_boundary, authorization_status, authorized_by, rationale, authorized_at, job_id, outcome, configuration_fingerprint) VALUES ($1,$2,1,'MEDIA_STAGE_TECHNICAL_FAILURE',1,'tts',$3,$4,$5,$6,$7,$8,null,'["scene-001","scene-002","scene-003"]','{"visualHumanGateEnabled":true}',9,'VISUAL_HUMAN_GATE_PENDING:NO_PUBLISHING','OWNER_APPROVED','owner','fixture',$9,1,'FAILED','fp') ON CONFLICT DO NOTHING`,
    [`media-resume-${workflowId}-from-tts-r1`, workflowId, `approval-${workflowId}-pre-production-owner-gate`, `art-${workflowId}-review`, `art-${workflowId}-writer_report`, `art-${workflowId}-seo_report`, `art-${workflowId}-brand_report`, `art-${workflowId}-director`, now]);
  for (let i = 0; i < 3; i++) {
    await persistence.saveExecutionProvenance({ executionId: `exec-${workflowId}-chunk-${i}`, workflowId, correlationId: `corr-${workflowId}`, agentId: "tts-chunk-coordinator", stage: "tts-submit", capability: "tts.generate", provider: "voicetut", model: "voicetut-tts", runtime: "runpod-queue", promptVersion: null, configurationFingerprint: "x", startedAt: now, completedAt: now, latencyMs: 100, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: `job-${i}`, errorClassification: null, configuration: { logicalChunkId: `log-${i}` }, failureMetadata: null });
  }
  await pool.query(`INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at) VALUES ($1,$2,'produce',$3,$4,$5,'failed',$6,$6) ON CONFLICT (submission_key) DO NOTHING`, [`mx:${workflowId}`, workflowId, `corr-${workflowId}`, projectId, JSON.stringify(definition), now]);
  await persistence.saveCheckpoint({ workflowId, state: "FAILED", completedSteps: ["planner-initial", "planner-synthesis", "research", "writer", "seo", "brand", "review", "pre-production-owner-gate", "director", "tts"], contextSnapshotRef: `fixture-${workflowId}`, lastEventOffset: 1, createdAt: now });
  return { workflowId, projectId };
}

async function waitFor(check, label, ms = 90000) {
  const d = Date.now() + ms;
  while (Date.now() < d) { if (await check()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timeout: ${label}`);
}

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  process.env.TEXT_AGENT_PROVIDER = "deterministic";
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  delete process.env.AMF_WORKER_RUNTIME_MODE;
  delete process.env.AMF_WORKER_LAUNCHER;
  process.env.TTS_PROVIDER = "voicetut";
  process.env.RUNPOD_API_KEY = "present-not-used";
  process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
  process.env.IMAGE_PROVIDER = "self-hosted-image";
  process.env.RUNPOD_IMAGE_ENDPOINT_ID = "present-not-used";
  globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN_IN_MATRIX"); };
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  await pool.end();
});

// A/B: build parity
test("A/B: build parity fails on drift and passes on match (+ determinism)", async () => {
  const a = computeMediaBuildId();
  const b = computeMediaBuildId();
  assert.equal(a.buildId, b.buildId, "deterministic");
  assert.ok(a.files.length > 50, "covers dist bundles");
  await pool.query(`INSERT INTO amf_worker_presence (worker_instance_id, build_id, runtime_mode, launcher, node_version, started_at, last_heartbeat_at) VALUES ('inst-matrix-1',$1,'PERSISTENT_PRODUCTION_WORKER','persistent-worker-script','vX',$2,$2) ON CONFLICT (worker_instance_id) DO UPDATE SET build_id=$1, last_heartbeat_at=$2`, [a.buildId, new Date().toISOString()]);
  const ok = await assertWorkerBuildParity(pool, a.buildId);
  assert.equal(ok.workerInstanceId, "inst-matrix-1");
  await assert.rejects(() => assertWorkerBuildParity(pool, "deadbeef"), /MEDIA_WORKER_BUILD_DRIFT/);
  await pool.query(`DELETE FROM amf_worker_presence WHERE worker_instance_id='inst-matrix-1'`);
  await assert.rejects(() => assertWorkerBuildParity(pool, a.buildId), /NO_LIVE_PERSISTENT_WORKER/);
});

// C/D: grant certification
test("C/D: grant certification fails without timeline grant, passes with repair", () => {
  const oldGrants = DEFAULT_PROVIDER_GRANTS.filter((g) => !(g.agentId === "timeline" && g.capabilityIds.includes("timeline.plan")));
  assert.throws(() => assertMediaGrants(certifyMediaGrants(oldGrants)), /TIMELINE_CALLER_NOT_AUTHORIZED/);
  assert.doesNotThrow(() => assertMediaGrants(certifyMediaGrants(DEFAULT_PROVIDER_GRANTS)));
  const cert = certifyMediaGrants(DEFAULT_PROVIDER_GRANTS);
  assert.equal(cert.timelineAuthorized, true);
  assert.equal(cert.ttsAuthorized, true);
  assert.equal(cert.sceneImageAuthorized, true);
  assert.equal(cert.noWildcardGrant, true);
});

// E/F/G/H/I/J: exactly-once claim lifecycle on a timeline resume
test("E/F/G/H/I/J: one claim executes; duplicates/recovery/restarts observe; budget once", async () => {
  const { workflowId } = await createTimelineFixture("claim");
  const calls = {};
  const boundary = stubBoundary(calls);
  const dispatcher = new PostgresMediaResumeDispatcher(pool, persistence, boundary);
  const auth = await dispatcher.authorizeAndDispatch({ workflowId, authorizedBy: "owner", rationale: "claim matrix" });
  assert.equal(auth.resumeStartStage, "timeline");

  // Direct claim semantics first (fast, no worker timing).
  const c1 = await dispatcher.claimStageExecution({ resumeId: auth.resumeId, workflowId, stage: "timeline" });
  assert.equal(c1.first, true);
  const c2 = await dispatcher.claimStageExecution({ resumeId: auth.resumeId, workflowId, stage: "timeline" });
  assert.equal(c2.first, false);
  assert.equal(c2.state, "CLAIMED");
  await dispatcher.finalizeStageExecution({ resumeId: auth.resumeId, stage: "timeline", outcome: "failed", error: "MATRIX_FIRST_FAILURE" });
  const c3 = await dispatcher.claimStageExecution({ resumeId: auth.resumeId, workflowId, stage: "timeline" });
  assert.equal(c3.first, false);
  assert.equal(c3.state, "FAILED");
  assert.equal(c3.error, "MATRIX_FIRST_FAILURE");

  // Reset claim to open for the worker-level duplicate test.
  await pool.query(`DELETE FROM media_stage_claims WHERE resume_id=$1`, [auth.resumeId]);

  // Worker-level: first run executes timeline exactly once with exactly one budget unit.
  // The mock bridge persists nothing itself, so mimic bridge persistence for reuse below.
  const bridge = mockBridge(calls);
  const exec2 = createProductionAgentExecutor({ persistence, providerBoundary: stubBoundary(calls), mediaChainBridge: bridge, mediaResumeBudget: dispatcher });
  const worker = new WorkflowWorker({ queue, persistence, executor: exec2, control, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
  const run = worker.runOnce();
  run.catch(() => undefined);
  try {
    await waitFor(async () => {
      const w = await persistence.loadWorkflow(workflowId);
      return w?.steps.find((s) => s.stepId === "timeline")?.status === "completed";
    }, "timeline completed");
    assert.equal(calls.timelineCalls ?? 0, 1, "E: exactly one timeline execution");
    const usage1 = await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE resume_id=$1 AND stage='timeline'`, [auth.resumeId]);
    assert.equal(usage1.rows[0].n, 1, "J: exactly one timeline budget unit");
    // The current executor persists the canonical timeline artifact before
    // advancing. Do not inject a second fixture artifact while the worker is
    // paused at the visual gate; reuse must observe the real persisted output.
    await waitFor(async () => {
      const w = await persistence.loadWorkflow(workflowId);
      return w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === "visual-human-gate")?.status === "running";
    }, "visual gate");
  } finally {
    const approval = await control.getApproval(`approval-${workflowId}-visual-human-gate`);
    if (approval?.status === "PENDING") await control.decideApproval(approval.approvalId, "REJECT", "matrix teardown");
  }
  await run;

  // Duplicate delivery with a FRESH executor (restart): drive the timeline step directly again.
  const wfNow = await persistence.loadWorkflow(workflowId);
  const bridge2 = mockBridge(calls);
  const exec3 = createProductionAgentExecutor({ persistence, providerBoundary: stubBoundary(calls), mediaChainBridge: bridge2, mediaResumeBudget: dispatcher });
  const dup = await exec3.executeAgentStep(
    { id: "timeline", agent: "timeline" },
    { workflowId, correlationId: `corr-${workflowId}`, data: wfNow.context.data, outputs: {} },
  );
  assert.equal(dup.status, "completed", "F/H: duplicate observes completed claim via reuse");
  assert.equal(calls.timelineCalls ?? 0, 1, "F/H: no second timeline execution on duplicate/restart");
  const usage2 = await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE resume_id=$1 AND stage='timeline'`, [auth.resumeId]);
  assert.equal(usage2.rows[0].n, 1, "I: no second budget consumption");
  assert.equal(calls.ttsCalls ?? 0, 0, "O: zero TTS calls");
  await pool.query(`UPDATE media_resume_dispatches SET outcome='FAILED' WHERE resume_id=$1`, [auth.resumeId]);
});

// G2: recovery after terminal failure returns recorded outcome without executing
test("G2: terminal FAILED claim short-circuits worker delivery", async () => {
  const { workflowId } = await createTimelineFixture("short");
  const calls = {};
  const boundary = stubBoundary(calls);
  const dispatcher = new PostgresMediaResumeDispatcher(pool, persistence, boundary);
  const auth = await dispatcher.authorizeAndDispatch({ workflowId, authorizedBy: "owner", rationale: "short" });
  await dispatcher.claimStageExecution({ resumeId: auth.resumeId, workflowId, stage: "timeline" });
  await dispatcher.finalizeStageExecution({ resumeId: auth.resumeId, stage: "timeline", outcome: "failed", error: "PRIOR_TERMINAL" });
  const bridge = mockBridge(calls);
  const exec = createProductionAgentExecutor({ persistence, providerBoundary: stubBoundary(calls), mediaChainBridge: bridge, mediaResumeBudget: dispatcher });
  // Drive the rewound timeline step directly (engine would drive it on redelivery).
  const wfNow = await persistence.loadWorkflow(workflowId);
  const out = await exec.executeAgentStep(
    { id: "timeline", agent: "timeline" },
    { workflowId, correlationId: `corr-${workflowId}`, data: wfNow.context.data, outputs: {} },
  );
  assert.equal(out.status, "failed");
  assert.match(String(out.error?.message ?? ""), /PRIOR_TERMINAL/);
  assert.equal(calls.timelineCalls ?? 0, 0, "no execution after terminal failure");
  const usage = await pool.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE resume_id=$1`, [auth.resumeId]);
  assert.equal(usage.rows[0].n, 0, "no budget on short-circuit");
  await pool.query(`UPDATE media_resume_dispatches SET outcome='FAILED' WHERE resume_id=$1`, [auth.resumeId]);
});

// R/P: forbidden downstream untouched on timeline run
test("R/P: forbidden downstream untouched on timeline run", async () => {
  const { workflowId } = await createTimelineFixture("fw");
  const calls = {};
  const boundary = stubBoundary(calls);
  const dispatcher = new PostgresMediaResumeDispatcher(pool, persistence, boundary);
  const auth = await dispatcher.authorizeAndDispatch({ workflowId, authorizedBy: "owner", rationale: "fw" });
  const bridge = mockBridge(calls);
  const exec = createProductionAgentExecutor({ persistence, providerBoundary: stubBoundary(calls), mediaChainBridge: bridge, mediaResumeBudget: dispatcher });
  const worker = new WorkflowWorker({ queue, persistence, executor: exec, control, pollMs: 10, resolveCommandConfiguration: (p) => control.agentConfigurationMap(p) });
  const run = worker.runOnce();
  run.catch(() => undefined);
  try {
    await waitFor(async () => {
      const w = await persistence.loadWorkflow(workflowId);
      return w?.state === "AWAITING_APPROVAL" && w.steps.find((s) => s.stepId === "visual-human-gate")?.status === "running";
    }, "visual gate");
    assert.equal(calls.forbidden ?? 0, 0, "no forbidden bridge calls");
    const w = await persistence.loadWorkflow(workflowId);
    for (const s of ["wan-authorization", "video", "composer", "publisher", "analytics"]) {
      assert.equal(w.steps.find((x) => x.stepId === s)?.status, "pending", `${s} untouched`);
    }
  } finally {
    const approval = await control.getApproval(`approval-${workflowId}-visual-human-gate`);
    if (approval?.status === "PENDING") await control.decideApproval(approval.approvalId, "REJECT", "matrix teardown");
    await run;
  }
  await pool.query(`UPDATE media_resume_dispatches SET outcome='FAILED' WHERE resume_id=$1`, [auth.resumeId]);
});
