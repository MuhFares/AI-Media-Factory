import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { ANALYTICS_CAPABILITY_ID, ANALYTICS_PLATFORM } from "@ai-media-factory/tool-framework";
import { createAnalyticsAgent } from "../dist/index.js";

const config = { model: "openrouter/auto", platform: ANALYTICS_PLATFORM, systemPrompt: "test" };

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

function chain(overrides = {}) {
  return [
    artifact("writer_report", { payload: { contentId: "content-1", title: "Analytics Content" } }),
    artifact("video_report", { payload: { status: "completed", executionEvidencePresent: true, videoId: "video-1" } }),
    artifact("qa_report", { payload: { status: "passed" } }),
    artifact("brand_report", { payload: { status: "approved" } }),
    artifact("published_report", {
      payload: {
        status: "completed",
        executionEvidencePresent: true,
        publicationId: "youtube-id-1",
        platform: ANALYTICS_PLATFORM,
        publishedUrl: "https://youtube.com/watch?v=youtube-id-1",
        sourceVideoId: "video-1",
      },
    }),
  ];
}

const validInput = () => ({ requestId: "req-analytics-1", objective: "Fetch performance for the published content", validatedArtifacts: chain() });

const successExecution = {
  requestId: "analytics-req-1",
  capabilityId: ANALYTICS_CAPABILITY_ID,
  operation: "fetch",
  agentId: "analytics",
  workflowId: "workflow-1",
  correlationId: "correlation-1",
  status: "success",
  input: { publicationId: "youtube-id-1", platform: ANALYTICS_PLATFORM },
  output: { providerId: "fake-analytics", publicationId: "youtube-id-1", metrics: { views: 1200, watchTimeSeconds: 36000 }, retrievedAt: "2026-08-14T03:00:00.000Z" },
  evidence: {
    evidenceId: "ev-analytics-1",
    capabilityId: ANALYTICS_CAPABILITY_ID,
    operation: "fetch",
    platform: ANALYTICS_PLATFORM,
    agentId: "analytics",
    workflowId: "workflow-1",
    correlationId: "correlation-1",
    providerInvoked: true,
    succeeded: true,
    createdAt: "2026-08-14T03:00:00.000Z",
    input: { publicationId: "youtube-id-1", platform: ANALYTICS_PLATFORM },
    output: { providerId: "fake-analytics", metrics: { views: 1200 } },
  },
};

function makeDeps(resolveExecution) {
  return { config, capabilityExecution: { executeCapability: async () => resolveExecution } };
}

const cancelToken = { isCancellationRequested: false, throwIfCancelled: () => {} };

async function run(execution) {
  const deps = makeDeps(execution);
  const agent = createAnalyticsAgent(deps);
  return agent.execute({ input: validInput(), context: {} }, cancelToken);
}

describe("AnalyticsAgent", () => {
  it("produces a completed performance report from matching runtime evidence", async () => {
    const result = await run(successExecution);
    const output = result.output;
    strictEqual(output.status, "completed");
    strictEqual(output.publicationId, "youtube-id-1");
    strictEqual(output.contentId, "content-1");
    strictEqual(output.platform, ANALYTICS_PLATFORM);
    strictEqual(output.executionEvidencePresent, true);
    strictEqual(output.metrics.views, 1200);
    strictEqual(output.reportId, "req-analytics-1");
  });

  it("blocks when the published report lacks matching evidence", async () => {
    const chainMissingEvidence = chain().map((a) => a.kind === "published_report"
      ? { ...a, payload: { ...a.payload, executionEvidencePresent: false } }
      : a);
    const agent = createAnalyticsAgent(makeDeps(successExecution));
    const result = await agent.execute({ input: { ...validInput(), validatedArtifacts: chainMissingEvidence }, context: {} }, cancelToken);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
  });

  it("blocks when the brand gate has not approved", async () => {
    const chainNotApproved = chain().map((a) => a.kind === "brand_report" ? { ...a, payload: { status: "rejected" } } : a);
    const agent = createAnalyticsAgent(makeDeps(successExecution));
    const result = await agent.execute({ input: { ...validInput(), validatedArtifacts: chainNotApproved }, context: {} }, cancelToken);
    strictEqual(result.output.status, "blocked");
  });

  it("blocks when a capability fails and reports a truthful reason", async () => {
    const agent = createAnalyticsAgent(makeDeps({ ...successExecution, status: "failed", error: { code: "UNAVAILABLE", message: "provider down", retryable: true } }));
    const result = await agent.execute({ input: validInput(), context: {} }, cancelToken);
    strictEqual(result.output.status, "blocked");
    ok(result.output.summary.includes("provider down"));
  });

  it("blocks malformed input instead of throwing", async () => {
    const agent = createAnalyticsAgent(makeDeps(successExecution));
    agent.execute({ input: { requestId: "req", objective: "" }, context: {} }, cancelToken)
      .then(() => { throw new Error("should throw"); }, (err) => ok(err instanceof Error));
  });
});
