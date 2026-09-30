import test from "node:test";
import assert from "node:assert/strict";
import {
  TARGETED_VERIFICATION_MODE,
  buildTargetedVerificationPlan,
  validateTargetedReevaluation,
} from "../dist/index.js";

const artifact = {
  candidateStories: [
    { candidateId: "candidate-1", topic: "A Nile-side perspective on ancient Egypt", factualAngle: "Daily life beside the Nile shaped ancient Egyptian settlement.", keyClaims: ["The Nile supported settlement and agriculture."] },
    { candidateId: "candidate-2", topic: "From Egyptian excavation to museum display", factualAngle: "Excavated objects move through documented conservation and display processes.", keyClaims: ["Museums document Egyptian excavation provenance."] },
  ],
};

const input = {
  mode: TARGETED_VERIFICATION_MODE,
  projectId: "morroway",
  workflowId: "wf-1790293235186-1l4105j4",
  artifactId: "art-wf-1790293235186-1l4105j4-research-20260926T155304378Z",
  selectedCandidateIds: ["candidate-1", "candidate-2"],
  maxVerificationRetrievalCalls: 2,
  maxReevaluationTextCalls: 1,
};

test("A/D: selected existing candidates produce one bounded targeted query each and no broad phase", () => {
  const plan = buildTargetedVerificationPlan(artifact, input);
  assert.equal(plan.length, 2);
  assert.deepEqual(plan.map((entry) => entry.candidateId), input.selectedCandidateIds);
  assert.equal(plan.every((entry) => entry.role === "TARGETED_VERIFICATION" && entry.capabilityId === "web.search"), true);
  assert.equal(plan.every((entry) => entry.query.length <= 200), true);
  assert.equal(plan.some((entry) => /direction|discovery/i.test(entry.role)), false);
});

test("B: unknown candidates fail closed", () => {
  assert.throws(() => buildTargetedVerificationPlan(artifact, { ...input, selectedCandidateIds: ["candidate-3"], maxVerificationRetrievalCalls: 1 }), /UNKNOWN_CANDIDATE/);
});

test("D/F: envelope and single re-evaluation call are strict", () => {
  assert.throws(() => buildTargetedVerificationPlan(artifact, { ...input, maxVerificationRetrievalCalls: 1 }), /ENVELOPE_TOO_SMALL/);
  assert.throws(() => buildTargetedVerificationPlan(artifact, { ...input, maxReevaluationTextCalls: 2 }), /LIMIT_MUST_EQUAL_ONE/);
});

test("reevaluation rejects candidate creation and semantic rewrites", () => {
  assert.throws(() => validateTargetedReevaluation({ candidateUpdates: [{ candidateId: "candidate-3", factualVerification: { status: "STRONG", basis: "x" }, recommendedForProduction: true, supportingSourceUrls: [], evidenceRisks: [] }] }, artifact, ["candidate-1"]), /CANDIDATE_ID_INVALID/);
  assert.throws(() => validateTargetedReevaluation({ candidateUpdates: [{ candidateId: "candidate-1", topic: "replacement", factualVerification: { status: "STRONG", basis: "x" }, recommendedForProduction: true, supportingSourceUrls: [], evidenceRisks: [] }] }, artifact, ["candidate-1"]), /SEMANTIC_REWRITE_FORBIDDEN/);
});

test("I: non-STRONG reevaluation cannot recommend production", () => {
  const [update] = validateTargetedReevaluation({ candidateUpdates: [{ candidateId: "candidate-1", factualVerification: { status: "PARTIAL", basis: "one source" }, recommendedForProduction: true, supportingSourceUrls: [], evidenceRisks: ["needs corroboration"] }] }, artifact, ["candidate-1"]);
  assert.equal(update.recommendedForProduction, false);
});
