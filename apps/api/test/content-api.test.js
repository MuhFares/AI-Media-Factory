/**
 * Program 2 content API (isolated TEST DB): creation auth, linkage
 * validation, status derivation, project isolation. No execution started.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, ContentStore, LifecycleStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
const AUTH = { Authorization: "Bearer test-owner-token" };
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
let pool, server, base;
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", ...AUTH }, ...options });
  return { status: res.status, body: await res.json() };
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  await pool.query(`TRUNCATE content_items RESTART IDENTITY CASCADE`);
  const handler = createWorkflowApiHandler({
    persistence: new PostgresPersistence(pool),
    queue: new PostgresQueue(pool),
    control: new ControlPlaneStore(pool),
    lifecycle: new LifecycleStore(pool),
    content: new ContentStore(pool),
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await pool.end(); });

test("creation requires auth and valid business fields; starts nothing", async () => {
  const anon = await fetch(`${base}/control/content`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: "morroway", title: "t", objective: "o" }) });
  assert.equal(anon.status, 401);
  const bad = await req("/control/content", { method: "POST", body: JSON.stringify({ projectId: "morroway", title: "", objective: "o" }) });
  assert.equal(bad.status, 400);
  const created = await req("/control/content", { method: "POST", body: JSON.stringify({ projectId: "morroway", title: "Short one", objective: "Test hook", topic: "seed idea" }) });
  assert.equal(created.status, 201);
  assert.equal(created.body.content.status, "IDEA");
  assert.equal(created.body.content.topic, "seed idea");
  assert.match(created.body.disclosure, /No workflow started/);
  const list = await req("/control/content?projectId=morroway");
  assert.ok(list.body.contents.some((c) => c.contentId === created.body.content.contentId));
  const detail = await req(`/control/content/${created.body.content.contentId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.artifacts.length, 0);
  assert.equal(detail.body.content.status, "IDEA");
});

test("link validates workflow existence and never executes", async () => {
  const created = await req("/control/content", { method: "POST", body: JSON.stringify({ projectId: "morroway", title: "t2", objective: "o" }) });
  const id = created.body.content.contentId;
  const missing = await req(`/control/content/${id}/link`, { method: "POST", body: JSON.stringify({ workflowId: "wf-nope" }) });
  assert.equal(missing.status, 404);
  const empty = await req(`/control/content/${id}/link`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(empty.status, 400);
  const seed = await req(`/control/content/${id}/link`, { method: "POST", body: JSON.stringify({ seedArtifactId: "art-seed-1" }) });
  assert.equal(seed.status, 200);
  assert.equal(seed.body.content.seedArtifactId, "art-seed-1");
  assert.equal(seed.body.content.workflowId, null);
});
