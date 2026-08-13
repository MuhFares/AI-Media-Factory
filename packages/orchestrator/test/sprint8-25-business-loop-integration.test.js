import { describe, it } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID, ImageGenerationCapabilityExecutor, IMAGE_GENERATION_CAPABILITY_ID, VideoGenerationCapabilityExecutor, VIDEO_GENERATION_CAPABILITY_ID, PublishingCapabilityExecutor, PUBLISH_CAPABILITY_ID, AnalyticsCapabilityExecutor, ANALYTICS_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createWriterAgent } from "@ai-media-factory/writer-agent";
import { createSEOAgent } from "@ai-media-factory/seo-agent";
import { createBrandAgent } from "@ai-media-factory/brand-agent";
import { createReviewerAgent } from "@ai-media-factory/reviewer-agent";
import { createQAAgent } from "@ai-media-factory/qa-agent";
import { createThumbnailAgent } from "@ai-media-factory/thumbnail-agent";
import { createVideoAgent } from "@ai-media-factory/video-agent";
import { createPublisherAgent } from "@ai-media-factory/publisher-agent";
import { createAnalyticsAgent } from "@ai-media-factory/analytics-agent";
import { createGrowthAgent } from "@ai-media-factory/growth-agent";
import { createFinanceAgent } from "@ai-media-factory/finance-agent";
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { Orchestrator, ArtifactProducingExecutor } from "../dist/index.js";
import { decideBusinessCycle, executiveContext, produceExecutive } from "@ai-media-factory/ceo-agent";

/**
 * Sprint 8.25 — CEO Business Feedback Loop.
 *
 * Closes the autonomous cycle AnalyticsReport → GrowthRecommendation →
 * FinancialReport → CEO → ExecutiveDirective → existing Orchestrator by REUSING
 * the existing CEO Decision Layer and ExecutiveDirective contract plus the single
 * Orchestrator execution path (no second CEO, no second Orchestrator, no
 * duplicate workflow execution). The loop is bounded by maxCycles and can never
 * run forever.
 */

const WORKFLOW = { workflowId: "workflow-8-25", correlationId: "corr-8-25", brandId: null, outputs: {}, data: {} };
const FIXED_CLOCK = () => "2026-08-14T00:00:00.000Z";

