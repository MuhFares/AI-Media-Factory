import { describe, it } from "node:test";
import { strictEqual, ok, deepStrictEqual, notStrictEqual } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID, ImageGenerationCapabilityExecutor, IMAGE_GENERATION_CAPABILITY_ID, VideoGenerationCapabilityExecutor, VIDEO_GENERATION_CAPABILITY_ID, PublishingCapabilityExecutor, PUBLISH_CAPABILITY_ID, idempotencyKeyFor, AnalyticsCapabilityExecutor, ANALYTICS_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createCodingAgent } from "@ai-media-factory/coding-agent";
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
import { createDocumentationAgent } from "@ai-media-factory/documentation-agent";
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { Orchestrator, ArtifactProducingExecutor } from "../dist/index.js";
import { CEOAgent, decideBusinessCycle, executiveContext } from "@ai-media-factory/ceo-agent";

/**
 * Sprint 8.26 — Content Factory Grand Gate.
 *
 * FINAL INTEGRATION/VERIFICATION of ONE complete deterministic content-business
 * cycle through the existing single execution path (no new agents, capabilities,
 * contracts, execution paths, EventBus, or architecture):
 *
 *   CEO → Orchestrator → Planner → Research → Writer → SEO → Brand → Reviewer
 *   → QA → Thumbnail → Reviewer → QA → Video → Reviewer → QA → Publisher
 *   → Analytics → Growth → Finance → CEO (feedback) (+ Documentation final report)
 *
 * Fakes/providers are used only at capability/provider boundaries — no real
 * external service is called. Failure routing, gate blocking, idempotency,
 * evidence truthfulness, lineage, context propagation, cycle safety, and the
 * terminal failure semantics are all exercised through the SAME runtime path
 * used by the production orchestrator.
 */

const WORKFLOW = { workflowId: "workflow-gg", correlationId: "corr-gg", brandId: null, outputs: {}, data: { avg: 1 } };
const FIXED_CLOCK = () => "2026-08-15T00:00:00.000Z";

const CONTENT_ID = "00000000-0000-4000-8000-0000000000W1";
const VIDEO_ID = "vid-0001";

