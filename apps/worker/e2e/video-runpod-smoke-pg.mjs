/**
 * Self-hosted video (RunPod Wan2.2 image-to-video) real smoke — opt-in.
 *
 * Proves:
 *   produce → video.generate (self-hosted-video) → RunPodWanVideoAdapter
 *   → RunPod Serverless Wan2.2 (image_base64 + prompt) → real MP4 base64
 *   → data:video/mp4;base64 → ExecutionEvidence (providerId=self-hosted-video)
 *   → Postgres durability + idempotency
 *
 * Requires:
 *   RUN_REAL_PROVIDER_TESTS=true
 *   RUNPOD_API_KEY
 *   RUNPOD_VIDEO_ENDPOINT_ID (e.g. ry49lc45y50ldy)
 *   RUNPOD_IMAGE_ENDPOINT_ID (for the source FLUX image, or uses latest FLUX artifact)
 *   DATABASE_URL
 *
 * Run:
 *   RUN_REAL_PROVIDER_TESTS=true node --env-file=.env apps/worker/e2e/video-runpod-smoke-pg.mjs
 *
 * Cost: one Wan2.2 generation (~3m GPU). Never part of npm test.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) { console.log("video-runpod-smoke-pg: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true)"); process.exit(0); }

const apiKey = (process.env.RUNPOD_API_KEY ?? process.env.RUNPOD_VIDEO_API_KEY ?? "").trim();
const videoEndpointId = (process.env.RUNPOD_VIDEO_ENDPOINT_ID ?? process.env.RUNPOD_VIDEO_API_ENDPOINT_ID ?? "").trim();
if (apiKey.length === 0 || videoEndpointId.length === 0) {
  console.log("video-runpod-smoke-pg: SKIPPED (missing RUNPOD_API_KEY or RUNPOD_VIDEO_ENDPOINT_ID)");
  console.log("  Required: RUNPOD_API_KEY + RUNPOD_VIDEO_ENDPOINT_ID (e.g. ry49lc45y50ldy)");
  process.exit(0);
}
const imageEndpointId = (process.env.RUNPOD_IMAGE_ENDPOINT_ID ?? "").trim();
if (imageEndpointId.length === 0) {
  console.log("video-runpod-smoke-pg: SKIPPED (missing RUNPOD_IMAGE_ENDPOINT_ID — needed for source FLUX image)");
  process.exit(0);
}

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const CORRELATION_ID = `corr-wan-${Date.now()}`;
const IDEMPOTENCY_KEY = `idem-wan-${Date.now()}`;

async function tryConnect(p){ await p.query("SELECT 1"); }
function postJson(u,b){return fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(async(r)=>({status:r.status, body:await r.json()}));}
async function waitForTerminal(pool, workflowId, ms=420_000){
  const deadline = Date.now()+ms;
  while(Date.now()<deadline){
    const q = await pool.query("SELECT state FROM workflow_instances WHERE workflow_id=$1",[workflowId]);
    if(q.rowCount===1 && ["COMPLETED","FAILED","CANCELLED"].includes(q.rows[0].state)) return q.rows[0].state;
    await new Promise(r=>setTimeout(r,1000));
  }
  throw new Error("timeout waiting for terminal state");
}

const pool = createPool({ connectionString: DATABASE_URL });
let server;
try { await tryConnect(pool); } catch(e){
  console.log("video-runpod-smoke-pg: BLOCKED Postgres unreachable");
  console.log(`  error: ${e?.message ?? String(e)}`);
  await pool.end().catch(()=>{});
  process.exit(42);
}

try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);

  // Force Wan as video provider (image already forced to self-hosted in .env)
  const prevVideoProvider = process.env.VIDEO_PROVIDER;
  process.env.VIDEO_PROVIDER = "self-hosted-video";
  const executor = createProductionAgentExecutor({ persistence, pool });
  if (prevVideoProvider===undefined) delete process.env.VIDEO_PROVIDER; else process.env.VIDEO_PROVIDER = prevVideoProvider;

  const handler = createWorkflowApiHandler({ persistence, queue });
  server = createServer((req,res)=> void handler(req,res));
  await new Promise((r)=> server.listen(0,"127.0.0.1",r));
  const base = `http://127.0.0.1:${(server.address()).port}`;

  console.log(`video-runpod-smoke-pg: submitting produce (Wan2.2 via ${videoEndpointId.slice(0,8)}… image via ${imageEndpointId.slice(0,8)}…)`);
  const t0 = Date.now();
  const created = await postJson(`${base}/workflows`, { directive:"produce", correlationId: CORRELATION_ID, idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(created.status,201);
  const workflowId = created.body.workflowId;
  console.log(`video-runpod-smoke-pg: created workflow ${workflowId}`);

  const worker = new WorkflowWorker({ queue, persistence, executor });
  assert.equal(await worker.runOnce(), true, "worker must claim");
  console.log("video-runpod-smoke-pg: worker claimed — waiting for Wan2.2 (expect ~3m) …");
  const state = await waitForTerminal(pool, workflowId, 420_000);
  assert.equal(state,"COMPLETED");
  const elapsed = ((Date.now()-t0)/1000).toFixed(1);
  console.log(`video-runpod-smoke-pg: worker completed in ${elapsed}s`);

  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const execs = await readPersistence.listCapabilityExecutions(workflowId);
  const artifacts = await readPersistence.listArtifacts(workflowId);
  const evidenceRows = await readPersistence.listExecutionEvidence(workflowId);

  const videoExec = execs.find((e)=> e.capabilityId==="video.generate");
  assert.ok(videoExec, "video.generate execution must be persisted");
  console.log(`video-runpod-smoke-pg: video.generate status=${videoExec.status} provider=${videoExec.payload.evidence?.providerId ?? "?"}`);

  if (videoExec.status !== "success") {
    console.log(`video-runpod-smoke-pg: BLOCKED — provider did not confirm success`);
    console.log(`  error: ${videoExec.payload.error?.message ?? JSON.stringify(videoExec.payload.evidence?.error ?? "")}`);
    assert.notEqual(videoExec.status,"success");
    await reloadPool.end();
    console.log("video-runpod-smoke-pg: PASS (blocked correctly, no fabricated video)");
    process.exit(0);
  }

  assert.equal(videoExec.payload.evidence.providerInvoked, true);
  assert.equal(videoExec.payload.evidence.succeeded, true);
  assert.equal(videoExec.payload.evidence.providerId, "self-hosted-video");
  const output = videoExec.payload.output;
  assert.ok(output?.url?.startsWith("data:video/mp4;base64,"), "video URL must be data:video/mp4;base64");
  assert.ok(output.url.length > 5000, "base64 video must be substantial");
  assert.ok(output.videoId, "videoId must be present");
  console.log(`video-runpod-smoke-pg: videoId=${output.videoId} url len=${output.url.length}`);

  const b64 = output.url.split(",")[1] ?? "";
  const buf = Buffer.from(b64, "base64");
  assert.ok(buf.length > 5000, "decoded video must be >5KB");
  // MP4 ftyp check: bytes 4-7 should be ftyp for MP4
  const ftyp = buf.slice(4,8).toString();
  console.log(`video-runpod-smoke-pg: decoded video ${buf.length} bytes, ftyp=${JSON.stringify(ftyp)} (MP4 header ${ftyp==="ftyp"?"OK":"check"})`);

  const videoArtifact = artifacts.find((a)=> a.kind==="video_report");
  assert.ok(videoArtifact, "video_report must exist");
  assert.equal(videoArtifact.status, "completed");
  console.log("video-runpod-smoke-pg: video_report completed");

  const evRow = evidenceRows.find((e)=> e.capabilityId==="video.generate");
  assert.ok(evRow, "execution_evidence row must be durable");
  assert.equal(evRow.succeeded, true);
  assert.equal(evRow.agentId, "video");

  // Duration + idempotency
  console.log(`video-runpod-smoke-pg: provider duration ${videoExec.payload.evidence.durationMs}ms wall ${elapsed}s`);
  assert.equal(await worker.recoverOrphans(),0);
  assert.equal(await worker.runOnce(), false);
  const afterExecs = await readPersistence.listCapabilityExecutions(workflowId);
  assert.equal(afterExecs.filter((e)=>e.capabilityId==="video.generate").length,1, "no duplicate video execution");

  // Optionally write video to output for manual inspection
  try {
    const fs = await import("node:fs");
    fs.mkdirSync("./output", { recursive:true });
    const outPath = `./output/wan-latest.mp4`;
    fs.writeFileSync(outPath, buf);
    console.log(`video-runpod-smoke-pg: wrote video to ${outPath} (${buf.length} bytes)`);
  } catch {}

  await reloadPool.end();
  console.log("\nvideo-runpod-smoke-pg: PASS — Wan2.2 image-to-video real video proven, evidence durable");
  console.log(`  workflowId: ${workflowId}`);
  console.log(`  videoId: ${output.videoId}`);
  console.log(`  correlationId: ${CORRELATION_ID}`);
} finally {
  const ps=[]; if(server) ps.push(new Promise((r)=>server.close(r))); ps.push(pool.end().catch(()=>{})); await Promise.allSettled(ps);
}
