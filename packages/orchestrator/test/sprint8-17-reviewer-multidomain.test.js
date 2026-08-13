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
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { ArtifactProducingExecutor } from "../dist/index.js";

/**
 * Sprint 8.17 — Reviewer generalized for multi-domain review, driven through the
 * single execution path. Coding review remains backward-compatible; the Reviewer
 * now also reviews writer_report / seo_report / brand_report artifacts with its
 * review mode derived from the artifact kind received via the normal
 * previousArtifact handoff (no side channel, no second reviewer path).
 */

const WORKFLOW = { workflowId: "workflow-8-17", correlationId: "corr-8-17", brandId: null, outputs: {}, data: { avg: 1 } };

const plannerTask = { id: "planner-8-17", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-8-17", name: "Research", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const writerTask = { id: "writer-8-17", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-8-17", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-8-17", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-8-17", name: "Review artifact", description: "Review the produced artifact", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-11T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven and scalable.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [{ sourceId: 1, text: "text" }], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function writerJson() { return { contentId: "00000000-0000-4000-8000-0000000000W1", taskDescription: writerTask.description, objective: "Write an article", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson() { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize the article", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "A practical guide.", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(status, seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate the article for brand", status, issues: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], passedChecks: status === "approved" ? [{ code: "brand.tonality", message: "Matches guidance" }] : [{ code: "brand.tonality", message: "Matches guidance" }], failedChecks: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], recommendations: [{ priority: "low", description: "Optional polish" }], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson(status, findings = []) { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "Review completed.", status, findings, recommendations: [], metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" } }; }

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

function buildHarness({ brandStatus = "approved" } = {}) {
  const registry = new DefaultAgentRegistry();
  const boundary = webSearchBoundary();

  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({ config: {}, execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }), capabilityExecution: boundary });

  const captured = { reviewerInput: null, reviewerRaw: null };

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
  register("reviewer", async (wfInput, execCtx) => {
    captured.reviewerInput = wfInput;
    const agent = createReviewerAgent({ config: {}, execute: async (_context, request) => {
      captured.reviewerRaw = request.messages[1].content;
      return { output: reviewJson("approved"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 };
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
          return {
            requestId: "review-8-17",
            task: reviewTask,
            context: { artifact: { kind: prev.kind, artifactId: prev.artifactId, payload: prev.payload } },
          };
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
        default: return { kind: "qa_report", artifactId: String(output.reportId) };
      }
    },
    hasFatalCapability: (output) => Array.isArray(output.capabilityExecutions) && output.capabilityExecutions.some((entry) => entry.status !== "success"),
  });

  return {
    captured,
    run: (stages) => new CollaborationRunner(executor).run(stages, WORKFLOW),
  };
}

const PRE = [
  { step: { id: "research", kind: "agent", agent: "research", emits: "research" }, artifactKind: "research_report" },
  { step: { id: "writer", kind: "agent", agent: "writer", emits: "writer" }, artifactKind: "writer_report" },
  { step: { id: "seo", kind: "agent", agent: "seo", emits: "seo" }, artifactKind: "seo_report" },
  { step: { id: "brand", kind: "agent", agent: "brand", emits: "brand" }, artifactKind: "brand_report" },
];

const REVIEW_STAGE = { step: { id: "reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" };

describe("Sprint 8.17 — Reviewer generalized for multi-domain review", () => {
  it("— reviews a writer_report via the single execution path", async () => {
    const { run } = buildHarness();
    const stages = [...PRE.slice(0, 2), REVIEW_STAGE];
    const result = await run(stages);
    strictEqual(result.status, "completed");
    const writer = result.lineage[1];
    const reviewer = result.lineage[2];
    strictEqual(writer.kind, "writer_report");
    strictEqual(reviewer.parentArtifact.artifactId, writer.artifactId);
    strictEqual(reviewer.parentArtifact.kind, "writer_report");
    strictEqual(reviewer.payload.status, "approved");
  });

  it("— reviews a seo_report via the single execution path", async () => {
    const { run } = buildHarness();
    const stages = [...PRE.slice(0, 3), REVIEW_STAGE];
    const result = await run(stages);
    strictEqual(result.status, "completed");
    const seo = result.lineage[2];
    strictEqual(result.lineage[3].parentArtifact.artifactId, seo.artifactId);
    strictEqual(result.lineage[3].parentArtifact.kind, "seo_report");
  });

  it("— reviews an approved brand_report and approves it", async () => {
    const { run } = buildHarness({ brandStatus: "approved" });
    const result = await run([...PRE, REVIEW_STAGE]);
    strictEqual(result.status, "completed");
    const brand = result.lineage[3];
    const reviewer = result.lineage[4];
    strictEqual(reviewer.parentArtifact.artifactId, brand.artifactId);
    strictEqual(reviewer.parentArtifact.kind, "brand_report");
    strictEqual(reviewer.payload.status, "approved");
  });

  it("— keeps a brand rejection visible to the reviewer (blocked, never over-approves)", async () => {
    const { run } = buildHarness({ brandStatus: "rejected" });
    const result = await run([...PRE, REVIEW_STAGE]);
    strictEqual(result.status, "completed");
    const brand = result.lineage[3];
    const reviewer = result.lineage[4];
    strictEqual(brand.payload.status, "rejected");
    strictEqual(reviewer.parentArtifact.artifactId, brand.artifactId);
    strictEqual(reviewer.payload.status, "blocked");
    ok(reviewer.payload.findings.some((finding) => finding.title === "Brand compliance gate rejected this artifact"));
  });

  it("— reviewer derives its mode from the artifact kind on the standard handoff", async () => {
    const { run, captured } = buildHarness();
    await run([...PRE, REVIEW_STAGE]);
    strictEqual(captured.reviewerInput.previousArtifact.kind, "brand_report");
    ok(captured.reviewerRaw.includes("Review domain: brand"));
    ok(captured.reviewerRaw.includes('"optimizedTitle"') || captured.reviewerRaw.includes('"passedChecks"'));
  });

  it("— single path: reviewer artifact preserves parent, workflowId, correlationId", async () => {
    const { run } = buildHarness();
    const result = await run([...PRE, REVIEW_STAGE]);
    const reviewer = result.lineage[4];
    strictEqual(reviewer.workflowId, WORKFLOW.workflowId);
    strictEqual(reviewer.correlationId, WORKFLOW.correlationId);
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKFLOW.workflowId);
      strictEqual(item.correlationId, WORKFLOW.correlationId);
    }
  });
});