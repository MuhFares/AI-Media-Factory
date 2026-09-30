import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, PostgresMediaResumeDispatcher } from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createProductionAgentExecutor } from "../dist/index.js";
import { createCapabilityRegistry } from "../../../packages/tool-framework/dist/index.js";
import { PROVIDER_CAPABILITIES, DEFAULT_PROVIDER_GRANTS } from "../../../packages/provider-adapters/dist/wiring/registry.js";
import { truncateAll, TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
const definition = directiveToWorkflowDefinition("produce");
let pool; let persistence; let queue; let control;

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  process.env.TEXT_AGENT_PROVIDER = "deterministic";
  process.env.TTS_PROVIDER = "voicetut";
  process.env.RUNPOD_API_KEY = "present-not-used";
  process.env.VOICETUT_TTS_ENDPOINT_ID = "present-not-used";
  process.env.IMAGE_PROVIDER = "self-hosted-image";
  process.env.RUNPOD_IMAGE_ENDPOINT_ID = "present-not-used";
});
after(async () => { await pool.end(); });

test("debug direct timeline drive", async () => {
  const workflowId = `wf-dbg-${Date.now().toString(36)}`;
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO workflow_instances (workflow_id, definition_id, definition_version, state, context, ready, created_at, updated_at) VALUES ($1,$2,$3,'FAILED',$4,$5,$6,$6)`, [workflowId, definition.id, definition.version, JSON.stringify({ data: { directive: "produce" }, brandId: null, correlationId: "c", directive: "produce" }), JSON.stringify([]), now]);
  for (const step of definition.steps) {
    await pool.query(`INSERT INTO workflow_steps (workflow_id, step_id, status, attempts, started_at, finished_at) VALUES ($1,$2,'pending',0,$3,$3) ON CONFLICT (workflow_id, step_id) DO NOTHING`, [workflowId, step.id, now]);
  }
  const boundary = {
    registeredCapabilityIds: ["tts.generate", "timeline.plan", "image.generate"],
    resolver: createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS }),
    workerExecutionEnvironment: { status: "SUPPORTED", mediaLiveExecutionAllowed: true, reasonCode: null },
    mediaConfiguration: { ttsEndpointIdentityHash: "h", ttsBaseHost: "api.runpod.ai" },
  };
  const dispatcher = new PostgresMediaResumeDispatcher(pool, persistence, boundary);
  const bridge = {
    executeDirector: async () => ({ status: "COMPLETED", output: {} }),
    executeTts: async () => ({ status: "COMPLETED", output: {} }),
    executeTimeline: async () => ({ status: "COMPLETED", output: { timelineId: "tl" } }),
    executeSceneImage: async () => ({ status: "COMPLETED", output: {} }),
    executeVisualSemanticReview: async () => ({ status: "COMPLETED", output: {} }),
    executeVisualTechnicalQa: async () => ({ status: "COMPLETED", output: {} }),
    executeWanAuthorization: async () => ({ status: "COMPLETED", output: {} }),
    executeVideo: async () => ({ status: "COMPLETED", output: {} }),
    executeComposer: async () => ({ status: "COMPLETED", output: {} }),
  };
  const exec = createProductionAgentExecutor({ persistence, providerBoundary: boundary, mediaChainBridge: bridge, mediaResumeBudget: dispatcher });
  const ctx = { workflowId, correlationId: "c", data: { mediaResumeExecution: { resumeId: "resume-dbg-1", resumeAuthorization: "OWNER_APPROVED", resumeStartStage: "timeline" } }, outputs: {} };
  const out = await exec.executeAgentStep({ id: "timeline", agent: "timeline" }, ctx);
  console.error("DIRECT_OUT=" + JSON.stringify(out).slice(0, 500));
  assert.ok(true);
});
