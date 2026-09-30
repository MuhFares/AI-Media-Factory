import { test } from "node:test";
import assert from "node:assert/strict";
import { artifactAttribution, configurationFingerprint, executionProvenance, modelPerformanceObservations, safeAttributionConfiguration } from "../dist/model-performance-attribution.js";

const base = (overrides = {}) => executionProvenance({
  workflowId: "wf-attribution", correlationId: "corr-attribution", agentId: "writer", stage: "writer", capability: "text.generate",
  provider: "mock-provider", model: "model-x", runtime: null, promptVersion: "prompt-v1",
  startedAt: "2026-09-03T00:00:00.000Z", completedAt: "2026-09-03T00:00:00.010Z", latencyMs: 10,
  status: "success", usage: { inputTokens: 5, outputTokens: 7, totalTokens: 12 }, costKind: "ESTIMATED", cost: 0.02, currency: "USD",
  artifactIds: ["writer-artifact"], parentExecutionIds: [], attemptNumber: 1, providerRequestId: "request-safe", providerJobId: null,
  errorClassification: null, configuration: { temperature: 0.2, apiKey: "never-store", authorization: "Bearer never-store", imageUrl: "https://x.test/a?signature=unsafe" }, ...overrides,
});

test("execution provenance is deterministic, secret-safe, and keeps unknown cost honest", () => {
  const safe = safeAttributionConfiguration({ temperature: 0.2, apiKey: "secret", nested: { accessToken: "secret", seed: 7 } });
  assert.deepEqual(safe, { nested: { seed: 7 }, temperature: 0.2 });
  assert.equal(configurationFingerprint({ seed: 7, temperature: 0.2 }), configurationFingerprint({ temperature: 0.2, seed: 7 }));
  const unknown = base({ costKind: "UNKNOWN", cost: null, configuration: { apiKey: "secret", temperature: 0.2 } });
  assert.equal(unknown.cost, null); assert.equal(unknown.configuration.apiKey, undefined); assert.equal(unknown.configurationFingerprint.length, 64);
});

test("retry/fallback attribution assigns the artifact only to the successful provider attempt", () => {
  const failed = base({ executionId: "attempt-a", provider: "provider-a", model: "model-a", status: "failed", artifactIds: [], errorClassification: "RATE_LIMIT", costKind: "UNKNOWN", cost: null, attemptNumber: 1 });
  const succeeded = base({ executionId: "attempt-b", provider: "provider-b", model: "model-b", artifactIds: ["writer-artifact"], attemptNumber: 2 });
  const artifacts = [{ artifactId: "writer-artifact", kind: "writer_report", payload: {}, workflowId: "wf-attribution", correlationId: "corr-attribution" }];
  const attribution = artifactAttribution(artifacts, [failed, succeeded], []);
  assert.equal(attribution[0].producedByExecutionId, "attempt-b");
  assert.equal(modelPerformanceObservations([failed, succeeded]).find((row) => row.provider === "provider-a").failureCount, 1);
});

test("provider/model observations remain separated by agent and configuration", () => {
  const planner = base({ executionId: "planner-1", agentId: "planner", stage: "planner", configuration: { temperature: 0.2 } });
  const writerOtherConfig = base({ executionId: "writer-2", configuration: { temperature: 0.8 } });
  const observations = modelPerformanceObservations([planner, writerOtherConfig]);
  assert.equal(observations.length, 2);
  assert.ok(observations.some((row) => row.agentId === "planner"));
  assert.notEqual(planner.configurationFingerprint, writerOtherConfig.configurationFingerprint);
});

test("artifact attribution joins reviewer, QA, and human outcomes without treating a human as a model", () => {
  const final = { artifactId: "final-media", kind: "final_media_artifact", payload: {}, workflowId: "wf-attribution", correlationId: "corr-attribution" };
  const review = { artifactId: "review-1", kind: "final_product_review", payload: { finalMediaArtifactId: "final-media", status: "human_review_required" }, workflowId: "wf-attribution", correlationId: "corr-attribution" };
  const qa = { artifactId: "qa-1", kind: "final_technical_qa", payload: { finalMediaArtifactId: "final-media", status: "passed" }, workflowId: "wf-attribution", correlationId: "corr-attribution" };
  const outcome = artifactAttribution([final, review, qa], [base({ executionId: "compose-1", artifactIds: ["final-media"] })], [{ payload: { finalMediaArtifactId: "final-media", outcome: "approved" } }]).find((row) => row.artifactId === "final-media");
  assert.deepEqual(outcome, { artifactId: "final-media", producedByExecutionId: "compose-1", reviewStatus: "human_review_required", qaStatus: "passed", humanDecision: "approved" });
});
