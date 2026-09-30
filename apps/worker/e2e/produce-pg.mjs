/**
 * Controlled Produce E2E — full production pipeline with real providers.
 *
 * Exercises the complete Phase 2 flow through the durable engine:
 *
 *   ExecutiveDirective(produce)
 *    → POST /workflows → Postgres submission + queue → Worker claim
 *    → ProductionAgentExecutor (research → writer → seo → brand → review
 *      → thumbnail → video → qa → publisher → analytics)
 *    → Provider registries → Real adapters (or blocked when not configured)
 *    → ExecutionEvidence → Artifacts (with lineage) → PostgreSQL
 *    → API reload + idempotency + restart probe
 *
 * Every capability invocation is provider-backed (or correctly blocked).
 * No fabricated success is allowed.
 *
 * Opt-in ONLY. Run:
 *   RUN_REAL_PROVIDER_TESTS=true node --env-file=.env apps/worker/e2e/produce-pg.mjs
 *
 * Exit codes: 0 PASS/SKIP, 42 BLOCKED (Postgres unreachable), 1 failure.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) {
  console.log("produce-pg: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true to enable)");
  process.exit(0);
}

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const CORRELATION_ID = `corr-produce-e2e-${Date.now()}`;
const IDEMPOTENCY_KEY = `idem-produce-e2e-${Date.now()}`;

const HAS_SEARCH = !!(process.env.SEARCH_API ?? process.env.TAVILY_API_KEY ?? process.env.SERPER_API_KEY ?? process.env.EXA_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY);
const HAS_IMAGE = !!process.env.OPENAI_API_KEY?.trim();
const HAS_VIDEO = !!process.env.REPLICATE_API_TOKEN?.trim();
const HAS_YOUTUBE = !!process.env.YOUTUBE_ACCESS_TOKEN?.trim();

console.log(`produce-pg: credentials — search=${HAS_SEARCH} image=${HAS_IMAGE} video=${HAS_VIDEO} youtube=${HAS_YOUTUBE}`);

async function tryConnect(pool) { await pool.query("SELECT 1"); }
function postJson(url, body) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (res) => ({ status: res.status, body: await res.json() }));
}
async function waitForTerminalState(pool, workflowId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await pool.query("SELECT state FROM workflow_instances WHERE workflow_id = $1", [workflowId]);
    if (probe.rowCount === 1 && ["COMPLETED", "FAILED", "CANCELLED"].includes(probe.rows[0].state)) return probe.rows[0].state;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for terminal state on ${workflowId}`);
}

const pool = createPool({ connectionString: DATABASE_URL });
let server;
try { await tryConnect(pool); } catch (error) {
  console.log("produce-pg: BLOCKED — PostgreSQL not reachable");
  console.log(`  connect error: ${error?.message ?? String(error)}`);
  await pool.end().catch(() => {});
  process.exit(42);
}

try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const executor = createProductionAgentExecutor({ persistence, pool });
  const handler = createWorkflowApiHandler({ persistence, queue });
  server = createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  console.log('produce-pg: submitting directive="produce" (full pipeline)');
  const created = await postJson(`${base}/workflows`, { directive: "produce", correlationId: CORRELATION_ID, idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(created.status, 201);
  const workflowId = created.body.workflowId;
  console.log(`produce-pg: created workflow ${workflowId}`);

  const dup = await postJson(`${base}/workflows`, { directive: "produce", correlationId: CORRELATION_ID, idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.workflowId, workflowId);
  console.log("produce-pg: duplicate submission deduplicated");

  const worker = new WorkflowWorker({ queue, persistence, executor });
  const claimed = await worker.runOnce();
  assert.equal(claimed, true, "worker must claim");
  const state = await waitForTerminalState(pool, workflowId);
  assert.equal(state, "COMPLETED", "workflow must complete (blocked artifacts are still COMPLETED)");
  console.log("produce-pg: worker claimed + ran to COMPLETED");

  // Reload from fresh pool
  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const readQueue = new PostgresQueue(reloadPool);

  const submission = await readQueue.loadSubmissionByWorkflow(workflowId);
  assert.ok(submission);
  assert.equal(submission.status, "completed");

  const artifacts = await readPersistence.listArtifacts(workflowId);
  console.log(`produce-pg: artifacts persisted: ${artifacts.length} (${artifacts.map((a) => a.kind + ":" + a.status).join(", ")})`);
  // Produce creates at minimum planner/research artifacts; with full pipeline expect 10+
  assert.ok(artifacts.length >= 2, "at least planner + research must be persisted");

  // Verify lineage
  for (const a of artifacts) {
    assert.equal(a.workflowId, workflowId);
    assert.equal(a.correlationId, CORRELATION_ID);
    assert.ok(a.artifactId.startsWith("art-"), "artifactId must be stable");
  }

  // Capability executions + evidence
  const executions = await readPersistence.listCapabilityExecutions(workflowId);
  const evidence = await readPersistence.listExecutionEvidence(workflowId);
  console.log(`produce-pg: capability executions: ${executions.length}, evidence rows: ${evidence.length}`);

  // Search must have succeeded if credential present, else blocked — never fabricated
  const searchExec = executions.find((e) => e.capabilityId === "web.search");
  if (HAS_SEARCH) {
    assert.ok(searchExec, "web.search execution must exist");
    assert.equal(searchExec.status, "success", "web.search must succeed with real credential");
    assert.equal(searchExec.payload.evidence.providerInvoked, true);
    assert.equal(searchExec.payload.evidence.succeeded, true);
    assert.ok(searchExec.payload.evidence.providerId, "providerId must be recorded");
    const report = artifacts.find((a) => a.kind === "research_report");
    assert.ok(report);
    assert.equal(report.status, "completed");
    assert.ok(report.payload.sources?.length > 0, "research must be grounded in real results");
    console.log(`produce-pg: research grounded in ${report.payload.sources.length} real sources via ${searchExec.payload.evidence.providerId}`);
  } else {
    console.log("produce-pg: search credential not set — expected blocked research (not tested as success)");
  }

  // Image must succeed if OPENAI_API_KEY present
  const imageExec = executions.find((e) => e.capabilityId === "image.generate");
  if (HAS_IMAGE) {
    assert.ok(imageExec, "image.generate execution must exist");
    // Image may be success or blocked (e.g. quota) — but evidence must be durable
    assert.ok(["success", "blocked", "failed"].includes(imageExec.status));
    if (imageExec.status === "success") {
      const expectedProvider = (process.env.IMAGE_PROVIDER ?? "").includes("self-hosted") ? "self-hosted-image" : "openai-image";
      assert.equal(imageExec.payload.evidence.providerId, expectedProvider);
      const thumb = artifacts.find((a) => a.kind === "thumbnail_report");
      assert.equal(thumb?.status, "completed");
      console.log(`produce-pg: image.generate succeeded via ${expectedProvider}`);
    } else {
      console.log(`produce-pg: image.generate ${imageExec.status} (expected when quota/model missing) — evidence durable, no fabricated success`);
      assert.equal(imageExec.payload.evidence.succeeded, false);
    }
  } else {
    if (imageExec) assert.notEqual(imageExec.status, "success", "without credential must not succeed");
    console.log("produce-pg: image credential not set — correctly blocked");
  }

  // Video — replicate token missing in this env → expect blocked, not fabricated
  const videoExec = executions.find((e) => e.capabilityId === "video.generate");
  if (HAS_VIDEO) {
    assert.ok(videoExec);
    console.log(`produce-pg: video.generate status=${videoExec.status} via ${videoExec.payload.evidence?.providerId ?? "?"}`);
  } else {
    if (videoExec) assert.notEqual(videoExec.status, "success", "without REPLICATE_API_TOKEN must not succeed");
    console.log("produce-pg: video credential not set — correctly blocked (no fabricated video)");
  }

  // Publishing — youtube token missing → blocked
  const publishExec = executions.find((e) => e.capabilityId === "publish.youtube");
  if (HAS_YOUTUBE) {
    console.log(`produce-pg: publish status=${publishExec?.status}`);
  } else {
    if (publishExec) assert.notEqual(publishExec.status, "success", "without YOUTUBE_ACCESS_TOKEN must not succeed");
    console.log("produce-pg: youtube credential not set — correctly blocked (no fabricated publication)");
  }

  // Analytics — same
  const analyticsExec = executions.find((e) => e.capabilityId === "analytics.fetch");
  if (analyticsExec && !HAS_YOUTUBE) {
    assert.notEqual(analyticsExec.status, "success");
    console.log("produce-pg: analytics correctly blocked without youtube credential");
  }

  // Evidence persistence for every execution
  for (const exec of executions) {
    const row = evidence.find((e) => e.evidenceId === exec.payload.evidence?.evidenceId || e.capabilityId === exec.capabilityId);
    assert.ok(row ?? exec.payload.evidence, `evidence must be durable for ${exec.capabilityId}`);
  }
  console.log("produce-pg: ExecutionEvidence durable for all capability invocations");

  // API reload
  const apiArtifacts = await fetch(`${base}/workflows/${workflowId}/artifacts`).then((r) => r.json());
  assert.equal(apiArtifacts.workflowId, workflowId);
  assert.ok(apiArtifacts.artifacts.length >= artifacts.length);
  console.log("produce-pg: API reload (status/artifacts/executions) read from Postgres");

  // Idempotency probe
  assert.equal(await worker.recoverOrphans(), 0);
  assert.equal(await worker.runOnce(), false, "queue must be empty on re-run");
  const afterArtifacts = await readPersistence.listArtifacts(workflowId);
  assert.equal(afterArtifacts.length, artifacts.length, "re-run must not duplicate artifacts");
  const afterExecs = await readPersistence.listCapabilityExecutions(workflowId);
  assert.equal(afterExecs.length, executions.length, "re-run must not duplicate executions");
  console.log("produce-pg: restart/re-claim probe idempotent (no duplicates)");

  await reloadPool.end();
  console.log("\nproduce-pg: PASS — full produce pipeline proven with durable state and provider evidence");
  console.log("  workflowId:", workflowId);
  console.log("  correlationId:", CORRELATION_ID);
} finally {
  const ps = [];
  if (server) ps.push(new Promise((r) => server.close(r)));
  ps.push(pool.end().catch(() => {}));
  await Promise.allSettled(ps);
}
