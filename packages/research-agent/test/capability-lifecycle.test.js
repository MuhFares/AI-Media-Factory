/** Provider-free research capability-lifecycle diagnostics. No network, no DB. */
import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  createResearchAgent,
  classifyResearchCapabilityError,
} from "../dist/index.js";
import {
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
  createCapabilityRegistry,
} from "@ai-media-factory/tool-framework";

const task = {
  id: "research-research",
  name: "Research",
  description: "Production research for probe factual candidates with Morroway research context.",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

const contract = { taskId: "research-research", stage: "research" };

function planOutput() {
  return {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe research for Morroway factual candidates.",
    summary: "Probe plan awaiting retrieval.",
    sources: [],
    confidence: 0.1,
    citations: [],
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function agentFor(output, capabilityExecution) {
  return createResearchAgent({
    config: {},
    execute: async () => ({ output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
    ...(capabilityExecution === undefined ? {} : { capabilityExecution }),
  });
}

const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };
const capabilityRequests = [{ requestId: "cap-1", capabilityId: WEB_SEARCH_CAPABILITY_ID, agentId: "research", workflowId: "wf-1", correlationId: "corr-1", input: { query: "probe", maxResults: 1 }, requestedAt: "2026-09-25T00:00:00.000Z" }];

describe("research capability lifecycle diagnostics", () => {
  it("declared capability with no boundary yields BLOCKED/MISSING_PROVIDER_BOUNDARY, never silent []", async () => {
    const agent = agentFor(planOutput());
    const result = await agent.execute({ context: {}, input: { task, contract, capabilityRequests } }, signal);
    strictEqual(result.output.capabilityExecutions.length, 1);
    strictEqual(result.output.capabilityExecutions[0].status, "blocked");
    strictEqual(result.output.capabilityExecutions[0].reasonCode, "MISSING_PROVIDER_BOUNDARY");
    strictEqual(result.output.capabilityExecutions[0].lifecycle.at(-1), "BLOCKED");
  });

  it("unregistered capability fails deterministically with CAPABILITY_NOT_REGISTERED", async () => {
    const agent = agentFor(planOutput(), { executeCapability: async () => { throw new Error("Capability web.search is not registered"); } });
    const result = await agent.execute({ context: {}, input: { task, contract, capabilityRequests } }, signal);
    strictEqual(result.output.capabilityExecutions.length, 1);
    strictEqual(result.output.capabilityExecutions[0].status, "failed");
    strictEqual(result.output.capabilityExecutions[0].reasonCode, "CAPABILITY_NOT_REGISTERED");
    strictEqual(result.output.capabilityExecutions[0].lifecycle.at(-1), "FAILED");
  });

  it("unauthorized capability is BLOCKED through the real registry and executor", async () => {
    const registry = createCapabilityRegistry({
      capabilities: [{ capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } }],
      grants: [],
    });
    const searchExecutor = new WebSearchCapabilityExecutor({ search: async () => { throw new Error("must not be called"); } }, registry, { maxResults: 5, maxQueryLength: 200 });
    const agent = agentFor(planOutput(), { executeCapability: (request) => searchExecutor.execute(request) });
    const result = await agent.execute({ context: {}, input: { task, contract, capabilityRequests } }, signal);
    strictEqual(result.output.capabilityExecutions.length, 1);
    strictEqual(result.output.capabilityExecutions[0].status, "blocked");
    strictEqual(result.output.capabilityExecutions[0].lifecycle.at(-1), "BLOCKED");
  });

  it("transport failure is persisted as FAILED/CAPABILITY_TRANSPORT_FAILED, never silent", async () => {
    const agent = agentFor(planOutput(), { executeCapability: async () => { throw new TypeError("fetch failed: EACCES"); } });
    const result = await agent.execute({ context: {}, input: { task, contract, capabilityRequests } }, signal);
    strictEqual(result.output.capabilityExecutions.length, 1);
    strictEqual(result.output.capabilityExecutions[0].status, "failed");
    strictEqual(result.output.capabilityExecutions[0].reasonCode, "CAPABILITY_TRANSPORT_FAILED");
    strictEqual(classifyResearchCapabilityError(new TypeError("fetch failed")), "CAPABILITY_TRANSPORT_FAILED");
    strictEqual(classifyResearchCapabilityError(new Error("nope")), "CAPABILITY_EXECUTION_FAILED");
  });
});
