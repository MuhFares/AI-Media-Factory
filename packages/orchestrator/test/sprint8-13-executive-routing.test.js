import { strictEqual, deepStrictEqual, ok, throws, rejects } from "node:assert";
import { describe, it } from "node:test";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { CEOAgent, executiveContext, produceExecutive } from "@ai-media-factory/ceo-agent";
import { ArtifactProducingExecutor, Orchestrator } from "../dist/index.js";

/**
 * Step 8.13 — ExecutiveDirective is the source of truth for workflow selection.
 *
 * Full dynamic path exercised end-to-end:
 * CEOAgent.decide (ExecutiveDirective)
 *   → produceExecutive → Orchestrator.produce (routes workflowIntent → template)
 *   → CollaborationRunner → ArtifactProducingExecutor → RuntimeAgentExecutor
 *   → RegistryAgentResolver → DefaultAgentRegistry → existing agents
 *   → CapabilityExecutionPort → RuntimeCapabilityExecutor → capability
 */

const ALL = ["planner", "research", "coding", "reviewer", "qa", "documentation"];

const ROUTING = {
  research: ["planner", "research"],
  implement: ["planner", "research", "coding", "reviewer"],
  verify: ["planner", "research", "coding", "reviewer", "qa"],
  ship: ["planner", "research", "coding", "reviewer", "qa", "documentation"],
};

const WORKSCOPE = { workflowId: "workflow-8-13", correlationId: "corr-8-13", brandId: null, outputs: {}, data: { avg: 1 } };

const researchTask = {
  id: "research-task-8-13",
  name: "Research media pipeline",
  description: "Research modern media pipelines",
  agent: "research",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  dependencies: [],
};

