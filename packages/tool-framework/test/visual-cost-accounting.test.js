import test from "node:test";
import assert from "node:assert/strict";
import { calculateVisualCost } from "../dist/visual-capability/cost-accounting.js";

test("derives compute cost from explicit billable GPU seconds first", () => {
  const result = calculateVisualCost({ usdPerGpuHour: 1.1, billableGpuSeconds: 30, requestLatencySeconds: 90 });
  assert.equal(result.confidence, "COMPUTE_DERIVED");
  assert.equal(result.amountUsd, 1.1 * 30 / 3600);
});

test("labels latency-based FLUX cost as an estimate, never exact billing", () => {
  const result = calculateVisualCost({ usdPerGpuHour: 1.1, requestLatencySeconds: 39.238 });
  assert.equal(result.confidence, "ESTIMATED_FROM_REQUEST_LATENCY");
  assert.equal(result.durationType, "request_latency_seconds");
  assert.match(result.formula, /3600/);
});

test("missing duration remains unknown", () => {
  assert.equal(calculateVisualCost({ usdPerGpuHour: 1.1 }).confidence, "UNKNOWN");
});
