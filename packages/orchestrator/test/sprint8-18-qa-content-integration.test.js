import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createWriterAgent } from "@ai-media-factory/writer-agent";
import { createSEOAgent } from "@ai-media-factory/seo-agent";
import { createBrandAgent } from "@ai-media-factory/brand-agent";
import { createReviewerAgent } from "@ai-media-factory/reviewer-agent";
import { createQAAgent } from "@ai-media-factory/qa-agent";
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { ArtifactProducingExecutor } from "../dist/index.js";

/**
 * Sprint 8.18 — QAAgent generalized for content QA through the single execution
 * path. QA derives content mode from the validatedArtifacts handoff and
 * deterministically enforces brand/reviewer/lineage predicates, while
 * engineering QA behavior remains unchanged.
 */

const WORKFLOW = { workflowId: "workflow-8-18", correlationId: "corr-8-18", brandId: null, outputs: {}, data: { avg: 1 } };

const plannerTask = { id: "planner-8-18", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-8-18", name: "Research", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const writerTask = { id: "writer-8-18", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-8-18", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-8-18", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-8-18", name: "Review artifact", description: "Review the produced artifact", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const qaTask = { id: "qa-8-18", name: "QA artifact", description: "Validate the content chain", agent: "qa", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-11T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven and scalable.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [{ sourceId: 1, text: "text" }], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function writerJson() { return { contentId: "00000000-0000-4000-8000-0000000000W1", taskDescription: writerTask.description, objective: "Write an article", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson() { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize the article", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "A practical guide.", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(status, seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate the article for brand", status, issues: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], passedChecks: [{ code: "brand.tonality", message: "Matches guidance" }], failedChecks: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "Review completed.", status, findings: status === "approved" ? [] : [{ id: "r1", severity: "high", category: "correctness", title: "Blocking", description: "Needs revision.", recommendation: "Fix" }], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } }; }

const METADATA = (id) => ({ id, name: id, version: "1.0.0", description: id, capabilities: ["text-generation"], tags: [], createdAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:00:00.000Z" });
const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

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

function buildHarness({ brandStatus = "approved", reviewStatus = "approved" } = {}) {
  const registry = new DefaultAgentRegistry();
  const boundary = webSearchBoundary();

  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({ config: {}, execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }), capabilityExecution: boundary });

  const captured = { qaInput: null, qaRaw: null };

  function register(id, run) {
    void registry.register({
      metadata: METADATA(id),
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
  register("writer", async (wfInput, execCtx) => createWriterAgent({ config: {}, execute: async () => ({ output: writerJson(), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("seo", async (wfInput, execCtx) => createSEOAgent({ config: {}, execute: async () => ({ output: seoJson(), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("brand", async (wfInput, execCtx) => createBrandAgent({ config: {}, execute: async () => ({ output: brandJson(brandStatus, wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("reviewer", async (wfInput, execCtx) => createReviewerAgent({ config: {}, execute: async (_context, request) => ({ output: reviewJson(reviewStatus), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("qa", async (wfInput, execCtx) => {
    captured.qaInput = wfInput;
    const agent = createQAAgent({ config: {}, execute: async (_context, request) => {
      captured.qaRaw = request.messages[1].content;
      return { output: { reportId: "00000000-0000-4000-8000-0000000000Q1", requestId: "qa-8-18", objective: "Validate the content chain", status: "passed", summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } }, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 };
    } });
    return agent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });

  const runtimeExecutor = new RuntimeAgentExecutor(new RegistryAgentResolver(registry));
  const executor = new ArtifactProducingExecutor({
    runtimeExecutor,
    prepareInput: (step, context) => {
      switch (step.agent) {
        case "planner": return { task: plannerTask };
        case "research": return { task: researchTask, capabilityRequests: [] };
        case "writer": return { objective: "Write an article about media pipelines", task: writerTask };
        case "seo": return { objective: "Optimize the article", task: seoTask };
        case "brand": return { objective: "Gate the article for brand", task: brandTask, brandConfig: "Use an approachable, factual tone." };
        case "reviewer": {
          const prev = context.data.previousArtifact;
          return { requestId: "review-8-18", task: reviewTask, context: { artifact: { kind: prev.kind, artifactId: prev.artifactId, payload: prev.payload } } };
        }
        case "qa": {
          const lineage = context.data.validatedArtifacts;
          return { requestId: "qa-8-18", task: qaTask, objective: "Validate the content chain", request: { scope: "content chain", requirements: ["brand approved", "reviewer approved"], expectedTests: ["content structure"] }, validatedArtifacts: lineage };
        }
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
        case "qa": return { kind: "qa_report", artifactId: String(output.reportId) };
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

const PRE = [
  { step: { id: "research", kind: "agent", agent: "research", emits: "research" }, artifactKind: "research_report" },
  { step: { id: "writer", kind: "agent", agent: "writer", emits: "writer" }, artifactKind: "writer_report" },
  { step: { id: "seo", kind: "agent", agent: "seo", emits: "seo" }, artifactKind: "seo_report" },
  { step: { id: "brand", kind: "agent", agent: "brand", emits: "brand" }, artifactKind: "brand_report" },
  { step: { id: "reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
];

describe("Sprint 8.18 — QA generalized for content QA", () => {
  it("— Registry resolves the QA agent", async () => {
    const { registry } = buildHarness();
    strictEqual(registry.has("qa"), true);
    const resolved = await registry.resolve("qa");
    strictEqual(resolved.id, "qa");
  });

  it("— full Writer→SEO→Brand→Reviewer→QA chain passes with approved brand/reviewer", async () => {
    const { run, captured } = buildHarness();
    const result = await run(PRE);
    strictEqual(result.status, "completed");
    const qa = result.lineage[5];
    strictEqual(qa.kind, "qa_report");
    strictEqual(qa.producerAgent, "qa");
    strictEqual(qa.parentArtifact.artifactId, result.lineage[4].artifactId);
    strictEqual(qa.workflowId, WORKFLOW.workflowId);
    strictEqual(qa.correlationId, WORKFLOW.correlationId);
    strictEqual(qa.payload.status, "passed");
    strictEqual(captured.qaInput.validatedArtifacts.length, 5);
  });

  it("— QA receives the full content lineage via validatedArtifacts", async () => {
    const { run, captured } = buildHarness();
    await run(PRE);
    strictEqual(captured.qaInput.validatedArtifacts.map((a) => a.kind).join(","), "research_report,writer_report,seo_report,brand_report,review_report");
    ok(captured.qaRaw.includes("brand"));
    ok(captured.qaRaw.includes("reviewer"));
  });

  it("— Brand rejected → QA cannot pass (blocked, rejection visible)", async () => {
    const { run } = buildHarness({ brandStatus: "rejected" });
    const result = await run(PRE);
    strictEqual(result.status, "completed");
    strictEqual(result.lineage[3].payload.status, "rejected");
    strictEqual(result.lineage[5].payload.status, "blocked");
    ok(result.lineage[5].payload.findings.some((f) => f.description.includes("Brand gate status")));
  });

  it("— Reviewer changes_requested → QA cannot pass", async () => {
    const { run } = buildHarness({ reviewStatus: "changes_requested" });
    const result = await run(PRE);
    strictEqual(result.status, "completed");
    strictEqual(result.lineage[5].payload.status, "blocked");
    ok(result.lineage[5].payload.findings.some((f) => f.description.includes("Reviewer status")));
  });

  it("— QA does not fabricate execution evidence in content mode", async () => {
    const { run } = buildHarness();
    const result = await run(PRE);
    const qa = result.lineage[5];
    strictEqual(qa.payload.metadata.executionEvidencePresent, false);
    strictEqual(qa.payload.testResults.length, 0);
  });

  it("— single path: all artifacts preserve workflowId/correlationId and lineage", async () => {
    const { run } = buildHarness();
    const result = await run(PRE);
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKFLOW.workflowId);
      strictEqual(item.correlationId, WORKFLOW.correlationId);
    }
    const qa = result.lineage[5];
    strictEqual(qa.parentArtifact.kind, "review_report");
  });
});