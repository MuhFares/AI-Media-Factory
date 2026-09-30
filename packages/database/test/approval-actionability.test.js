/**
 * Slice 3 — approval actionability (matrix 1-7 pure + store composition).
 * PENDING alone never implies attention; supersession/conflict derived.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ControlPlaneStore, ApprovalActionabilityStore, classifyApproval } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool, control, actionability;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  control = new ControlPlaneStore(pool);
  actionability = new ApprovalActionabilityStore(pool);
});
after(async () => { await pool.end(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const ev = (over = {}) => ({
  approvalId: `ap-${runId()}`, projectId: "p", targetType: "workflow_gate", targetId: "wf-1:gate",
  status: "PENDING", ownerDecision: null, createdAt: new Date().toISOString(),
  workflowId: "wf-1", liveWork: false, laterMilestones: [], decidedReplacement: false,
  laterValidationAcceptance: false, duplicatePending: false, workflowTerminal: false,
  isStrategic: false, ...over,
});

test("1: PENDING blocking continuation with live work -> ACTION_REQUIRED", async () => {
  assert.equal(classifyApproval(ev({ liveWork: true })).state, "ACTION_REQUIRED");
});

test("2: PENDING with later milestones + acceptance -> SUPERSEDED", async () => {
  const r = classifyApproval(ev({ laterMilestones: ["final_media_artifact"], laterValidationAcceptance: true }));
  assert.equal(r.state, "SUPERSEDED");
  assert.match(r.reason, /later governed continuation/i);
});

test("2b: later milestones alone supersede", async () => {
  assert.equal(classifyApproval(ev({ laterMilestones: ["scene_video_clip"] })).state, "SUPERSEDED");
});

test("3: DECIDED -> history with decision preserved", async () => {
  const r = classifyApproval(ev({ status: "DECIDED", ownerDecision: "APPROVE" }));
  assert.equal(r.state, "DECIDED");
  assert.match(r.evidence.join(), /APPROVE/);
});

test("4/5/6: wrong project/target handled by scoping (store level excludes)", async () => {
  const p = `act-${runId()}`;
  const uniqTarget = `wf-${runId()}:gate`;
  await control.createApproval({
    approvalId: `ap-${runId()}`, projectId: p, targetType: "workflow_gate", targetId: uniqTarget,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  const other = await actionability.projectActionability(`other-${runId()}`);
  assert.ok(!other.some((a) => a.approvalId.startsWith("ap-") && a.approvalId.includes(p)));
  const mine = await actionability.projectActionability(p);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].state, "ACTION_REQUIRED");
});

test("7: duplicate pending on same target -> CONFLICTED, no action button basis", async () => {
  const p = `conf-${runId()}`;
  const sameTarget = `wf-${runId()}:same`;
  for (let i = 0; i < 2; i++) {
    await control.createApproval({
      approvalId: `ap-${runId()}-${i}`, projectId: p, targetType: "workflow_gate", targetId: sameTarget,
      agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
      status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
    });
  }
  const rows = await actionability.projectActionability(p);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.state === "CONFLICTED"));
});

test("strategic scope always ACTION_REQUIRED (never auto-continues)", async () => {
  assert.equal(classifyApproval(ev({ targetType: "STRATEGY_ACTIVATION", isStrategic: true })).state, "ACTION_REQUIRED");
});

test("terminal workflow without continuation -> HISTORICAL", async () => {
  assert.equal(classifyApproval(ev({ workflowTerminal: true })).state, "HISTORICAL");
});

test("store: superseded via later artifacts (composition)", async () => {
  const p = `sup-${runId()}`;
  const wf = `wf-${runId()}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'produce','c',$3,'{}','revision_required',now()::text,now()::text)`, [`k-${wf}`, wf, p]);
  await pool.query(
    `INSERT INTO artifacts (artifact_id, workflow_id, kind, producer_agent, status, payload, content_type, schema_version, created_at)
     VALUES ($1,$2,'final_media_artifact','video','completed','{}','application/json','v1',now()::text)`, [`art-${wf}`, wf]);
  const apId = `ap-${runId()}`;
  await control.createApproval({
    approvalId: apId, projectId: p, targetType: "workflow_gate", targetId: `${wf}:visual-human-gate`,
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: [],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date(Date.now() - 86400000).toISOString(),
  });
  const r = await actionability.approvalActionability(apId);
  assert.equal(r.state, "SUPERSEDED");
});
