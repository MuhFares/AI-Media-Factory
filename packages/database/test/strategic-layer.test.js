/**
 * Strategic Operating Layer V1 — checkpoints B/C/D/E/G (isolated TEST DB).
 * B: deterministic resolution + task relevance + hash stability (no providers).
 * C: V1 propose->activate->V2 supersession, old snapshot keeps V1.
 * D: governance fail-closed matrix. E: historical lineage immutability.
 * G: full proposal->approval->activation path through control_approvals.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ControlPlaneStore, StrategicStore, canonicalJson, strategicContextHash, strategicDiff } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool, strategic, control;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  strategic = new StrategicStore(pool);
  control = new ControlPlaneStore(pool);
});
after(async () => { await pool.end(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const proj = () => `strat-proj-${runId()}`;

async function approvedActivationApproval(projectId, entityId, scope = "STRATEGY_ACTIVATION") {
  const created = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId, targetType: scope, targetId: entityId,
    agentRecommendation: { activation: entityId }, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  return control.decideApproval(created.approvalId, "APPROVE", "isolated strategic fixture");
}

test("B: same inputs+state resolve deterministically with stable hash", async () => {
  const p = proj();
  const v1 = await strategic.propose({ projectId: p, entityType: "STRATEGY", payload: { contentPillars: ["a"], pilot: { model: "adaptive" } }, createdBy: "test" });
  await strategic.activate({ entityId: v1.entityId, approvalId: (await approvedActivationApproval(p, v1.entityId)).approvalId });
  const r1 = await strategic.resolve({ projectId: p, agentId: "writer" });
  const r2 = await strategic.resolve({ projectId: p, agentId: "writer" });
  assert.equal(r1.contextHash, r2.contextHash);
  assert.equal(r1.resolverVersion, "strat-resolver-v2");
  assert.deepEqual(r1.entityRefs, r2.entityRefs);
  const shaped = r1.context.entities.STRATEGY;
  assert.equal(shaped.key, "primary", "shaped entity carries its key");
  assert.equal(shaped.status, "ACTIVE", "shaped entity carries lifecycle status");
  assert.ok(shaped.authority.activatedByApprovalId, "shaped entity carries approval authority");
  assert.deepEqual(shaped.evidenceRefs, [], "shaped entity carries evidence refs");
  assert.equal(shaped.supersedesVersion, null);
});

test("B: task relevance differs (visual-director excludes STRATEGY, ceo includes PRINCIPLES)", async () => {
  const p = proj();
  for (const t of ["STRATEGY", "BRAND", "CONTENT_SYSTEM", "PRINCIPLES"]) {
    const payloads = {
      STRATEGY: { contentPillars: ["a"], pilot: { model: "adaptive" } },
      BRAND: { brand: "B", naming: { status: "X" } },
      CONTENT_SYSTEM: { status: "s", sourcing: { historicalPov: "h", fantasy: "f" }, governance: { publicationPolicy: { currentMode: "X" } } },
      PRINCIPLES: { tenet: "t" },
    };
    const e = await strategic.propose({ projectId: p, entityType: t, payload: payloads[t], createdBy: "test" });
    await strategic.activate({ entityId: e.entityId, approvalId: (await approvedActivationApproval(p, e.entityId, `${t}_ACTIVATION`)).approvalId });
  }
  const vd = await strategic.resolve({ projectId: p, agentId: "director" });
  assert.ok(!vd.includedTypes.includes("STRATEGY"), "visual-director must not receive STRATEGY");
  assert.ok(vd.includedTypes.includes("BRAND"));
  const ceo = await strategic.resolve({ projectId: p, agentId: "ceo" });
  assert.ok(ceo.includedTypes.includes("PRINCIPLES"));
  assert.ok(ceo.includedTypes.includes("STRATEGY"));
});

test("hash is ordering-invariant", async () => {
  const a = strategicContextHash({ b: 1, a: { y: 2, x: 1 } });
  const b = strategicContextHash({ a: { x: 1, y: 2 }, b: 1 });
  assert.equal(a, b);
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("C+G: V1 active, V2 proposal not effective until activation, then V1 superseded", async () => {
  const p = proj();
  const v1 = await strategic.propose({ projectId: p, entityType: "STRATEGY", payload: { name: "one", contentPillars: ["a"] }, createdBy: "test" });
  assert.equal(v1.status, "PROPOSED");
  assert.equal(v1.version, 1);
  await strategic.activate({ entityId: v1.entityId, approvalId: (await approvedActivationApproval(p, v1.entityId)).approvalId });
  const v2 = await strategic.propose({ projectId: p, entityType: "STRATEGY", payload: { name: "two", contentPillars: ["a"] }, createdBy: "test" });
  assert.equal(v2.version, 2);
  let eff = await strategic.effectiveState(p);
  assert.deepEqual(eff.active.map((e) => e.version), [1], "V1 remains effective before V2 activation");
  const snapV1 = await strategic.snapshotResolved(await strategic.resolve({ projectId: p, agentId: "writer" }), "writer");
  await strategic.activate({ entityId: v2.entityId, approvalId: (await approvedActivationApproval(p, v2.entityId)).approvalId });
  eff = await strategic.effectiveState(p);
  assert.deepEqual(eff.active.map((e) => e.version), [2]);
  const old = await strategic.getEntity(v1.entityId);
  assert.equal(old.status, "SUPERSEDED");
  // E: old snapshot still references V1
  const reloaded = await strategic.getSnapshot(snapV1.snapshotId);
  assert.ok(reloaded.entityRefs.some((r) => r.version === 1 && r.entityType === "STRATEGY"));
  const now = await strategic.resolve({ projectId: p, agentId: "writer" });
  assert.ok(now.entityRefs.some((r) => r.version === 2), "future resolution uses V2");
  assert.notEqual(now.contextHash, snapV1.contextHash);
});

test("D: governance fail-closed matrix", async () => {
  const p = proj();
  const e = await strategic.propose({ projectId: p, entityType: "BRAND", payload: { v: 1 }, createdBy: "test" });
  // no approval
  await assert.rejects(() => strategic.activate({ entityId: e.entityId, approvalId: "approval-missing" }), /STRATEGIC_APPROVAL_NOT_FOUND/);
  // pending approval
  const pend = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId: p, targetType: "BRAND_ACTIVATION", targetId: e.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await assert.rejects(() => strategic.activate({ entityId: e.entityId, approvalId: pend.approvalId }), /STRATEGIC_APPROVAL_PENDING/);
  // rejected
  const rej = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId: p, targetType: "BRAND_ACTIVATION", targetId: e.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(rej.approvalId, "REJECT", "fixture reject");
  await assert.rejects(() => strategic.activate({ entityId: e.entityId, approvalId: rej.approvalId }), /STRATEGIC_APPROVAL_NOT_APPROVED/);
  // wrong scope
  const wrongScope = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId: p, targetType: "workflow_gate", targetId: e.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(wrongScope.approvalId, "APPROVE", "fixture");
  await assert.rejects(() => strategic.activate({ entityId: e.entityId, approvalId: wrongScope.approvalId }), /STRATEGIC_APPROVAL_SCOPE_MISMATCH/);
  // different version target
  const other = await strategic.propose({ projectId: p, entityType: "BRAND", payload: { v: 2 }, createdBy: "test" });
  const mismatch = await approvedActivationApproval(p, other.entityId, "BRAND_ACTIVATION");
  await assert.rejects(() => strategic.activate({ entityId: e.entityId, approvalId: mismatch.approvalId }), /STRATEGIC_APPROVAL_TARGET_MISMATCH/);
  // different project
  const otherProj = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId: `other-${runId()}`, targetType: "BRAND_ACTIVATION", targetId: e.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(otherProj.approvalId, "APPROVE", "fixture");
  await assert.rejects(() => strategic.activate({ entityId: e.entityId, approvalId: otherProj.approvalId }), /STRATEGIC_APPROVAL_PROJECT_MISMATCH/);
  // correct activation works once, duplicate is idempotent
  const good = await approvedActivationApproval(p, e.entityId, "BRAND_ACTIVATION");
  const first = await strategic.activate({ entityId: e.entityId, approvalId: good.approvalId });
  assert.equal(first.created, true);
  const second = await strategic.activate({ entityId: e.entityId, approvalId: good.approvalId });
  assert.equal(second.created, false);
  // activating a SUPERSEDED version with a fresh approval fails
  const v2b = await strategic.propose({ projectId: p, entityType: "BRAND", payload: { v: 3 }, createdBy: "test" });
  await strategic.activate({ entityId: v2b.entityId, approvalId: (await approvedActivationApproval(p, v2b.entityId, "BRAND_ACTIVATION")).approvalId });
  const stale = await approvedActivationApproval(p, e.entityId, "BRAND_ACTIVATION");
  await assert.rejects(() => strategic.activate({ entityId: e.entityId, approvalId: stale.approvalId }), /STRATEGIC_STATUS_NOT_ACTIVATABLE:SUPERSEDED/);
});

test("strategicDiff is deterministic: changed/added/removed/unchanged + no-baseline", async () => {
  const d = strategicDiff(
    { keep: 1, chg: "a", gone: true, nested: { x: 1, y: 2 }, arr: ["a", "b"] },
    { keep: 1, chg: "b", fresh: "n", nested: { x: 1, y: 3 }, arr: ["a", "c"] });
  assert.equal(d.baseline, "COMPARABLE");
  const byPath = Object.fromEntries(d.rows.map((r) => [r.path, r.state]));
  assert.equal(byPath["keep"], "UNCHANGED");
  assert.equal(byPath["chg"], "CHANGED");
  assert.equal(byPath["gone"], "REMOVED");
  assert.equal(byPath["fresh"], "ADDED");
  assert.equal(byPath["nested.y"], "CHANGED");
  assert.equal(byPath["nested.x"], "UNCHANGED");
  assert.equal(byPath["arr[1]"], "CHANGED");
  // determinism: same inputs, same rows
  const d2 = strategicDiff({ keep: 1, chg: "a", gone: true, nested: { y: 2, x: 1 }, arr: ["a", "b"] },
    { fresh: "n", arr: ["a", "c"], nested: { y: 3, x: 1 }, chg: "b", keep: 1 });
  assert.deepEqual(d2.rows, d.rows);
  // no baseline: everything ADDED, honest NONE
  const n = strategicDiff(null, { a: 1 });
  assert.equal(n.baseline, "NONE");
  assert.ok(n.rows.every((r) => r.state === "ADDED"));
});

test("reviewEntity is read-only and reports no-baseline honestly", async () => {
  const p = proj();
  const e = await strategic.propose({ projectId: p, entityType: "CONSTRAINTS", payload: { r: 1 }, createdBy: "test" });
  const r1 = await strategic.reviewEntity(p, e.entityId);
  assert.equal(r1.baseline, null);
  assert.equal(r1.diff.baseline, "NONE");
  const r2 = await strategic.reviewEntity(p, e.entityId);
  assert.deepEqual(r2, r1);
  const kept = await strategic.getEntity(e.entityId);
  assert.equal(kept.status, "PROPOSED", "review caused zero mutation");
});

test("health + empty states are honest", async () => {
  const p = proj();
  const empty = await strategic.strategicHealth(`never-configured-${runId()}`);
  assert.equal(empty.status, "NOT_CONFIGURED");
  const r = await strategic.resolve({ projectId: p, agentId: "writer" });
  assert.equal(r.status, "STRATEGY_NOT_CONFIGURED");
  assert.equal(r.entityRefs.length, 0);
});
