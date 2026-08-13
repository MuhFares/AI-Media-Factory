import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { AnalyticsCapabilityExecutor, ANALYTICS_CAPABILITY_ID, ANALYTICS_PLATFORM } from "../dist/index.js";

const descriptor = { capabilityId: ANALYTICS_CAPABILITY_ID, description: "Fetch analytics", inputSchema: { type: "object" }, outputSchema: { type: "object" } };

let requestNumber = 0;
function request(input, agentId = "analytics") {
  requestNumber += 1;
  return { requestId: `analytics-${requestNumber}`, capabilityId: ANALYTICS_CAPABILITY_ID, operation: "fetch", agentId, workflowId: "workflow-analytics", correlationId: "correlation-analytics", input, requestedAt: "2026-08-14T00:00:00.000Z" };
}

const baseInput = (overrides = {}) => ({ publicationId: "pub-0001", platform: ANALYTICS_PLATFORM, ...overrides });

const completed = (overrides = {}) => ({
  providerId: "fake-analytics",
  status: "completed",
  publicationId: "pub-0001",
  metrics: { views: 1200, likes: 80, comments: 5, watchTimeSeconds: 36000 },
  retrievedAt: "2026-08-14T03:00:00.000Z",
  ...overrides,
});

function setup(provider, authorized = true) {
  const calls = [];
  const resolver = {
    resolve: (capabilityId) => capabilityId === ANALYTICS_CAPABILITY_ID ? descriptor : null,
    isAuthorized: (agentId, capabilityId) => authorized && agentId === "analytics" && capabilityId === ANALYTICS_CAPABILITY_ID,
  };
  const wrappedProvider = {
    fetch: async (value) => { calls.push(value); return provider(value); },
  };
  return { calls, executor: new AnalyticsCapabilityExecutor(wrappedProvider, resolver, { maxPublicationIdLength: 500 }) };
}

describe("AnalyticsCapabilityExecutor", () => {
  it("fetches authorized analytics through the injected provider", async () => {
    const { executor, calls } = setup(async () => completed());
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "success");
    strictEqual(calls[0].publicationId, "pub-0001");
    strictEqual(calls[0].platform, ANALYTICS_PLATFORM);
    strictEqual(result.output.providerId, "fake-analytics");
    strictEqual(result.output.publicationId, "pub-0001");
    strictEqual(result.output.metrics.views, 1200);
  });

  it("unauthorized fetch is blocked", async () => {
    const { executor } = setup(async () => completed(), false);
    const result = await executor.execute(request(baseInput(), "other-agent"));
    strictEqual(result.status, "blocked");
  });

  it("provider failure is reported as failed with truthful evidence", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-analytics", status: "failed", error: { code: "UNAVAILABLE", message: "down" } }));
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "UNAVAILABLE");
    strictEqual(result.evidence.succeeded, false);
  });

  it("a blocked malformed request is not forwarded to the provider", async () => {
    const { executor, calls } = setup(async () => completed());
    const result = await executor.execute(request({ ...baseInput(), publicationId: "" }));
    strictEqual(result.status, "blocked");
    strictEqual(calls.length, 0);
  });

  it("produces truthful completion evidence with platform/provenance", async () => {
    const { executor } = setup(async () => completed());
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "success");
    const evidence = result.evidence;
    strictEqual(typeof evidence.evidenceId, "string");
    strictEqual(evidence.capabilityId, ANALYTICS_CAPABILITY_ID);
    strictEqual(evidence.operation, "fetch");
    strictEqual(evidence.platform, ANALYTICS_PLATFORM);
    strictEqual(evidence.agentId, "analytics");
    strictEqual(evidence.workflowId, "workflow-analytics");
    strictEqual(evidence.correlationId, "correlation-analytics");
    strictEqual(evidence.publicationId, "pub-0001");
    strictEqual(evidence.providerInvoked, true);
    strictEqual(evidence.succeeded, true);
  });

  it("only includes metrics the provider supports (no fabricated fields)", async () => {
    const { executor } = setup(async () => completed({ metrics: { views: 10, revenue: 3.5 } }));
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "success");
    strictEqual(Object.keys(result.output.metrics).length, 2);
    strictEqual(result.output.metrics.likes, undefined);
  });

  it("rejects a malformed provider response or missing publication as failed", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-analytics", status: "completed", publicationId: "" }));
    const missing = await executor.execute(request(baseInput()));
    strictEqual(missing.status, "failed");

    const { executor: e2 } = setup(async () => ({ providerId: "fake-analytics", status: "completed", publicationId: "pub", metrics: [1, 2] }));
    const badMetrics = await e2.execute(request(baseInput()));
    strictEqual(badMetrics.status, "failed");
  });
});