function planJson() {
  return {
    planId: "00000000-0000-4000-8000-0000000000P1",
    objective: "Improve the media pipeline",
    tasks: [
      { id: "t1", name: "Research", description: researchTask.description, agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [], estimatedCostUsd: 1, estimatedDurationSeconds: 10, parallelizable: false },
    ],
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
  qa: { id: "qa", name: "QA", version: "1.0.0", description: "qa", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  documentation: { id: "documentation", name: "Documentation", version: "1.0.0", description: "documentation", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
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
 * Build the real runtime stack for all six existing agent ids. planner/research
 * are the real packages; the remaining ids are generic successful steps (same
 * pattern as the Step 8.11 harness). `fail` selects an id whose step throws so
 * downstream production can be proven to stop.
 */
function buildHarness({ agents = ALL, fail = null } = {}) {
  const counts = { planner: 0, research: 0, coding: 0, reviewer: 0, qa: 0, documentation: 0 };
  const registry = new DefaultAgentRegistry();
  const boundary = webSearchBoundary(true);

  const plannerAgent = createPlannerAgent({
    config: {},
    execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
  });
  const researchAgent = createResearchAgent({
    config: {},
    execute: async () => ({ output: researchReportJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
    capabilityExecution: boundary,
  });

  const adapt = {
    planner: (input, context) => plannerAgent.execute({ context, input }, SIGNAL),
    research: (input, context) => researchAgent.execute({ context, input }, SIGNAL),
    coding: async (input, context) => {
      const previous = input.previousArtifact;
      return { output: { resultId: "coding-8-13", signedOff: true, evidenceHandoff: previous !== undefined && previous.payload ? previous.payload.capabilityExecutions : [] } };
    },
    reviewer: async () => ({ output: { reportId: "review-8-13", verdict: "approved" } }),
    qa: async () => ({ output: { reportId: "qa-8-13", result: "passed" } }),
    documentation: async () => ({ output: { reportId: "doc-8-13", guide: "done" } }),
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
            if (fail === id) throw new Error(`${id} step failure`);
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
          capabilityRequests: [
            { requestId: "cap-research-8-13", capabilityId: WEB_SEARCH_CAPABILITY_ID, agentId: "research", workflowId: context.workflowId, correlationId: context.correlationId, input: { query: "media pipeline", maxResults: 3 }, requestedAt: "2026-08-11T00:00:00.000Z" },
          ],
        };
      }
      return {};
    },
    artifactFor: (step, context, output) => {
      switch (step.agent) {
        case "planner": return { kind: "execution_plan", artifactId: String(output.planId) };
        case "research": return { kind: "research_report", artifactId: String(output.reportId) };
        case "coding": return { kind: "coding_report", artifactId: String(output.resultId) };
        case "reviewer": return { kind: "review_report", artifactId: String(output.reportId) };
        case "qa": return { kind: "qa_report", artifactId: String(output.reportId) };
        default: return { kind: "documentation_report", artifactId: String(output.reportId) };
      }
    },
    hasFatalCapability: (output) => Array.isArray(output.capabilityExecutions) && output.capabilityExecutions.some((entry) => entry.status !== "success"),
  });

  const orchestrator = new Orchestrator({ executor });
  const ceo = new CEOAgent({ registry });
  return { orchestrator, ceo, counts, registry };
}

async function runIntent(orchestrator, ceo, intent) {
  const directive = ceo.decide({ objective: "Improve the media pipeline", intent, priority: "medium" });
  const target = { workflowId: WORKSCOPE.workflowId, correlationId: WORKSCOPE.correlationId, brandId: null, data: { avg: 1 } };
  const context = executiveContext(directive, target);
  return { directive, context, result: await produceExecutive(orchestrator, directive, context) };
}

describe("Sprint 8 Step 8.13 — ExecutiveDirective → dynamic orchestrator execution", () => {
  for (const intent of ["research", "implement", "verify", "ship"]) {
    it(`routes ${intent} → ${ROUTING[intent].join(" → ")} through real runtime agents`, async () => {
      const { orchestrator, ceo, counts } = buildHarness();
      const { result } = await runIntent(orchestrator, ceo, intent);
      strictEqual(result.status, "completed");
      deepStrictEqual(result.lineage.map((item) => item.producerAgent), ROUTING[intent]);
      for (const id of ROUTING[intent]) strictEqual(counts[id], 1);
    });
  }

  it("E — unknown directive executes zero agents (rejected before execution)", async () => {
    const { orchestrator, ceo, counts } = buildHarness();
    const directive = ceo.decide({ objective: "Improve the media pipeline", intent: "research", priority: "medium" });
    const context = executiveContext(directive, { workflowId: WORKSCOPE.workflowId, correlationId: WORKSCOPE.correlationId, brandId: null, data: {} });
    await rejects(() => orchestrator.produce("magic", context), /Unsupported directive/);
    for (const id of ALL) strictEqual(counts[id], 0);
  });

  it("F — unavailable agent executes zero agents (rejected at decision layer)", () => {
    const partial = new DefaultAgentRegistry();
    for (const id of ["planner", "research"]) {
      void partial.register({
        metadata: METADATA[id],
        configSchema: { type: "object", properties: {} },
        defaultConfig: {},
        state: "REGISTERED",
        factory: async () => ({ id, metadata: METADATA[id], config: {}, initialize: async () => {}, execute: async () => ({}), health: async () => ({ healthy: true }), dispose: async () => {} }),
      });
    }
    const restrictedCeo = new CEOAgent({ registry: partial });
    throws(() => restrictedCeo.decide({ objective: "Improve the media pipeline", intent: "implement", priority: "medium" }), /Unavailable agent: coding/);
  });

  it("F' — unavailable agent rejected by the Orchestrator before any stage runs", () => {
    const { orchestrator } = buildHarness({ agents: ["planner", "research"] });
    const partialLookup = { has: (id) => ["planner", "research"].includes(id) };
    const strictOrchestrator = new Orchestrator({ registry: partialLookup, executor: { executeAgentStep: async () => ({ status: "completed", output: {} }) } });
    throws(() => strictOrchestrator.plan("implement", WORKSCOPE), /Agent not registered: coding/);
  });

  it("G — a stage failure stops all downstream stages", async () => {
    const { orchestrator, ceo, counts } = buildHarness({ fail: "coding" });
    const { result } = await runIntent(orchestrator, ceo, "implement");
    strictEqual(result.status, "failed");
    ok(result.error.message.includes("coding step failure"));
    strictEqual(counts.planner, 1);
    strictEqual(counts.research, 1);
    strictEqual(counts.coding, 1);
    strictEqual(counts.reviewer, 0);
    strictEqual(result.lineage.length, 2);
  });

  it("H — workflowId/correlationId remain identical through execution", async () => {
    const { orchestrator, ceo } = buildHarness();
    const { result } = await runIntent(orchestrator, ceo, "ship");
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKSCOPE.workflowId);
      strictEqual(item.correlationId, WORKSCOPE.correlationId);
    }
  });

  it("I — artifact lineage remains valid across every stage", async () => {
    const { orchestrator, ceo } = buildHarness();
    const { result } = await runIntent(orchestrator, ceo, "ship");
    strictEqual(result.lineage.length, 6);
    strictEqual(result.lineage[0].parentArtifact, undefined);
    for (let i = 1; i < result.lineage.length; i += 1) {
      strictEqual(result.lineage[i].parentArtifact.artifactId, result.lineage[i - 1].artifactId);
      strictEqual(result.lineage[i].parentArtifact.kind, result.lineage[i - 1].kind);
    }
  });

  it("J — capability evidence reaches a downstream artifact through normal handoff", async () => {
    const { orchestrator, ceo } = buildHarness();
    const { result } = await runIntent(orchestrator, ceo, "implement");
    const research = result.lineage[1];
    ok(research.payload.capabilityExecutions.length === 1);
    strictEqual(research.payload.capabilityExecutions[0].status, "success");
    strictEqual(research.payload.capabilityExecutions[0].evidence.succeeded, true);
    const coding = result.lineage[2];
    strictEqual(coding.parentArtifact.artifactId, research.artifactId);
    ok(Array.isArray(coding.payload.evidenceHandoff) && coding.payload.evidenceHandoff.length === 1);
    strictEqual(coding.payload.evidenceHandoff[0].status, "success");
  });
});