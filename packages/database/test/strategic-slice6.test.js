/**
 * Slice 6 Strategic Operating Layer V1 — Morroway-shaped fixture coverage
 * (isolated TEST DB). Approved-vs-superseded vs experimental vs historical,
 * conflict fail-closed, evidence/supersession lineage, no authority grants.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ControlPlaneStore, StrategicStore } from "../dist/index.js";
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
const proj = () => `slice6-${runId()}`;

async function approveFor(projectId, entityId, scope) {
  const created = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId, targetType: scope, targetId: entityId,
    agentRecommendation: { activation: entityId }, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  return control.decideApproval(created.approvalId, "APPROVE", "slice6 fixture");
}

test("1+6+10+11: Owner-approved v2 resolves current; superseded v1 and old candidates do not", async () => {
  const p = proj();
  const v1 = await strategic.propose({
    projectId: p, entityType: "BRAND",
    payload: { brand: "Morroway", naming: { status: "PENDING_SELECTION", finalists: ["Morroway", "Remnara"] } },
    sourceArtifactIds: ["artifacts/brand-architecture-v1.json"], createdBy: "test",
  });
  await strategic.activate({ entityId: v1.entityId, approvalId: (await approveFor(p, v1.entityId, "BRAND_ACTIVATION")).approvalId });
  const v2 = await strategic.propose({
    projectId: p, entityType: "BRAND",
    payload: { brand: "Morroway", brandStatus: "APPROVED_MASTER_BRAND", naming: { status: "CLOSED", winner: "Morroway", reserveFinalist: "Remnara" } },
    sourceArtifactIds: ["docs/brand-and-channel-naming-v1.md"], createdBy: "test",
  });
  await strategic.activate({ entityId: v2.entityId, approvalId: (await approveFor(p, v2.entityId, "BRAND_ACTIVATION")).approvalId });
  const r = await strategic.resolve({ projectId: p, agentId: "writer" });
  assert.equal(r.context.entities.BRAND.version, 2, "current truth is v2");
  assert.equal(r.context.entities.BRAND.payload.naming.status, "CLOSED");
  assert.equal(r.context.entities.BRAND.status, "ACTIVE");
  const old = await strategic.getEntity(v1.entityId);
  assert.equal(old.status, "SUPERSEDED", "v1 retained as history, never current");
});

test("2+12: superseded strategy never resolves; learning batch stays a note, not a fixed pilot", async () => {
  const p = proj();
  const v1 = await strategic.propose({ projectId: p, entityType: "STRATEGY", payload: { pilot: { model: "fixed" } }, createdBy: "test" });
  await strategic.activate({ entityId: v1.entityId, approvalId: (await approveFor(p, v1.entityId, "STRATEGY_ACTIVATION")).approvalId });
  const v2 = await strategic.propose({
    projectId: p, entityType: "STRATEGY",
    payload: { contentPillars: ["a"], pilot: { model: "adaptive", learningBatch: 4, learningBatchNote: "4 items = initial learning batch, NOT permanent fixed pilot size" } },
    createdBy: "test",
  });
  await strategic.activate({ entityId: v2.entityId, approvalId: (await approveFor(p, v2.entityId, "STRATEGY_ACTIVATION")).approvalId });
  const r = await strategic.resolve({ projectId: p, agentId: "writer" });
  assert.match(r.context.entities.STRATEGY.payload.pilot.learningBatchNote, /NOT permanent/);
});

test("4+5: experimental hypothesis stays experimental; promotion requires governed approval", async () => {
  const p = proj();
  const e = await strategic.propose({
    projectId: p, entityType: "EXPERIMENT", entityKey: "pilot-gates",
    payload: {
      hypothesis: "gates", status: "EXPERIMENTAL", rule: "promotion only via governed Owner decision",
      experimentalEvaluationSignals: ["5%"], decisionUse: "informs evaluation",
      decisionModel: ["PERFORMANCE_LED"], automaticDecisionRule: "No signal crossing automatically selects.",
    },
    createdBy: "test",
  });
  const r = await strategic.resolve({ projectId: p, agentId: "ceo" });
  assert.equal(r.status, "STRATEGY_NOT_CONFIGURED", "PROPOSED-only state resolves nothing current");
  // Properly scoped approval activates it — still recorded as experimental.
  const good = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId: p, targetType: "EXPERIMENT_ACTIVATION", targetId: e.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(good.approvalId, "APPROVE", "slice6 fixture");
  await strategic.activate({ entityId: e.entityId, approvalId: good.approvalId });
  const r2 = await strategic.resolve({ projectId: p, agentId: "ceo" });
  assert.equal(r2.status, "RESOLVED");
  assert.equal(r2.context.entities.EXPERIMENT.status, "ACTIVE");
  assert.equal(r2.context.entities.EXPERIMENT.payload.status, "EXPERIMENTAL", "activation does not rewrite hypothesis state");
  assert.equal(r2.context.entities.EXPERIMENT.authority.activatedByApprovalId, good.approvalId);
  // Wrong-scope approval cannot promote a fresh proposal (STRATEGY_ACTIVATION
  // is the generic scope, so a mismatched per-type scope must fail).
  const e2 = await strategic.propose({
    projectId: p, entityType: "EXPERIMENT", entityKey: "pilot-gates-2",
    payload: { hypothesis: "gates-2", status: "EXPERIMENTAL" },
    createdBy: "test",
  });
  const bad = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId: p, targetType: "BRAND_ACTIVATION", targetId: e2.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(bad.approvalId, "APPROVE", "slice6 fixture");
  await assert.rejects(
    strategic.activate({ entityId: e2.entityId, approvalId: bad.approvalId }),
    /STRATEGIC_APPROVAL_SCOPE_MISMATCH/,
    "EXPERIMENT activation requires EXPERIMENT_ACTIVATION scope",
  );
  const still = await strategic.getEntity(e2.entityId);
  assert.equal(still.status, "PROPOSED", "no silent promotion");
});

test("13+14: unresolved duplicate ACTIVE rows conflict; resolution refuses to choose or fabricate", async () => {
  const p = proj();
  for (let v = 0; v < 2; v++) {
    const e = await strategic.propose({ projectId: p, entityType: "BRAND", payload: { brand: v ? "Other" : "Morroway" }, createdBy: "test" });
    await pool.query(`UPDATE strategic_entities SET status='ACTIVE' WHERE entity_id=$1`, [e.entityId]);
  }
  const { conflicts } = await strategic.effectiveState(p);
  assert.equal(conflicts.length, 1, "duplicate ACTIVE singletons conflict");
  await assert.rejects(strategic.resolve({ projectId: p, agentId: "writer" }), /STRATEGIC_STATE_CONFLICT/);
  const approvals = await control.listApprovals(p);
  assert.equal(approvals.length, 0, "conflict fabricates no Owner action");
});

test("15+16: evidence refs and supersession lineage survive activation", async () => {
  const p = proj();
  const v1 = await strategic.propose({
    projectId: p, entityType: "CONTENT_SYSTEM", payload: { state: "draft" },
    sourceArtifactIds: ["docs/a.md", "docs/b.md"], createdBy: "test",
  });
  await strategic.activate({ entityId: v1.entityId, approvalId: (await approveFor(p, v1.entityId, "CONTENT_SYSTEM_ACTIVATION")).approvalId });
  const v2 = await strategic.propose({
    projectId: p, entityType: "CONTENT_SYSTEM", payload: { state: "ready" },
    sourceArtifactIds: ["docs/c.md"], createdBy: "test",
  });
  assert.deepEqual(v2.sourceArtifactIds, ["docs/c.md"]);
  const res = await strategic.activate({ entityId: v2.entityId, approvalId: (await approveFor(p, v2.entityId, "CONTENT_SYSTEM_ACTIVATION")).approvalId });
  assert.equal(res.activation.previousActiveVersion, 1, "activation records lineage");
  assert.equal((await strategic.getEntity(v1.entityId)).status, "SUPERSEDED");
  assert.deepEqual((await strategic.history(p, "CONTENT_SYSTEM", "primary")).map((e) => e.version), [2, 1]);
});

test("8+9+19: activation grants no production/publication authority and creates no actionability", async () => {
  const p = proj();
  const e = await strategic.propose({
    projectId: p, entityType: "STRATEGY", payload: { contentPillars: ["a"] }, createdBy: "test",
  });
  const res = await strategic.activate({ entityId: e.entityId, approvalId: (await approveFor(p, e.entityId, "STRATEGY_ACTIVATION")).approvalId });
  const dumped = JSON.stringify(res);
  assert.doesNotMatch(dumped, /GRANTED/i, "no production/publication grant anywhere in activation");
  assert.doesNotMatch(dumped, /production|publication/i, "authority domains absent from strategic activation");
  const r = await strategic.resolve({ projectId: p, agentId: "writer" });
  assert.doesNotMatch(JSON.stringify(r.context), /actionable/i, "strategic layer carries no actionability signal");
});
