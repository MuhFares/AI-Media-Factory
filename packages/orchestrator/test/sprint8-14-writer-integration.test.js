import { describe, it } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createReviewerAgent } from "@ai-media-factory/reviewer-agent";
import { createWriterAgent } from "@ai-media-factory/writer-agent";
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { ArtifactProducingExecutor } from "../dist/index.js";

/**
 * Sprint 8.14 — Writer (first production specialist) integrated through the
 * single execution path: CollaborationRunner → AgentExecutorPort →
 * RuntimeAgentExecutor → AgentRegistry → agents. Writer consumes the research
 * report via the normal previousArtifact handoff — no side channel.
 */

const WORKFLOW = { workflowId: "workflow-8-14", correlationId: "corr-8-14", brandId: null, outputs: {}, data: { avg: 1 } };

const plannerTask = {
  id: "planner-8-14",
  name: "Plan content",
  description: "Plan the content pipeline",
  agent: "planner",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  dependencies: [],
};

const researchTask = {
  id: "research-8-14",
  name: "Research media pipelines",
  description: "Research modern media pipelines",
  agent: "research",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  dependencies: [],
};

const writerTask = {
  id: "writer-8-14",
  name: "Write article",
  description: "Write the media pipeline article",
  agent: "writer",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  dependencies: [],
};

const reviewTask = {
  id: "review-8-14",
  name: "Review article",
  description: "Review the produced article",
  agent: "reviewer",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  dependencies: [],
};

function planJson() {
  return {
    planId: "00000000-0000-4000-8000-0000000000P1",
    objective: "Produce the media pipeline article",
    tasks: [researchTask],
    estimatedTotalCostUsd: 1,
    estimatedTotalDurationSeconds: 10,
    hasParallelism: false,
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] },
  };
}

function researchJson() {
  return {
    reportId: "00000000-0000-4000-8000-0000000000R1",
    taskDescription: researchTask.description,
    summary: "Modern media pipelines are event-driven and scalable.",
    sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "text" }],
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

function writerJson(researchArtifactId) {
  return {
    contentId: "00000000-0000-4000-8000-0000000000W1",
    taskDescription: writerTask.description,
    objective: "Write an article about media pipelines",
    title: "Modern Media Pipelines",
    content: "Event-driven pipelines enable scalable media production.",
    summary: "A grounded article based on the research report.",
    sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }],
    status: "completed",
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId },
  };
}

