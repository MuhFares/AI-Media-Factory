/**
 * Slice 4 — canonical agent read model API (isolated TEST DB).
 * Roster truth, honest statuses, config inheritance, cost semantics,
 * options endpoint, secret-free responses, project scoping.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, StrategicStore, LifecycleStore, ApprovalActionabilityStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
let pool, persistence, server, base;
process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", "Authorization": "Bearer test-owner-token" }, ...options });
  const body = await res.json();
  return { status: res.status, body };
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const handler = createWorkflowApiHandler({
    persistence, queue, control: new ControlPlaneStore(pool),
    strategic: new StrategicStore(pool), lifecycle: new LifecycleStore(pool),
    actionability: new ApprovalActionabilityStore(pool),
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await persistence.close(); });

test("roster lists registered team with business names, honest statuses", async () => {
  const pid = `agents-${Date.now().toString(36)}`;
  const r = await req(`/control/agents?projectId=${pid}`);
  assert.equal(r.status, 200);
  assert.ok(r.body.agents.length >= 24, "canonical roster present");
  const keys = r.body.agents.map((a) => a.agentKey);
  for (const k of ["research", "writer", "seo", "brand", "director", "visual-director", "review", "ceo"]) {
    assert.ok(keys.includes(k), `roster includes ${k}`);
  }
  const writer = r.body.agents.find((a) => a.agentKey === "writer");
  assert.equal(writer.displayName, "Writer");
  assert.ok(writer.role.length > 10 && writer.responsibilities.length > 10);
  assert.equal(writer.registered, true);
  // no executions yet: healthy idle with honest empty states, never fake WORKING
  assert.ok(r.body.agents.every((a) => a.status === "HEALTHY_IDLE"));
  assert.equal(r.body.summary.working, 0);
  assert.equal(r.body.summary.teamTotal, r.body.agents.length);
  assert.ok(r.body.summary.runtimeComponents >= 0);
  // grouping is presentation metadata; identities unchanged
  const groups = new Set(r.body.agents.map((a) => a.group));
  assert.ok(groups.has("Content & Creative") && groups.has("Media Production"));
  assert.equal(r.body.agents.filter((a) => a.agentKey === "writer")[0].group, "Content & Creative");
  assert.ok(writer.cost.display.includes("No runs") || writer.cost.display.includes("Unknown"));
  assert.equal(writer.currentActivity, null);
  // secret-free
  assert.doesNotMatch(JSON.stringify(r.body), /api[_-]?key\s*[:=]\s*\S+/i);
});

test("executions drive runs, outputs, cost, attention deterministically", async () => {
  const pid = `agents-run-${Date.now().toString(36)}`;
  const wf = `wf-${pid}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'produce','c',$3,'{}','failed',now()::text,now()::text)`, [`k-${wf}`, wf, pid]);
  await pool.query(
    `INSERT INTO execution_provenance (execution_id, workflow_id, agent_id, stage, provider, model, runtime, started_at, completed_at, latency_ms, status, cost_kind, cost, currency, artifact_ids, parent_execution_ids, attempt_number, configuration)
     VALUES ('${wf}-exec-det',$1,'writer','command:writer','openrouter','m','r','2026-01-01T00:00:00Z','2026-01-01T00:01:00Z',1000,'failed','UNKNOWN',NULL,'USD','[]','[]',1,'{}')`, [wf]);
  await pool.query(
    `INSERT INTO artifacts (artifact_id, workflow_id, kind, producer_agent, status, payload, content_type, schema_version, created_at)
     VALUES ('${wf}-art-w1',$1,'writer_report','writer','completed','{}','application/json','v1',now()::text)`, [wf]);
  const r = await req(`/control/agents?projectId=${pid}`);
  const writer = r.body.agents.find((a) => a.agentKey === "writer");
  // failed run on terminal workflow with no live work: historical, not Owner attention
  assert.equal(writer.status, "HISTORICAL_FAILURE");
  assert.match(writer.statusReason, /stopped with no live state/i);
  assert.equal(writer.attentionKind, "NONE");
  assert.equal(writer.recentRuns.length, 1);
  assert.equal(writer.recentRuns[0].status, "FAILED");
  assert.equal(writer.outputs.length, 1);
  assert.ok(writer.outputs[0].artifactId.endsWith("-art-w1"));
  assert.match(writer.cost.display, /Unknown/);
  assert.match(writer.issues.historyNote, /failed run/);
  assert.deepEqual(writer.issues.current, [], "historical failure is not a current issue");
});

test("owner-action attention when workflow waits on a real decision", async () => {
  const pid = `agents-owner-${Date.now().toString(36)}`;
  const wf = `wf-${pid}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'produce','c',$3,'{}','revision_required',now()::text,now()::text)`, [`k-${wf}`, wf, pid]);
  await pool.query(
    `INSERT INTO execution_provenance (execution_id, workflow_id, agent_id, stage, provider, model, runtime, started_at, completed_at, latency_ms, status, cost_kind, cost, currency, artifact_ids, parent_execution_ids, attempt_number, configuration)
     VALUES ('${wf}-exec-owner',$1,'writer','command:writer','openrouter','m','r','2026-01-02T00:00:00Z','2026-01-02T00:01:00Z',1000,'failed','UNKNOWN',NULL,'USD','[]','[]',1,'{}')`, [wf]);
  await pool.query(
    `INSERT INTO control_approvals (approval_id, project_id, target_type, target_id, agent_recommendation, evidence_refs, status, created_at)
     VALUES ('${wf}-ap-o',$1,'workflow_gate',$2,'{}','[]','PENDING',now()::text)`, [pid, `${wf}:review-gate`]);
  const r = await req(`/control/agents?projectId=${pid}`);
  const writer = r.body.agents.find((a) => a.agentKey === "writer");
  assert.equal(writer.status, "OWNER_ACTION_REQUIRED");
  assert.equal(writer.attentionKind, "OWNER");
  assert.ok(writer.attentionWorkflowId === wf);
  assert.equal(r.body.summary.ownerActionRequired, 1);
});

test("runtime components are separated, never counted as team", async () => {
  const pid = `agents-rt-${Date.now().toString(36)}`;
  const wf = `wf-${pid}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'produce','c',$3,'{}','submitted',now()::text,now()::text)`, [`k-${wf}`, wf, pid]);
  await pool.query(
    `INSERT INTO execution_provenance (execution_id, workflow_id, agent_id, stage, provider, model, runtime, started_at, completed_at, latency_ms, status, cost_kind, cost, currency, artifact_ids, parent_execution_ids, attempt_number, configuration)
     VALUES ('${wf}-exec-rt',$1,'tts-chunk-coordinator','tts-submit','voicetut','v','r','2026-01-03T00:00:00Z','2026-01-03T00:01:00Z',1000,'success','UNKNOWN',NULL,'USD','[]','[]',1,'{}')`, [wf]);
  const r = await req(`/control/agents?projectId=${pid}`);
  assert.equal(r.body.summary.teamTotal, 24);
  assert.equal(r.body.summary.runtimeComponents, 1);
  assert.ok(Array.isArray(r.body.runtimeComponents));
  const tts = r.body.runtimeComponents.find((a) => a.agentKey === "tts-chunk-coordinator");
  assert.equal(tts.registered, false);
  assert.equal(tts.group, "Runtime components");
  assert.ok(!r.body.agents.some((a) => a.agentKey === "tts-chunk-coordinator"));
});

test("registered team and runtime components are separated (24 + extras)", async () => {
  const pid = `agents-sep-${Date.now().toString(36)}`;
  const wf = `wf-${pid}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'produce','c',$3,'{}','submitted',now()::text,now()::text)`, [`k-${wf}`, wf, pid]);
  await pool.query(
    `INSERT INTO execution_provenance (execution_id, workflow_id, agent_id, stage, provider, model, runtime, started_at, completed_at, latency_ms, status, cost_kind, cost, currency, artifact_ids, parent_execution_ids, attempt_number, configuration)
     VALUES ('${wf}-exec-media',$1,'media','command:media','openrouter','m','r','2026-02-01T00:00:00Z','2026-02-01T00:01:00Z',1000,'success','UNKNOWN',NULL,'USD','[]','[]',1,'{}')`, [wf]);
  const r = await req(`/control/agents?projectId=${pid}`);
  assert.equal(r.status, 200);
  // canonical registered roster: exactly 24, all registered=true
  assert.equal(r.body.summary.teamTotal, 24);
  assert.equal(r.body.agents.length, 24);
  assert.ok(r.body.agents.every((a) => a.registered === true));
  // runtime extra is separated, never in the team list
  assert.equal(r.body.summary.runtimeComponents, 1);
  assert.equal(r.body.runtimeComponents.length, 1);
  assert.equal(r.body.runtimeComponents[0].agentKey, "media");
  assert.equal(r.body.runtimeComponents[0].registered, false);
  assert.ok(!r.body.agents.some((a) => a.agentKey === "media" || a.agentKey === "tts-chunk-coordinator"));
  // combined telemetry cannot inflate the registered count
  assert.equal(r.body.summary.teamTotal, r.body.agents.length);
});

test("configuration options endpoint is secret-free and scoped validation untouched", async () => {
  const o = await req("/control/configuration/options");
  assert.equal(o.status, 200);
  assert.ok(Array.isArray(o.body.options));
  assert.doesNotMatch(JSON.stringify(o.body), /sk-|eyJ/);
  const bad = await req("/control/agents?projectId=");
  assert.equal(bad.status, 400);
});
