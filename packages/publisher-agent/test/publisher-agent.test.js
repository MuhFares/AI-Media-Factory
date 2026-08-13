import { describe, it } from "node:test";
import { strictEqual, ok, rejects } from "node:assert";
import { createPublisherAgent } from "../dist/index.js";
import { PUBLISH_CAPABILITY_ID, PUBLISH_PLATFORM } from "@ai-media-factory/tool-framework";

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
    {
      artifactId: "a-video",
      kind: "video_report",
      producerAgent: "video",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      parentArtifact: { artifactId: "a-thumb", kind: "thumbnail_report" },
      payload: { reportId: "v", taskDescription: "Video", objective: "Generate a video", status: "completed", summary: "ok", videoId: "vid-0001", videoUrl: "https://cdn.example.com/vid-0001.mp4", videoTitle: "Generated Video", providerId: "fake-video", jobId: "job-0001", durationSeconds: 30, aspectRatio: "16:9", executionEvidencePresent: true, metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-qa",
      kind: "qa_report",
      producerAgent: "qa",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      parentArtifact: { artifactId: "a-video", kind: "video_report" },
      payload: { reportId: "q", requestId: "qa-1", objective: "Validate the content chain", status: "passed", summary: "review", testResults: [], findings: [], risks: [], recommendations: [], metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false } },
    },
  ];
}

function input(artifacts, extra = {}) {
  return {
    requestId: "00000000-0000-4000-8000-000000000001",
    objective: "Publish the approved content",
    taskDescription: "Publish the approved content",
    validatedArtifacts: artifacts,
    ...extra,
  };
}

function capCompleted() {
  return {
    status: "success",
    resultId: "publish-result-publish-00000000-0000-4000-8000-000000000001",
    capabilityId: PUBLISH_CAPABILITY_ID,
    output: { providerId: "fake-publish", status: "completed", publicationId: "pub-0001", url: "https://youtube.com/watch?v=pub-0001", publishedAt: "2026-08-14T01:00:00.000Z", idempotencyKey: `publish:assetId=vid-0001&platform=${PUBLISH_PLATFORM}&workflowId=workflow-1`, deduplicated: false },
    evidence: {
      evidenceId: "evidence-publish-result-publish-00000000-0000-4000-8000-000000000001",
      capabilityId: PUBLISH_CAPABILITY_ID,
      operation: "publish",
      platform: PUBLISH_PLATFORM,
      providerId: "fake-publish",
      publicationId: "pub-0001",
      publishedUrl: "https://youtube.com/watch?v=pub-0001",
      publishedAt: "2026-08-14T01:00:00.000Z",
      idempotencyKey: `publish:assetId=vid-0001&platform=${PUBLISH_PLATFORM}&workflowId=workflow-1`,
      providerInvoked: true,
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      agentId: "publisher",
      executedAt: "2026-08-14T01:00:00.000Z",
      durationMs: 1,
      succeeded: true,
      resultStatus: "success",
    },
  };
}

function boundary(result) {
  return {
    executeCapability: async (request) => {
      if (request.capabilityId !== PUBLISH_CAPABILITY_ID) {
        return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
      }
      strictEqual(request.agentId, "publisher");
      return result;
    },
  };
}

describe("PublisherAgent", () => {
  it("produces a completed published_report with matching completion evidence", async () => {
    const agent = createPublisherAgent({ config: {}, capabilityExecution: boundary(capCompleted()) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "completed");
    strictEqual(result.output.executionEvidencePresent, true);
    strictEqual(result.output.publicationId, "pub-0001");
    strictEqual(result.output.publishedUrl, "https://youtube.com/watch?v=pub-0001");
    strictEqual(result.output.sourceVideoId, "vid-0001");
    strictEqual(result.output.providerId, "fake-publish");
    strictEqual(result.output.capabilityExecutions[0].status, "success");
  });

  it("requests the publish.youtube capability through the boundary", async () => {
    let capturedRequest;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: {
      executeCapability: async (request) => { capturedRequest = request; return capCompleted(); },
    } });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "completed");
    strictEqual(capturedRequest.capabilityId, PUBLISH_CAPABILITY_ID);
    strictEqual(capturedRequest.input.assetId, "vid-0001");
    strictEqual(capturedRequest.input.title, "Build Scalable Media Pipelines");
    strictEqual(typeof capturedRequest.input.idempotencyKey, "string");
  });

  it("blocks when the video is missing (no publish requested)", async () => {
    let invoked = false;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const noVideo = baseArtifacts().filter((a) => a.kind !== "video_report");
    const result = await agent.execute({ context: {}, input: input(noVideo) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
    strictEqual(invoked, false);
  });

  it("blocks when the video is not completed", async () => {
    let invoked = false;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain.find((a) => a.kind === "video_report").payload.status = "blocked";
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks when the video lacks execution evidence", async () => {
    let invoked = false;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain.find((a) => a.kind === "video_report").payload.executionEvidencePresent = false;
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks when the final QA gate is not passed", async () => {
    let invoked = false;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain.find((a) => a.kind === "qa_report").payload.status = "blocked";
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks when the brand gate is not approved", async () => {
    let invoked = false;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain.find((a) => a.kind === "brand_report").payload.status = "rejected";
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks when an upstream artifact is blocked/failed", async () => {
    let invoked = false;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capCompleted(); } } });
    const chain = baseArtifacts();
    chain[1].status = "failed";
    const result = await agent.execute({ context: {}, input: input(chain) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(invoked, false);
  });

  it("never claims completion when the capability was blocked or failed", async () => {
    const blocked = { status: "blocked", resultId: "blocked-1", capabilityId: PUBLISH_CAPABILITY_ID, reason: "Not authorized" };
    const agent = createPublisherAgent({ config: {}, capabilityExecution: boundary(blocked) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
    strictEqual(result.output.publicationId, "");

    const failed = { status: "failed", resultId: "failed-1", capabilityId: PUBLISH_CAPABILITY_ID, error: { code: "PROVIDER_ERROR", message: "down", retryable: true }, evidence: { evidenceId: "e-1", capabilityId: PUBLISH_CAPABILITY_ID, operation: "publish", providerId: "fake-publish", providerInvoked: true, workflowId: "workflow-1", correlationId: "correlation-1", agentId: "publisher", executedAt: "2026-08-14T00:00:00.000Z", durationMs: 1, succeeded: false, resultStatus: "failed" } };
    const agent2 = createPublisherAgent({ config: {}, capabilityExecution: boundary(failed) });
    const result2 = await agent2.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result2.output.status, "blocked");
    strictEqual(result2.output.executionEvidencePresent, false);
  });

  it("preserves workflowId and correlationId across the lineage", async () => {
    const agent = createPublisherAgent({ config: {}, capabilityExecution: boundary(capCompleted()) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.metadata.workflowId, "workflow-1");
    strictEqual(result.output.metadata.correlationId, "correlation-1");
  });

  it("rejects malformed publisher input", async () => {
    const agent = createPublisherAgent({ config: {}, capabilityExecution: boundary(capCompleted()) });
    await rejects(() => agent.execute({ context: {}, input: { requestId: "x", objective: "  " } }, signal), /Invalid publisher input/);
  });

  it("honors publish instructions as the description", async () => {
    let capturedRequest;
    const agent = createPublisherAgent({ config: {}, capabilityExecution: {
      executeCapability: async (request) => { capturedRequest = request; return capCompleted(); },
    } });
    await agent.execute({ context: {}, input: input(baseArtifacts(), { instructions: "A caption describing the video." }) }, signal);
    strictEqual(capturedRequest.input.description, "A caption describing the video.");
  });
});