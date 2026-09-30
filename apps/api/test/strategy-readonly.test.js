/**
 * Slice 6 — strategy API is read-first and governed (isolated TEST DB).
 * GETs never mutate; proposals persist as PROPOSED (never effective);
 * activation without exact Owner approval fails closed.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, StrategicStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
let pool, persistence, server, base;
const proj = `strat-api-${Date.now().toString(36)}`;
process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", "Authorization": "Bearer test-owner-token" }, ...options });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const control = new ControlPlaneStore(pool);
  const strategic = new StrategicStore(pool);
  const handler = createWorkflowApiHandler({ persistence, queue, control, strategic });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await persistence.close(); });

test("strategy GETs are read-only and honest when unconfigured", async () => {
  const e1 = await req(`/control/strategy/entities?projectId=${proj}`);
  assert.equal(e1.status, 200);
  assert.deepEqual(e1.body.entities, []);
  assert.equal(e1.body.health.status, "NOT_CONFIGURED");
  const eff = await req(`/control/strategy/effective?projectId=${proj}`);
  assert.equal(eff.status, 200);
  assert.deepEqual(eff.body.active, []);
  const pv = await req(`/control/strategy/preview?projectId=${proj}&agentId=writer`);
  assert.equal(pv.status, 200);
  assert.equal(pv.body.preview.status, "STRATEGY_NOT_CONFIGURED");
  const e2 = await req(`/control/strategy/entities?projectId=${proj}`);
  assert.deepEqual(e2.body.entities, [], "reads mutated nothing");
});

test("review shows effective-vs-proposed diff + no-authority impact; history stays immutable", async () => {
  const p = await req("/control/strategy/proposals", {
    method: "POST",
    body: JSON.stringify({ projectId: proj, entityType: "BRAND", payload: { brand: "Morroway", naming: { status: "CLOSED" } }, sourceArtifactIds: ["docs/naming.md"] }),
  });
  assert.equal(p.status, 201);
  const before = await req(`/control/strategy/entities?projectId=${proj}&type=BRAND`);
  // Second proposal in the same chain: older stays inspectable history.
  const p2 = await req("/control/strategy/proposals", {
    method: "POST",
    body: JSON.stringify({ projectId: proj, entityType: "BRAND", payload: { brand: "Morroway", naming: { status: "CLOSED" }, tagline: { status: "NOT_APPROVED" } }, sourceArtifactIds: ["docs/naming.md"] }),
  });
  assert.equal(p2.status, 201);
  assert.equal(p2.body.entity.version, 2);
  const after = await req(`/control/strategy/entities?projectId=${proj}&type=BRAND`);
  const old = after.body.entities.find((x) => x.version === 1);
  const oldBefore = before.body.entities.find((x) => x.version === 1);
  assert.deepEqual(old, oldBefore, "older proposal immutable after newer proposal");
  // Activate v1 via exact Owner approval, then review v2 against an ACTIVE baseline.
  const ap = await req("/control/approvals", {
    method: "POST",
    body: JSON.stringify({ projectId: proj, targetType: "BRAND_ACTIVATION", targetId: p.body.entity.entityId, agentRecommendation: { activation: p.body.entity.entityId } }),
  });
  assert.equal(ap.status, 201);
  const dec = await req(`/control/approvals/${ap.body.approval.approvalId}/decision`, {
    method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "isolated fixture" }),
  });
  assert.equal(dec.body.approval.ownerDecision, "APPROVE");
  const act = await req("/control/strategy/activations", {
    method: "POST", body: JSON.stringify({ entityId: p.body.entity.entityId, approvalId: ap.body.approval.approvalId }),
  });
  assert.equal(act.status, 200);
  const rev = await req(`/control/strategy/review?projectId=${proj}&entityId=${p2.body.entity.entityId}`);
  assert.equal(rev.status, 200);
  assert.equal(rev.body.diff.baseline, "COMPARABLE", "effective vs proposed diff");
  assert.ok(rev.body.diff.rows.some((r) => r.state !== "UNCHANGED"), "meaningful diff rows");
  const notActivate = (rev.body.impact.notOnActivate || []).join(" ");
  assert.match(notActivate, /No production authority is granted/);
  assert.match(notActivate, /No publication authority is granted/);
});

test("proposal persists as PROPOSED, never effective; review + activation stay governed", async () => {
  const q = `${proj}-queue`;
  const p = await req("/control/strategy/proposals", {
    method: "POST",
    body: JSON.stringify({ projectId: q, entityType: "BRAND", payload: { brand: "Morroway" }, sourceArtifactIds: ["docs/x.md"] }),
  });
  assert.equal(p.status, 201);
  assert.equal(p.body.entity.status, "PROPOSED");
  assert.match(p.body.disclosure, /NOT affect effective/i);
  const eff = await req(`/control/strategy/effective?projectId=${q}`);
  assert.deepEqual(eff.body.active, [], "proposal is not effective");
  const rev = await req(`/control/strategy/review?projectId=${q}&entityId=${p.body.entity.entityId}`);
  assert.equal(rev.status, 200);
  assert.equal(rev.body.diff.baseline, "NONE", "first version has no baseline");
  assert.ok(Array.isArray(rev.body.diff.rows) && rev.body.diff.rows.length > 0);
  const act = await req("/control/strategy/activations", {
    method: "POST", body: JSON.stringify({ entityId: p.body.entity.entityId, approvalId: "approval-missing" }),
  });
  assert.equal(act.status, 404, "unknown approval cannot activate");
  const still = await req(`/control/strategy/entities?projectId=${q}&type=BRAND`);
  assert.equal(still.body.entities[0].status, "PROPOSED", "failed activation changes nothing");
});