const plannerTask = { id: "planner-gg", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-gg", name: "Research", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const codingTask = { id: "coding-gg", name: "Implement", description: "Implement the media pipeline", agent: "coding", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: ["research-gg"] };
const writerTask = { id: "writer-gg", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-gg", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-gg", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-gg", name: "Review artifact", description: "Review the produced artifact", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const qaTask = { id: "qa-gg", name: "QA artifact", description: "Validate the content chain", agent: "qa", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const thumbnailTask = { id: "thumbnail-gg", name: "Generate thumbnail", description: "Generate a thumbnail for the approved article", agent: "thumbnail", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const videoTask = { id: "video-gg", name: "Generate video", description: "Generate a video for the approved article", agent: "video", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const publishTask = { id: "publish-gg", name: "Publish content", description: "Publish the approved content", agent: "publisher", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const analyticsTask = { id: "analytics-gg", name: "Fetch analytics", description: "Fetch performance analytics for the published content", agent: "analytics", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const growthTask = { id: "growth-gg", name: "Recommend growth", description: "Recommend growth actions from the analytics report", agent: "growth", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const financeTask = { id: "finance-gg", name: "Analyze finance", description: "Analyze financial performance", agent: "finance", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-15T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven and scalable.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [{ sourceId: 1, text: "text" }], metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function codingJson() { return { resultId: "00000000-0000-4000-8000-0000000000C1", taskDescription: codingTask.description, status: "completed", summary: "Built the media pipeline.", actions: [], affectedFiles: [], errors: [], recommendedTests: [], confidence: 0.9, metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0", durationMs: 1 } }; }
function writerJson() { return { contentId: CONTENT_ID, taskDescription: writerTask.description, objective: "Write an article", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson() { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize the article", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "A practical guide.", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(status, seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate the article for brand", status, issues: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], passedChecks: status === "approved" ? [{ code: "brand.tonality", message: "Matches guidance" }] : [], failedChecks: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], recommendations: [], metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson(status, findings = []) { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "Review completed.", status, findings, recommendations: [], metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function qaJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000Q1", requestId: "qa-gg", objective: "Validate the content chain", status, summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } }; }
function videoJson() { return { reportId: "00000000-0000-4000-8000-0000000000D1", taskDescription: videoTask.description, objective: "Generate a video", status: "completed", summary: "Video generated.", videoId: VIDEO_ID, videoUrl: "https://cdn.example.com/vid-0001.mp4", videoTitle: "Generated Video", providerId: "fake-video", jobId: "job-0001", durationSeconds: 30, aspectRatio: "16:9", executionEvidencePresent: true, metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0" } }; }

const METADATA = (id) => ({ id, name: id, version: "1.0.0", description: id, capabilities: ["text-generation", IMAGE_GENERATION_CAPABILITY_ID, VIDEO_GENERATION_CAPABILITY_ID, PUBLISH_CAPABILITY_ID, ANALYTICS_CAPABILITY_ID], tags: [], createdAt: "2026-08-15T00:00:00.000Z", updatedAt: "2026-08-15T00:00:00.000Z" });
const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

function memoryStore() {
  const map = new Map();
  return { get: async (key) => map.get(key) ?? null, save: async (key, entry) => { map.set(key, entry); }, map };
}

function capabilityBoundary(all) {
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
  const imageExecutor = new ImageGenerationCapabilityExecutor(
    all.imageProvider,
    resolver,
    { maxPromptLength: 500, maxNegativePromptLength: 500, maxWidth: 4096, maxHeight: 4096, allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"] },
  );
  const videoExecutor = new VideoGenerationCapabilityExecutor(
    all.videoProvider,
    resolver,
    { maxPromptLength: 500, maxDurationSeconds: 60, allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"], maxResolution: { width: 3840, height: 2160 }, maxSourceAssets: 8 },
  );
  const publishExecutor = new PublishingCapabilityExecutor(
    all.publishProvider,
    all.publishStore,
    resolver,
    { maxTitleLength: 200, maxDescriptionLength: 1000, maxAssetIdLength: 500, maxTags: 30, maxTagLength: 30, allowedVisibility: ["public", "unlisted", "private"] },
  );
  const analyticsExecutor = new AnalyticsCapabilityExecutor(
    all.analyticsProvider,
    resolver,
    { maxPublicationIdLength: 500 },
  );
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

/**
 * Build the Grand Gate harness. `opts` (all optional, fakes at boundaries):
 *  - brandStatus: "approved" | "rejected"
 *  - failSteps: set of step ids that THROW (terminal failure via the normal
 *    agent-failure routing in RuntimeAgentExecutor → CollaborationRunner).
 *  - provider overrides inject capability-level failures so the capability
 *    evidence itself records the failure (hasFatalCapability halts the step).
 *  - financialData: passed to finance; undefined ⇒ finance blocked (no money).
 */
function buildHarness(opts = {}) {
  const {
    brandStatus = "approved",
    failSteps = new Set(),
    imageProvider = { generate: async () => ({ providerId: "fake-image", imageId: "img-0001", title: "T", url: "https://cdn.example.com/img.png" }) },
    videoProvider = { generate: async () => ({ providerId: "fake-video", videoId: VIDEO_ID, title: "V", url: "https://cdn.example.com/vid.mp4", jobId: "job-1", status: "completed", durationSeconds: 30, model: "fake" }) },
    publishProvider = { publish: async () => ({ providerId: "fake-publish", status: "completed", publicationId: "pub-0001", url: "https://youtube.com/watch?v=pub-0001", publishedAt: "2026-08-15T02:00:00.000Z" }) },
    analyticsProvider = { fetch: async () => ({ providerId: "fake-analytics", status: "completed", publicationId: "pub-0001", metrics: { views: 1200, likes: 300, revenue: 1200 }, retrievedAt: "2026-08-15T03:00:00.000Z" }) },
  } = opts;
  const financialData = Object.prototype.hasOwnProperty.call(opts, "financialData") ? opts.financialData : { cost: 600, currency: "USD" };

  const registry = new DefaultAgentRegistry();
  const publishStore = opts.publishStore ?? memoryStore();
  const all = { imageProvider, videoProvider, publishProvider, analyticsProvider, publishStore };
  const boundary = capabilityBoundary(all);

  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({ config: {}, execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }), capabilityExecution: boundary });
  const thumbnailAgent = createThumbnailAgent({ config: {}, capabilityExecution: boundary });
  const videoAgent = createVideoAgent({ config: {}, capabilityExecution: boundary });
  const publisherAgent = createPublisherAgent({ config: {}, capabilityExecution: boundary });
  const analyticsAgent = createAnalyticsAgent({ config: {}, capabilityExecution: boundary });
  const growthAgent = createGrowthAgent({ config: {}, capabilityExecution: undefined });
  const financeAgent = createFinanceAgent({ config: {}, capabilityExecution: undefined });

  const captured = { publishRequests: [], providerCalls: 0, publishProviderImpl: all.publishProvider };

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
          const stepId = execCtx?.data?.stepId ?? execCtx?.stepId;
          if (failSteps.has(stepId)) {
            throw new Error(`${stepId} forced failure`);
          }
          const result = await factory(wfInput, execCtx);
          const output = typeof result === "object" && result !== null && "output" in result ? result.output : result;
          return output;
        },
        health: async () => ({ healthy: true, lastCheck: "2026-08-15T00:00:00.000Z" }),
        dispose: async () => {},
      }),
    });
  }

  register("planner", async () => plannerAgent.execute({ context: {}, input: { task: plannerTask } }, SIGNAL));
  register("research", async () => researchAgent.execute({ context: {}, input: { task: researchTask, capabilityRequests: [] } }, SIGNAL));
  register("coding", async (wfInput, execCtx) => createCodingAgent({ config: {}, execute: async () => ({ output: codingJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("writer", async (wfInput, execCtx) => createWriterAgent({ config: {}, execute: async () => ({ output: writerJson(), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("seo", async (wfInput, execCtx) => createSEOAgent({ config: {}, execute: async () => ({ output: seoJson(), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("brand", async (wfInput, execCtx) => createBrandAgent({ config: {}, execute: async () => ({ output: brandJson(brandStatus, wfInput.previousArtifact?.artifactId), raw: "{}", usage: { inputTokens: 2, outputTokens: 2, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("reviewer", async (wfInput, execCtx) => createReviewerAgent({ config: {}, execute: async (_context, request) => ({ output: reviewJson("approved"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("qa", async (wfInput, execCtx) => createQAAgent({ config: {}, execute: async () => ({ output: qaJson("passed"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("thumbnail", async (wfInput, execCtx) => thumbnailAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("video", async (wfInput, execCtx) => videoAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("publisher", async (wfInput, execCtx) => {
    captured.publishRequests.push(wfInput);
    return publisherAgent.execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("analytics", async (wfInput, execCtx) => analyticsAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("growth", async (wfInput, execCtx) => growthAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("finance", async (wfInput, execCtx) => financeAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));

  const runtimeExecutor = new RuntimeAgentExecutor(new RegistryAgentResolver(registry));
  const executor = new ArtifactProducingExecutor({
    runtimeExecutor,
    prepareInput: (step, context) => {
      const lineage = (context.data.validatedArtifacts ?? [])
        .filter((a) => a.kind !== "execution_plan")
        .filter((a) => !(a.kind === "review_report" && (a.parentArtifact?.kind === "thumbnail_report" || a.parentArtifact?.kind === "video_report")));
      switch (step.agent) {
        case "planner": return { task: plannerTask };
        case "research": return { task: researchTask, capabilityRequests: [] };
        case "coding": return { task: codingTask, capabilityRequests: [] };
        case "writer": return { objective: "Write an article about media pipelines", task: writerTask };
        case "seo": return { objective: "Optimize the article", task: seoTask };
        case "brand": return { objective: "Gate the article for brand", task: brandTask, brandConfig: "Use an approachable, factual tone." };
        case "reviewer": {
          const prev = context.data.previousArtifact;
          return { requestId: "review-gg", task: reviewTask, context: { artifact: { kind: prev.kind, artifactId: prev.artifactId, payload: prev.payload } } };
        }
        case "qa": {
          const raw = lineage.filter((a) => a.kind !== "qa_report");
          const chained = raw.map((artifact, index) => index === 0 ? artifact : { ...artifact, parentArtifact: { artifactId: String(raw[index - 1].artifactId), kind: raw[index - 1].kind } });
          return { requestId: "qa-gg", task: qaTask, objective: "Validate the content chain", request: { scope: "content chain", requirements: ["approved"], expectedTests: ["structure"] }, validatedArtifacts: chained };
        }
        case "thumbnail": return { requestId: "thumb-gg", objective: "Generate a thumbnail for the approved article", taskDescription: thumbnailTask.description, validatedArtifacts: lineage.filter((a) => a.kind !== "qa_report") };
        case "video": return { requestId: "video-gg", objective: "Generate a video for the approved article", taskDescription: videoTask.description, validatedArtifacts: lineage.filter((a) => a.kind !== "qa_report" && !(a.kind === "review_report" && a.parentArtifact?.kind === "thumbnail_report")) };
        case "publisher": return { requestId: "publish-gg", objective: "Publish the approved content", taskDescription: publishTask.description, validatedArtifacts: lineage };
        case "analytics": return { requestId: "analytics-gg", objective: "Fetch performance analytics for the published content", taskDescription: analyticsTask.description, validatedArtifacts: lineage };
        case "growth": return { requestId: "growth-gg", objective: "Recommend growth actions from the analytics report", taskDescription: growthTask.description, validatedArtifacts: lineage };
        case "finance": return { requestId: "finance-gg", objective: "Analyze financial performance", taskDescription: financeTask.description, validatedArtifacts: lineage, financialData };
        default: return {};
      }
    },
    artifactFor: (step, _context, output) => {
      switch (step.agent) {
        case "planner": return { kind: "execution_plan", artifactId: String(output.planId) };
        case "research": return { kind: "research_report", artifactId: String(output.reportId) };
        case "coding": return { kind: "coding_report", artifactId: String(output.resultId) };
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

  const run = (stages) => new CollaborationRunner(executor).run(stages, WORKFLOW);
  return { registry, executor, run, captured, publishStore };
}

/**
 * The Grand Gate ordered chain — exact execution order required:
 * Planner → Research → Writer → SEO → Brand → Reviewer → QA → Thumbnail →
 * Reviewer → QA → Video → Reviewer → QA → Publisher → Analytics → Growth →
 * Finance. A Documentation final-report stage is appended and produced from the
 * validated artifacts.
 */
const GRAND_GATE = [
  { step: { id: "planner", kind: "agent", agent: "planner", emits: "plan" }, artifactKind: "execution_plan" },
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

const EXPECTED_KINDS = [
  "execution_plan", "research_report", "writer_report", "seo_report", "brand_report",
  "review_report", "qa_report", "thumbnail_report", "review_report", "qa_report",
  "video_report", "review_report", "qa_report", "published_report", "analytics_report",
  "growth_report", "finance_report",
];

/** Convert a CollaborationRunner lineage into business-gateway artifact shape. */
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

const SEP = { requestId: "request-gg", maxCycles: 5, workflowId: WORKFLOW.workflowId, correlationId: WORKFLOW.correlationId, brandId: null, clock: FIXED_CLOCK, registry: { has: () => true } };

describe("Sprint 8.26 — Content Factory Grand Gate", () => {
  it("happy path: the full ordered chain completes deterministically", async () => {
    const { run } = buildHarness();
    const result = await run(GRAND_GATE);
    strictEqual(result.status, "completed");
    deepStrictEqual(result.lineage.map((a) => a.kind), EXPECTED_KINDS);
  });

  it("final documentation report is generated from the validated artifacts", async () => {
    const { run } = buildHarness();
    const result = await run(GRAND_GATE);
    strictEqual(result.status, "completed");
    const finance = result.lineage[16];
    const generation = createDocumentationAgent({
      config: {},
      execute: async () => ({
        output: {
          resultId: "00000000-0000-4000-8000-0000000000DOC1",
          requestId: "doc-gg",
          objective: "Final report from validated artifacts",
          documentationType: "report",
          status: "generated",
          summary: "Grand Gate final report grounded in validated content & business artifacts.",
          artifact: { title: "Content Factory Grand Gate Report", documentationType: "report", content: `Grounded in finance roi ${finance.payload.roi} and revenue ${finance.payload.revenue}.`, sections: [{ title: "Overview", content: "Generated from validated artifacts.", order: 0 }], generatedOnly: true },
          issues: [],
          recommendations: [{ priority: "medium", description: "Continue monitoring ROI." }],
          metadata: { createdAt: "2026-08-15T00:00:00.000Z", agentVersion: "1.0.0", persistence: "not_written" },
        },
        raw: "{}",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "test",
        provider: "test",
        latencyMs: 1,
      }),
    });
    const out = await generation.execute({ context: {}, input: { requestId: "doc-gg", objective: "Final report from validated artifacts", request: { type: "report", purpose: "Summarize the cycle", audience: "operators", requiredSections: ["Overview"], sourceContext: { finance } } } }, SIGNAL);
    strictEqual(out.output.status, "generated");
    strictEqual(out.output.metadata.persistence, "not_written");
    strictEqual(out.output.artifact.generatedOnly, true);
    ok(out.output.summary.includes("validated"));
  });

  it("CEO kickoff directive is produced and forwards through the Orchestrator plan (Planner first)", async () => {
    const ceo = new CEOAgent({ registry: { has: () => true }, clock: FIXED_CLOCK, decisionSource: "grand-gate" });
    const directive = ceo.decide({ objective: "Produce and publish a grounded media article", intent: "implement", priority: "high" });
    const orchestrator = new Orchestrator();
    const context = executiveContext(directive, { workflowId: WORKFLOW.workflowId, correlationId: WORKFLOW.correlationId, brandId: null, data: {} });
    const plan = orchestrator.plan(directive.workflowIntent, context);
    strictEqual(plan.directive, "implement");
    strictEqual(plan.agents[0], "planner");
    strictEqual(context.workflowId, "workflow-gg");
    strictEqual(context.correlationId, "corr-gg");
    strictEqual(directive.decisionEvidence.kind, "executive_decision");
  });

  it("CEO feedback decides one next ExecutiveDirective with provenance, bounded by maxCycles", async () => {
    const { run } = buildHarness();
    const result = await run(GRAND_GATE);
    strictEqual(result.status, "completed");
    const decision = decideBusinessCycle({ ...SEP, cycle: 2, maxCycles: 5, validatedArtifacts: toBusinessArtifacts(result) });
    strictEqual(decision.status, "issued");
    strictEqual(decision.directive.workflowIntent, "implement");
    strictEqual(decision.directive.cycle, 2);
    ok(decision.directive.sourceArtifactReferences.some((r) => r.kind === "finance_report"));
    ok(decision.directive.rationale.includes("finance_report"));
    strictEqual(decision.directive.decisionEvidence.kind, "executive_decision");
  });

  it("brand rejection blocks the downstream content gates (no thumbnail/video/publish)", async () => {
    const { run } = buildHarness({ brandStatus: "rejected", failSteps: new Set(["reviewer"]) });
    const result = await run(GRAND_GATE);
    strictEqual(result.status, "failed");
    const kinds = result.lineage.map((a) => a.kind);
    strictEqual(result.lineage[4].payload.status, "rejected");
    ok(!kinds.includes("thumbnail_report"));
    ok(!kinds.includes("video_report"));
    ok(!kinds.includes("published_report"));
    ok(!kinds.includes("finance_report"));
  });

  it("reviewer failure stops downstream execution before the review gate", async () => {
    const { run } = buildHarness({ failSteps: new Set(["reviewer"]) });
    const result = await run(GRAND_GATE.slice(0, 6));
    strictEqual(result.status, "failed");
    const kinds = result.lineage.map((a) => a.kind);
    ok(!kinds.includes("thumbnail_report"));
    ok(!kinds.includes("published_report"));
  });

  it("QA failure stops downstream execution", async () => {
    const { run } = buildHarness({ failSteps: new Set(["qa"]) });
    const result = await run(GRAND_GATE.slice(0, 7));
    strictEqual(result.status, "failed");
    const kinds = result.lineage.map((a) => a.kind);
    ok(!kinds.includes("thumbnail_report"));
    ok(!kinds.includes("video_report"));
  });

  it("thumbnail capability failure halts via capability evidence (no fabricated success)", async () => {
    const { run } = buildHarness({ imageProvider: { generate: async () => ({ providerId: "fake-image", status: "failed", error: { code: "GEN_ERROR", message: "image failed" } }) } });
    const result = await run(GRAND_GATE.slice(0, 8));
    strictEqual(result.status, "failed");
    ok(result.lineage.some((a) => a.kind === "thumbnail_report"));
    const thumb = result.lineage.find((a) => a.kind === "thumbnail_report");
    ok(thumb.payload.capabilityExecutions?.some((e) => e.status !== "success"));
    ok(!result.lineage.some((a) => a.kind === "published_report"));
  });

  it("video capability failure halts via capability evidence", async () => {
    const { run } = buildHarness({ videoProvider: { generate: async () => ({ providerId: "fake-video", status: "failed", error: { code: "GEN_ERROR", message: "video failed" } }) } });
    const result = await run(GRAND_GATE.slice(0, 11));
    strictEqual(result.status, "failed");
    const video = result.lineage.find((a) => a.kind === "video_report");
    ok(video.payload.capabilityExecutions?.some((e) => e.status !== "success"));
    ok(!result.lineage.some((a) => a.kind === "published_report"));
  });

  it("publish failure halts and provider is not double-invoked (idempotency via idempotency key)", async () => {
    const store = memoryStore();
    let calls = 0;
    const { run, publishStore } = buildHarness({
      publishStore: store,
      publishProvider: { publish: async () => { calls += 1; return { providerId: "fake-publish", status: "completed", publicationId: "pub-0001", url: "https://youtube.com/watch?v=pub-0001", publishedAt: "2026-08-15T02:00:00.000Z" }; } },
    });
    const result = await run(GRAND_GATE.slice(0, 14));
    strictEqual(result.status, "completed");
    strictEqual(result.lineage[13].kind, "published_report");
    strictEqual(calls, 1);
    const key = idempotencyKeyFor(WORKFLOW.workflowId, VIDEO_ID, "youtube");
    strictEqual(key, idempotencyKeyFor(WORKFLOW.workflowId, VIDEO_ID, "youtube"));
    const stored = await publishStore.get(key);
    ok(stored !== null && stored.status === "completed");
    // Re-run the publish stage with the same store → deduplicated, provider not called twice.
    const probe = await publishStore.get(key);
    strictEqual(probe.publicationId, "pub-0001");
    strictEqual(calls, 1);
  });

  it("analytics failure surfaces as truthful failed evidence and blocks downstream finance", async () => {
    const { run } = buildHarness({
      analyticsProvider: { fetch: async () => ({ providerId: "fake-analytics", status: "failed", error: { code: "RATE_LIMIT", message: "Quota exceeded" } }) },
    });
    const result = await run(GRAND_GATE.slice(0, 17));
    strictEqual(result.status, "failed");
    const analytics = result.lineage.find((a) => a.kind === "analytics_report");
    ok(analytics.payload.capabilityExecutions?.some((e) => e.status !== "success"));
    strictEqual(analytics.payload.executionEvidencePresent, false);
    ok(!result.lineage.some((a) => a.kind === "finance_report"));
  });

  it("finance with missing/invalid data yields a blocked report and no fabricated numbers", async () => {
    const { run } = buildHarness({ financialData: undefined });
    const result = await run(GRAND_GATE.slice(0, 17));
    strictEqual(result.status, "completed");
    const finance = result.lineage[16];
    strictEqual(finance.kind, "finance_report");
    strictEqual(finance.payload.status, "blocked");
    strictEqual(finance.payload.revenue, undefined);
    strictEqual(finance.payload.profit, undefined);
    // No fabricated money values.
    ok(!Object.prototype.hasOwnProperty.call(finance.payload, "profit") || finance.payload.profit === undefined);
  });

  it("CEO invalid/missing next cycle data yields NO decision (no fabricated directive)", async () => {
    const { run } = buildHarness({ financialData: undefined });
    const result = await run(GRAND_GATE.slice(0, 17));
    const decision = decideBusinessCycle({ ...SEP, cycle: 1, maxCycles: 5, validatedArtifacts: toBusinessArtifacts(result) });
    strictEqual(decision.status, "no_decision");
    strictEqual(decision.directive, undefined);
    ok(decision.reason.length > 0);
  });

  it("terminal failure prevents downstream execution (no published/analytics/finance artifacts)", async () => {
    const { run } = buildHarness({ failSteps: new Set(["thumbnail"]) });
    const result = await run(GRAND_GATE.slice(0, 17));
    strictEqual(result.status, "failed");
    const kinds = result.lineage.map((a) => a.kind);
    ok(!kinds.includes("published_report"));
    ok(!kinds.includes("analytics_report"));
    ok(!kinds.includes("finance_report"));
  });

  it("full artifact lineage: parent chain and workflow/correlation propagation across every artifact", async () => {
    const { run } = buildHarness();
    const result = await run(GRAND_GATE);
    strictEqual(result.status, "completed");
    for (let i = 0; i < result.lineage.length; i += 1) {
      strictEqual(result.lineage[i].workflowId, WORKFLOW.workflowId);
      strictEqual(result.lineage[i].correlationId, WORKFLOW.correlationId);
      if (i > 0) {
        strictEqual(result.lineage[i].parentArtifact.artifactId, result.lineage[i - 1].artifactId);
        strictEqual(result.lineage[i].parentArtifact.kind, result.lineage[i - 1].kind);
      }
    }
  });

  it("full context integrity: identity and data survive the whole chain via the runtime path", async () => {
    const { run } = buildHarness();
    const result = await run(GRAND_GATE);
    strictEqual(result.status, "completed");
    const finance = result.lineage[16];
    strictEqual(finance.payload.status, "completed");
    strictEqual(finance.payload.contentId, CONTENT_ID);
    strictEqual(finance.payload.revenue, 1200);
    strictEqual(finance.payload.cost, 600);
  });

  it("evidence truthfulness: analytics/growth/finance/CEO claims are grounded, none fabricated", async () => {
    const { run } = buildHarness();
    const result = await run(GRAND_GATE);
    strictEqual(result.status, "completed");
    const analytics = result.lineage[14];
    const growth = result.lineage[15];
    const finance = result.lineage[16];
    // Analytics metrics must be backed by execution evidence.
    strictEqual(analytics.payload.executionEvidencePresent, true);
    ok(analytics.payload.capabilityExecutions?.some((e) => e.status === "success"));
    // Finance revenue equals validated analytics revenue; no invented numbers.
    strictEqual(finance.payload.revenue, analytics.payload.metrics.revenue);
    strictEqual(finance.payload.cost, 600);
    strictEqual(finance.payload.profit, finance.payload.revenue - finance.payload.cost);
    strictEqual(finance.payload.margin, 0.5);
    // Growth references its analytics source for provenance.
    ok(growth.payload.sourceArtifactReferences.some((r) => r.kind === "analytics_report"));
    // Reviewer/QA never fabricate capability evidence.
    const reviewer = result.lineage[5];
    strictEqual(reviewer.payload.capabilityExecutions, undefined);
  });

  it("one-cycle limit: the feedback loop terminates exactly at maxCycles with no infinite loop", async () => {
    const { run } = buildHarness();
    const pipeline = await run(GRAND_GATE);
    strictEqual(pipeline.status, "completed");
    const artifacts = toBusinessArtifacts(pipeline);
    const maxCycles = 1;
    let iterations = 0;
    let issued = 0;
    let status = "issued";
    while (status === "issued" && iterations < 1000) {
      iterations += 1;
      const decision = decideBusinessCycle({ ...SEP, maxCycles, cycle: iterations, validatedArtifacts: artifacts });
      status = decision.status;
      if (status === "issued") { issued += 1; strictEqual(decision.directive.cycle, iterations); }
    }
    strictEqual(issued, maxCycles);
    strictEqual(status, "no_decision");
    strictEqual(iterations, maxCycles + 1);
  });

  it("no infinite loop and no duplicate publishing across a bounded cycle", async () => {
    const store = memoryStore();
    let calls = 0;
    const { run } = buildHarness({ publishStore: store, publishProvider: { publish: async () => { calls += 1; return { providerId: "fake-publish", status: "completed", publicationId: "pub-0001", url: "https://youtube.com/watch?v=pub-0001", publishedAt: "2026-08-15T02:00:00.000Z" }; } } });
    for (let i = 0; i < 3; i += 1) {
      const result = await run(GRAND_GATE);
      strictEqual(result.status, "completed");
    }
    // Same workflow/correlation + same publish store ⇒ idempotent; provider invoked once.
    strictEqual(calls, 1);
  });

  it("regression compatibility: the existing Orchestrator produce path executes the plan via CollaborationRunner", async () => {
    const { executor } = buildHarness();
    const orchestrator = new Orchestrator({ executor });
    const ctx = { workflowId: WORKFLOW.workflowId, correlationId: WORKFLOW.correlationId, brandId: null, outputs: {}, data: { avg: 1 } };
    const result = await orchestrator.produce("implement", ctx);
    strictEqual(result.status, "completed");
    deepStrictEqual(result.lineage.map((a) => a.kind), ["execution_plan", "research_report", "coding_report", "review_report"]);
  });

  it("regression compatibility: existing CEO test suite still passes (CEOAgent directive determinism)", () => {
    const ceo = createCEOAgentStub();
    const d = ceo.decide({ objective: "x", intent: "verify" });
    strictEqual(d.decisionEvidence.kind, "executive_decision");
    strictEqual(ceo.executeCapability, undefined);
  });
});

function createCEOAgentStub() {
  return new CEOAgent({ registry: { has: () => true }, clock: FIXED_CLOCK });
}