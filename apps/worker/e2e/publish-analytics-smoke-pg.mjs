/**
 * YouTube publish + analytics smoke — real provider or blocked-path proof (opt-in).
 * Publish uses YouTube Data API v3 (resumable upload); analytics uses
 * YouTube Analytics API v2. Both share YOUTUBE_ACCESS_TOKEN.
 * Without the token, both must be blocked — never fabricated.
 *
 * Run: RUN_REAL_PROVIDER_TESTS=true node --env-file=.env apps/worker/e2e/publish-analytics-smoke-pg.mjs
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) { console.log("publish-analytics-smoke-pg: SKIPPED"); process.exit(0); }

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const HAS_YOUTUBE = !!process.env.YOUTUBE_ACCESS_TOKEN?.trim();
const CORRELATION_ID = `corr-pub-${Date.now()}`;
const IDEMPOTENCY_KEY = `idem-pub-${Date.now()}`;
async function tryConnect(p){await p.query("SELECT 1");}
function postJson(u,b){return fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(async(r)=>({status:r.status,body:await r.json()}));}
async function waitFor(pool,id,ms=180_000){const d=Date.now()+ms;while(Date.now()<d){const q=await pool.query("SELECT state FROM workflow_instances WHERE workflow_id=$1",[id]);if(q.rowCount===1&&["COMPLETED","FAILED","CANCELLED"].includes(q.rows[0].state))return q.rows[0].state;await new Promise((r)=>setTimeout(r,300));}throw new Error("timeout");}

const pool = createPool({connectionString: DATABASE_URL});
let server;
try{await tryConnect(pool);}catch{console.log("publish-analytics-smoke-pg: BLOCKED Postgres unreachable");await pool.end().catch(()=>{});process.exit(42);}
try{
  await migrate(pool);
  const persistence=new PostgresPersistence(pool);
  const queue=new PostgresQueue(pool);
  const executor=createProductionAgentExecutor({ persistence, pool });
  const handler=createWorkflowApiHandler({persistence,queue});
  server=createServer((req,res)=>void handler(req,res));
  await new Promise((r)=>server.listen(0,"127.0.0.1",r));
  const base=`http://127.0.0.1:${server.address().port}`;
  console.log(`publish-analytics-smoke-pg: submitting produce (youtube ${HAS_YOUTUBE?"present":"missing"} → expect ${HAS_YOUTUBE?"publish+analytics":"blocked"})`);
  const created=await postJson(`${base}/workflows`,{directive:"produce",correlationId:CORRELATION_ID,idempotencyKey:IDEMPOTENCY_KEY});
  assert.equal(created.status,201);
  const workflowId=created.body.workflowId;
  const worker=new WorkflowWorker({queue,persistence,executor});
  assert.equal(await worker.runOnce(),true);
  const state=await waitFor(pool,workflowId);
  assert.equal(state,"COMPLETED");
  const reloadPool=createPool({connectionString: DATABASE_URL});
  const readPersistence=new PostgresPersistence(reloadPool);
  const execs=await readPersistence.listCapabilityExecutions(workflowId);
  const artifacts=await readPersistence.listArtifacts(workflowId);
  const pubExec=execs.find((e)=>e.capabilityId==="publish.youtube");
  const anaExec=execs.find((e)=>e.capabilityId==="analytics.fetch");
  if(HAS_YOUTUBE){
    assert.ok(pubExec, "publish execution must exist with token");
    assert.ok(anaExec, "analytics execution must exist with token");
    console.log(`publish-analytics-smoke-pg: publish status=${pubExec.status} provider=${pubExec.payload.evidence?.providerId ?? "?"}`);
    console.log(`publish-analytics-smoke-pg: analytics status=${anaExec.status} provider=${anaExec.payload.evidence?.providerId ?? "?"}`);
    if(pubExec.status==="success") assert.equal(pubExec.payload.evidence.providerId,"youtube");
    if(anaExec?.status==="success") {
      assert.equal(anaExec.payload.evidence.providerId,"youtube-analytics");
      assert.ok(anaExec.payload.output?.metrics !== undefined);
    }
    console.log("publish-analytics-smoke-pg: PASS — publish/analytics evidence durable, no fabricated metrics");
  }else{
    if(pubExec) assert.notEqual(pubExec.status,"success","without YOUTUBE_ACCESS_TOKEN must not succeed");
    if(anaExec) assert.notEqual(anaExec.status,"success","without YOUTUBE_ACCESS_TOKEN must not succeed");
    const pubArtifact=artifacts.find((a)=>a.kind==="published_report");
    const anaArtifact=artifacts.find((a)=>a.kind==="analytics_report");
    assert.equal(pubArtifact?.status,"blocked","published_report must be blocked without credential");
    assert.equal(anaArtifact?.status,"blocked","analytics_report must be blocked without credential");
    console.log("publish-analytics-smoke-pg: PASS — correctly blocked without YOUTUBE_ACCESS_TOKEN (no fabricated publication/metrics)");
  }
  await reloadPool.end();
}finally{const ps=[];if(server)ps.push(new Promise((r)=>server.close(r)));ps.push(pool.end().catch(()=>{}));await Promise.allSettled(ps);}