const plannerTask = { id: "planner-8-25", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-8-25", name: "Research", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const writerTask = { id: "writer-8-25", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-8-25", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-8-25", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-8-25", name: "Review artifact", description: "Review the produced artifact", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const qaTask = { id: "qa-8-25", name: "QA artifact", description: "Validate the content chain", agent: "qa", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const thumbnailTask = { id: "thumbnail-8-25", name: "Generate thumbnail", description: "Generate a thumbnail", agent: "thumbnail", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const videoTask = { id: "video-8-25", name: "Generate video", description: "Generate a video", agent: "video", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const publishTask = { id: "publish-8-25", name: "Publish content", description: "Publish the approved content", agent: "publisher", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const analyticsTask = { id: "analytics-8-25", name: "Fetch analytics", description: "Fetch performance analytics", agent: "analytics", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const growthTask = { id: "growth-8-25", name: "Recommend growth", description: "Recommend growth actions", agent: "growth", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const financeTask = { id: "finance-8-25", name: "Analyze finance", description: "Analyze financial performance", agent: "finance", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-14T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function writerJson() { return { contentId: "00000000-0000-4000-8000-0000000000W1", taskDescription: writerTask.description, objective: "Write an article", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson() { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize", optimizedTitle: "X", optimizedDescription: "D", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(status, seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate", status, issues: [], passedChecks: [{ code: "brand.tonality", message: "Matches guidance" }], failedChecks: [], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "ok", status, findings: [], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function qaJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000Q1", requestId: "qa-8-25", objective: "Validate", status, summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } }; }
function videoJson() { return { reportId: "00000000-0000-4000-8000-0000000000D1", taskDescription: videoTask.description, objective: "Generate a video", status: "completed", summary: "ok", videoId: "vid-1", videoUrl: "https://cdn.example.com/1", videoTitle: "V", providerId: "fake-video", jobId: "j1", durationSeconds: 30, aspectRatio: "16:9", executionEvidencePresent: true, metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } }; }

const METADATA = (id) => ({ id, name: id, version: "1.0.0", description: id, capabilities: ["text-generation", IMAGE_GENERATION_CAPABILITY_ID, VIDEO_GENERATION_CAPABILITY_ID, PUBLISH_CAPABILITY_ID, ANALYTICS_CAPABILITY_ID], tags: [], createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" });
const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

function memoryStore() {
  const map = new Map();
  return { get: async (key) => map.get(key) ?? null, save: async (key, entry) => { map.set(key, entry); }, map };
}

function capabilityBoundary({ analyticsProvider } = {}) {
  const descriptors = [
    { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: IMAGE_GENERATION_CAPABILITY_ID, description: "Generate image", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: VIDEO_GENERATION_CAPABILITY_ID, description: "Generate video", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: PUBLISH_CAPABILITY_ID, description: "Publish content", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: ANALYTICS_CAPABILITY_ID, description: "Fetch analytics", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
  ];
  const resolver = {
    resolve: (id) => descriptors.find((d) => d.capabilityId === id) ?? null,
    isAuthorized: (agentId, capabilityId) =>
      (agentId === "research" && capabilityId === WEB_SEARCH_CAPABILITY_ID) ||
      (agentId === "thumbnail" && capabilityId === IMAGE_GENERATION_CAPABILITY_ID) ||
      (agentId === "video" && capabilityId === VIDEO_GENERATION_CAPABILITY_ID) ||
      (agentId === "publisher" && capabilityId === PUBLISH_CAPABILITY_ID) ||
      (agentId === "analytics" && capabilityId === ANALYTICS_CAPABILITY_ID),
  };
  const webExecutor = new WebSearchCapabilityExecutor({ search: async () => ({ providerId: "fake-provider", results: [{ title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet", source: "example", rank: 1 }] }) }, resolver, { maxResults: 5, maxQueryLength: 200 });
  const imageExecutor = new ImageGenerationCapabilityExecutor({ generate: async () => ({ providerId: "fake-image", imageId: "img-1", title: "T", url: "https://cdn.example.com/1.png" }) }, resolver, { maxPromptLength: 500, maxNegativePromptLength: 500, maxWidth: 4096, maxHeight: 4096, allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"] });
  const videoExecutor = new VideoGenerationCapabilityExecutor({ generate: async () => ({ providerId: "fake-video", videoId: "vid-1", title: "V", url: "https://cdn.example.com/1.mp4", jobId: "j1", status: "completed", durationSeconds: 30, model: "fake" }) }, resolver, { maxPromptLength: 500, maxDurationSeconds: 60, allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"], maxResolution: { width: 3840, height: 2160 }, maxSourceAssets: 8 });
  const publishExecutor = new PublishingCapabilityExecutor({ publish: async () => ({ providerId: "fake-publish", status: "completed", publicationId: "pub-1", url: "https://youtube.com/watch?v=pub-1", publishedAt: "2026-08-14T02:00:00.000Z" }) }, memoryStore(), resolver, { maxTitleLength: 200, maxDescriptionLength: 1000, maxAssetIdLength: 500, maxTags: 30, maxTagLength: 30, allowedVisibility: ["public", "unlisted", "private"] });
  const analyticsProviderImpl = analyticsProvider ?? {
    fetch: async () => ({ providerId: "fake-analytics", status: "completed", publicationId: "pub-1", metrics: { views: 1200, likes: 300, revenue: 1200 }, retrievedAt: "2026-08-14T03:00:00.000Z" }),
  };
  const analyticsExecutor = new AnalyticsCapabilityExecutor(analyticsProviderImpl, resolver, { maxPublicationIdLength: 500 });
  const executor = {
    execute: (request) => {
      switch (request.capabilityId) {
        case WEB_SEARCH_CAPABILITY_ID: return webExecutor.execute(request);
        case IMAGE_GENERATION_CAPABILITY_ID: return imageExecutor.execute(request);
        case VIDEO_GENERATION_CAPABILITY_ID: return videoExecutor.execute(request);
        case PUBLISH_CAPABILITY_ID: return publishExecutor.execute(request);
        case ANALYTICS_CAPABILITY_ID: return analyticsExecutor.execute(request);
        default: return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
      }
    },
  };
  return new RuntimeCapabilityExecutor({ resolver, executor });
}

function buildHarness({ analyticsProvider } = {}) {
  const registry = new DefaultAgentRegistry();
  const boundary = capabilityBoundary({ analyticsProvider });
  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({ config: {}, execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }), capabilityExecution: boundary });
  const thumbnailAgent = createThumbnailAgent({ config: {}, capabilityExecution: boundary });
  const videoAgent = createVideoAgent({ config: {}, capabilityExecution: boundary });
  const publisherAgent = createPublisherAgent({ config: {}, capabilityExecution: boundary });
  const analyticsAgent = createAnalyticsAgent({ config: {}, capabilityExecution: boundary });
  const growthAgent = createGrowthAgent({ config: {}, capabilityExecution: undefined });
  const financeAgent = createFinanceAgent({ config: {}, capabilityExecution: undefined });

  function register(id, factory) {
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
          const result = await factory(wfInput, execCtx);
          const output = typeof result === "object" && result !== null && "output" in result ? result.output : result;
          return output;
        },
        health: async () => ({ healthy: true, lastCheck: "2026-08-14T00:00:00.000Z" }),
        dispose: async () => {},
      }),
    });
  }

  register("planner", async () => plannerAgent.execute({ context: {}, input: { task: plannerTask } }, SIGNAL));
  register("research", async () => researchAgent.execute({ context: {}, input: { task: researchTask, capabilityRequests: [] } }, SIGNAL));
  register("writer", async (wfInput, execCtx) => createWriterAgent({ config: {}, execute: async () => ({ output: writerJson(), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("seo", async (wfInput, execCtx) => createSEOAgent({ config: {}, execute: async () => ({ output: seoJson(), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("brand", async (wfInput, execCtx) => createBrandAgent({ config: {}, execute: async () => ({ output: brandJson("approved", wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("reviewer", async (wfInput, execCtx) => createReviewerAgent({ config: {}, execute: async () => ({ output: reviewJson("approved"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("qa", async (wfInput, execCtx) => createQAAgent({ config: {}, execute: async () => ({ output: qaJson("passed"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("thumbnail", async (wfInput, execCtx) => thumbnailAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("video", async (wfInput, execCtx) => videoAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("publisher", async (wfInput, execCtx) => publisherAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("analytics", async (wfInput, execCtx) => analyticsAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("growth", async (wfInput, execCtx) => growthAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("finance", async (wfInput, execCtx) => financeAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));

  const runtimeExecutor = new RuntimeAgentExecutor(new RegistryAgentResolver(registry));
  const executor = new ArtifactProducingExecutor({
    runtimeExecutor,
    prepareInput: (step, context) => {
      const lineage = (context.data.validatedArtifacts ?? [])
        .filter((a) => !(a.kind === "review_report" && (a.parentArtifact?.kind === "thumbnail_report" || a.parentArtifact?.kind === "video_report")));
      switch (step.agent) {
        case "planner": return { task: plannerTask };
        case "research": return { task: researchTask, capabilityRequests: [] };
        case "writer": return { objective: "Write an article", task: writerTask };
        case "seo": return { objective: "Optimize", task: seoTask };
        case "brand": return { objective: "Gate", task: brandTask, brandConfig: "approachable" };
        case "reviewer": return { requestId: "review-8-25", task: reviewTask, context: { artifact: { kind: lineage[lineage.length - 1]?.kind ?? "review_report", artifactId: lineage[lineage.length - 1]?.artifactId ?? "x", payload: lineage[lineage.length - 1]?.payload ?? {} } } };
        case "qa": {
          const raw = lineage.filter((a) => a.kind !== "qa_report");
          const chained = raw.map((artifact, index) => index === 0 ? artifact : { ...artifact, parentArtifact: { artifactId: String(raw[index - 1].artifactId), kind: raw[index - 1].kind } });
          return { requestId: "qa-8-25", task: qaTask, objective: "Validate", request: { scope: "chain", requirements: ["approved"], expectedTests: ["structure"] }, validatedArtifacts: chained };
        }
        case "thumbnail": return { requestId: "thumb-8-25", objective: "thumbnail", taskDescription: thumbnailTask.description, validatedArtifacts: lineage.filter((a) => a.kind !== "qa_report") };
        case "video": return { requestId: "video-8-25", objective: "video", taskDescription: videoTask.description, validatedArtifacts: lineage.filter((a) => a.kind !== "qa_report" && !(a.kind === "review_report" && a.parentArtifact?.kind === "thumbnail_report")) };
        case "publisher": return { requestId: "publish-8-25", objective: "publish", taskDescription: publishTask.description, validatedArtifacts: lineage };
        case "analytics": return { requestId: "analytics-8-25", objective: "fetch analytics", taskDescription: analyticsTask.description, validatedArtifacts: lineage };
        case "growth": return { requestId: "growth-8-25", objective: "recommend growth", taskDescription: growthTask.description, validatedArtifacts: lineage };
        case "finance": return { requestId: "finance-8-25", objective: "analyze finance", taskDescription: financeTask.description, validatedArtifacts: lineage, financialData: { cost: 600, currency: "USD" } };
        default: return {};
      }
    },
    artifactFor: (step, _context, output) => {
      switch (step.agent) {
        case "planner": return { kind: "execution_plan", artifactId: String(output.planId) };
        case "research": return { kind: "research_report", artifactId: String(output.reportId) };
        case "writer": return { kind: "writer_report", artifactId: String(output.contentId) };
        case "seo": return { kind: "seo_report", artifactId: String(output.reportId) };
        case "brand": return { kind: "brand_report", artifactId: String(output.reportId) };
        case "reviewer": return { kind: "review_report", artifactId: String(output.reportId) };
        case "qa": return { kind: "qa_report", artifactId: String(output.reportId) };
        case "thumbnail": return { kind: "thumbnail_report", artifactId: `thumb-${String(output.reportId)}` };
        case "video": return { kind: "video_report", artifactId: `video-${String(output.reportId)}` };
        case "publisher": return { kind: "published_report", artifactId: `published-${String(output.publicationId)}` };
        case "analytics": return { kind: "analytics_report", artifactId: `analytics-${String(output.reportId)}` };
        case "growth": return { kind: "growth_report", artifactId: `growth-${String(output.recommendationId)}` };
        case "finance": return { kind: "finance_report", artifactId: `finance-${String(output.reportId)}` };
        default: return { kind: "qa_report", artifactId: String(output.reportId) };
      }
    },
    hasFatalCapability: (output) => Array.isArray(output.capabilityExecutions) && output.capabilityExecutions.some((entry) => entry.status !== "success"),
  });

  return { registry, run: (stages) => new CollaborationRunner(executor).run(stages, WORKFLOW) };
}

const FULL = [
  { step: { id: "research", kind: "agent", agent: "research", emits: "research" }, artifactKind: "research_report" },
  { step: { id: "writer", kind: "agent", agent: "writer", emits: "writer" }, artifactKind: "writer_report" },
  { step: { id: "seo", kind: "agent", agent: "seo", emits: "seo" }, artifactKind: "seo_report" },
  { step: { id: "brand", kind: "agent", agent: "brand", emits: "brand" }, artifactKind: "brand_report" },
  { step: { id: "reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
  { step: { id: "thumbnail", kind: "agent", agent: "thumbnail", emits: "thumbnail" }, artifactKind: "thumbnail_report" },
  { step: { id: "thumbnail-reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "thumbnail-qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
  { step: { id: "video", kind: "agent", agent: "video", emits: "video" }, artifactKind: "video_report" },
  { step: { id: "video-reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "video-qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
  { step: { id: "publisher", kind: "agent", agent: "publisher", emits: "published" }, artifactKind: "published_report" },
  { step: { id: "analytics", kind: "agent", agent: "analytics", emits: "analytics" }, artifactKind: "analytics_report" },
  { step: { id: "growth", kind: "agent", agent: "growth", emits: "growth" }, artifactKind: "growth_report" },
  { step: { id: "finance", kind: "agent", agent: "finance", emits: "finance" }, artifactKind: "finance_report" },
];

/** Convert a CollaborationRunner lineage into the business gateway artifact shape. */
function toBusinessArtifacts(result) {
  return result.lineage.map((item) => ({
    artifactId: item.artifactId,
    kind: item.kind,
    producerAgent: item.producerAgent,
    workflowId: item.workflowId,
    correlationId: item.correlationId,
    status: item.payload?.status ?? "completed",
    createdAt: item.createdAt,
    ...(item.parentArtifact ? { parentArtifact: item.parentArtifact } : {}),
    payload: item.payload ?? {},
  }));
}

const SEP = { requestId: "request-8-25", maxCycles: 5, workflowId: WORKFLOW.workflowId, correlationId: WORKFLOW.correlationId, brandId: null, clock: FIXED_CLOCK, registry: { has: () => true } };

describe("Sprint 8.25 — CEO Business Feedback Loop", () => {
  it("produces a completed finance_report to close Analytics→Growth→Finance", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.status, "completed");
    strictEqual(result.lineage[15].kind, "finance_report");
    strictEqual(result.lineage[15].payload.status, "completed");
  });

  it("issues a grounded ExecutiveDirective from the validated chain (CEO reuse)", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    const decision = decideBusinessCycle({ ...SEP, cycle: 1, validatedArtifacts: toBusinessArtifacts(result) });
    strictEqual(decision.status, "issued");
    strictEqual(decision.directive.workflowIntent, "implement");
    strictEqual(decision.directive.decisionEvidence.kind, "executive_decision");
    // grounded in validated figures only, no fabricated business metric
    ok(decision.directive.rationale.includes("analytics_report"));
    ok(decision.directive.objective.includes("00000000-0000-4000-8000-0000000000W1"));
    ok(decision.directive.objective.includes("cycle 1"));
  });

  it("forwards the directive to the existing Orchestrator via produceExecutive (single path)", async () => {
    const { run } = buildHarness();
    const pipeline = await run(FULL);
    const decision = decideBusinessCycle({ ...SEP, cycle: 1, validatedArtifacts: toBusinessArtifacts(pipeline) });
    const orchestrator = new Orchestrator();
    const target = { workflowId: WORKFLOW.workflowId, correlationId: WORKFLOW.correlationId, brandId: null, data: {} };
    const context = executiveContext(decision.directive, target);
    strictEqual(context.data.objective.includes("cycle 1"), true);
    // the directive routes through the same Orchestrator.plan; identity preserved
    const plan = orchestrator.plan(decision.directive.workflowIntent, context);
    strictEqual(plan.directive, "implement");
    ok(plan.agents.length >= 1);
    strictEqual(context.workflowId, "workflow-8-25");
    strictEqual(context.correlationId, "corr-8-25");
  });

  it("is bounded by maxCycles and never runs forever (no infinite loop)", async () => {
    const { run } = buildHarness();
    const pipeline = await run(FULL);
    const artifacts = toBusinessArtifacts(pipeline);
    const maxCycles = 4;
    let cycles = 0;
    let issued = 0;
    let status = "issued";
    while (status === "issued" && cycles < 1000) {
      cycles += 1;
      const decision = decideBusinessCycle({ ...SEP, maxCycles, cycle: cycles, validatedArtifacts: artifacts });
      status = decision.status;
      if (status === "issued") issued += 1;
    }
    strictEqual(issued, maxCycles);
    strictEqual(status, "no_decision");
    strictEqual(cycles, maxCycles + 1);
  });

  it("records decision provenance and keeps directive evidence distinct from execution evidence", async () => {
    const { run } = buildHarness();
    const pipeline = await run(FULL);
    const decision = decideBusinessCycle({ ...SEP, cycle: 1, validatedArtifacts: toBusinessArtifacts(pipeline) });
    const kinds = decision.sourceArtifactReferences.map((r) => r.kind).sort();
    deepStrictEqual(kinds, ["analytics_report", "finance_report", "growth_report"]);
    strictEqual(decision.directive.decisionEvidence.kind, "executive_decision");
    strictEqual(decision.directive.decisionEvidence.status, undefined);
    strictEqual(decision.directive.decisionEvidence.executeCapability, undefined);
  });

  it("propagates invalid/blocked upstream as NO decision (loop halts, no directive)", async () => {
    const { run } = buildHarness({
      analyticsProvider: { fetch: async () => ({ providerId: "fake-analytics", status: "failed", error: { code: "RATE_LIMIT", message: "Quota exceeded" } }) },
    });
    const result = await run(FULL);
    strictEqual(result.status, "failed");
    const financeCompleted = result.lineage.filter((a) => a.kind === "finance_report" && a.payload.status === "completed");
    strictEqual(financeCompleted.length, 0);
    const decision = decideBusinessCycle({ ...SEP, cycle: 1, validatedArtifacts: toBusinessArtifacts(result) });
    strictEqual(decision.status, "no_decision");
    strictEqual(decision.directive, undefined);
  });
});