/**
 * GOVERNED VISUAL ITERATION V1 — store lifecycle tests (isolated test DB).
 * Provider-free: durable rows only, zero provider/network calls.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, VisualIterationStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

let pool;
let store;
before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  store = new VisualIterationStore(pool);
});
after(async () => { await pool.end(); });

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function request(overrides = {}) {
  const id = runId();
  return {
    workflowId: `wf-vi-${id}`,
    contentId: `content-${id}`,
    sourceVisualApprovalId: `approval-${id}`,
    sourceVisualGateState: "DECIDED",
    ownerDecision: "REQUEST_VISUAL_ITERATION",
    ownerRationale: "fixture iteration",
    lineage: {
      sourceWriterArtifactId: "w", sourceBrandArtifactId: "b", sourceReviewArtifactId: "r",
      sourceDirectorArtifactId: "d", sourceNarrationArtifactId: "n", sourceTimelineArtifactId: "t",
      sourceVisualArtifactIds: ["v1"], sourceSemanticQaArtifactIds: ["s1"], sourceTechnicalQaArtifactIds: ["q1"],
    },
    scenesToKeep: [],
    scenesToRegenerate: ["scene-001"],
    proposedImageBudget: 5,
    ...overrides,
  };
}

test("request creates REQUESTED with frozen lineage and proposed (not authorized) budget", async () => {
  const { created, iteration } = await store.requestVisualIteration(request());
  assert.equal(created, true);
  assert.equal(iteration.status, "REQUESTED");
  assert.equal(iteration.iterationNumber, 1);
  assert.ok(iteration.visualIterationId.startsWith("visual-iteration-"));
  assert.equal(iteration.proposedImageBudget, 5);
  assert.equal(iteration.authorizedImageBudget, 0, "proposal never converts implicitly");
  assert.deepEqual(iteration.lineage.sourceVisualArtifactIds, ["v1"]);
});

test("duplicate and concurrent requests are exactly-once", async () => {
  const input = request();
  const first = await store.requestVisualIteration(input);
  assert.equal(first.created, true);
  const dup = await store.requestVisualIteration(input);
  assert.equal(dup.created, false);
  assert.equal(dup.iteration.visualIterationId, first.iteration.visualIterationId);
  const [a, b] = await Promise.all([store.requestVisualIteration(input), store.requestVisualIteration(input)]);
  assert.equal(a.iteration.visualIterationId, first.iteration.visualIterationId);
  assert.equal(b.iteration.visualIterationId, first.iteration.visualIterationId);
  const listed = await store.listByWorkflow(input.workflowId);
  assert.equal(listed.length, 1);
});

test("non-iteration decisions and negative budgets are rejected", async () => {
  await assert.rejects(() => store.requestVisualIteration(request({ ownerDecision: "APPROVE" })), /VISUAL_ITERATION_OWNER_DECISION_REQUIRED/);
  await assert.rejects(() => store.requestVisualIteration(request({ proposedImageBudget: -1 })), /VISUAL_ITERATION_PROPOSED_BUDGET_INVALID/);
});

test("full lifecycle: contract → scenes → prompt review → authorize → generate → QA → review → complete", async () => {
  const { iteration } = await store.requestVisualIteration(request());
  const id = iteration.visualIterationId;
  assert.equal((await store.requireContract(id)).status, "CONTRACT_REQUIRED");
  const prepared = await store.attachContracts(id, { visualDirectionContractArtifactId: "vd", sceneContractArtifactIds: ["s1"], compiledPromptArtifactIds: ["p1"] });
  assert.equal(prepared.status, "CONTRACT_PREPARED");
  assert.equal(prepared.visualDirectionContractArtifactId, "vd");
  const withScenes = await store.setScenes(id, { scenesToKeep: [], scenesToRegenerate: ["scene-001", "scene-002"] });
  assert.deepEqual(withScenes.scenesToRegenerate, ["scene-001", "scene-002"]);
  const review = await store.openPromptReview(id, "prompt-gate-1");
  assert.equal(review.status, "OWNER_REVIEW_REQUIRED");
  // Authorization requires explicit owner action + approved prompt gate.
  await assert.rejects(() => store.authorizeGeneration(id, { authorizedBy: "operator", imageBudget: 5, promptApproval: { status: "DECIDED", ownerDecision: "APPROVE" } }), /NOT_OWNER_AUTHORIZED/);
  await assert.rejects(() => store.authorizeGeneration(id, { authorizedBy: "owner", imageBudget: 5, promptApproval: { status: "PENDING", ownerDecision: null } }), /PROMPT_APPROVAL_REQUIRED/);
  const authed = await store.authorizeGeneration(id, { authorizedBy: "owner", imageBudget: 5, promptApproval: { status: "DECIDED", ownerDecision: "APPROVE" } });
  assert.equal(authed.status, "AUTHORIZED");
  assert.equal(authed.authorizedImageBudget, 5);
  assert.ok(authed.authorizedAt);
  // Exactly-once authorization: second attempt is an illegal transition.
  await assert.rejects(() => store.authorizeGeneration(id, { authorizedBy: "owner", imageBudget: 5, promptApproval: { status: "DECIDED", ownerDecision: "APPROVE" } }), /ILLEGAL_TRANSITION/);
  assert.equal((await store.beginGeneration(id)).status, "GENERATING");
  await assert.rejects(() => store.completeGeneration(id, 99), /USED_BUDGET_INVALID/);
  assert.equal((await store.completeGeneration(id, 5)).status, "QA_REQUIRED");
  assert.equal((await store.openVisualReview(id)).status, "VISUAL_HUMAN_REVIEW_REQUIRED");
  await assert.rejects(() => store.completeIteration(id, { status: "PENDING", ownerDecision: null }), /VISUAL_APPROVAL_REQUIRED/);
  const done = await store.completeIteration(id, { status: "DECIDED", ownerDecision: "APPROVE" });
  assert.equal(done.status, "COMPLETED");
  assert.ok(done.completedAt);
});

test("illegal transitions fail closed; terminal states settle without side effects", async () => {
  const { iteration } = await store.requestVisualIteration(request());
  const id = iteration.visualIterationId;
  await assert.rejects(() => store.authorizeGeneration(id, { authorizedBy: "owner", imageBudget: 1, promptApproval: { status: "DECIDED", ownerDecision: "APPROVE" } }), /ILLEGAL_TRANSITION/);
  await assert.rejects(() => store.completeIteration(id, { status: "DECIDED", ownerDecision: "APPROVE" }), /ILLEGAL_TRANSITION/);
  assert.equal((await store.settle(id, "CANCELLED")).status, "CANCELLED");
  await assert.rejects(() => store.requireContract(id), /ILLEGAL_TRANSITION/);
});

test("creative supersession returns OWNER_REVIEW_REQUIRED to CONTRACT_PREPARED for re-attachment", async () => {
  const { iteration } = await store.requestVisualIteration(request());
  const id = iteration.visualIterationId;
  await store.requireContract(id);
  await store.attachContracts(id, { visualDirectionContractArtifactId: "draft", sceneContractArtifactIds: [], compiledPromptArtifactIds: [] });
  await store.openPromptReview(id, "prompt-gate-1");
  // Canonical creative contract supersedes the draft: re-open preparation,
  // re-attach, re-review.
  assert.equal((await store.requireContract(id)).status, "CONTRACT_REQUIRED");
  const reattached = await store.attachContracts(id, { visualDirectionContractArtifactId: "creative", sceneContractArtifactIds: ["s1"], compiledPromptArtifactIds: ["p1"] });
  assert.equal(reattached.visualDirectionContractArtifactId, "creative");
  assert.equal((await store.openPromptReview(id, "prompt-gate-1")).status, "OWNER_REVIEW_REQUIRED");
});

test("second iteration number increments per workflow", async () => {
  const base = request();
  const first = await store.requestVisualIteration(base);
  const second = await store.requestVisualIteration({ ...base, sourceVisualApprovalId: `${base.sourceVisualApprovalId}-v2` });
  assert.equal(second.created, true);
  assert.equal(second.iteration.iterationNumber, first.iteration.iterationNumber + 1);
});
test("setScenes records dispositions and proposed budget without authorizing", async () => {
  const { iteration } = await store.requestVisualIteration(request());
  const updated = await store.setScenes(iteration.visualIterationId, {
    scenesToKeep: [],
    scenesToRegenerate: ["scene-001", "scene-002"],
    proposedImageBudget: 5,
  });
  assert.deepEqual(updated.scenesToRegenerate, ["scene-001", "scene-002"]);
  assert.equal(updated.proposedImageBudget, 5);
  assert.equal(updated.authorizedImageBudget, 0, "proposal never converts implicitly");
  assert.equal(updated.status, "REQUESTED", "setScenes alone does not advance status");
  await assert.rejects(() => store.setScenes(iteration.visualIterationId, { scenesToKeep: [], scenesToRegenerate: [], proposedImageBudget: -1 }), /PROPOSED_BUDGET_INVALID/);
});
