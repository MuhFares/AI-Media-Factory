import assert from "node:assert/strict";
import test from "node:test";
import { assertNoExternalCalls, assertProviderAccounting, assertResearchEvidence, assertSceneContract, evaluateFinalDelivery } from "../dist/index.js";

test("research and scene contracts fail closed when evidence or lineage is missing", () => {
  assert.throws(() => assertResearchEvidence({ claim: "claim", sourceIds: [], evidenceStatus: "UNKNOWN", scientificReviewer: "HUMAN_REVIEW_REQUIRED" }), /RESEARCH_EVIDENCE_INSUFFICIENT/);
  assert.throws(() => assertSceneContract({ sceneId: "s1", startMs: 0, endMs: 1000, narrationText: "say", visualPurpose: "show", semanticAction: "sink", sourceArtifactIds: [], sourceProvenance: "", referenceContinuity: "HUMAN_REVIEW_REQUIRED", motionReview: "HUMAN_REVIEW_REQUIRED" }), /SCENE_LINEAGE_INCOMPLETE/);
});

test("provider accounting never hides unknown cost or ambiguous submission", () => {
  assert.throws(() => assertProviderAccounting({ provider: "wan", model: "wan2.2", costKind: "UNKNOWN", costUsd: 1, providerCallCount: 1, duplicatePaidCalls: 0 }), /UNKNOWN_COST_MUST_BE_NULL/);
  assert.throws(() => assertProviderAccounting({ provider: "wan", model: "wan2.2", costKind: "ACTUAL", costUsd: null, providerCallCount: 1, duplicatePaidCalls: 0 }), /KNOWN_COST_REQUIRED/);
  assert.throws(() => assertProviderAccounting({ provider: "wan", model: "wan2.2", costKind: "UNKNOWN", costUsd: null, providerCallCount: 1, duplicatePaidCalls: 0, submissionState: "RECONCILIATION_REQUIRED" }), /PROVIDER_RECONCILIATION_REQUIRED/);
});

test("final delivery requires burned captions and keeps human review explicit", () => {
  const base = { videoDurationMs: 19688, narrationDurationMs: 19680, narrationComplete: true, technicalQa: "PASS", productReview: "HUMAN_REVIEW_REQUIRED", humanGate: "AWAITING_APPROVAL", publishingAuthorization: "BLOCKED" };
  assert.equal(evaluateFinalDelivery({ ...base, captions: "SIDECAR_ONLY" }), "DETECTED_FAIL_CLOSED");
  assert.equal(evaluateFinalDelivery({ ...base, captions: "BURNED_IN" }), "HUMAN_GATED");
  assert.equal(evaluateFinalDelivery({ ...base, captions: "BURNED_IN", productReview: "PASS", humanGate: "APPROVED" }), "PREVENTED");
});

test("zero-call validation accepts only non-negative integer counters", () => {
  assert.doesNotThrow(() => assertNoExternalCalls({ research: 0, image: 0, tts: 0, wan: 0, composer: 0, publishing: 0 }));
  assert.throws(() => assertNoExternalCalls({ research: 0.5, image: 0, tts: 0, wan: 0, composer: 0, publishing: 0 }), /CALL_COUNT_INVALID/);
});
