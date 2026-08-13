import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID, ImageGenerationCapabilityExecutor, IMAGE_GENERATION_CAPABILITY_ID, VideoGenerationCapabilityExecutor, VIDEO_GENERATION_CAPABILITY_ID, PublishingCapabilityExecutor, PUBLISH_CAPABILITY_ID, PUBLISH_PLATFORM, AnalyticsCapabilityExecutor, ANALYTICS_CAPABILITY_ID, ANALYTICS_PLATFORM } from "@ai-media-factory/tool-framework";
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
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { ArtifactProducingExecutor } from "../dist/index.js";

/**
 * Sprint 8.22 — analytics.fetch capability + AnalyticsAgent integrated into the
 * content production route. The AnalyticsAgent validates that the content was
 * published with matching runtime evidence, then requests analytics.fetch
 * through the runtime boundary, producing an analytics_report. The report only
 * claims provider-backed metrics — no provider call means no fetched-data claim.
 */

const WORKFLOW = { workflowId: "workflow-8-22", correlationId: "corr-8-22", brandId: null, outputs: {}, data: { avg: 1 } };

const plannerTask = { id: "planner-8-22", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-8-22", name: "Research", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const writerTask = { id: "writer-8-22", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-8-22", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-8-22", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-8-22", name: "Review artifact", description: "Review the produced artifact", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const qaTask = { id: "qa-8-22", name: "QA artifact", description: "Validate the content chain", agent: "qa", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const thumbnailTask = { id: "thumbnail-8-22", name: "Generate thumbnail", description: "Generate a thumbnail for the approved article", agent: "thumbnail", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const videoTask = { id: "video-8-22", name: "Generate video", description: "Generate a video for the approved article", agent: "video", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const publishTask = { id: "publish-8-22", name: "Publish content", description: "Publish the approved content", agent: "publisher", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const analyticsTask = { id: "analytics-8-22", name: "Fetch analytics", description: "Fetch performance analytics for the published content", agent: "analytics", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-14T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven and scalable.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [{ sourceId: 1, text: "text" }], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function writerJson() { return { contentId: "00000000-0000-4000-8000-0000000000W1", taskDescription: writerTask.description, objective: "Write an article", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson() { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize the article", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "A practical guide.", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(status, seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate the article for brand", status, issues: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], passedChecks: [{ code: "brand.tonality", message: "Matches guidance" }], failedChecks: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "Review completed.", status, findings: status === "approved" ? [] : [{ id: "r1", severity: "high", category: "correctness", title: "Blocking", description: "Needs revision.", recommendation: "Fix" }], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function qaJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000Q1", requestId: "qa-8-22", objective: "Validate the content chain", status, summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } }; }
function videoJson() { return { reportId: "00000000-0000-4000-8000-0000000000D1", taskDescription: videoTask.description, objective: "Generate a video", status: "completed", summary: "Video generated.", videoId: "vid-0001", videoUrl: "https://cdn.example.com/vid-0001.mp4", videoTitle: "Generated Video", providerId: "fake-video", jobId: "job-0001", durationSeconds: 30, aspectRatio: "16:9", executionEvidencePresent: true, metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } }; }

const METADATA = (id) => ({ id, name: id, version: "1.0.0", description: id, capabilities: ["text-generation", IMAGE_GENERATION_CAPABILITY_ID, VIDEO_GENERATION_CAPABILITY_ID, PUBLISH_CAPABILITY_ID, ANALYTICS_CAPABILITY_ID], tags: [], createdAt: "2026-08-14T00:00:00.000Z", updatedAt: "2026-08-14T00:00:00.000Z" });
const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

function memoryStore() {
  const map = new Map();
  return {
    get: async (key) => map.get(key) ?? null,
    save: async (key, entry) => { map.set(key, entry); },
    map,
  };
}

function capabilityBoundary({ publishProvider, analyticsProvider } = {}) {
  const descriptors = [
    { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: IMAGE_GENERATION_CAPABILITY_ID, description: "Generate image", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: VIDEO_GENERATION_CAPABILITY_ID, description: "Generate video", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: PUBLISH_CAPABILITY_ID, description: "Publish content", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: ANALYTICS_CAPABILITY_ID, description: "Fetch analytics", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
  ];
  const localResolver = {
    resolve: (id) => descriptors.find((d) => d.capabilityId === id) ?? null,
    isAuthorized: (agentId, capabilityId) =>
      (agentId === "research" && capabilityId === WEB_SEARCH_CAPABILITY_ID) ||
      (agentId === "thumbnail" && capabilityId === IMAGE_GENERATION_CAPABILITY_ID) ||
      (agentId === "video" && capabilityId === VIDEO_GENERATION_CAPABILITY_ID) ||
      (agentId === "publisher" && capabilityId === PUBLISH_CAPABILITY_ID) ||
      (agentId === "analytics" && capabilityId === ANALYTICS_CAPABILITY_ID),
  };
  const webExecutor = new WebSearchCapabilityExecutor(
    { search: async () => ({ providerId: "fake-provider", results: [{ title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet", source: "example", rank: 1 }] }) },
    localResolver,
    { maxResults: 5, maxQueryLength: 200 },
  );
  const imageExecutor = new ImageGenerationCapabilityExecutor(
    { generate: async () => ({ providerId: "fake-image", imageId: "img-0001", title: "Generated Thumbnail", url: "https://cdn.example.com/img-0001.png" }) },
    localResolver,
    { maxPromptLength: 500, maxNegativePromptLength: 500, maxWidth: 4096, maxHeight: 4096, allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"] },
  );
  const videoExecutor = new VideoGenerationCapabilityExecutor(
    { generate: async () => ({ providerId: "fake-video", videoId: "vid-0001", title: "Generated Video", url: "https://cdn.example.com/vid-0001.mp4", jobId: "job-0001", status: "completed", durationSeconds: 30, model: "fake-video-model" }) },
    localResolver,
    { maxPromptLength: 500, maxDurationSeconds: 60, allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"], maxResolution: { width: 3840, height: 2160 }, maxSourceAssets: 8 },
  );
  const publishProviderImpl = publishProvider ?? {
    publish: async () => ({ providerId: "fake-publish", status: "completed", publicationId: "pub-0001", url: "https://youtube.com/watch?v=pub-0001", publishedAt: "2026-08-14T02:00:00.000Z" }),
  };
  const publishExecutor = new PublishingCapabilityExecutor(
    publishProviderImpl,
    memoryStore(),
    localResolver,
    { maxTitleLength: 200, maxDescriptionLength: 1000, maxAssetIdLength: 500, maxTags: 30, maxTagLength: 30, allowedVisibility: ["public", "unlisted", "private"] },
  );
  const analyticsProviderImpl = analyticsProvider ?? {
    fetch: async () => ({ providerId: "fake-analytics", status: "completed", publicationId: "pub-0001", metrics: { impressions: 5000, views: 1200, likes: 80, watchTimeSeconds: 36000 }, retrievedAt: "2026-08-14T03:00:00.000Z" }),
  };
  const analyticsExecutor = new AnalyticsCapabilityExecutor(
    analyticsProviderImpl,
    localResolver,
    { maxPublicationIdLength: 500 },
  );
  const executor = {
    execute: (request) => {
      if (request.capabilityId === WEB_SEARCH_CAPABILITY_ID) return webExecutor.execute(request);
      if (request.capabilityId === IMAGE_GENERATION_CAPABILITY_ID) return imageExecutor.execute(request);
      if (request.capabilityId === VIDEO_GENERATION_CAPABILITY_ID) return videoExecutor.execute(request);
      if (request.capabilityId === PUBLISH_CAPABILITY_ID) return publishExecutor.execute(request);
      if (request.capabilityId === ANALYTICS_CAPABILITY_ID) return analyticsExecutor.execute(request);
      return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
    },
  };
  return new RuntimeCapabilityExecutor({ resolver: localResolver, executor });
}

function buildHarness({ brandStatus = "approved", publishProvider, analyticsProvider } = {}) {
  const registry = new DefaultAgentRegistry();
  const boundary = capabilityBoundary({ publishProvider, analyticsProvider });

  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({ config: {}, execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }), capabilityExecution: boundary });
  const thumbnailAgent = createThumbnailAgent({ config: {}, capabilityExecution: boundary });
  const videoAgent = createVideoAgent({ config: {}, capabilityExecution: boundary });
  const publisherAgent = createPublisherAgent({ config: {}, capabilityExecution: boundary });
  const analyticsAgent = createAnalyticsAgent({ config: {}, capabilityExecution: boundary });

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
  register("brand", async (wfInput, execCtx) => createBrandAgent({ config: {}, execute: async () => ({ output: brandJson(brandStatus, wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("reviewer", async (wfInput, execCtx) => createReviewerAgent({ config: {}, execute: async (_context, request) => ({ output: reviewJson("approved"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("qa", async (wfInput, execCtx) => {
    const ok = wfInput.validatedArtifacts?.every((a) => a.status !== "blocked" && a.status !== "failed");
    return createQAAgent({ config: {}, execute: async (_context, request) => ({ output: qaJson(ok ? "passed" : "blocked"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("thumbnail", async (wfInput, execCtx) => thumbnailAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("video", async (wfInput, execCtx) => videoAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("publisher", async (wfInput, execCtx) => publisherAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("analytics", async (wfInput, execCtx) => analyticsAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));

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
          return { requestId: "review-8-22", task: reviewTask, context: { artifact: { kind: prev.kind, artifactId: prev.artifactId, payload: prev.payload } } };
        }
        case "qa": {
          const raw = (context.data.validatedArtifacts ?? [])
            .filter((a) => a.kind !== "qa_report")
            .filter((a) => !(a.kind === "review_report" && (a.parentArtifact?.kind === "thumbnail_report" || a.parentArtifact?.kind === "video_report")));
          const lineage = raw.map((artifact, index) => index === 0
            ? artifact
            : { ...artifact, parentArtifact: { artifactId: String(raw[index - 1].artifactId), kind: raw[index - 1].kind } });
          return { requestId: "qa-8-22", task: qaTask, objective: "Validate the content chain", request: { scope: "content chain", requirements: ["approved"], expectedTests: ["structure"] }, validatedArtifacts: lineage };
        }
        case "thumbnail": {
          const lineage = (context.data.validatedArtifacts ?? []).filter((a) => a.kind !== "qa_report");
          return { requestId: "thumbnail-8-22", objective: "Generate a thumbnail for the approved article", taskDescription: thumbnailTask.description, validatedArtifacts: lineage };
        }
        case "video": {
          const lineage = (context.data.validatedArtifacts ?? [])
            .filter((a) => a.kind !== "qa_report")
            .filter((a) => !(a.kind === "review_report" && a.parentArtifact?.kind === "thumbnail_report"));
          return { requestId: "video-8-22", objective: "Generate a video for the approved article", taskDescription: videoTask.description, validatedArtifacts: lineage };
        }
        case "publisher": {
          const lineage = (context.data.validatedArtifacts ?? [])
            .filter((a) => !(a.kind === "review_report" && (a.parentArtifact?.kind === "thumbnail_report" || a.parentArtifact?.kind === "video_report")));
          return { requestId: "publish-8-22", objective: "Publish the approved content", taskDescription: publishTask.description, validatedArtifacts: lineage };
        }
        case "analytics": {
          const lineage = (context.data.validatedArtifacts ?? [])
            .filter((a) => !(a.kind === "review_report" && (a.parentArtifact?.kind === "thumbnail_report" || a.parentArtifact?.kind === "video_report")));
          return { requestId: "analytics-8-22", objective: "Fetch performance analytics for the published content", taskDescription: analyticsTask.description, validatedArtifacts: lineage };
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
        case "thumbnail": return { kind: "thumbnail_report", artifactId: `thumb-${String(output.reportId)}` };
        case "video": return { kind: "video_report", artifactId: `video-${String(output.reportId)}` };
        case "publisher": return { kind: "published_report", artifactId: `published-${String(output.publicationId)}` };
        case "analytics": return { kind: "analytics_report", artifactId: `analytics-${String(output.reportId)}` };
        default: return { kind: "qa_report", artifactId: String(output.reportId) };
      }
    },
    hasFatalCapability: (output) => Array.isArray(output.capabilityExecutions) && output.capabilityExecutions.some((entry) => entry.status !== "success"),
  });

  return {
    registry,
    run: (stages) => new CollaborationRunner(executor).run(stages, WORKFLOW),
  };
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
];

describe("Sprint 8.22 — analytics.fetch + AnalyticsAgent integration", () => {
  it("— Registry resolves the analytics agent", async () => {
    const { registry } = buildHarness();
    strictEqual(registry.has("analytics"), true);
    const resolved = await registry.resolve("analytics");
    strictEqual(resolved.id, "analytics");
  });

  it("— full chain produces a completed analytics_report via analytics.fetch evidence", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.status, "completed");
    const analytics = result.lineage[13];
    strictEqual(analytics.kind, "analytics_report");
    strictEqual(analytics.payload.status, "completed");
    strictEqual(analytics.payload.executionEvidencePresent, true);
    strictEqual(analytics.payload.publicationId, "pub-0001");
    strictEqual(analytics.payload.platform, ANALYTICS_PLATFORM);
    strictEqual(analytics.payload.contentId, "00000000-0000-4000-8000-0000000000W1");
    strictEqual(analytics.payload.metrics.views, 1200);
    strictEqual(analytics.payload.source, "provider");
  });

  it("— AnalyticsAgent is authorized for analytics.fetch only and requests it via the boundary", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    const analytics = result.lineage[13];
    const execution = analytics.payload.capabilityExecutions[0];
    strictEqual(execution.status, "success");
    strictEqual(execution.capabilityId, ANALYTICS_CAPABILITY_ID);
    strictEqual(execution.evidence.agentId, "analytics");
    strictEqual(execution.evidence.platform, ANALYTICS_PLATFORM);
    strictEqual(execution.evidence.succeeded, true);
  });

  it("— analytics follows only a completed, evidenced publication", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.lineage[13].kind, "analytics_report");
    strictEqual(result.lineage[12].kind, "published_report");
    strictEqual(result.lineage[13].payload.status, "completed");
  });

  it("— the analytics_report chained lineage preserves workflow/correlation lineage", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.lineage[13].parentArtifact.kind, "published_report");
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKFLOW.workflowId);
      strictEqual(item.correlationId, WORKFLOW.correlationId);
    }
  });

  it("— a provider analytics failure produces no completed metrics claim", async () => {
    const { run } = buildHarness({
      analyticsProvider: { fetch: async () => ({ providerId: "fake-analytics", status: "failed", error: { code: "RATE_LIMIT", message: "Quota exceeded" } }) },
    });
    const result = await run(FULL);
    strictEqual(result.status, "failed");
    // No analytics_report may claim provider-backed metrics without a success.
    const completed = result.lineage.filter((a) => a.kind === "analytics_report" && a.payload.status === "completed" && a.payload.executionEvidencePresent === true);
    strictEqual(completed.length, 0);
  });
});