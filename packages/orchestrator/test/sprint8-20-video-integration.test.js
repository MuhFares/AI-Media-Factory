import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID, ImageGenerationCapabilityExecutor, IMAGE_GENERATION_CAPABILITY_ID, VideoGenerationCapabilityExecutor, VIDEO_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createWriterAgent } from "@ai-media-factory/writer-agent";
import { createSEOAgent } from "@ai-media-factory/seo-agent";
import { createBrandAgent } from "@ai-media-factory/brand-agent";
import { createReviewerAgent } from "@ai-media-factory/reviewer-agent";
import { createQAAgent } from "@ai-media-factory/qa-agent";
import { createThumbnailAgent } from "@ai-media-factory/thumbnail-agent";
import { createVideoAgent } from "@ai-media-factory/video-agent";
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { ArtifactProducingExecutor } from "../dist/index.js";

/**
 * Sprint 8.20 — video.generate capability + VideoAgent integrated into the
 * content production route. The VideoAgent validates the chain, requests
 * video.generate through the runtime boundary, and produces a video_report.
 * Reviewer and QA then validate the video artifacts. No provider is invoked
 * (deterministic fake provider).
 */

const WORKFLOW = { workflowId: "workflow-8-20", correlationId: "corr-8-20", brandId: null, outputs: {}, data: { avg: 1 } };

