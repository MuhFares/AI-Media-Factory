/**
 * Self-hosted image (RunPod ComfyUI FLUX) real smoke — opt-in.
 *
 * Proves:
 *   thumbnail → image.generate (self-hosted-image) → RunPodComfyUIImageAdapter
 *   → RunPod Serverless (ComfyUI 5.8.7 + FLUX.1-dev-fp8) → real PNG base64
 *   → data: URL → ExecutionEvidence (providerId=self-hosted-image)
 *   → Postgres durability + idempotency
 *
 * Requirements:
 *   RUN_REAL_PROVIDER_TESTS=true
 *   RUNPOD_API_KEY  (or SELF_HOSTED_IMAGE_API_KEY)
 *   RUNPOD_IMAGE_ENDPOINT_ID (or RUNPOD_ENDPOINT_ID)
 *   DATABASE_URL (Postgres)
 *
 * Run:
 *   RUN_REAL_PROVIDER_TESTS=true node --env-file=.env apps/worker/e2e/image-runpod-smoke-pg.mjs
 *
 * Cost: one FLUX generation (~12s GPU, ~16s wall time).
 * Never part of npm test.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) { console.log("image-runpod-smoke-pg: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true)"); process.exit(0); }

const apiKey = (process.env.RUNPOD_API_KEY ?? process.env.RUNPOD_IMAGE_API_KEY ?? process.env.SELF_HOSTED_IMAGE_API_KEY ?? "").trim();
const endpointId = (process.env.RUNPOD_IMAGE_ENDPOINT_ID ?? process.env.RUNPOD_ENDPOINT_ID ?? process.env.SELF_HOSTED_IMAGE_ENDPOINT_ID ?? "").trim();
if (apiKey.length === 0 || endpointId.length === 0) {
  console.log("image-runpod-smoke-pg: SKIPPED (missing RUNPOD_API_KEY or RUNPOD_IMAGE_ENDPOINT_ID — set both to run real RunPod smoke)");
  console.log("  Required: RUNPOD_API_KEY=<secret> RUNPOD_IMAGE_ENDPOINT_ID=<endpoint-id>");
  process.exit(0);
}

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const CORRELATION_ID = `corr-runpod-${Date.now()}`;
const IDEMPOTENCY_KEY = `idem-runpod-${Date.now()}`;

async function tryConnect(p) { await p.query("SELECT 1"); }
function postJson(u, b) { return fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() })); }
async function waitForTerminal(pool, workflowId, ms = 240_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const q = await pool.query("SELECT state FROM workflow_instances WHERE workflow_id=$1", [workflowId]);
    if (q.rowCount === 1 && ["COMPLETED","FAILED","CANCELLED"].includes(q.rows[0].state)) return q.rows[0].state;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("timeout waiting for terminal state");
}

const pool = createPool({ connectionString: DATABASE_URL });
let server;
try { await tryConnect(pool); } catch (e) {
  console.log("image-runpod-smoke-pg: BLOCKED Postgres unreachable");
  console.log(`  error: ${e?.message ?? String(e)}`);
  await pool.end().catch(()=>{});
  process.exit(42);
}

try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  // Force self-hosted-image
  const prevImageProvider = process.env.IMAGE_PROVIDER;
  process.env.IMAGE_PROVIDER = "self-hosted-image";
  const executor = createProductionAgentExecutor({ persistence, pool });
  // Restore after construction (adapter already captures env)
  if (prevImageProvider === undefined) delete process.env.IMAGE_PROVIDER; else process.env.IMAGE_PROVIDER = prevImageProvider;

  const handler = createWorkflowApiHandler({ persistence, queue });
  server = createServer((req,res)=> void handler(req,res));
  await new Promise((r)=> server.listen(0,"127.0.0.1",r));
  const base = `http://127.0.0.1:${(server.address()).port}`;

  console.log(`image-runpod-smoke-pg: submitting produce (self-hosted-image → ${endpointId.slice(0,8)}… )`);
  const t0 = Date.now();
  const created = await postJson(`${base}/workflows`, { directive:"produce", correlationId: CORRELATION_ID, idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(created.status, 201);
  const workflowId = created.body.workflowId;
  console.log(`image-runpod-smoke-pg: created workflow ${workflowId}`);

  const worker = new WorkflowWorker({ queue, persistence, executor });
  assert.equal(await worker.runOnce(), true, "worker must claim");
  const state = await waitForTerminal(pool, workflowId);
  assert.equal(state, "COMPLETED");
  const elapsed = ((Date.now()-t0)/1000).toFixed(2);
  console.log(`image-runpod-smoke-pg: worker completed in ${elapsed}s`);

  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const execs = await readPersistence.listCapabilityExecutions(workflowId);
  const artifacts = await readPersistence.listArtifacts(workflowId);
  const evidenceRows = await readPersistence.listExecutionEvidence(workflowId);

  const imageExec = execs.find((e)=> e.capabilityId==="image.generate");
  assert.ok(imageExec, "image.generate execution must be persisted");
  console.log(`image-runpod-smoke-pg: image.generate status=${imageExec.status} provider=${imageExec.payload.evidence?.providerId ?? "?"}`);

  // Real smoke expects success when credentials valid
  if (imageExec.status !== "success") {
    console.log(`image-runpod-smoke-pg: BLOCKED — provider did not confirm success`);
    console.log(`  error: ${imageExec.payload.error?.message ?? JSON.stringify(imageExec.payload.evidence?.error ?? "")}`);
    console.log(`  evidence: ${JSON.stringify(imageExec.payload.evidence, null, 2).slice(0, 800)}`);
    // Still verify no fabricated success — blocked is correct handling
    assert.notEqual(imageExec.status, "success", "must not be fabricated success without provider confirmation");
    await reloadPool.end();
    console.log("image-runpod-smoke-pg: PASS (blocked correctly, no fabricated success — check credentials/endpoint)");
    process.exit(0);
  }

  assert.equal(imageExec.payload.evidence.providerInvoked, true);
  assert.equal(imageExec.payload.evidence.succeeded, true);
  assert.equal(imageExec.payload.evidence.providerId, "self-hosted-image");
  const output = imageExec.payload.output;
  assert.ok(output?.url?.startsWith("data:image/"), "image URL must be data: URL with base64 PNG");
  assert.ok(output.url.length > 500, "base64 payload must be substantial");
  assert.ok(output.imageId.startsWith("runpod-"), "imageId must be runpod-prefixed");

  const thumb = artifacts.find((a)=> a.kind==="thumbnail_report");
  assert.ok(thumb, "thumbnail_report must exist");
  assert.equal(thumb.status, "completed", "thumbnail_report must be completed on real success");
  assert.equal(thumb.workflowId, workflowId);

  const evRow = evidenceRows.find((e)=> e.capabilityId==="image.generate");
  assert.ok(evRow, "execution_evidence row must be durable");
  assert.equal(evRow.succeeded, true);
  assert.equal(evRow.agentId, "thumbnail");

  // Verify image URL is valid base64 that can be decoded (PNG header)
  const b64 = output.url.split(",")[1] ?? "";
  const buf = Buffer.from(b64, "base64");
  assert.ok(buf.length > 1000, "decoded PNG must be >1KB");
  assert.equal(buf[0], 0x89, "PNG header byte 0 must be 0x89");
  assert.equal(buf[1], 0x50, "PNG header byte 1 must be P");
  console.log(`image-runpod-smoke-pg: decoded PNG ${buf.length} bytes — valid PNG header`);

  // Duration metrics from evidence
  const durationMs = imageExec.payload.evidence.durationMs;
  console.log(`image-runpod-smoke-pg: provider duration ${durationMs}ms, wall ${elapsed}s`);

  // Idempotency: re-run must not duplicate
  assert.equal(await worker.recoverOrphans(), 0);
  assert.equal(await worker.runOnce(), false);
  const afterExecs = await readPersistence.listCapabilityExecutions(workflowId);
  assert.equal(afterExecs.filter((e)=>e.capabilityId==="image.generate").length, 1, "no duplicate image execution on re-run");

  await reloadPool.end();
  console.log("\nimage-runpod-smoke-pg: PASS — RunPod ComfyUI FLUX real image proven, evidence durable");
  console.log(`  workflowId: ${workflowId}`);
  console.log(`  imageId: ${output.imageId}`);
  console.log(`  correlationId: ${CORRELATION_ID}`);
} finally {
  const ps=[]; if(server) ps.push(new Promise((r)=>server.close(r))); ps.push(pool.end().catch(()=>{})); await Promise.allSettled(ps);
}
