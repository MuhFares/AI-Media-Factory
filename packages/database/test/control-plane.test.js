/**
 * Control-plane approval evidence attachment (isolated test DB).
 * Additive evidence on PENDING approvals; DECIDED history immutable.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ControlPlaneStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool;
let control;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  control = new ControlPlaneStore(pool);
});
after(async () => { await pool.end(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function pendingApproval() {
  const id = `approval-ev-${runId()}`;
  await control.createApproval({
    approvalId: id, projectId: "proj-ev", targetType: "workflow_gate", targetId: "wf:gate",
    agentRecommendation: {}, agentConfidence: null, evidenceRefs: ["a1"],
    status: "PENDING", supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  return id;
}

test("PENDING approval evidence appends additively with dedupe", async () => {
  const id = await pendingApproval();
  const updated = await control.appendApprovalEvidence(id, ["a2", "a1", "a3"]);
  assert.deepEqual(updated.evidenceRefs, ["a1", "a2", "a3"]);
  assert.equal(updated.status, "PENDING");
  assert.equal(updated.ownerDecision, null);
});

test("DECIDED approval evidence is frozen", async () => {
  const id = await pendingApproval();
  await control.decideApproval(id, "APPROVE", "fixture");
  await assert.rejects(() => control.appendApprovalEvidence(id, ["a9"]), /APPROVAL_EVIDENCE_FROZEN/);
  const kept = await control.getApproval(id);
  assert.deepEqual(kept.evidenceRefs, ["a1"]);
});

test("missing approval throws", async () => {
  await assert.rejects(() => control.appendApprovalEvidence("approval-does-not-exist", ["a1"]), /APPROVAL_NOT_FOUND/);
});
