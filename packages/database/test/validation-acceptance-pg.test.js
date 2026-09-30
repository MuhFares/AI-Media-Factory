/**
 * E2E Operating Loop Proof M0 — validation-acceptance persistence matrix.
 * Isolated TEST DB only (helpers.js derivation + isolation guard); never
 * touches production. Proves: bit recorded only via explicit Owner path,
 * historical rows never rewritten, lifecycle exposes the derived field
 * without changing any authority truth.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPool, migrate, PostgresQueue, ControlPlaneStore, LifecycleStore, isValidationAcceptance,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool, queue, control, lifecycle;
const PID = `va-${Date.now().toString(36)}`;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  lifecycle = new LifecycleStore(pool);
  await queue.submit({
    submissionKey: `${PID}-sub`, workflowId: `wf-${PID}`, directive: "research",
    correlationId: `${PID}-corr`, brandId: `${PID}-proj`, definition: { stages: [] },
    status: "submitted",
  });
});
after(async () => { await pool.end(); });

const mk = (n, over = {}) => ({
  approvalId: `${PID}-ap-${n}`,
  projectId: `${PID}-proj`,
  targetType: "publication_integration_validation_gate",
  targetId: `wf-${PID}:${n}`,
  agentRecommendation: { engine: "fixture" },
  agentConfidence: null,
  evidenceRefs: [],
  status: "AWAITING_OWNER",
  supersedes: null,
  supersededBy: null,
  createdAt: new Date().toISOString(),
  ...over,
});

test("6+7: explicit bit persists on exact scope; historical rows untouched; authority triple intact", async () => {
  const legacy = await control.createApproval(mk("legacy"));
  const decidedLegacy = await control.decideApproval(legacy.approvalId, "APPROVE", "historical shape, no bit");
  assert.equal(isValidationAcceptance({
    status: decidedLegacy.status, owner_decision: decidedLegacy.ownerDecision,
    target_type: decidedLegacy.targetType, agent_recommendation: decidedLegacy.agentRecommendation,
  }), false);
  const beforeLegacy = JSON.stringify(decidedLegacy.agentRecommendation);

  const prod = await control.createApproval(mk("prod", {
    targetType: "workflow_gate", targetId: `wf-${PID}:production-approved`,
  }));
  const decidedProd = await control.decideApproval(prod.approvalId, "APPROVE", "production-shaped");
  assert.equal(isValidationAcceptance({
    status: decidedProd.status, owner_decision: decidedProd.ownerDecision,
    target_type: decidedProd.targetType, agent_recommendation: decidedProd.agentRecommendation,
  }), false);

  const fresh = await control.createApproval(mk("fresh"));
  const decidedFresh = await control.decideApproval(fresh.approvalId, "APPROVE", "explicit acceptance", { validationAcceptance: true });
  assert.equal(decidedFresh.agentRecommendation.owner_validation_acceptance, true);
  assert.equal(decidedFresh.agentRecommendation.engine, "fixture", "agent content preserved");
  assert.equal(isValidationAcceptance({
    status: decidedFresh.status, owner_decision: decidedFresh.ownerDecision,
    target_type: decidedFresh.targetType, agent_recommendation: decidedFresh.agentRecommendation,
  }), true);

  // Historical rows were not rewritten or backfilled.
  const reLegacy = await control.getApproval(legacy.approvalId);
  const reProd = await control.getApproval(prod.approvalId);
  assert.equal(JSON.stringify(reLegacy.agentRecommendation), beforeLegacy);
  assert.equal(reProd.agentRecommendation.owner_validation_acceptance, undefined);

  // Authority triple intact on the lifecycle read model for this workflow.
  // (The production-shaped APPROVE in this fixture yields GRANTED under
  // pre-existing target-pattern semantics — unchanged by this contract.)
  const lc = await lifecycle.workflowLifecycle(`wf-${PID}`);
  assert.equal(lc.validationAcceptance, true);
  assert.equal(lc.productionApproval, "GRANTED");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");

  // Validation acceptance alone grants nothing: isolated workflow with only
  // the explicit validation APPROVE keeps the full NOT_GRANTED triple.
  await queue.submit({
    submissionKey: `${PID}-sub-2`, workflowId: `wf-${PID}-2`, directive: "research",
    correlationId: `${PID}-corr-2`, brandId: `${PID}-proj`, definition: { stages: [] },
    status: "submitted",
  });
  const solo = await control.createApproval(mk("solo", { targetId: `wf-${PID}-2:solo` }));
  await control.decideApproval(solo.approvalId, "APPROVE", "explicit acceptance", { validationAcceptance: true });
  const lc2 = await lifecycle.workflowLifecycle(`wf-${PID}-2`);
  assert.equal(lc2.validationAcceptance, true);
  assert.equal(lc2.productionApproval, "NOT_GRANTED");
  assert.equal(lc2.publicationApproval, "NOT_GRANTED");
  assert.equal(lc2.publicStatus, "NOT_PUBLISHED");
});

test("fail-closed: bit rejected on wrong scope and non-APPROVE action", async () => {
  const other = await control.createApproval(mk("other", {
    targetType: "workflow_gate", targetId: `wf-${PID}:pre-production-owner-gate`,
  }));
  await assert.rejects(
    control.decideApproval(other.approvalId, "APPROVE", "wrong scope", { validationAcceptance: true }),
    /VALIDATION_ACCEPTANCE_SCOPE_MISMATCH/,
  );
  const rej = await control.createApproval(mk("rej"));
  await assert.rejects(
    control.decideApproval(rej.approvalId, "REJECT", "not approve", { validationAcceptance: true }),
    /VALIDATION_ACCEPTANCE_REQUIRES_APPROVE/,
  );
  const untouched = await control.getApproval(other.approvalId);
  assert.equal(untouched.status, "AWAITING_OWNER", "rejected decision path leaves row undecided");
});
