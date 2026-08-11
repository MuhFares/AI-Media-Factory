import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { describe, it } from "node:test";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { ArtifactProducingExecutor, Orchestrator } from "../dist/index.js";

const WORKSCOPE = { workflowId: "workflow-orch", correlationId: "corr-orch", brandId: null, outputs: {}, data: { objective: "Improve the media pipeline" } };

const researchTask = { id: "research-task-1", name: "Research media pipeline", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() {
  return {
    planId: "00000000-0000-4000-8000-0000000000P1",
    objective: "Improve the media pipeline",
    tasks: [{ id: "t1", name: "Research", description: researchTask.description, agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [], estimatedCostUsd: 1, estimatedDurationSeconds: 10, parallelizable: false }],
    estimatedTotalCostUsd: 1,
    estimatedTotalDurationSeconds: 10,
    hasParallelism: false,
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] },
  };
}

function researchReportJson() {
  return {
    reportId: "00000000-0000-4000-8000-0000000000R1",
    taskDescription: researchTask.description,
    summary: "Researched media pipelines via a real web search.",
    sources: [{ id: 1, title: "Example", url: "https://example.com", snippet: "snippet" }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "text" }],
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

const METADATA = {
  planner: { id: "planner", name: "Planner", version: "1.0.0", description: "planner", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  research: { id: "research", name: "Research", version: "1.0.0", description: "research", capabilities: ["web-search"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  coding: { id: "coding", name: "Coding", version: "1.0.0", description: "coding", capabilities: ["file-operations"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  reviewer: { id: "reviewer", name: "Reviewer", version: "1.0.0", description: "reviewer", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
};

function webSearchBoundary(authorized) {
  const descriptor = { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
  const localResolver = { resolve: (id) => (id === WEB_SEARCH_CAPABILITY_ID ? descriptor : null), isAuthorized: () => authorized };
  const webExecutor = new WebSearchCapabilityExecutor(
    { search: async () => ({ providerId: "fake-provider", results: [{ title: "Media Pipeline", url: "https://example.com/pipeline", snippet: "A modern media pipeline", source: "example", rank: 1 }] }) },
    localResolver,
    { maxResults: 5, maxQueryLength: 200 },
  );
  const executor = { execute: (request) => (request.capabilityId === WEB_SEARCH_CAPABILITY_ID ? webExecutor.execute(request) : { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" }) };
  return new RuntimeCapabilityExecutor({ resolver: localResolver, executor });
}

const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

/**
 * Builds a real DefaultAgentRegistry with real planner/research/coding/reviewer
 * instances and wires the full Step 8.11 path:
 * Orchestrator → ArtifactProducingExecutor → RuntimeAgentExecutor
 * → RegistryAgentResolver → DefaultAgentRegistry → real agent → RuntimeCapabilityExecutor.
 */
function buildHarness(options = {}) {
  const { agents = ["planner", "research", "coding", "reviewer"], webAuthorized = true, researchThrows = false } = options;
  const counts = { planner: 0, research: 0, coding: 0, reviewer: 0 };
  const registry = new DefaultAgentRegistry();

  const boundary = webSearchBoundary(webAuthorized);
  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({
    config: {},
    execute: researchThrows
      ? async () => { throw new Error("research runtime failure"); }
      : async () => ({ output: researchReportJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
    capabilityExecution: boundary,
  });

  const adapt = {
    planner: (input, context) => plannerAgent.execute({ context, input }, SIGNAL),
    research: (input, context) => researchAgent.execute({ context, input }, SIGNAL),
    coding: async () => { counts.coding += 1; throw new Error("coding must not run in this flow"); },
    reviewer: async () => { counts.reviewer += 1; throw new Error("reviewer must not run in this flow"); },
  };

  for (const id of agents) {
    void registry.register({
      metadata: METADATA[id],
      configSchema: { type: "object", properties: {} },
      defaultConfig: {},
      state: "REGISTERED",
      factory: async (config) => {
        const agent = adapt[id];
        return {
          id,
          metadata: config.metadata,
          config,
          initialize: async () => {},
          execute: async (input, context) => {
            counts[id] += 1;
            const result = await agent(input, context);
            return result.output;
          },
          health: async () => ({ healthy: true, lastCheck: "2026-08-11T00:00:00.000Z" }),
          dispose: async () => {},
        };
      },
    });
  }

  const runtimeExecutor = new RuntimeAgentExecutor(new RegistryAgentResolver(registry));
  const executor = new ArtifactProducingExecutor({
    runtimeExecutor,
    prepareInput: (step, context) => {
      if (step.agent === "planner") return { objective: "Improve the media pipeline" };
      if (step.agent === "research") {
        return {
          task: researchTask,
          capabilityRequests: [{ requestId: "cap-research", capabilityId: WEB_SEARCH_CAPABILITY_ID, agentId: "research", workflowId: context.workflowId, correlationId: context.correlationId, input: { query: "media pipeline", maxResults: 3 }, requestedAt: "2026-08-11T00:00:00.000Z" }],
        };
      }
      return {};
    },
    artifactFor: (step, context, output) => {
      if (step.agent === "planner") return { kind: "execution_plan", artifactId: String(output.planId) };
      if (step.agent === "research") return { kind: "research_report", artifactId: String(output.reportId) };
      if (step.agent === "coding") return { kind: "coding_report", artifactId: String(output.resultId) };
      return { kind: "review_report", artifactId: String(output.reportId) };
    },
    hasFatalCapability: (output) => Array.isArray(output.capabilityExecutions) && output.capabilityExecutions.some((entry) => entry.status !== "success"),
  });

  const orchestrator = new Orchestrator({ executor });
  return { orchestrator, counts, registry };
}

describe("Step 8.11 — Orchestrator runtime integration (real agents + runtime boundary)", () => {
  it("A/B/C/D — executes a real multi-agent workflow through registry → RuntimeAgentExecutor", async () => {
    const { orchestrator, counts } = buildHarness({ agents: ["planner", "research"] });
    const result = await orchestrator.produce("research", WORKSCOPE);
    strictEqual(result.status, "completed");
    strictEqual(result.lineage.length, 2);
    strictEqual(result.lineage[0].kind, "execution_plan");
    strictEqual(result.lineage[1].kind, "research_report");
    strictEqual(counts.planner, 1);
    strictEqual(counts.research, 1);
  });

  it("F/N — real execution evidence reaches the artifact payload (nothing fabricated)", async () => {
    const { orchestrator } = buildHarness({ agents: ["planner", "research"] });
    const result = await orchestrator.produce("research", WORKSCOPE);
    const research = result.lineage[1];
    ok(research.payload.capabilityExecutions.length === 1);
    strictEqual(research.payload.capabilityExecutions[0].status, "success");
    const evidence = research.payload.capabilityExecutions[0].evidence;
    strictEqual(evidence.agentId, "research");
    strictEqual(evidence.workflowId, WORKSCOPE.workflowId);
    strictEqual(evidence.correlationId, WORKSCOPE.correlationId);
    strictEqual(evidence.succeeded, true);
    ok(typeof evidence.evidenceId === "string" && evidence.evidenceId.length > 0);
  });

  it("G — artifact lineage is preserved across multiple stages", async () => {
    const { orchestrator } = buildHarness({ agents: ["planner", "research"] });
    const result = await orchestrator.produce("research", WORKSCOPE);
    strictEqual(result.lineage[1].parentArtifact.artifactId, result.lineage[0].artifactId);
    strictEqual(result.lineage[1].parentArtifact.kind, "execution_plan");
    strictEqual(result.lineage[0].parentArtifact, undefined);
  });

  it("H — workflowId/correlationId remain identical across the full flow", async () => {
    const { orchestrator } = buildHarness({ agents: ["planner", "research"] });
    const result = await orchestrator.produce("research", WORKSCOPE);
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKSCOPE.workflowId);
      strictEqual(item.correlationId, WORKSCOPE.correlationId);
    }
    const research = result.lineage[1];
    strictEqual(research.payload.capabilityExecutions[0].evidence.correlationId, WORKSCOPE.correlationId);
  });

  it("I — unknown agent fails safely and explicitly", async () => {
    const { orchestrator, counts } = buildHarness({ agents: ["planner"] });
    const result = await orchestrator.produce("research", WORKSCOPE);
    strictEqual(result.status, "failed");
    ok(result.error.message.includes("Agent not found"));
    strictEqual(counts.planner, 1);
    strictEqual(counts.research, 0);
  });

  it("J — agent execution failure stops downstream stages", async () => {
    const { orchestrator, counts } = buildHarness({ agents: ["planner", "research", "coding", "reviewer"], researchThrows: true });
    const result = await orchestrator.produce("implement", WORKSCOPE);
    strictEqual(result.status, "failed");
    ok(result.error.message.includes("research runtime failure"));
    strictEqual(counts.planner, 1);
    strictEqual(counts.research, 1);
    strictEqual(counts.coding, 0);
    strictEqual(counts.reviewer, 0);
    strictEqual(result.lineage.length, 1);
  });

  it("K — capability BLOCKED never becomes a successful downstream output", async () => {
    const { orchestrator, counts } = buildHarness({ agents: ["planner", "research", "coding", "reviewer"], webAuthorized: false });
    const result = await orchestrator.produce("implement", WORKSCOPE);
    strictEqual(result.status, "failed");
    ok(result.error.message.includes("blocked"));
    strictEqual(counts.planner, 1);
    strictEqual(counts.research, 1);
    strictEqual(counts.coding, 0);
    strictEqual(counts.reviewer, 0);
  });

  it("L/M — single execution, no duplicates, no infinite loop", async () => {
    const { orchestrator, counts } = buildHarness({ agents: ["planner", "research"] });
    const result = await orchestrator.produce("research", WORKSCOPE);
    strictEqual(result.status, "completed");
    strictEqual(counts.planner, 1);
    strictEqual(counts.research, 1);
    deepStrictEqual(result.lineage.map((item) => item.producerAgent), ["planner", "research"]);
  });
});