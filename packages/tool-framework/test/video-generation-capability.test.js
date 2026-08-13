import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { VideoGenerationCapabilityExecutor } from "../dist/index.js";

const descriptor = { capabilityId: "video.generate", description: "Generate a video", inputSchema: { type: "object" }, outputSchema: { type: "object" } };

let requestNumber = 0;
function request(input, agentId = "video", capabilityId = "video.generate") {
  requestNumber += 1;
  return { requestId: `video-${requestNumber}`, capabilityId, agentId, workflowId: "workflow-video", correlationId: "correlation-video", input, requestedAt: "2026-08-14T00:00:00.000Z" };
}

function setup(provider, authorized = true) {
  const calls = [];
  const resolver = {
    resolve: (capabilityId) => capabilityId === "video.generate" ? descriptor : null,
    isAuthorized: (agentId, capabilityId) => authorized && agentId === "video" && capabilityId === "video.generate",
  };
  const wrappedProvider = {
    generate: async (value) => { calls.push(value); return provider(value); },
  };
  return { calls, executor: new VideoGenerationCapabilityExecutor(wrappedProvider, resolver, { maxPromptLength: 200, maxNegativePromptLength: 200, maxDurationSeconds: 120, allowedAspectRatios: ["16:9", "9:16", "1:1"], maxSourceAssets: 4 }) };
}

const completed = (overrides = {}) => ({
  providerId: "fake-video",
  status: "completed",
  jobId: "job-0001",
  videoId: "vid-0001",
  url: "https://cdn.example.com/vid-0001.mp4",
  title: "Generated Video",
  durationSeconds: 30,
  width: 1920,
  height: 1080,
  ...overrides,
});

describe("VideoGenerationCapabilityExecutor", () => {
  it("executes a valid generation through the injected provider and confirms completion", async () => {
    const { executor, calls } = setup(async (value) => completed());
    const result = await executor.execute(request({ prompt: "A cinematic media pipeline video", durationSeconds: 30, aspectRatio: "16:9" }));
    strictEqual(result.status, "success");
    strictEqual(calls[0].prompt, "A cinematic media pipeline video");
    strictEqual(calls[0].durationSeconds, 30);
    strictEqual(calls[0].aspectRatio, "16:9");
    strictEqual(result.output.providerId, "fake-video");
    strictEqual(result.output.videoId, "vid-0001");
    strictEqual(result.output.url, "https://cdn.example.com/vid-0001.mp4");
  });

  it("produces truthful completion evidence and preserves context", async () => {
    const { executor } = setup(async () => completed());
    const result = await executor.execute(request({ prompt: "evidence", durationSeconds: 20 }));
    strictEqual(result.status, "success");
    strictEqual(result.evidence.capabilityId, "video.generate");
    strictEqual(result.evidence.operation, "generate");
    strictEqual(result.evidence.providerId, "fake-video");
    strictEqual(result.evidence.providerInvoked, true);
    strictEqual(result.evidence.jobId, "job-0001");
    strictEqual(result.evidence.videoId, "vid-0001");
    strictEqual(result.evidence.videoStatus, "completed");
    strictEqual(result.evidence.succeeded, true);
    strictEqual(result.evidence.workflowId, "workflow-video");
    strictEqual(result.evidence.correlationId, "correlation-video");
    strictEqual(result.evidence.agentId, "video");
  });

  it("blocks unauthorized generation without invoking the provider", async () => {
    let invoked = false;
    const { executor } = setup(async () => { invoked = true; return completed(); }, false);
    const result = await executor.execute(request({ prompt: "blocked" }));
    strictEqual(result.status, "blocked");
    strictEqual(invoked, false);
    strictEqual(result.evidence, undefined);
  });

  it("blocks unregistered capability without invoking the provider", async () => {
    let invoked = false;
    const { executor } = setup(async () => { invoked = true; return completed(); });
    const result = await executor.execute(request({ prompt: "unknown" }, "video", "video.make"));
    strictEqual(result.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks empty, oversized, invalid-aspect, and invalid-duration queries", async () => {
    const { executor } = setup(async () => completed());
    strictEqual((await executor.execute(request({ prompt: "   " }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "x".repeat(201) }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "valid", aspectRatio: "5:4" }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "valid", durationSeconds: 0 }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "valid", durationSeconds: 5000 }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "valid", sourceAssetIds: Array.from({ length: 5 }, (_, i) => `asset-${i}`) }))).status, "blocked");
  });

  it("represents provider throw as FAILED with failure evidence", async () => {
    const { executor } = setup(async () => { throw new Error("provider unavailable"); });
    const result = await executor.execute(request({ prompt: "failure" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "PROVIDER_ERROR");
    strictEqual(result.evidence.providerInvoked, true);
    strictEqual(result.evidence.succeeded, false);
  });

  it("represents a provider-reported failure as FAILED", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-video", status: "failed", jobId: "job-fail", error: { code: "RENDER_ERROR", message: "render exploded" } }));
    const result = await executor.execute(request({ prompt: "fail" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "RENDER_ERROR");
    strictEqual(result.evidence.videoStatus, "failed");
    strictEqual(result.evidence.jobId, "job-fail");
  });

  it("treats a submitted job as NOT completed and preserves the jobId", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-video", status: "submitted", jobId: "job-sub" }));
    const result = await executor.execute(request({ prompt: "submitted" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "VIDEO_NOT_COMPLETED");
    strictEqual(result.error.retryable, true);
    strictEqual(result.evidence.videoStatus, "submitted");
    strictEqual(result.evidence.jobId, "job-sub");
    strictEqual(result.evidence.succeeded, false);
  });

  it("treats a running job as NOT completed", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-video", status: "running", jobId: "job-run" }));
    const result = await executor.execute(request({ prompt: "running" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "VIDEO_NOT_COMPLETED");
    strictEqual(result.evidence.videoStatus, "running");
    strictEqual(result.evidence.succeeded, false);
  });

  it("rejects a malformed completed provider result without fabricating success", async () => {
    const { executor } = setup(async () => completed({ videoId: "" }));
    const result = await executor.execute(request({ prompt: "malformed" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });

  it("rejects a completed result with an invalid asset url without fabrication", async () => {
    const { executor } = setup(async () => completed({ url: "not-a-url" }));
    const result = await executor.execute(request({ prompt: "bad url" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });

  it("never lets a non-completed provider state become success", async () => {
    for (const status of ["submitted", "running"]) {
      const { executor } = setup(async () => ({ providerId: "fake-video", status, jobId: "job-1" }));
      const result = await executor.execute(request({ prompt: `state-${status}` }));
      strictEqual(result.status, "failed");
      ok(result.output === undefined);
    }
  });
});