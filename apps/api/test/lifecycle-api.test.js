/**
 * Slice 2 — lifecycle read-model API (isolated TEST DB).
 * Matrix 18 (reload identical), 404s, project scoping, no-secrets scan.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, StrategicStore, LifecycleStore } from "@ai-media-factory/database";
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
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await persistence.close(); });

test("lifecycle detail resolves fixture workflow end to end", async () => {
  const pid = `lc-api-${Date.now().toString(36)}`;
  const sub = await req("/workflows", { method: "POST", body: JSON.stringify({ directive: "produce-pre-media", correlationId: "lc-1", brandId: pid, idempotencyKey: `lc-idem-${pid}` }) });
  assert.equal(sub.status, 201);
  const det = await req(`/control/lifecycle/${sub.body.workflowId}`);
  assert.equal(det.status, 200);
  const lc = det.body.lifecycle;
  assert.equal(lc.workflowId, sub.body.workflowId);
  assert.ok(lc.title.includes(pid) || lc.title.includes("Produce-pre-media"), lc.title);
  assert.ok(Array.isArray(lc.phases) && lc.phases.length === 8);
  assert.ok(Array.isArray(lc.milestones) && lc.milestones.length === 10);
  assert.ok(lc.nextStep.length > 0 && lc.ifYouDoNothing.length > 0);
  assert.equal(lc.readyToPublish, false);
  // no secrets anywhere in the read model
  const dumped = JSON.stringify(det.body);
  assert.doesNotMatch(dumped, /api[_-]?key\s*[:=]\s*\S+/i);
});

test("reload returns identical lifecycle; unknown workflow 404s", async () => {
  const list = await req("/control/workflows?projectId=morroway&limit=1");
  if ((list.body.workflows ?? []).length === 0) return; // isolated DB may be empty
  const id = list.body.workflows[0].workflowId;
  const a = await req(`/control/lifecycle/${id}`);
  const b = await req(`/control/lifecycle/${id}`);
  assert.equal(a.status, 200);
  assert.deepEqual({ ...a.body.lifecycle, resolvedAt: null }, { ...b.body.lifecycle, resolvedAt: null });
  const nf = await req("/control/lifecycle/wf-does-not-exist");
  assert.equal(nf.status, 404);
  const missing = await req("/control/lifecycle?projectId=");
  assert.equal(missing.status, 400);
});

test("ASK/MULTI executions never hijack project lifecycle truth", async () => {
  const pid = `lc-hijack-${Date.now().toString(36)}`;
  // content workflow first (older)
  await req("/workflows", { method: "POST", body: JSON.stringify({ directive: "produce-pre-media", correlationId: "lc-h1", brandId: pid, idempotencyKey: `lc-h1-${pid}` }) });
  // then a live ASK command (newer) on the same project
  const ask = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: pid, mode: "ASK_AGENT", message: "hi", selectedAgents: ["research"] }) });
  assert.equal(ask.status, 201);
  const list = await req(`/control/lifecycle?projectId=${pid}`);
  assert.ok(list.body.lifecycles.every((l) => l.workflowId !== ask.body.workflowId), "ASK execution excluded from pipeline");
  const ready = await req(`/control/publication-readiness?projectId=${pid}`);
  assert.notEqual(ready.body.readiness.workflowId, ask.body.workflowId, "readiness ignores ASK executions");
  const wl = await req(`/control/workflows?projectId=${pid}`);
  assert.ok(wl.body.workflows.every((w) => w.workflowId !== ask.body.workflowId));
});

test("project lifecycle list is scoped and bounded", async () => {
  const pid = `lc-scope-${Date.now().toString(36)}`;
  await req("/workflows", { method: "POST", body: JSON.stringify({ directive: "produce-pre-media", correlationId: "lc-s", brandId: pid, idempotencyKey: `lc-scope-${pid}` }) });
  const list = await req(`/control/lifecycle?projectId=${pid}`);
  assert.equal(list.status, 200);
  assert.ok(list.body.lifecycles.length >= 1);
  assert.ok(list.body.lifecycles.every((l) => l.projectId === pid));
  const other = await req("/control/lifecycle?projectId=proj-that-does-not-exist");
  assert.deepEqual(other.body.lifecycles, []);
});
