import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { DefaultAgentRegistry } from "@ai-media-factory/agent-registry";
import { RegistryAgentResolver, RuntimeAgentExecutor, RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { WebSearchCapabilityExecutor, WEB_SEARCH_CAPABILITY_ID, ImageGenerationCapabilityExecutor, IMAGE_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createPlannerAgent } from "@ai-media-factory/planner-agent";
import { createResearchAgent } from "@ai-media-factory/research-agent";
import { createWriterAgent } from "@ai-media-factory/writer-agent";
import { createSEOAgent } from "@ai-media-factory/seo-agent";
import { createBrandAgent } from "@ai-media-factory/brand-agent";
import { createReviewerAgent } from "@ai-media-factory/reviewer-agent";
import { createQAAgent } from "@ai-media-factory/qa-agent";
import { createThumbnailAgent } from "@ai-media-factory/thumbnail-agent";
import { CollaborationRunner } from "@ai-media-factory/workflow-engine";
import { ArtifactProducingExecutor } from "../dist/index.js";

/**
 * Sprint 8.19 — image.generate capability + ThumbnailAgent integrated into the
 * content production route. The ThumbnailAgent derives a prompt from the
 * approved content chain, requests image.generate through the runtime boundary,
 * and produces a thumbnail_report. Reviewer and QA then validate the thumbnail
 * artifacts. No provider is invoked (deterministic fake provider).
 */

const WORKFLOW = { workflowId: "workflow-8-19", correlationId: "corr-8-19", brandId: null, outputs: {}, data: { avg: 1 } };

const plannerTask = { id: "planner-8-19", name: "Plan content", description: "Plan the content pipeline", agent: "planner", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const researchTask = { id: "research-8-19", name: "Research", description: "Research modern media pipelines", agent: "research", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const writerTask = { id: "writer-8-19", name: "Write article", description: "Write the media pipeline article", agent: "writer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const seoTask = { id: "seo-8-19", name: "Optimize article", description: "Optimize the article for search", agent: "seo", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const brandTask = { id: "brand-8-19", name: "Brand gate", description: "Gate the article for brand", agent: "brand", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const reviewTask = { id: "review-8-19", name: "Review artifact", description: "Review the produced artifact", agent: "reviewer", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const qaTask = { id: "qa-8-19", name: "QA artifact", description: "Validate the content chain", agent: "qa", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };
const thumbnailTask = { id: "thumbnail-8-19", name: "Generate thumbnail", description: "Generate a thumbnail for the approved article", agent: "thumbnail", inputSchema: { type: "object" }, outputSchema: { type: "object" }, dependencies: [] };

function planJson() { return { planId: "00000000-0000-4000-8000-0000000000P1", objective: "Produce the media pipeline article", tasks: [researchTask], estimatedTotalCostUsd: 1, estimatedTotalDurationSeconds: 10, hasParallelism: false, metadata: { createdAt: "2026-08-13T00:00:00.000Z", plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 0, confidence: 0.8, warnings: [] } }; }
function researchJson() { return { reportId: "00000000-0000-4000-8000-0000000000R1", taskDescription: researchTask.description, summary: "Modern media pipelines are event-driven and scalable.", sources: [{ id: 1, title: "Pipeline Guide", url: "https://example.com/guide", snippet: "snippet" }], confidence: 0.8, citations: [{ sourceId: 1, text: "text" }], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function writerJson() { return { contentId: "00000000-0000-4000-8000-0000000000W1", taskDescription: writerTask.description, objective: "Write an article", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "A grounded article.", sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: "artifact-research-1" } }; }
function seoJson() { return { reportId: "00000000-0000-4000-8000-0000000000S1", taskDescription: seoTask.description, objective: "Optimize the article", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "A practical guide.", keywords: [{ keyword: "media pipeline", importance: "primary" }], topics: [{ topic: "scalability", presentInContent: true }], searchIntent: "informational", contentStructure: [{ heading: "Introduction", purpose: "Hook" }], sourceReferences: [{ sourceId: 1, title: "Pipeline Guide", url: "https://example.com/guide" }], status: "completed", metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: "artifact-writer-1" } }; }
function brandJson(status, seoArtifactId) { return { reportId: "00000000-0000-4000-8000-0000000000B1", taskDescription: brandTask.description, objective: "Gate the article for brand", status, issues: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], passedChecks: [{ code: "brand.tonality", message: "Matches guidance" }], failedChecks: status === "rejected" ? [{ code: "brand.tonality", message: "Tone drift" }] : [], recommendations: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId } }; }
function reviewJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000V1", taskDescription: reviewTask.description, summary: "Review completed.", status, findings: status === "approved" ? [] : [{ id: "r1", severity: "high", category: "correctness", title: "Blocking", description: "Needs revision.", recommendation: "Fix" }], recommendations: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } }; }
function qaJson(status) { return { reportId: "00000000-0000-4000-8000-0000000000Q1", requestId: "qa-8-19", objective: "Validate the content chain", status, summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } }; }

const METADATA = (id) => ({ id, name: id, version: "1.0.0", description: id, capabilities: ["text-generation", IMAGE_GENERATION_CAPABILITY_ID], tags: [], createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z" });
const SIGNAL = { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} };

function capabilityBoundary() {
  const descriptors = [
    { capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    { capabilityId: IMAGE_GENERATION_CAPABILITY_ID, description: "Generate image", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
  ];
  const localResolver = {
    resolve: (id) => descriptors.find((d) => d.capabilityId === id) ?? null,
    isAuthorized: (agentId, capabilityId) => (agentId === "research" && capabilityId === WEB_SEARCH_CAPABILITY_ID) || (agentId === "thumbnail" && capabilityId === IMAGE_GENERATION_CAPABILITY_ID),
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
  const executor = {
    execute: (request) => {
      if (request.capabilityId === WEB_SEARCH_CAPABILITY_ID) return webExecutor.execute(request);
      if (request.capabilityId === IMAGE_GENERATION_CAPABILITY_ID) return imageExecutor.execute(request);
      return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
    },
  };
  return new RuntimeCapabilityExecutor({ resolver: localResolver, executor });
}

function buildHarness({ brandStatus = "approved", reviewStatus = "approved", preThumbReviewStatus = "approved" } = {}) {
  const registry = new DefaultAgentRegistry();
  const boundary = capabilityBoundary();
  const captured = { thumbCapability: null, qaInputs: [], reviewInputs: [] };
  const thumbnailAgent = createThumbnailAgent({ config: {}, capabilityExecution: boundary });

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
    const isThumbnail = wfInput.context?.artifact?.kind === "thumbnail_report";
    const status = isThumbnail ? preThumbReviewStatus : reviewStatus;
    return createReviewerAgent({ config: {}, execute: async (_context, request) => ({ output: reviewJson(status), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("qa", async (wfInput, execCtx) => {
    captured.qaInputs.push(wfInput.validatedArtifacts?.map((a) => a.kind) ?? []);
    const hasThumbnail = wfInput.validatedArtifacts?.some((a) => a.kind === "thumbnail_report");
    const status = hasThumbnail && wfInput.validatedArtifacts.every((a) => a.status !== "blocked" && a.status !== "failed") ? "passed" : "blocked";
    return createQAAgent({ config: {}, execute: async (_context, request) => ({ output: qaJson(status), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }) }).execute({ context: execCtx, input: wfInput }, SIGNAL);
  });
  register("thumbnail", async (wfInput, execCtx) => {
    const result = await thumbnailAgent.execute({ context: execCtx, input: wfInput }, SIGNAL);
    captured.thumbCapability = result.output.capabilityExecutions?.[0] ?? null;
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
          return { requestId: "review-8-19", task: reviewTask, context: { artifact: { kind: prev.kind, artifactId: prev.artifactId, payload: prev.payload } } };
        }
        case "qa": {
          const raw = (context.data.validatedArtifacts ?? [])
            .filter((a) => a.kind !== "qa_report")
            .filter((a) => !(a.kind === "review_report" && a.parentArtifact?.kind === "thumbnail_report"));
          const lineage = raw.map((artifact, index) => index === 0
            ? artifact
            : { ...artifact, parentArtifact: { artifactId: String(raw[index - 1].artifactId), kind: raw[index - 1].kind } });
          return { requestId: "qa-8-19", task: qaTask, objective: "Validate the content chain", request: { scope: "content chain", requirements: ["approved"], expectedTests: ["structure"] }, validatedArtifacts: lineage };
        }
        case "thumbnail": {
          const lineage = (context.data.validatedArtifacts ?? []).filter((a) => a.kind !== "qa_report");
          return { requestId: "thumbnail-8-19", objective: "Generate a thumbnail for the approved article", taskDescription: thumbnailTask.description, validatedArtifacts: lineage };
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

const FULL = [
  ...PRE,
  { step: { id: "thumbnail-reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
  { step: { id: "thumbnail-qa", kind: "agent", agent: "qa", emits: "qa" }, artifactKind: "qa_report" },
];

describe("Sprint 8.19 — image.generate + ThumbnailAgent integration", () => {
  it("— Registry resolves the thumbnail agent", async () => {
    const { registry } = buildHarness();
    strictEqual(registry.has("thumbnail"), true);
    const resolved = await registry.resolve("thumbnail");
    strictEqual(resolved.id, "thumbnail");
  });

  it("— full chain generates a completed thumbnail_report via image.generate evidence", async () => {
    const { run, captured } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.status, "completed");
    const thumbnail = result.lineage[6];
    strictEqual(thumbnail.kind, "thumbnail_report");
    strictEqual(thumbnail.payload.status, "completed");
    strictEqual(thumbnail.payload.executionEvidencePresent, true);
    strictEqual(thumbnail.payload.imageId, "img-0001");
    strictEqual(thumbnail.payload.imageUrl, "https://cdn.example.com/img-0001.png");
    strictEqual(captured.thumbCapability.status, "success");
    strictEqual(captured.thumbCapability.evidence.capabilityId, IMAGE_GENERATION_CAPABILITY_ID);
  });

  it("— ThumbnailAgent is authorized and executes image.generate not a provider directly", async () => {
    const { run, captured } = buildHarness();
    await run(FULL);
    strictEqual(captured.thumbCapability.status, "success");
    strictEqual(captured.thumbCapability.evidence.agentId, "thumbnail");
    strictEqual(captured.thumbCapability.evidence.providerInvoked, true);
  });

  it("— the post-thumbnail reviewer validates the thumbnail_report", async () => {
    const { run, captured } = buildHarness();
    await run(FULL);
    strictEqual(captured.reviewInputs[captured.reviewInputs.length - 1], "thumbnail_report");
    const thumbnailReviewer = result => result.lineage[7];
    const r = await run(FULL);
    strictEqual(thumbnailReviewer(r).kind, "review_report");
    strictEqual(thumbnailReviewer(r).parentArtifact.kind, "thumbnail_report");
  });

  it("— final QA validates the content chain including the terminal thumbnail", async () => {
    const { run, captured } = buildHarness();
    const result = await run(FULL);
    const finalQaInput = captured.qaInputs[captured.qaInputs.length - 1];
    strictEqual(finalQaInput.join(","), "research_report,writer_report,seo_report,brand_report,review_report,thumbnail_report");
    const qa = result.lineage[8];
    strictEqual(qa.kind, "qa_report");
    strictEqual(qa.payload.status, "passed");
  });

  it("— the thumbnail_report is chained onto the reviewer report, preserving lineage", async () => {
    const { run } = buildHarness();
    const result = await run(FULL);
    strictEqual(result.lineage[6].parentArtifact.kind, "qa_report");
    strictEqual(result.lineage[7].parentArtifact.kind, "thumbnail_report");
    strictEqual(result.lineage[8].parentArtifact.kind, "review_report");
    for (const item of result.lineage) {
      strictEqual(item.workflowId, WORKFLOW.workflowId);
      strictEqual(item.correlationId, WORKFLOW.correlationId);
    }
  });

  it("— final QA preserves validatedArtifacts including the terminal thumbnail", async () => {
    const { run, captured } = buildHarness();
    const result = await run(FULL);
    const finalQaInput = captured.qaInputs[captured.qaInputs.length - 1];
    strictEqual(finalQaInput.join(","), "research_report,writer_report,seo_report,brand_report,review_report,thumbnail_report");
    strictEqual(result.lineage[8].payload.status, "passed");
    strictEqual(result.lineage[8].payload.validatedArtifacts.length, 6);
  });
});