function reviewJson() {
  return {
    reportId: "00000000-0000-4000-8000-0000000000V1",
    taskDescription: reviewTask.description,
    summary: "The article is accurate and well-structured.",
    status: "approved",
    findings: [],
    recommendations: [],
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

const METADATA = {
  planner: { id: "planner", name: "Planner", version: "1.0.0", description: "planner", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  research: { id: "research", name: "Research", version: "1.0.0", description: "research", capabilities: ["web-search"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  writer: { id: "writer", name: "Writer", version: "1.0.0", description: "writer", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  reviewer: { id: "reviewer", name: "Reviewer", version: "1.0.0", description: "reviewer", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  qa: { id: "qa", name: "QA", version: "1.0.0", description: "qa", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
};

function webSearchBoundary() {
  const descriptor = { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
  const localResolver = { resolve: (id) => (id === WEB_SEARCH_CAPABILITY_ID ? descriptor : null), isAuthorized: () => true };
  const webExecutor = new WebSearchCapabilityExecutor(
    { search: async () => ({ providerId: "fake-provider", results: [{ title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet", source: "example", rank: 1 }] }) },
    localResolver,
    { maxResults: 5, maxQueryLength: 200 },
  );
  const executor = { execute: (request) => (request.capabilityId === WEB_SEARCH_CAPABILITY_ID ? webExecutor.execute(request) : { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" }) };
  return new RuntimeCapabilityExecutor({ resolver: localResolver, executor });
}

const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

function buildHarness() {
  const registry = new DefaultAgentRegistry();
  const boundary = webSearchBoundary();

  const plannerAgent = createPlannerAgent({
    config: {},
    execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
  });
  const researchAgent = createResearchAgent({
    config: {},
    execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
    capabilityExecution: boundary,
  });
  const reviewerAgent = createReviewerAgent({
    config: {},
    execute: async () => ({ output: reviewJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
  });

  const captured = { writerHandoff: null, reviewerHandoff: null, qaHandoff: null };

  function register(id, run, deps) {
    void registry.register({
      metadata: METADATA[id],
      configSchema: { type: "object", properties: {} },
      defaultConfig: {},
      state: "REGISTERED",
      factory: async (config) => ({
        id,
        metadata: config.metadata,
        config,
        initialize: async () => {},
        execute: async (wfInput, execCtx) => {
          const result = await run(wfInput, execCtx);
          const output = typeof result === "object" && result !== null && "output" in result ? result.output : result;
          return output;
        },
        health: async () => ({ healthy: true, lastCheck: "2026-08-11T00:00:00.000Z" }),
        dispose: async () => {},
      }),
    });
    return deps;
  }

  register("planner", async () => plannerAgent.execute({ context: {}, input: { task: plannerTask } }, SIGNAL));
  register("research", async () => researchAgent.execute({ context: {}, input: { task: researchTask, capabilityRequests: [] } }, SIGNAL));
  register("writer", async (wfInput, execCtx) => {
    captured.writerHandoff = wfInput;
    const agent = createWriterAgent({
      config: {},
      execute: async () => ({ output: writerJson(wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
    });
    return agent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("reviewer", async (wfInput, execCtx) => {
    captured.reviewerHandoff = wfInput;
    return reviewerAgent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("qa", async (wfInput) => {
    captured.qaHandoff = wfInput;
    return { output: { reportId: "qa-8-14", objective: "Validate the article", status: "passed", summary: "Valid", testResults: [], executionEvidencePresent: false } };
  });

  const runtimeExecutor = new RuntimeAgentExecutor(new RegistryAgentResolver(registry));
  const executor = new ArtifactProducingExecutor({
    runtimeExecutor,
    prepareInput: (step) => {
      switch (step.agent) {
        case "planner": return { task: plannerTask };
        case "research": return { task: researchTask, capabilityRequests: [] };
        case "writer": return { objective: "Write an article about media pipelines", task: writerTask };
        case "reviewer": return { requestId: "review-8-14", task: reviewTask };
        default: return {};
      }
    },
    artifactFor: (step, context, output) => {
      switch (step.agent) {
        case "planner": return { kind: "execution_plan", artifactId: String(output.planId) };
        case "research": return { kind: "research_report", artifactId: String(output.reportId) };
        case "writer": return { kind: "writer_report", artifactId: String(output.contentId) };
        case "reviewer": return { kind: "review_report", artifactId: String(output.reportId) };
        default: return { kind: "qa_report", artifactId: String(output.reportId) };
      }
    },
    hasFatalCapability: (output) => Array.isArray(output.capabilityExecutions) && output.capabilityExecutions.some((entry) => entry.status !== "success"),
  });

  function runContentChain(stages) {
    return new CollaborationRunner(executor).run(stages, WORKFLOW);
  }

  return { registry, captured, runContentChain };
}

const CONTENT_STAGES = [
  { step: { id: "planner", kind: "agent", agent: "planner", emits: "plan" }, artifactKind: "execution_plan" },
  { step: { id: "research", kind: "agent", agent: "research", emits: "research" }, artifactKind: "research_report" },
  { step: { id: "writer", kind: "agent", agent: "writer", emits: "writer" }, artifactKind: "writer_report" },
];

describe("Sprint 8.14 — Writer integration through the single execution path", () => {
  it("8 — Registry resolves the writer as a registrable agent", async () => {
    const { registry } = buildHarness();
    strictEqual(registry.has("writer"), true);
    const resolved = await registry.resolve("writer");
    strictEqual(resolved.id, "writer");
  });

  it("9/10 — Planner → Research → Writer runs through CollaborationRunner with correct lineage", async () => {
    const { runContentChain } = buildHarness();
    const result = await runContentChain(CONTENT_STAGES);
    strictEqual(result.status, "completed");
    deepStrictEqual(result.lineage.map((item) => item.producerAgent), ["planner", "research", "writer"]);
    const writer = result.lineage[2];
    strictEqual(writer.kind, "writer_report");
    strictEqual(writer.producerAgent, "writer");
    strictEqual(writer.parentArtifact.artifactId, result.lineage[1].artifactId);
    strictEqual(writer.parentArtifact.kind, "research_report");
    deepStrictEqual(writer.payload.sourceReferences, [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }]);
  });

  it("11 — Reviewer receives the Writer artifact through the normal handoff", async () => {
    const { runContentChain, captured } = buildHarness();
    const stages = [...CONTENT_STAGES, { step: { id: "reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" }];
    const result = await runContentChain(stages);
    strictEqual(result.status, "completed");
    const writer = result.lineage[2];
    strictEqual(captured.reviewerHandoff.previousArtifact.artifactId, writer.artifactId);
    strictEqual(captured.reviewerHandoff.previousArtifact.kind, "writer_report");
    strictEqual(result.lineage[3].parentArtifact.artifactId, writer.artifactId);
  });

  it("12 — QA receives the downstream Writer/Reviewer artifact through the normal handoff", async () => {
    const { runContentChain, captured } = buildHarness();
    const stages = [
      ...CONTENT_STAGES,
      { step: { id: "reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
      { step: { id: "qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
    ];
    const result = await runContentChain(stages);
    strictEqual(result.status, "completed");
    const reviewer = result.lineage[3];
    strictEqual(captured.qaHandoff.previousArtifact.artifactId, reviewer.artifactId);
    strictEqual(captured.qaHandoff.previousArtifact.kind, "review_report");
    strictEqual(result.lineage.length, 5);
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKFLOW.workflowId);
      strictEqual(item.correlationId, WORKFLOW.correlationId);
    }
  });

  it("H — workflowId/correlationId preserved and writer fabricates no capability evidence", async () => {
    const { runContentChain, captured } = buildHarness();
    const result = await runContentChain(CONTENT_STAGES);
    const writer = result.lineage[2];
    strictEqual(writer.workflowId, WORKFLOW.workflowId);
    strictEqual(writer.correlationId, WORKFLOW.correlationId);
    ok(!("capabilityExecutions" in writer.payload));
    ok(!("capabilityExecutions" in captured.writerHandoff) || captured.writerHandoff.capabilityExecutions === undefined);
  });
});