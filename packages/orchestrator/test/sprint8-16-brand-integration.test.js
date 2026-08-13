import { describe, it } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createWriterAgent } from "@ai-media-factory/writer-agent";
import { createSEOAgent } from "@ai-media-factory/seo-agent";
import { createBrandAgent } from "@ai-media-factory/brand-agent";
import { createReviewerAgent } from "@ai-media-factory/reviewer-agent";
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { ArtifactProducingExecutor } from "../dist/index.js";

/**
 * Sprint 8.16 — Brand Gate (production quality gate) integrated through the
 * single execution path. Brand consumes the SEO artifact (and its writer
 * lineage) via the normal previousArtifact handoff — no side channel. The
 * content flow is Research → Writer → SEO → Brand (→ Reviewer / QA).
 */

const WORKFLOW = { workflowId: "workflow-8-16", correlationId: "corr-8-16", brandId: null, outputs: {}, data: { avg: 1 } };

const plannerTask = { id: "planner-8-16", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-8-16", name: "Research media pipelines", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const writerTask = { id: "writer-8-16", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-8-16", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-8-16", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-8-16", name: "Review article", description: "Review the produced article", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-11T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven and scalable.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [{ sourceId: 1, text: "text" }], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function writerJson(writerArtifactId) { return { contentId: "00000000-0000-4000-8000-0000000000W1", taskDescription: writerTask.description, objective: "Write an article about media pipelines", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson(seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize the article", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "A practical guide.", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate the article for brand", status: "approved", issues: [], passedChecks: [{ code: "brand.tonality", message: "Matches provided guidelines" }], failedChecks: [], recommendations: [{ priority: "low", description: "Optional polish" }], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson() { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "The article is accurate and well-structured.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } }; }

const METADATA = {
  planner: { id: "planner", name: "Planner", version: "1.0.0", description: "planner", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  research: { id: "research", name: "Research", version: "1.0.0", description: "research", capabilities: ["web-search"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  writer: { id: "writer", name: "Writer", version: "1.0.0", description: "writer", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  seo: { id: "seo", name: "SEO", version: "1.0.0", description: "seo", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
  brand: { id: "brand", name: "Brand Gate", version: "1.0.0", description: "brand", capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" },
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

  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({ config: {}, execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }), capabilityExecution: boundary });
  const reviewerAgent = createReviewerAgent({ config: {}, execute: async () => ({ output: reviewJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });

  const captured = { brandHandoff: null, reviewerHandoff: null, qaHandoff: null };

  function register(id, run) {
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
  }

  register("planner", async () => plannerAgent.execute({ context: {}, input: { task: plannerTask } }, SIGNAL));
  register("research", async () => researchAgent.execute({ context: {}, input: { task: researchTask, capabilityRequests: [] } }, SIGNAL));
  register("writer", async (wfInput, execCtx) => {
    const agent = createWriterAgent({ config: {}, execute: async () => ({ output: writerJson(wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
    return agent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("seo", async (wfInput, execCtx) => {
    const agent = createSEOAgent({ config: {}, execute: async () => ({ output: seoJson(wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
    return agent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("brand", async (wfInput, execCtx) => {
    captured.brandHandoff = wfInput;
    const agent = createBrandAgent({ config: {}, execute: async () => ({ output: brandJson(wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
    return agent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("reviewer", async (wfInput, execCtx) => {
    captured.reviewerHandoff = wfInput;
    return reviewerAgent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("qa", async (wfInput) => {
    captured.qaHandoff = wfInput;
    return { output: { reportId: "qa-8-16", objective: "Validate the article", status: "passed", summary: "Valid", testResults: [], executionEvidencePresent: false } };
  });

  const runtimeExecutor = new RuntimeAgentExecutor(new RegistryAgentResolver(registry));
  const executor = new ArtifactProducingExecutor({
    runtimeExecutor,
    prepareInput: (step) => {
      switch (step.agent) {
        case "planner": return { task: plannerTask };
        case "research": return { task: researchTask, capabilityRequests: [] };
        case "writer": return { objective: "Write an article about media pipelines", task: writerTask };
        case "seo": return { objective: "Optimize the article", task: seoTask };
        case "brand": return { objective: "Gate the article for brand", task: brandTask, brandConfig: "Use an approachable, factual tone." };
        case "reviewer": return { requestId: "review-8-16", task: reviewTask };
        default: return {};
      }
    },
    artifactFor: (step, context, output) => {
      switch (step.agent) {
        case "planner": return { kind: "execution_plan", artifactId: String(output.planId) };
        case "research": return { kind: "research_report", artifactId: String(output.reportId) };
        case "writer": return { kind: "writer_report", artifactId: String(output.contentId) };
        case "seo": return { kind: "seo_report", artifactId: String(output.reportId) };
        case "brand": return { kind: "brand_report", artifactId: String(output.reportId) };
        case "reviewer": return { kind: "review_report", artifactId: String(output.reportId) };
        default: return { kind: "qa_report", artifactId: String(output.reportId) };
      }
    },
    hasFatalCapability: (output) => Array.isArray(output.capabilityExecutions) && output.capabilityExecutions.some((entry) => entry.status !== "success"),
  });

  return {
    registry,
    captured,
    run: (stages) => new CollaborationRunner(executor).run(stages, WORKFLOW),
  };
}

const CONTENT_STAGES = [
  { step: { id: "research", kind: "agent", agent: "research", emits: "research" }, artifactKind: "research_report" },
  { step: { id: "writer", kind: "agent", agent: "writer", emits: "writer" }, artifactKind: "writer_report" },
  { step: { id: "seo", kind: "agent", agent: "seo", emits: "seo" }, artifactKind: "seo_report" },
  { step: { id: "brand", kind: "agent", agent: "brand", emits: "brand" }, artifactKind: "brand_report" },
];

describe("Sprint 8.16 — Brand Gate integration through the single execution path", () => {
  it("— Registry resolves the brand gate as an agent", async () => {
    const { registry } = buildHarness();
    strictEqual(registry.has("brand"), true);
    const resolved = await registry.resolve("brand");
    strictEqual(resolved.id, "brand");
  });

  it("— Research → Writer → SEO → Brand runs with correct lineage and preserved identity", async () => {
    const { run } = buildHarness();
    const result = await run(CONTENT_STAGES);
    strictEqual(result.status, "completed");
    deepStrictEqual(result.lineage.map((item) => item.producerAgent), ["research", "writer", "seo", "brand"]);
    const brand = result.lineage[3];
    strictEqual(brand.kind, "brand_report");
    strictEqual(brand.producerAgent, "brand");
    strictEqual(brand.parentArtifact.artifactId, result.lineage[2].artifactId);
    strictEqual(brand.parentArtifact.kind, "seo_report");
    strictEqual(brand.workflowId, WORKFLOW.workflowId);
    strictEqual(brand.correlationId, WORKFLOW.correlationId);
    strictEqual(brand.payload.status, "approved");
  });

  it("— Reviewer receives the Brand artifact through the normal handoff", async () => {
    const { run, captured } = buildHarness();
    const stages = [...CONTENT_STAGES, { step: { id: "reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" }];
    const result = await run(stages);
    strictEqual(result.status, "completed");
    const brand = result.lineage[3];
    strictEqual(captured.reviewerHandoff.previousArtifact.artifactId, brand.artifactId);
    strictEqual(captured.reviewerHandoff.previousArtifact.kind, "brand_report");
    strictEqual(result.lineage[4].parentArtifact.artifactId, brand.artifactId);
  });

  it("— QA receives the downstream validated artifact normally", async () => {
    const { run, captured } = buildHarness();
    const stages = [
      ...CONTENT_STAGES,
      { step: { id: "reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
      { step: { id: "qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
    ];
    const result = await run(stages);
    strictEqual(result.status, "completed");
    const reviewer = result.lineage[4];
    strictEqual(captured.qaHandoff.previousArtifact.artifactId, reviewer.artifactId);
    strictEqual(captured.qaHandoff.previousArtifact.kind, "review_report");
    strictEqual(result.lineage.length, 6);
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKFLOW.workflowId);
      strictEqual(item.correlationId, WORKFLOW.correlationId);
    }
  });

  it("— single path: every artifact is a normal CollaborationArtifact", async () => {
    const { run } = buildHarness();
    const result = await run(CONTENT_STAGES);
    ok(result.lineage.every((item) => typeof item.schemaVersion === "string" && item.contentType === "application/json"));
    ok(result.lineage.every((item) => item.workflowId === WORKFLOW.workflowId));
  });
});