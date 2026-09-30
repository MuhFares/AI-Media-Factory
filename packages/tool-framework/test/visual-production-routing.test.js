import test from "node:test";
import assert from "node:assert/strict";
import {
  selectVisualRoute,
  canAdvanceManualGeneration,
  VISUAL_PROVIDER_ROUTING_BENCHMARK_V1,
} from "../dist/visual-capability/visual-production-routing.js";

const profile = (overrides = {}) => ({
  provider: "runpod-zimage", model: "z-image-turbo", route: "AUTOMATIC_LOW_COST",
  domains: ["CARTOON_2D"], capabilities: {}, qualityScore: 8,
  humanVerdict: "HUMAN_PASS", automatedVerdict: "PASS", commercialEligible: "PASS",
  estimatedCostUsd: 0.005, evidenceSource: "fixture", benchmarkVersion: "fixture-v1", confidence: "HIGH", ...overrides,
});

test("selects the cheapest eligible low-cost provider", () => {
  const decision = selectVisualRoute({ task: "CARTOON_2D", requirements: [], minimumQualityScore: 7 }, [
    profile({ provider: "flux", estimatedCostUsd: 0.03 }), profile({ estimatedCostUsd: 0.005 }),
  ]);
  assert.equal(decision.provider, "runpod-zimage");
  assert.equal(decision.route, "AUTOMATIC_LOW_COST");
});

test("does not treat unknown or failed capability evidence as a pass", () => {
  const decision = selectVisualRoute({ task: "CARTOON_2D", requirements: ["CHARACTER_CONSISTENCY"], humanInterventionAvailable: true }, [
    profile({ capabilities: { CHARACTER_CONSISTENCY: "UNKNOWN" } }),
  ]);
  assert.equal(decision.route, "MANUAL_EXTERNAL_GENERATION");
  assert.equal(selectVisualRoute({ task: "CARTOON_2D", requirements: ["CHARACTER_CONSISTENCY"] }, [profile({ capabilities: { CHARACTER_CONSISTENCY: "FAIL" } })]).provider, undefined);
});

test("escalates to premium evidence before manual generation", () => {
  const decision = selectVisualRoute({ task: "CARTOON_2D", requirements: ["CHARACTER_CONSISTENCY"] }, [
    profile({ capabilities: { CHARACTER_CONSISTENCY: "FAIL" } }),
    profile({ route: "PREMIUM_API", provider: "premium-fixture", capabilities: { CHARACTER_CONSISTENCY: "PASS" }, estimatedCostUsd: 0.1 }),
  ]);
  assert.equal(decision.route, "PREMIUM_API");
  assert.equal(decision.provider, "premium-fixture");
});

test("manual generation lifecycle cannot bypass reviewer and QA", () => {
  assert.equal(canAdvanceManualGeneration("PENDING_HUMAN_GENERATION", "ASSET_RECEIVED"), true);
  assert.equal(canAdvanceManualGeneration("ASSET_RECEIVED", "APPROVED"), false);
  assert.equal(canAdvanceManualGeneration("REVIEW_REQUIRED", "QA_REQUIRED"), true);
  assert.equal(canAdvanceManualGeneration("QA_REQUIRED", "APPROVED"), false);
  assert.equal(canAdvanceManualGeneration("QA_REQUIRED", "HUMAN_APPROVAL_REQUIRED"), true);
  assert.equal(canAdvanceManualGeneration("HUMAN_APPROVAL_REQUIRED", "APPROVED"), true);
  assert.equal(canAdvanceManualGeneration("APPROVED", "READY_FOR_DOWNSTREAM_VIDEO"), true);
  assert.equal(canAdvanceManualGeneration("ASSET_RECEIVED", "READY_FOR_DOWNSTREAM_VIDEO"), false);
});

test("benchmark preparation is provider-neutral and has no execution side effects", () => {
  assert.equal(VISUAL_PROVIDER_ROUTING_BENCHMARK_V1.length, 8);
  for (const item of VISUAL_PROVIDER_ROUTING_BENCHMARK_V1) {
    assert.deepEqual(item.providers, ["runpod-zimage", "self-hosted-image"]);
    assert.equal(item.maxCallsPerProvider, 1);
    assert.ok(item.prompt.length > 20);
  }
});
