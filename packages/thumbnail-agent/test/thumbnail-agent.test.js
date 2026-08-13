import { describe, it } from "node:test";
import { strictEqual, ok, rejects } from "node:assert";
import { createThumbnailAgent } from "../dist/index.js";
import { IMAGE_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";

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
      createdAt: "2026-08-13T00:00:00.000Z",
      parentArtifact: undefined,
      payload: { reportId: "r", taskDescription: "Research", summary: "ok", sources: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-writer",
      kind: "writer_report",
      producerAgent: "writer",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-13T00:00:00.000Z",
      parentArtifact: { artifactId: "a-research", kind: "research_report" },
      payload: { contentId: "w", taskDescription: "Write", objective: "Write", title: "Modern Media Pipelines", content: "Event-driven pipelines enable scalable media production.", summary: "sum", sourceReferences: [], status: "completed", metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-seo",
      kind: "seo_report",
      producerAgent: "seo",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-13T00:00:00.000Z",
      parentArtifact: { artifactId: "a-writer", kind: "writer_report" },
      payload: { reportId: "s", taskDescription: "SEO", objective: "Optimize", optimizedTitle: "Build Scalable Media Pipelines", optimizedDescription: "d", keywords: [], topics: [], searchIntent: "informational", contentStructure: [], status: "completed", metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-brand",
      kind: "brand_report",
      producerAgent: "brand",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-13T00:00:00.000Z",
      parentArtifact: { artifactId: "a-seo", kind: "seo_report" },
      payload: { reportId: "b", taskDescription: "Brand", objective: "Gate", status: "approved", issues: [], passedChecks: [], failedChecks: [], recommendations: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
    {
      artifactId: "a-review",
      kind: "review_report",
      producerAgent: "reviewer",
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      status: "completed",
      createdAt: "2026-08-13T00:00:00.000Z",
      parentArtifact: { artifactId: "a-brand", kind: "brand_report" },
      payload: { reportId: "v", taskDescription: "Review", status: "approved", summary: "ok", findings: [], metadata: { createdAt: "2026-08-13T00:00:00.000Z", agentVersion: "1.0.0" } },
    },
  ];
}

function input(artifacts, extra = {}) {
  return {
    requestId: "00000000-0000-4000-8000-000000000001",
    objective: "Generate a thumbnail for the approved article",
    taskDescription: "Generate a thumbnail",
    validatedArtifacts: artifacts,
    ...extra,
  };
}

function capSuccess() {
  return {
    status: "success",
    resultId: "image-generation-result-thumbnail-00000000-0000-4000-8000-000000000001",
    capabilityId: IMAGE_GENERATION_CAPABILITY_ID,
    output: { providerId: "fake-image", imageId: "img-0001", title: "Generated Thumbnail", url: "https://cdn.example.com/img-0001.png" },
    evidence: {
      evidenceId: "evidence-image-generation-result-thumbnail-00000000-0000-4000-8000-000000000001",
      capabilityId: IMAGE_GENERATION_CAPABILITY_ID,
      operation: "generate",
      providerId: "fake-image",
      imageId: "img-0001",
      providerInvoked: true,
      workflowId: "workflow-1",
      correlationId: "correlation-1",
      agentId: "thumbnail",
      executedAt: "2026-08-13T00:00:00.000Z",
      durationMs: 1,
      succeeded: true,
      resultStatus: "success",
    },
  };
}

function boundary(result) {
  return {
    executeCapability: async (request) => {
      if (request.capabilityId !== IMAGE_GENERATION_CAPABILITY_ID) {
        return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
      }
      strictEqual(request.agentId, "thumbnail");
      strictEqual(typeof request.input.prompt, "string");
      strictEqual(request.input.prompt.length > 0, true);
      return result;
    },
  };
}

describe("ThumbnailAgent", () => {
  it("produces a completed thumbnail report with matching runtime evidence", async () => {
    const agent = createThumbnailAgent({ config: {}, capabilityExecution: boundary(capSuccess()) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "completed");
    strictEqual(result.output.executionEvidencePresent, true);
    strictEqual(result.output.imageId, "img-0001");
    strictEqual(result.output.providerId, "fake-image");
    strictEqual(result.output.capabilityExecutions[0].status, "success");
  });

  it("derives the prompt from the SEO optimized title", async () => {
    let capturedRequest;
    const agent = createThumbnailAgent({ config: {}, capabilityExecution: { executeCapability: async (request) => { capturedRequest = request; return capSuccess(); } } });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    ok(result.output.status, "completed");
    ok(capturedRequest.input.prompt.includes("Build Scalable Media Pipelines"));
    strictEqual(capturedRequest.input.aspectRatio, "16:9");
  });

  it("blocks when the content chain is not viable (no image generation requested)", async () => {
    let invoked = false;
    const agent = createThumbnailAgent({ config: {}, capabilityExecution: { executeCapability: async () => { invoked = true; return capSuccess(); } } });
    const result = await agent.execute({ context: {}, input: input([]) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
    strictEqual(invoked, false);
  });

  it("never claims completion when the capability was blocked", async () => {
    const blocked = { status: "blocked", resultId: "blocked-1", capabilityId: IMAGE_GENERATION_CAPABILITY_ID, reason: "Not authorized" };
    const agent = createThumbnailAgent({ config: {}, capabilityExecution: boundary(blocked) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
    strictEqual(result.output.imageId, "");
  });

  it("never claims completion when the capability failed", async () => {
    const failed = { status: "failed", resultId: "failed-1", capabilityId: IMAGE_GENERATION_CAPABILITY_ID, error: { code: "PROVIDER_ERROR", message: "down", retryable: false } };
    const agent = createThumbnailAgent({ config: {}, capabilityExecution: boundary(failed) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.executionEvidencePresent, false);
  });

  it("does not claim completion when evidence does not match the context", async () => {
    const mismatched = {
      status: "success",
      resultId: "image-generation-result-thumbnail-00000000-0000-4000-8000-000000000001",
      capabilityId: IMAGE_GENERATION_CAPABILITY_ID,
      output: { providerId: "fake-image", imageId: "img-0002", title: "T", url: "https://cdn.example.com/img-0002.png" },
      evidence: {
        evidenceId: "e-1",
        capabilityId: IMAGE_GENERATION_CAPABILITY_ID,
        operation: "generate",
        providerId: "fake-image",
        imageId: "img-0002",
        providerInvoked: true,
        workflowId: "other-workflow",
        correlationId: "other-correlation",
        agentId: "thumbnail",
        executedAt: "2026-08-13T00:00:00.000Z",
        durationMs: 1,
        succeeded: true,
        resultStatus: "success",
      },
    };
    const agent = createThumbnailAgent({ config: {}, capabilityExecution: boundary(mismatched) });
    const result = await agent.execute({ context: {}, input: input(baseArtifacts()) }, signal);
    strictEqual(result.output.status, "failed");
    strictEqual(result.output.executionEvidencePresent, false);
  });

  it("rejects malformed thumbnail input", async () => {
    const agent = createThumbnailAgent({ config: {}, capabilityExecution: boundary(capSuccess()) });
    await rejects(() => agent.execute({ context: {}, input: { requestId: "x", objective: "  " } }, signal), /Invalid thumbnail input/);
  });
});