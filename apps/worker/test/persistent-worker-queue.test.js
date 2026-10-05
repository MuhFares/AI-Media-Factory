/**
 * Persistent production worker queue ownership / readiness (isolated test DB, zero-network).
 *
 * Provider-free proves the canonical persistent path:
 *   durable queue → createProductionWorker (PERSISTENT mode) → shared
 *   buildProviderBoundary → canonical WorkflowWorker → completed test job,
 * with clean start/stop and restart (new instance id claims the next job).
 *
 * Allowed test job only: a single deterministic `documentation` step that
 * never touches a provider. A throwing fetch stub enforces zero-network.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
} from "@ai-media-factory/database";
import { workflow } from "@ai-media-factory/workflow-engine";
import { createProductionWorker } from "../dist/index.js";
import { truncateAll, TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

const PROVIDER_KEYS = [
  "TTS_PROVIDER", "RUNPOD_API_KEY", "VOICETUT_TTS_ENDPOINT_ID", "GROQ_API_KEY",
  "GROQ_BASE_URL", "IMAGE_PROVIDER", "RUNPOD_IMAGE_ENDPOINT_ID",
  "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENAI_API_KEY",
  "ANTHROPIC_AUTH_TOKEN", "BRAVE_API_KEY", "TAVILY_API_KEY", "SERPER_API_KEY",
  "EXA_API_KEY", "YOUTUBE_API_KEY", "APIFY_API_TOKEN", "BRIGHTDATA_API_TOKEN",
  "TEXT_AGENT_PROVIDER", "CODEX_SANDBOX_NETWORK_DISABLED",
  "AMF_WORKER_RUNTIME_MODE", "AMF_WORKER_LAUNCHER",
];
const savedEnv = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, process.env[k]]));
const realFetch = globalThis.fetch;

function definition() {
  return workflow()
    .id("op-readiness")
    .version(1)
    .trigger("event", "OpReadiness")
    .entryStep("op-step-1")
    .timeoutSeconds(60)
    .addAgentStep({ id: "op-step-1", agent: "documentation", emits: "documentation_report" })
    .build();
}

async function waitFor(check, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timeout: ${label}`);
}

before(async () => {
  for (const k of PROVIDER_KEYS) delete process.env[k];
  process.env.TEXT_AGENT_PROVIDER = "deterministic";
  globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN_IN_QUEUE_FIXTURE"); };
});

after(async () => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test("persistent worker starts, claims an allowed test job through the canonical path, and stops cleanly", async () => {
  const pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
  const runtime = await createProductionWorker({
    pool,
    pollMs: 10,
    runtimeMode: "PERSISTENT_PRODUCTION_WORKER",
    launcher: "persistent-worker-queue-fixture",
  });
  try {
    assert.equal(runtime.identity.runtimeMode, "PERSISTENT_PRODUCTION_WORKER");
    assert.equal(runtime.identity.launcherClassification, "persistent-worker-queue-fixture");
    assert.equal(runtime.identity.executionEnvironment.status, "SUPPORTED");
    assert.equal(runtime.identity.nodeVersion, process.version);
    const presence = await pool.query(
      `SELECT execution_environment_status, execution_environment_reason_codes,
              execution_environment_failed_checks, execution_environment_runtime_fingerprint
         FROM amf_worker_presence WHERE worker_instance_id=$1`,
      [runtime.identity.workerInstanceId],
    );
    assert.equal(presence.rows[0]?.execution_environment_status, "SUPPORTED");
    assert.deepEqual(presence.rows[0]?.execution_environment_reason_codes, []);
    assert.deepEqual(presence.rows[0]?.execution_environment_failed_checks, []);
    assert.equal(presence.rows[0]?.execution_environment_runtime_fingerprint?.platform, process.platform);

    // Canonical preflight is wired on the same boundary the worker executes.
    const preflight = runtime.mediaResumes.preflight();
    assert.equal(preflight.workerRuntimeMode, "PERSISTENT_PRODUCTION_WORKER");
    assert.equal(preflight.workerExecutionEnvironment, "SUPPORTED");

    const workflowId = `wf-op-queue-${Date.now().toString(36)}`;
    await pool.query(`DELETE FROM workflow_jobs WHERE status='queued'`);
    const queue = new PostgresQueue(pool);
    await queue.submit({
      submissionKey: `op:${workflowId}`,
      workflowId,
      directive: "op-readiness",
      correlationId: `corr-${workflowId}`,
      brandId: null,
      definition: definition(),
    });
    await queue.enqueue(workflowId, `op:${workflowId}`);

    // The worker runs independently of this test's control flow (background
    // loop, like a service); it must claim and complete the job on its own.
    const loop = runtime.worker.runLoop();
    loop.catch(() => undefined);
    await waitFor(async () => {
      const sub = await queue.loadSubmissionByWorkflow(workflowId);
      return sub?.status === "completed";
    }, "persistent worker completes the allowed test job");
    const jobs = await pool.query(`SELECT status FROM workflow_jobs WHERE workflow_id=$1 ORDER BY job_id DESC LIMIT 1`, [workflowId]);
    assert.equal(jobs.rows[0]?.status, "succeeded");
    const artifacts = await runtime.persistence.listArtifacts(workflowId);
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].producerAgent, "documentation");

    runtime.worker.stop();
    await Promise.race([loop, new Promise((r) => setTimeout(r, 5000))]);
  } finally {
    runtime.worker.stop();
    await runtime.close();
  }
});

test("restarted persistent worker gets a new instance id and claims the next job", async () => {
  const firstPool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(firstPool);
  await truncateAll(firstPool);
  const first = await createProductionWorker({ pool: firstPool, pollMs: 10, runtimeMode: "PERSISTENT_PRODUCTION_WORKER", launcher: "persistent-worker-queue-fixture" });
  const firstId = first.identity.workerInstanceId;
  first.worker.stop();
  await first.close();
  const pool = createPool({ connectionString: TEST_DATABASE_URL });
  const second = await createProductionWorker({ pool, pollMs: 10, runtimeMode: "PERSISTENT_PRODUCTION_WORKER", launcher: "persistent-worker-queue-fixture" });
  try {
    assert.notEqual(second.identity.workerInstanceId, firstId);
    const workflowId = `wf-op-restart-${Date.now().toString(36)}`;
    await pool.query(`DELETE FROM workflow_jobs WHERE status='queued'`);
    const queue = new PostgresQueue(pool);
    await queue.submit({
      submissionKey: `op:${workflowId}`,
      workflowId,
      directive: "op-readiness",
      correlationId: `corr-${workflowId}`,
      brandId: null,
      definition: definition(),
    });
    await queue.enqueue(workflowId, `op:${workflowId}`);
    const handled = await second.worker.runOnce();
    assert.equal(handled, true);
    const sub = await queue.loadSubmissionByWorkflow(workflowId);
    assert.equal(sub?.status, "completed");
  } finally {
    second.worker.stop();
    await second.close();
  }
});
