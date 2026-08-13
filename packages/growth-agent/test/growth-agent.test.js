import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { createGrowthAgent } from "../dist/index.js";

const config = { model: "openrouter/auto", systemPrompt: "test" };

function artifact(kind, { status = "completed", payload = {} } = {}) {
  return {
    artifactId: `aff-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    producerAgent: `producer-${kind}`,
    workflowId: "workflow-1",
    correlationId: "correlation-1",
    status,
    createdAt: "2026-08-14T00:00:00.000Z",
    payload,
  };
}

function analyticsReport(overrides = {}, metrics = {}) {
  return artifact("analytics_report", {
    payload: {
      status: "completed",
      publicationId: "pub-0001",
      contentId: "content-1",
      platform: "youtube",
      retrievedAt: "2026-08-14T03:00:00.000Z",
      summary: "Metrics fetched.",
      metrics: { impressions: 5000, views: 1200, likes: 800, completionRate: 0.6, clickThroughRate: 0.02, ...metrics },
      source: "provider",
      sourceId: "analytics-id-1",
      executionEvidencePresent: true,
      ...overrides,
    },
  });
}

function baseChain() {
  return [
    artifact("writer_report", { payload: { contentId: "content-1-document", title: "Growth Content" } }),
    artifact("video_report", { payload: { status: "completed", executionEvidencePresent: true, videoId: "video-1" } }),
    artifact("qa_report", { payload: { status: "passed" } }),
    artifact("brand_report", { payload: { status: "approved" } }),
    artifact("published_report", { payload: { status: "completed", executionEvidencePresent: true, publicationId: "pub-0001", sourceVideoId: "video-1" } }),
  ];
}

const validInput = (analytics = analyticsReport()) => ({
  requestId: "req-growth-1",
  objective: "Recommend growth actions for the published content",
  validatedArtifacts: [...baseChain(), analytics],
});

const cancelToken = { isCancellationRequested: false, throwIfCancelled: () => {} };

async function run(input, depsOverrides = {}) {
  const agent = createGrowthAgent({ config, ...depsOverrides });
  return agent.execute({ input, context: {} }, cancelToken);
}

describe("GrowthAgent", () => {
  it("1 — valid analytics produces a completed growth report", async () => {
    const result = await run(validInput());
    const output = result.output;
    strictEqual(output.status, "completed");
    strictEqual(output.recommendationId, "req-growth-1");
    strictEqual(output.objective, "Recommend growth actions for the published content");
    strictEqual(output.contentId, "content-1");
    strictEqual(typeof output.confidence, "number");
    ok(output.priorities.length > 0);
  });

  it("2 — missing analytics is blocked", async () => {
    const result = await run({ requestId: "req-growth-2", objective: "o", validatedArtifacts: baseChain() });
    const output = result.output;
    strictEqual(output.status, "blocked");
    strictEqual(output.priorities.length, 0);
    strictEqual(output.confidence, 0);
  });

  it("3 — malformed analytics (empty metrics) is blocked", async () => {
    const malformed = artifact("analytics_report", { payload: { status: "completed", executionEvidencePresent: true, metrics: {} } });
    const result = await run(validInput(malformed));
    strictEqual(result.output.status, "blocked");
  });

  it("4 — metric traceability: every recommendation references only supplied metrics", async () => {
    const supplied = { completionRate: 0.6, clickThroughRate: 0.02, likes: 800 };
    const analytics = artifact("analytics_report", { payload: { status: "completed", executionEvidencePresent: true, metrics: supplied } });
    const result = await run(validInput(analytics));
    const output = result.output;
    const suppliedKeys = Object.keys(supplied);
    for (const rec of output.recommendations) {
      ok(Array.isArray(rec.basedOn) && rec.basedOn.length > 0, "recommendation must trace to at least one metric");
      ok(rec.basedOn.every((key) => suppliedKeys.includes(key)), `references non-supplied metric: ${rec.basedOn}`);
    }
    ok(output.recommendations.some((r) => r.basedOn.includes("completionRate")));
    ok(output.recommendations.some((r) => r.basedOn.includes("likes")));
  });

  it("5 — recommendation provenance: recommendations trace to the analytics artifact", async () => {
    const result = await run(validInput());
    const output = result.output;
    const refs = output.sourceArtifactReferences.filter((r) => r.kind === "analytics_report");
    ok(refs.length > 0, "analytics artifact must be referenced");
    strictEqual(output.metadata.analyticsReportId, refs[0].artifactId);
  });

  it("6 — workflow/correlation preservation", async () => {
    const result = await run(validInput());
    const output = result.output;
    strictEqual(output.metadata.workflowId, "workflow-1");
    strictEqual(output.metadata.correlationId, "correlation-1");
  });

  it("7 — lineage: upstream artifacts are referenced as sources", async () => {
    const result = await run(validInput());
    const kinds = result.output.sourceArtifactReferences.map((r) => r.kind);
    ok(kinds.includes("analytics_report"));
    ok(kinds.includes("published_report"));
    ok(kinds.includes("writer_report"));
  });

  it("10 — failure propagation: failed analytics blocks growth", async () => {
    const failed = artifact("analytics_report", { payload: { status: "failed", executionEvidencePresent: false, metrics: {} } });
    const result = await run(validInput(failed));
    strictEqual(result.output.status, "blocked");
  });

  it("11 — agent isolation: no capability execution / no provider", async () => {
    let executed = false;
    const spyBoundary = { executeCapability: async () => { executed = true; return { status: "blocked" }; } };
    const result = await run(validInput(), { capabilityExecution: spyBoundary });
    strictEqual(result.output.status, "completed");
    strictEqual(executed, false, "growth agent must not invoke any capability");
  });

  it("12 — no unsafe casts: output round-trips through plain JSON", async () => {
    const result = await run(validInput());
    const round = JSON.parse(JSON.stringify(result.output));
    strictEqual(typeof round.confidence, "number");
    strictEqual(Array.isArray(round.winningPatterns), true);
    strictEqual(Array.isArray(round.recommendations), true);
    strictEqual(Array.isArray(round.experiments), true);
    strictEqual(typeof round.recommendationId, "string");
  });
});