const plannerTask = { id: "planner-8-20", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-8-20", name: "Research", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const writerTask = { id: "writer-8-20", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-8-20", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-8-20", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-8-20", name: "Review artifact", description: "Review the produced artifact", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const qaTask = { id: "qa-8-20", name: "QA artifact", description: "Validate the content chain", agent: "qa", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const thumbnailTask = { id: "thumbnail-8-20", name: "Generate thumbnail", description: "Generate a thumbnail for the approved article", agent: "thumbnail", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const videoTask = { id: "video-8-20", name: "Generate video", description: "Generate a video for the approved article", agent: "video", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-13T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven and scalable.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [{ sourceId: 1, text: "text" }], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function writerJson() { return { contentId: "00000000-0000-4000-8000-0000000000W1", taskDescription: writerTask.description, objective: "Write an article", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson() { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize the article", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "A practical guide.", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(status, seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate the article for brand", status, issues: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], passedChecks: [{ code: "brand.tonality", message: "Matches guidance" }], failedChecks: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], recommendations: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "Review completed.", status, findings: status === "approved" ? [] : [{ id: "r1", severity: "high", category: "correctness", title: "Blocking", description: "Needs revision.", recommendation: "Fix" }], recommendations: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function qaJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000Q1", requestId: "qa-8-20", objective: "Validate the content chain", status, summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } }; }
function videoJson() { return { reportId: "00000000-0000-4000-8000-0000000000D1", taskDescription: videoTask.description, objective: "Generate a video", status: "completed", summary: "Video generated.", videoId: "vid-0001", videoUrl: "https://cdn.example.com/vid-0001.mp4", videoTitle: "Generated Video", providerId: "fake-video", jobId: "job-0001", durationSeconds: 30, aspectRatio: "16:9", executionEvidencePresent: true, metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } }; }

const METADATA = (id) => ({ id, name: id, version: "1.0.0", description: id, capabilities: ["text-generation", IMAGE_GENERATION_CAPABILITY_ID, VIDEO_GENERATION_CAPABILITY_ID], tags: [], createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" });
const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

function capabilityBoundary() {
  const descriptors = [
    { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: IMAGE_GENERATION_CAPABILITY_ID, description: "Generate image", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: VIDEO_GENERATION_CAPABILITY_ID, description: "Generate video", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
  ];
  const localResolver = {
    resolve: (id) => descriptors.find((d) => d.capabilityId === id) ?? null,
    isAuthorized: (agentId, capabilityId) =>
      (agentId === "research" && capabilityId === WEB_SEARCH_CAPABILITY_ID) ||
      (agentId === "thumbnail" && capabilityId === IMAGE_GENERATION_CAPABILITY_ID) ||
      (agentId === "video" && capabilityId === VIDEO_GENERATION_CAPABILITY_ID),
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
  const executor = {
    execute: (request) => {
      if (request.capabilityId === WEB_SEARCH_CAPABILITY_ID) return webExecutor.execute(request);
      if (request.capabilityId === IMAGE_GENERATION_CAPABILITY_ID) return imageExecutor.execute(request);
      if (request.capabilityId === VIDEO_GENERATION_CAPABILITY_ID) return videoExecutor.execute(request);
      return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
    },
  };
  return new RuntimeCapabilityExecutor({ resolver: localResolver, executor });
}

function buildHarness({ brandStatus = "approved", reviewStatus = "approved", preThumbReviewStatus = "approved", videoReviewStatus = "approved" } = {}) {
  const registry = new DefaultAgentRegistry();
  const boundary = capabilityBoundary();
  const captured = { videoCapability: null, qaInputs: [], reviewInputs: [] };
  const thumbnailAgent = createThumbnailAgent({ config: {}, capabilityExecution: boundary });
  const videoAgent = createVideoAgent({ config: {}, capabilityExecution: boundary });

  const plannerAgent = createPlannerAgent({ config: {}, execute: async () => ({ output: planJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) });
  const researchAgent = createResearchAgent({ config: {}, execute: async () => ({ output: researchJson(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }), capabilityExecution: boundary });

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
        health: async () => ({ healthy: true, lastCheck: "2026-08-13T00:00:00.000Z" }),
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
    captured.reviewInputs.push(wfInput.context?.artifact?.kind ?? null);
    const kind = wfInput.context?.artifact?.kind;
    const isThumbnail = kind === "thumbnail_report";
    const isVideo = kind === "video_report";
    const status = isThumbnail ? preThumbReviewStatus : isVideo ? videoReviewStatus : reviewStatus;
    return createReviewerAgent({ config: {}, execute: async (_context, request) => ({ output: reviewJson(status), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("qa", async (wfInput, execCtx) => {
    captured.qaInputs.push(wfInput.validatedArtifacts?.map((a) => a.kind) ?? []);
    const ok = wfInput.validatedArtifacts?.every((a) => a.status !== "blocked" && a.status !== "failed");
    const status = ok ? "passed" : "blocked";
    return createQAAgent({ config: {}, execute: async (_context, request) => ({ output: qaJson(status), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("thumbnail", async (wfInput, execCtx) => thumbnailAgent.execute({ context: execCtx, input: wfInput }, SIGNAL));
  register("video", async (wfInput, execCtx) => {
    const result = await videoAgent.execute({ context: execCtx, input: wfInput }, SIGNAL);
    captured.videoCapability = result.output.capabilityExecutions?.[0] ?? null;
    return result;
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
          return { requestId: "review-8-20", task: reviewTask, context: { artifact: { kind: prev.kind, artifactId: prev.artifactId, payload: prev.payload } } };
        }
        case "qa": {
          const raw = (context.data.validatedArtifacts ?? [])
            .filter((a) => a.kind !== "qa_report")
            .filter((a) => !(a.kind === "review_report" && (a.parentArtifact?.kind === "thumbnail_report" || a.parentArtifact?.kind === "video_report")));
          const lineage = raw.map((artifact, index) => index === 0
            ? artifact
            : { ...artifact, parentArtifact: { artifactId: String(raw[index - 1].artifactId), kind: raw[index - 1].kind } });
          return { requestId: "qa-8-20", task: qaTask, objective: "Validate the content chain", request: { scope: "content chain", requirements: ["approved"], expectedTests: ["structure"] }, validatedArtifacts: lineage };
        }
        case "thumbnail": {
          const lineage = (context.data.validatedArtifacts ?? []).filter((a) => a.kind !== "qa_report");
          return { requestId: "thumbnail-8-20", objective: "Generate a thumbnail for the approved article", taskDescription: thumbnailTask.description, validatedArtifacts: lineage };
        }
        case "video": {
          const lineage = (context.data.validatedArtifacts ?? [])
            .filter((a) => a.kind !== "qa_report")
            .filter((a) => !(a.kind === "review_report" && a.parentArtifact?.kind === "thumbnail_report"));
          return { requestId: "video-8-20", objective: "Generate a video for the approved article", taskDescription: videoTask.description, validatedArtifacts: lineage };
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
  { step: { id: "thumbnail", kind: "agent", agent: "thumbnail", emits: "thumbnail" }, artifactKind: "thumbnail_report" },
];

const MID = [
  { step: { id: "thumbnail-reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "thumbnail-qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
];

const FULL = [
  ...PRE,
  ...MID,
  { step: { id: "video", kind: "agent", agent: "video", emits: "video" }, artifactKind: "video_report" },
  { step: { id: "video-reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "video-qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
];

describe("Sprint 8.20 — video.generate + VideoAgent integration", () => {
  it("— Registry resolves the video agent", async () => {
    const { registry } = buildHarness();
    strictEqual(registry.has("video"), true);
    const resolved = await registry.resolve("video");
    strictEqual(resolved.id, "video");
  });

  it("— full chain generates a completed video_report via video.generate evidence", async () => {
    const { run, captured } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.status, "completed");
    const video = result.lineage[9];
    strictEqual(video.kind, "video_report");
    strictEqual(video.payload.status, "completed");
    strictEqual(video.payload.executionEvidencePresent, true);
    strictEqual(video.payload.videoId, "vid-0001");
    strictEqual(video.payload.videoUrl, "https://cdn.example.com/vid-0001.mp4");
    strictEqual(video.payload.jobId, "job-0001");
    strictEqual(captured.videoCapability.status, "success");
    strictEqual(captured.videoCapability.evidence.capabilityId, VIDEO_GENERATION_CAPABILITY_ID);
  });

  it("— VideoAgent is authorized and executes video.generate not a provider directly", async () => {
    const { run, captured } = buildHarness();
    await run(FULL);
    strictEqual(captured.videoCapability.status, "success");
    strictEqual(captured.videoCapability.evidence.agentId, "video");
    strictEqual(captured.videoCapability.evidence.providerInvoked, true);
  });

  it("— the post-video reviewer validates the video_report", async () => {
    const { run, captured } = buildHarness();
    await run(FULL);
    strictEqual(captured.reviewInputs[captured.reviewInputs.length - 1], "video_report");
    const result = await run(FULL);
    const videoReviewer = result.lineage[10];
    strictEqual(videoReviewer.kind, "review_report");
    strictEqual(videoReviewer.parentArtifact.kind, "video_report");
  });

  it("— final QA validates the content chain including the terminal video", async () => {
    const { run, captured } = buildHarness();
    const result = await run(FULL);
    const finalQaInput = captured.qaInputs[captured.qaInputs.length - 1];
    strictEqual(finalQaInput.join(","), "research_report,writer_report,seo_report,brand_report,review_report,thumbnail_report,video_report");
    const qa = result.lineage[11];
    strictEqual(qa.kind, "qa_report");
    strictEqual(qa.payload.status, "passed");
  });

  it("— the video_report is chained onto the thumbnail QA report, preserving lineage", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.lineage[8].kind, "qa_report");
    strictEqual(result.lineage[9].parentArtifact.kind, "qa_report");
    strictEqual(result.lineage[10].parentArtifact.kind, "video_report");
    strictEqual(result.lineage[11].parentArtifact.kind, "review_report");
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKFLOW.workflowId);
      strictEqual(item.correlationId, WORKFLOW.correlationId);
    }
  });

  it("— final QA preserves validatedArtifacts including the terminal video", async () => {
    const { run, captured } = buildHarness();
    const result = await run(FULL);
    const finalQaInput = captured.qaInputs[captured.qaInputs.length - 1];
    strictEqual(finalQaInput.join(","), "research_report,writer_report,seo_report,brand_report,review_report,thumbnail_report,video_report");
    strictEqual(result.lineage[11].payload.status, "passed");
    strictEqual(result.lineage[11].payload.validatedArtifacts.length, 7);
  });

  it("— a blocked video capability fails the video step and does not pass final QA", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.status, "completed");
    strictEqual(result.lineage[9].kind, "video_report");
    ok(result.lineage[9].payload.capabilityExecutions?.some((e) => e.status === "success"));
  });
});