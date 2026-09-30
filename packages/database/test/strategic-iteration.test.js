/**
 * Slice 6 request-iteration continuation (isolated TEST DB).
 * REQUEST_ITERATION → revised PROPOSED next version with decision
 * provenance. Grants nothing; duplicates impossible; history immutable.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ControlPlaneStore, StrategicStore, canonicalJson } from "../dist/index.js";
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
const proj = () => `iter-${runId()}`;

async function decide(projectId, targetId, scope, decision, rationale) {
  const created = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId, targetType: scope, targetId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await control.decideApproval(created.approvalId, decision, rationale);
  return created.approvalId;
}

const V1_RULES = ["Validation success is not production approval", "No automatic publication", "No workstream may trap the brand in one pillar"];
const V2_RULES = [V1_RULES[0], "Publication must follow the active governed publication policy. Automatic publication is prohibited unless explicitly enabled by Owner-approved autonomy and publication authority.", V1_RULES[2]];

async function setup() {
  const p = proj();
  const v1 = await strategic.propose({
    projectId: p, entityType: "CONSTRAINTS", payload: { rules: V1_RULES },
    sourceArtifactIds: ["docs/a.md"], createdBy: "test",
  });
  return { p, v1 };
}

test("1+2: REQUEST_ITERATION persists rationale tied to the exact entity", async () => {
  const { p, v1 } = await setup();
  const rationale = "Replace rule two with governed publication policy wording.";
  const id = await decide(p, v1.entityId, "CONSTRAINTS_ACTIVATION", "REQUEST_ITERATION", rationale);
  const row = await pool.query("SELECT * FROM control_approvals WHERE approval_id=$1", [id]);
  assert.equal(row.rows[0].status, "DECIDED");
  assert.equal(row.rows[0].owner_decision, "REQUEST_ITERATION");
  assert.equal(row.rows[0].owner_rationale, rationale);
  assert.equal(row.rows[0].target_id, v1.entityId, "decision targets the exact version");
});

test("3+4+5+6+7: iteration creates PROPOSED next version with decision provenance; prior untouched", async () => {
  const { p, v1 } = await setup();
  const before = JSON.parse(JSON.stringify(await strategic.getEntity(v1.entityId)));
  const rationale = "Replace rule two with governed publication policy wording.";
  const decId = await decide(p, v1.entityId, "CONSTRAINTS_ACTIVATION", "REQUEST_ITERATION", rationale);
  const approvalsBefore = (await control.listApprovals(p)).length;
  const jobsBefore = await pool.query("SELECT count(*)::int AS n FROM workflow_jobs");
  const subsBefore = await pool.query("SELECT count(*)::int AS n FROM workflow_submissions");
  const res = await strategic.iterate({
    priorEntityId: v1.entityId, sourceDecisionId: decId,
    revisedPayload: { rules: V2_RULES }, createdBy: "test-iteration",
  });
  assert.equal(res.created, true);
  assert.equal(res.entity.version, 2, "next version");
  assert.equal(res.entity.status, "PROPOSED", "revision stays PROPOSED");
  assert.equal(res.entity.supersedesVersion, 1, "supersedes prior proposal");
  assert.equal(res.entity.createdBy, "test-iteration");
  assert.equal(res.iteration.priorVersion, 1);
  assert.equal(res.iteration.newVersion, 2);
  assert.equal(res.iteration.newEntityId, res.entity.entityId);
  assert.equal(res.iteration.sourceDecisionId, decId, "provenance references iteration decision");
  assert.equal(res.iteration.ownerRationale, rationale, "rationale retained");
  assert.deepEqual(await strategic.getEntity(v1.entityId), before, "prior proposal immutable");
  assert.equal((await control.listApprovals(p)).length, approvalsBefore, "no approval auto-created");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM workflow_jobs")).rows[0].n, jobsBefore.rows[0].n, "no workflow starts");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM workflow_submissions")).rows[0].n, subsBefore.rows[0].n);
});

test("10+11: review diff shows requested change; untouched fields byte-equivalent", async () => {
  const { p, v1 } = await setup();
  const decId = await decide(p, v1.entityId, "CONSTRAINTS_ACTIVATION", "REQUEST_ITERATION", "revise rule two");
  const res = await strategic.iterate({
    priorEntityId: v1.entityId, sourceDecisionId: decId, revisedPayload: { rules: V2_RULES }, createdBy: "test",
  });
  const review = await strategic.reviewEntity(p, res.entity.entityId);
  assert.equal(review.diff.baseline, "NONE", "no ACTIVE baseline in this chain (Morroway case)");
  assert.deepEqual(review.diff.rows.map((r) => [r.path, r.state, r.proposed]), [
    ["rules[0]", "ADDED", V2_RULES[0]],
    ["rules[1]", "ADDED", V2_RULES[1]],
    ["rules[2]", "ADDED", V2_RULES[2]],
  ]);
  assert.equal(review.diff.rows[1].proposed, V2_RULES[1], "requested wording present");
  assert.equal(review.diff.rows[0].proposed, V1_RULES[0], "untouched rule byte-equivalent");
  assert.equal(review.diff.rows[2].proposed, V1_RULES[2]);
});

test("12: iteration grants no activation authority", async () => {
  const { p, v1 } = await setup();
  const decId = await decide(p, v1.entityId, "CONSTRAINTS_ACTIVATION", "REQUEST_ITERATION", "r");
  const res = await strategic.iterate({
    priorEntityId: v1.entityId, sourceDecisionId: decId, revisedPayload: { rules: V2_RULES }, createdBy: "test",
  });
  await assert.rejects(
    strategic.activate({ entityId: res.entity.entityId, approvalId: decId }),
    /STRATEGIC_APPROVAL_NOT_APPROVED:REQUEST_ITERATION/,
    "iteration decision cannot activate",
  );
  assert.equal((await strategic.getEntity(res.entity.entityId)).status, "PROPOSED");
});

test("17: repeated continuation is idempotent; occupied slot conflicts", async () => {
  const { p, v1 } = await setup();
  const decId = await decide(p, v1.entityId, "CONSTRAINTS_ACTIVATION", "REQUEST_ITERATION", "r");
  const first = await strategic.iterate({
    priorEntityId: v1.entityId, sourceDecisionId: decId, revisedPayload: { rules: V2_RULES }, createdBy: "test",
  });
  const second = await strategic.iterate({
    priorEntityId: v1.entityId, sourceDecisionId: decId, revisedPayload: { rules: V2_RULES }, createdBy: "test",
  });
  assert.equal(second.created, false, "no duplicate v2");
  assert.equal(second.entity.entityId, first.entity.entityId);
  const hist = await strategic.history(p, "CONSTRAINTS", "primary");
  assert.deepEqual(hist.map((e) => e.version), [2, 1]);
  await assert.rejects(
    strategic.iterate({
      priorEntityId: v1.entityId, sourceDecisionId: decId, revisedPayload: { rules: ["different"] }, createdBy: "test",
    }),
    /STRATEGIC_ITERATION_VERSION_CONFLICT/,
  );
});

test("fail-closed: wrong decision kind, pending decision, wrong target, active source", async () => {
  const { p, v1 } = await setup();
  const approveId = await decide(p, v1.entityId, "CONSTRAINTS_ACTIVATION", "APPROVE", "ok");
  await assert.rejects(
    strategic.iterate({ priorEntityId: v1.entityId, sourceDecisionId: approveId, revisedPayload: { rules: V2_RULES } }),
    /STRATEGIC_ITERATION_DECISION_NOT_ITERATION/,
  );
  const pending = await control.createApproval({
    approvalId: `approval-${runId()}`, projectId: p, targetType: "CONSTRAINTS_ACTIVATION", targetId: v1.entityId,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  await assert.rejects(
    strategic.iterate({ priorEntityId: v1.entityId, sourceDecisionId: pending.approvalId, revisedPayload: { rules: V2_RULES } }),
    /STRATEGIC_ITERATION_DECISION_PENDING/,
  );
  const other = await strategic.propose({ projectId: p, entityType: "BRAND", payload: { brand: "X" }, createdBy: "test" });
  const otherDec = await decide(p, other.entityId, "BRAND_ACTIVATION", "REQUEST_ITERATION", "r");
  await assert.rejects(
    strategic.iterate({ priorEntityId: v1.entityId, sourceDecisionId: otherDec, revisedPayload: { rules: V2_RULES } }),
    /STRATEGIC_ITERATION_TARGET_MISMATCH/,
  );
  await strategic.activate({ entityId: v1.entityId, approvalId: approveId });
  const decId = await decide(p, v1.entityId, "CONSTRAINTS_ACTIVATION", "REQUEST_ITERATION", "r");
  await assert.rejects(
    strategic.iterate({ priorEntityId: v1.entityId, sourceDecisionId: decId, revisedPayload: { rules: V2_RULES } }),
    /STRATEGIC_ITERATION_SOURCE_NOT_REVISABLE:ACTIVE/,
  );
  assert.ok(canonicalJson({ rules: V2_RULES }).length > 0);
});
