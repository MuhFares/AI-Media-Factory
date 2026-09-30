/**
 * Video generation smoke — real provider or blocked-path proof (opt-in).
 * Run: RUN_REAL_PROVIDER_TESTS=true node --env-file=.env apps/worker/e2e/video-smoke-pg.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) { console.log("video-smoke-pg: SKIPPED"); process.exit(0); }

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const HAS_VIDEO = !!process.env.REPLICATE_API_TOKEN?.trim() || !!(process.env.SELF_HOSTED_VIDEO_API_KEY?.trim() && process.env.SELF_HOSTED_VIDEO_BASE_URL?.trim());
const EXPECTED = process.env.VIDEO_PROVIDER?.includes("self") ? "self-hosted-video" : "replicate";
const CORRELATION_ID = `corr-video-${Date.now()}`;
const IDEMPOTENCY_KEY = `idem-video-${Date.now()}`;
async function tryConnect(p) { await p.query("SELECT 1"); }
function postJson(u, b) { return fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, body: await r.json() })); }
async function waitFor(pool, id, ms = 180_000) { const d = Date.now() + ms; while (Date.now() < d) { const q = await pool.query("SELECT state FROM workflow_instances WHERE workflow_id=$1", [id]); if (q.rowCount === 1 && ["COMPLETED","FAILED","CANCELLED"].includes(q.rows[0].state)) return q.rows[0].state; await new Promise((r)=>setTimeout(r,300)); } throw new Error("timeout"); }

const pool = createPool({ connectionString: DATABASE_URL });
let server;
try { await tryConnect(pool); } catch { console.log("video-smoke-pg: BLOCKED Postgres unreachable"); await pool.end().catch(()=>{}); process.exit(42); }
try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const executor = createProductionAgentExecutor({ persistence, pool });
  const handler = createWorkflowApiHandler({ persistence, queue });
  server = createServer((req,res)=>void handler(req,res));
  await new Promise((r)=>server.listen(0,"127.0.0.1",r));
  const base = `http://127.0.0.1:${server.address().port}`;
  console.log(`video-smoke-pg: submitting produce (video ${HAS_VIDEO?"present":"missing"} → expect ${HAS_VIDEO?"success/running":"blocked"})`);
  const created = await postJson(`${base}/workflows`, { directive:"produce", correlationId: CORRELATION_ID, idempotencyKey: IDEMPOTENCY_KEY });
  assert.equal(created.status,201);
  const workflowId = created.body.workflowId;
  const worker = new WorkflowWorker({ queue, persistence, executor });
  assert.equal(await worker.runOnce(), true);
  const state = await waitFor(pool, workflowId);
  assert.equal(state, "COMPLETED");
  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const execs = await readPersistence.listCapabilityExecutions(workflowId);
  const artifacts = await readPersistence.listArtifacts(workflowId);
  const videoExec = execs.find((e)=>e.capabilityId==="video.generate");
  const videoArtifact = artifacts.find((a)=>a.kind==="video_report");
  if (HAS_VIDEO) {
    assert.ok(videoExec, "video.generate execution must be persisted with credential");
    assert.ok(["success","blocked","failed"].includes(videoExec.status));
    if (videoExec.status==="success") {
      assert.equal(videoExec.payload.evidence.providerId, EXPECTED);
      console.log(`video-smoke-pg: PASS — video.generate via ${EXPECTED}`);
    } else {
      console.log(`video-smoke-pg: PASS — video.generate ${videoExec.status} — evidence durable, no fabricated success`);
    }
  } else {
    // Without credential, the capability is correctly blocked; the artifact is blocked
    // and no successful execution is persisted — no fabricated video.
    if (videoExec) assert.notEqual(videoExec.status, "success");
    assert.equal(videoArtifact?.status, "blocked", "video_report must be blocked without REPLICATE_API_TOKEN");
    console.log("video-smoke-pg: PASS — correctly blocked without credential (no fabricated video)");
  }
  await reloadPool.end();
} finally { const ps=[]; if(server) ps.push(new Promise((r)=>server.close(r))); ps.push(pool.end().catch(()=>{})); await Promise.allSettled(ps); }
