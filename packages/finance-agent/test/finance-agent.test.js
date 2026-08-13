import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { createFinanceAgent } from "../dist/index.js";

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
      metrics: { impressions: 5000, views: 1200, revenue: 1200, conversions: 40, ...metrics },
      source: "provider",
      sourceId: "analytics-id-1",
      executionEvidencePresent: true,
      ...overrides,
    },
  });
}

function growthReport() {
  return artifact("growth_report", {
    payload: {
      recommendationId: "growth-1",
      objective: "grow",
      contentId: "content-1",
      status: "completed",
      summary: "recommendations",
      winningPatterns: [],
      losingPatterns: [{ metric: "revenue", value: 1200, reason: "low" }],
      recommendations: [],
      experiments: [],
      priorities: [],
      confidence: 0.9,
      sourceArtifactReferences: [],
      metadata: {},
    },
  });
}

function baseChain(analytics = analyticsReport()) {
  return [
    artifact("writer_report", { payload: { contentId: "content-1-document", title: "Finance Content" } }),
    artifact("published_report", { payload: { status: "completed", executionEvidencePresent: true, publicationId: "pub-0001" } }),
    growthReport(),
    analytics,
  ];
}

const validInput = (analytics = analyticsReport(), financialData = { cost: 600, currency: "USD" }) => ({
  requestId: "req-fin-1",
  objective: "Analyze financial performance of the published content",
  validatedArtifacts: baseChain(analytics),
  financialData,
});

const cancelToken = { isCancellationRequested: false, throwIfCancelled: () => {} };

async function run(input, depsOverrides = {}) {
  const agent = createFinanceAgent({ config, ...depsOverrides });
  return agent.execute({ input, context: {} }, cancelToken);
}

describe("FinanceAgent", () => {
  it("1 — valid analytics + cost produces a completed financial report", async () => {
    const result = await run(validInput());
    const output = result.output;
    strictEqual(output.status, "completed");
    strictEqual(output.reportId, "req-fin-1");
    strictEqual(output.contentId, "content-1");
    strictEqual(output.revenue, 1200);
    strictEqual(output.cost, 600);
    strictEqual(output.profit, 600);
    strictEqual(output.margin, 0.5);
    strictEqual(output.currency, "USD");
  });

  it("2 — missing cost is blocked (explicit unavailable)", async () => {
    const result = await run(validInput(analyticsReport(), {}));
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.revenue, undefined);
    strictEqual(result.output.cost, undefined);
    ok(result.output.summary.includes("cost"));
  });

  it("3 — missing revenue (invalid metrics) is blocked", async () => {
    const analytics = artifact("analytics_report", { payload: { status: "completed", executionEvidencePresent: true, metrics: { impressions: 5000, views: 1200, conversions: 1 } } });
    const result = await run(validInput(analytics, { cost: 600 }));
    strictEqual(result.output.status, "blocked");
    ok(result.output.summary.includes("revenue"));
  });

  it("4 — ROI correctness", async () => {
    const result = await run(validInput(analyticsReport({}, { revenue: 1200 }), { cost: 600 }));
    const output = result.output;
    strictEqual(output.roi, 1);
    strictEqual(output.profit, 600);
    strictEqual(output.margin, 0.5);
  });

  it("5 — provenance: analytics/growth/financial-data sources are referenced", async () => {
    const result = await run(validInput());
    const kinds = result.output.sourceArtifactReferences.map((r) => r.kind);
    ok(kinds.includes("analytics_report"));
    ok(kinds.includes("growth_report"));
    strictEqual(result.output.metadata.analyticsReportId, result.output.sourceArtifactReferences.find((r) => r.kind === "analytics_report").artifactId);
  });

  it("6 — lineage/context: workflow id and correlation id preserved", async () => {
    const result = await run(validInput());
    strictEqual(result.output.metadata.workflowId, "workflow-1");
    strictEqual(result.output.metadata.correlationId, "correlation-1");
  });

  it("7 — CPA/CAC derived only when conversions are supplied", async () => {
    const withConversions = await run(validInput(analyticsReport({}, { revenue: 1200, conversions: 40 }), { cost: 600 }));
    strictEqual(withConversions.output.cpa, 15);
    strictEqual(withConversions.output.cpaType, "CPA");
    const withoutConversions = await run(validInput(artifact("analytics_report", { payload: { status: "completed", executionEvidencePresent: true, metrics: { revenue: 1200, impressions: 1, views: 1 } } }), { cost: 600 }));
    strictEqual(withoutConversions.output.cpa, undefined);
  });

  it("10 — no fabricated numbers: every value derives from supplied data", async () => {
    const result = await run(validInput(analyticsReport({}, { revenue: 250, conversions: 5 }), { cost: 100 }));
    const output = result.output;
    strictEqual(output.revenue, 250);
    strictEqual(output.cost, 100);
    strictEqual(output.profit, 150);
    strictEqual(output.roi, 1.5);
    strictEqual(output.cpa, 20);
  });

  it("11 — isolation: no capability execution, no provider, no boundary", async () => {
    let executed = false;
    const spyBoundary = { executeCapability: async () => { executed = true; return { status: "blocked" }; } };
    const result = await run(validInput(), { capabilityExecution: spyBoundary });
    strictEqual(result.output.status, "completed");
    strictEqual(executed, false, "finance agent must not invoke any capability");
  });

  it("12 — no unsafe casts: output round-trips through plain JSON", async () => {
    const result = await run(validInput());
    const round = JSON.parse(JSON.stringify(result.output));
    strictEqual(typeof round.revenue, "number");
    strictEqual(typeof round.roi, "number");
    strictEqual(Array.isArray(round.sourceArtifactReferences), true);
    strictEqual(typeof round.confidence, "number");
  });

  it("8 — finance uses spend alias and campaign id context", async () => {
    const result = await run(validInput(analyticsReport({}, { revenue: 1000 }), { spend: 200, campaignId: "camp-9", currency: "EUR" }));
    const output = result.output;
    strictEqual(output.cost, 200);
    strictEqual(output.campaignId, "camp-9");
    strictEqual(output.currency, "EUR");
    strictEqual(output.profit, 800);
  });

  it("9 — failure propagation: failed analytics blocks finance", async () => {
    const failed = artifact("analytics_report", { status: "failed", payload: { status: "failed", executionEvidencePresent: false, metrics: {} } });
    const result = await run(validInput(failed, { cost: 600 }));
    strictEqual(result.output.status, "blocked");
  });
});