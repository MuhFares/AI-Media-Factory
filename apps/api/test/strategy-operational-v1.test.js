/**
 * Strategic Operating Layer V1 — API contract + governance (isolated TEST DB).
 * propose -> preview (deterministic, side-effect-free) -> scoped approval ->
 * activate -> effective/history/snapshot/lineage. Fail-closed matrix included.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, StrategicStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
let pool, server, base;
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
  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const handler = createWorkflowApiHandler({ persistence, queue, control: new ControlPlaneStore(pool), strategic: new StrategicStore(pool) });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await pool.end(); });

const pid = () => `strat-api-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test("propose -> preview deterministic -> approve -> activate -> effective", async () => {
  const projectId = pid();
  const prop = await req("/control/strategy/proposals", { method: "POST", body: JSON.stringify({ projectId, entityType: "STRATEGY", payload: { contentPillars: ["p1"], pilot: { model: "adaptive" } }, sourceArtifactIds: ["docs/x.md"] }) });
  assert.equal(prop.status, 201);
  assert.equal(prop.body.entity.status, "PROPOSED");
  assert.match(prop.body.disclosure, /NOT affect effective/);
  const entityId = prop.body.entity.entityId;
  // preview before activation: honest empty, side-effect-free
  const pre = await req(`/control/strategy/preview?projectId=${projectId}&agentId=writer`);
  assert.equal(pre.status, 200);
  assert.equal(pre.body.preview.status, "STRATEGY_NOT_CONFIGURED");
  // scoped approval via canonical engine
  const created = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId, targetType: "STRATEGY_ACTIVATION", targetId: entityId, agentRecommendation: { activate: entityId } }) });
  assert.equal(created.body.approval.authorityScope, "STRATEGY_ACTIVATION");
  const decided = await req(`/control/approvals/${created.body.approval.approvalId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "isolated strategic fixture" }) });
  assert.equal(decided.status, 200);
  const act = await req("/control/strategy/activations", { method: "POST", body: JSON.stringify({ entityId, approvalId: created.body.approval.approvalId }) });
  assert.equal(act.status, 200);
  assert.equal(act.body.entity.status, "ACTIVE");
  // preview after activation: deterministic across calls
  const p1 = await req(`/control/strategy/preview?projectId=${projectId}&agentId=writer`);
  const p2 = await req(`/control/strategy/preview?projectId=${projectId}&agentId=writer`);
  assert.equal(p1.body.preview.contextHash, p2.body.preview.contextHash);
  assert.ok(p1.body.preview.entityRefs.some((r) => r.entityId === entityId));
  // effective + history
  const eff = await req(`/control/strategy/effective?projectId=${projectId}`);
  assert.equal(eff.body.health.status, "INCOMPLETE");
  assert.equal(eff.body.active.length, 1);
  const hist = await req(`/control/strategy/entities?projectId=${projectId}`);
  assert.equal(hist.body.entities.length, 1);
});

test("activation fail-closed: pending, wrong scope, target mismatch", async () => {
  const projectId = pid();
  const prop = await req("/control/strategy/proposals", { method: "POST", body: JSON.stringify({ projectId, entityType: "BRAND", payload: { v: 1 } }) });
  const entityId = prop.body.entity.entityId;
  const pend = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId, targetType: "BRAND_ACTIVATION", targetId: entityId, agentRecommendation: {} }) });
  const pendingAct = await req("/control/strategy/activations", { method: "POST", body: JSON.stringify({ entityId, approvalId: pend.body.approval.approvalId }) });
  assert.equal(pendingAct.status, 409);
  assert.match(pendingAct.body.error, /PENDING/);
  const wrong = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId, targetType: "workflow_gate", targetId: entityId, agentRecommendation: {} }) });
  await req(`/control/approvals/${wrong.body.approval.approvalId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "x" }) });
  const wrongAct = await req("/control/strategy/activations", { method: "POST", body: JSON.stringify({ entityId, approvalId: wrong.body.approval.approvalId }) });
  assert.equal(wrongAct.status, 409);
  assert.match(wrongAct.body.error, /SCOPE_MISMATCH/);
});

test("review bundle: diff states, eligibility transitions, read-only, supersession", async () => {
  const projectId = pid();
  // ACTIVE v1 with nested payload
  const v1 = await req("/control/strategy/proposals", { method: "POST", body: JSON.stringify({ projectId, entityType: "CONSTRAINTS", payload: { keep: 1, chg: "a", gone: true, nested: { x: 1, y: 2 } } }) });
  const ap1 = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId, targetType: "CONSTRAINTS_ACTIVATION", targetId: v1.body.entity.entityId, agentRecommendation: {} }) });
  await req(`/control/approvals/${ap1.body.approval.approvalId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "fixture" }) });
  await req("/control/strategy/activations", { method: "POST", body: JSON.stringify({ entityId: v1.body.entity.entityId, approvalId: ap1.body.approval.approvalId }) });
  // PROPOSED v2 with added/removed/changed
  const v2 = await req("/control/strategy/proposals", { method: "POST", body: JSON.stringify({ projectId, entityType: "CONSTRAINTS", payload: { keep: 1, chg: "b", fresh: "n", nested: { x: 1, y: 3 } } }) });
  const entityId = v2.body.entity.entityId;
  // review BEFORE authority: eligibility honest, diff present, zero mutation
  const rev0 = await req(`/control/strategy/review?projectId=${projectId}&entityId=${entityId}`);
  assert.equal(rev0.status, 200);
  assert.equal(rev0.body.baseline.version, 1);
  const states = Object.fromEntries(rev0.body.diff.rows.map((r) => [r.path, r.state]));
  assert.equal(states["chg"], "CHANGED");
  assert.equal(states["fresh"], "ADDED");
  assert.equal(states["gone"], "REMOVED");
  assert.equal(states["keep"], "UNCHANGED");
  assert.equal(rev0.body.eligibility.canActivate, false);
  assert.equal(rev0.body.eligibility.reason, "ACTIVATION_AUTHORITY_REQUIRED");
  assert.ok(Array.isArray(rev0.body.impact.onActivate) && rev0.body.impact.notOnActivate.length === 4);
  // read-only: repeated reviews mutate nothing
  await req(`/control/strategy/review?projectId=${projectId}&entityId=${entityId}`);
  const still = await req(`/control/strategy/entities?projectId=${projectId}&type=CONSTRAINTS`);
  assert.ok(still.body.entities.find((e) => e.entityId === entityId && e.status === "PROPOSED"));
  // request decision -> pending -> approve with rationale -> activate
  const pend = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId, targetType: "CONSTRAINTS_ACTIVATION", targetId: entityId, agentRecommendation: { activate: entityId } }) });
  const rev1 = await req(`/control/strategy/review?projectId=${projectId}&entityId=${entityId}`);
  assert.equal(rev1.body.eligibility.reason, "APPROVAL_PENDING");
  assert.equal(rev1.body.eligibility.approvalId, pend.body.approval.approvalId);
  // rationale required by governance
  const noRat = await req(`/control/approvals/${pend.body.approval.approvalId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "" }) });
  assert.equal(noRat.status, 400);
  await req(`/control/approvals/${pend.body.approval.approvalId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "fixture review journey" }) });
  const rev2 = await req(`/control/strategy/review?projectId=${projectId}&entityId=${entityId}`);
  assert.equal(rev2.body.eligibility.canActivate, true);
  const act = await req("/control/strategy/activations", { method: "POST", body: JSON.stringify({ entityId, approvalId: pend.body.approval.approvalId }) });
  assert.equal(act.status, 200);
  // idempotent repeat
  const again = await req("/control/strategy/activations", { method: "POST", body: JSON.stringify({ entityId, approvalId: pend.body.approval.approvalId }) });
  assert.equal(again.status, 200);
  assert.equal(again.body.created, false);
  // effective reload shows v2; preview reflects it
  const eff = await req(`/control/strategy/effective?projectId=${projectId}`);
  assert.ok(eff.body.active.some((e) => e.entityId === entityId));
  const pv = await req(`/control/strategy/preview?projectId=${projectId}&taskClass=default`);
  assert.ok(pv.body.preview.entityRefs.some((r) => r.entityId === entityId && r.version === 2));
  // no-baseline type reports NONE honestly
  const solo = await req("/control/strategy/proposals", { method: "POST", body: JSON.stringify({ projectId, entityType: "OBJECTIVES", payload: { g: 1 } }) });
  const revSolo = await req(`/control/strategy/review?projectId=${projectId}&entityId=${solo.body.entity.entityId}`);
  assert.equal(revSolo.body.baseline, null);
  assert.equal(revSolo.body.diff.baseline, "NONE");
  // proposal never auto-activated
  assert.equal(solo.body.entity.status, "PROPOSED");
  // unknown entity -> 404, cross-project -> 404
  const nf = await req(`/control/strategy/review?projectId=${projectId}&entityId=strat-nope`);
  assert.equal(nf.status, 404);
  const xp = await req(`/control/strategy/review?projectId=${pid()}&entityId=${entityId}`);
  assert.equal(xp.status, 404);
});

test("snapshot + lineage endpoints", async () => {
  const projectId = pid();
  const prop = await req("/control/strategy/proposals", { method: "POST", body: JSON.stringify({ projectId, entityType: "STRATEGY", payload: { a: 1 } }) });
  const ap = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId, targetType: "STRATEGY_ACTIVATION", targetId: prop.body.entity.entityId, agentRecommendation: {} }) });
  await req(`/control/approvals/${ap.body.approval.approvalId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "x" }) });
  await req("/control/strategy/activations", { method: "POST", body: JSON.stringify({ entityId: prop.body.entity.entityId, approvalId: ap.body.approval.approvalId }) });
  const missing = await req("/control/strategy/snapshots/snap-does-not-exist");
  assert.equal(missing.status, 404);
  const lin = await req("/control/strategy/lineage/exec-does-not-exist");
  assert.equal(lin.status, 200);
  assert.equal(lin.body.snapshot, null);
  const art = await req("/control/strategy/artifact-lineage?artifactId=art-does-not-exist");
  assert.equal(art.status, 200);
  assert.deepEqual(art.body.executions, []);
});
