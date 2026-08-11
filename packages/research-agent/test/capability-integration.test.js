/** ResearchAgent + real web search capability through the Runtime boundary. */
import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createResearchAgent } from "../dist/index.js";

const task = {
  id: "research-cap-1",
  name: "Research media pipeline",
  description: "Research modern media pipelines",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

function report() {
  return {
    reportId: "00000000-0000-4000-8000-000000000001",
    taskDescription: task.description,
    summary: "Researched media pipelines using a web search.",
    sources: [{ id: 1, title: "Example", url: "https://example.com", snippet: "snippet" }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "text" }],
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

function buildBoundary() {
  const fakeProvider = {
    search: async (request) => ({
      providerId: "fake-provider",
      results: [{ title: "Media Pipeline", url: "https://example.com/pipeline", snippet: "A modern media pipeline", source: "example", rank: 1 }],
    }),
  };
  const descriptor = { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
  const resolver = { resolve: (id) => (id === WEB_SEARCH_CAPABILITY_ID ? descriptor : null), isAuthorized: () => true };
  const webSearchExecutor = new WebSearchCapabilityExecutor(fakeProvider, resolver, { maxResults: 5, maxQueryLength: 200 });
  const boundary = new RuntimeCapabilityExecutor({ resolver, executor: { execute: (r) => webSearchExecutor.execute(r) } });
  return boundary;
}

describe("ResearchAgent capability integration", () => {
  it("executes a real web search through the Runtime boundary and embeds real evidence", async () => {
    const boundary = buildBoundary();
    const agent = createResearchAgent({
      config: {},
      execute: async () => ({ output: report(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
      capabilityExecution: boundary,
    });
    const result = await agent.execute({
      context: {},
      input: {
        task,
        capabilityRequests: [
          { requestId: "cap-1", capabilityId: WEB_SEARCH_CAPABILITY_ID, agentId: "research", workflowId: "workflow-1", correlationId: "correlation-1", input: { query: "media pipeline", maxResults: 3 }, requestedAt: "2026-08-11T00:00:00.000Z" },
        ],
      },
    }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} });

    const executions = result.output.capabilityExecutions;
    strictEqual(executions.length, 1);
    strictEqual(executions[0].status, "success");
    strictEqual(executions[0].evidence.capabilityId, WEB_SEARCH_CAPABILITY_ID);
    strictEqual(executions[0].evidence.providerId, "fake-provider");
    strictEqual(executions[0].evidence.providerInvoked, true);
    strictEqual(executions[0].evidence.agentId, "research");
    strictEqual(executions[0].evidence.workflowId, "workflow-1");
    strictEqual(executions[0].evidence.correlationId, "correlation-1");
    strictEqual(executions[0].evidence.succeeded, true);
    strictEqual(executions[0].output.results.length, 1);
    strictEqual(result.output.taskDescription, task.description);
    ok(Array.isArray(result.output.sources));
  });

  it("embeds no capability executions when none are requested", async () => {
    const boundary = buildBoundary();
    const agent = createResearchAgent({
      config: {},
      execute: async () => ({ output: report(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
      capabilityExecution: boundary,
    });
    const result = await agent.execute({ context: {}, input: { task } }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} });
    strictEqual(result.output.capabilityExecutions, undefined);
  });
});
