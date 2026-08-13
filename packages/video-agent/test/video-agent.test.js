import { describe, it } from "node:test";
import { strictEqual, ok, rejects } from "node:assert";
import { createVideoAgent } from "../dist/index.js";
import { VIDEO_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";

const signal = { throwIfCancelled() {} };

function baseArtifacts(overrides = {}) {
  return [
    {
      artifactId: "a-research",
      kind: "research_report",
      producerAgent: "research",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      parentArtifact: undefined,
      payload: { reportId: "r", taskDescription: "Research", summary: "ok", sources: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-writer",
      kind: "writer_report",
      producerAgent: "writer",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      parentArtifact: { artifactId: "a-research", kind: "research_report" },
      payload: { contentId: "w", taskDescription: "Write", objective: "Write", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "sum", sourceReferences: [], status: "completed", metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-seo",
      kind: "seo_report",
      producerAgent: "seo",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      parentArtifact: { artifactId: "a-writer", kind: "writer_report" },
      payload: { reportId: "s", taskDescription: "SEO", objective: "Optimize", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "d", keywords: [], topics: [], searchIntent: "informational", contentStructure: [], status: "completed", metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-brand",
      kind: "brand_report",
      producerAgent: "brand",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      parentArtifact: { artifactId: "a-seo", kind: "seo_report" },
      payload: { reportId: "b", taskDescription: "Brand", objective: "Gate", status: "approved", issues: [], passedChecks: [], failedChecks: [], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-thumb",
      kind: "thumbnail_report",
      producerAgent: "thumbnail",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      parentArtifact: { artifactId: "a-brand", kind: "brand_report" },
      payload: { reportId: "t", taskDescription: "Thumbnail", objective: "Generate a thumbnail", status: "completed", summary: "ok", imageId: "img-0001", imageUrl: "https://cdn.example.com/img-0001.png", imageTitle: "Thumb", providerId: "fake-image", executionEvidencePresent: true, metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
  ];
}

function input(artifacts, extra = {}) {
  return {
    requestId: "00000000-0000-4000-8000-000000000001",
    objective: "Generate a video for the approved article",
    taskDescription: "Generate a video",
    validatedArtifacts: artifacts,
    ...extra,
  };
}

function capCompleted() {
  return {
    status: "success",
    resultId: "video-generation-result-video-00000000-0000-4000-8000-000000000001",
    capabilityId: VIDEO_GENERATION_CAPABILITY_ID,
    output: { providerId: "fake-video", status: "completed", jobId: "job-0001", videoId: "vid-0001", url: "https://cdn.example.com/vid-0001.mp4", title: "Generated Video", durationSeconds: 30, width: 1920, height: 1080 },
    evidence: {
      evidenceId: "evidence-video-generation-result-video-00000000-0000-4000-8000-000000000001",
      capabilityId: VIDEO_GENERATION_CAPABILITY_ID,
      operation: "generate",
      providerId: "fake-video",
      jobId: "job-0001",
      videoId: "vid-0001",
      videoStatus: "completed",
      providerInvoked: true,
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      agentId: "video",
      executedAt: "2026-08-14T00:00:00.000Z",
      durationMs: 1,
      succeeded: true,
      resultStatus: "success",
    },
  };
}

function boundary(result) {
  return {
    executeCapability: async (request) => {
      if (request.capabilityId !== VIDEO_GENERATION_CAPABILITY_ID) {
        return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
      }
      strictEqual(request.agentId, "video");
      strictEqual(typeof request.input.prompt, "string");
      strictEqual(request.input.prompt.length > 0, true);
      return result;
    },
  };
}

describe("VideoAgent", () => {
  it("produces a completed video report with matching completion evidence", async () => {
    const agent = createVideoAgent({ config: {}, capabilityExecution: boundary(capCompleted()) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "completed");
    strictEqual(result.output.executionEvidencePresent, true);
    strictEqual(result.output.videoId, "vid-0001");
    strictEqual(result.output.jobId, "job-0001");
    strictEqual(result.output.providerId, "fake-video");
    strictEqual(result.output.capabilityExecutions[0].status, "success");
  });

  it("requests the video.generate capability through the boundary", async () => {
    let capturedRequest;
    const agent = createVideoAgent({ config: {}, capabilityExecution: {
      executeCapability: async (request) => { capturedRequest = request; return capCompleted(); },
    } });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "completed");
    strictEqual(capturedRequest.capabilityId, VIDEO_GENERATION_CAPABILITY_ID);
    strictEqual(capturedRequest.input.prompt.includes("Build Scalable Media Pipelines"), true);
    strictEqual(capturedRequest.input.sourceAssetIds[0], "img-0001");
    strictEqual(capturedRequest.input.durationSeconds, 30);
  });

  it("blocks when the thumbnail is missing (no video generation requested)", async () => {
    let invoked = false;
    const agent = createVideoAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const noThumb = baseArtifacts().filter((a) => a.kind !== "thumbnail_report");
    const result = await agent.execute({ context: {}, input: input(noThumb) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
    strictEqual(invoked, false);
  });

  it("blocks when the thumbnail is failed/blocked", async () => {
    let invoked = false;
    const agent = createVideoAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain.find((a) => a.kind === "thumbnail_report").status = "blocked";
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks when the brand gate is not approved", async () => {
    let invoked = false;
    const agent = createVideoAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain.find((a) => a.kind === "brand_report").payload.status = "rejected";
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks on inconsistent workflowId/correlationId lineage", async () => {
    let invoked = false;
    const agent = createVideoAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain[1].workflowId = "other-workflow";
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("never claims completion when the capability was blocked", async () => {
    const blocked = { status: "blocked", resultId: "blocked-1", capabilityId: VIDEO_GENERATION_CAPABILITY_ID, reason: "Not authorized" };
    const agent = createVideoAgent({ config: {}, capabilityExecution: boundary(blocked) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
    strictEqual(result.output.videoId, "");
  });

  it("never claims completion when the capability failed", async () => {
    const failed = { status: "failed", resultId: "failed-1", capabilityId: VIDEO_GENERATION_CAPABILITY_ID, error: { code: "PROVIDER_ERROR", message: "down", retryable: false } };
    const agent = createVideoAgent({ config: {}, capabilityExecution: boundary(failed) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
  });

  it("never claims completion when the job is only submitted", async () => {
    const submitted = {
      status: "failed",
      resultId: "video-generation-result-video-1",
      capabilityId: VIDEO_GENERATION_CAPABILITY_ID,
      error: { code: "VIDEO_NOT_COMPLETED", message: "not yet complete", retryable: true },
      evidence: { evidenceId: "e-1", capabilityId: VIDEO_GENERATION_CAPABILITY_ID, operation: "generate", providerId: "fake-video", jobId: "job-sub", videoStatus: "submitted", providerInvoked: true, workflowId: "workflow-1", correlationId: "correlation-1", agentId: "video", executedAt: "2026-08-14T00:00:00.000Z", durationMs: 1, succeeded: false, resultStatus: "failed" },
    };
    const agent = createVideoAgent({ config: {}, capabilityExecution: boundary(submitted) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
    strictEqual(result.output.videoId, "");
  });

  it("rejects malformed video input", async () => {
    const agent = createVideoAgent({ config: {}, capabilityExecution: boundary(capCompleted()) });
    await rejects(() => agent.execute({ context: {}, input: { requestId: "x", objective: "  " } }, signal), /Invalid video input/);
  });

  it("honors video-specific instructions as the negative prompt", async () => {
    let capturedRequest;
    const agent = createVideoAgent({ config: {}, capabilityExecution: {
      executeCapability: async (request) => { capturedRequest = request; return capCompleted(); },
    } });
    await agent.execute({ context: {}, input: input(baseArtifacts(), { instructions: "No gore, keep it clean." }) }, signal);
    strictEqual(capturedRequest.input.negativePrompt, "No gore, keep it clean.");
  });
});