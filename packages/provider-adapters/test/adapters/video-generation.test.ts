/** Video generation adapter tests against the Replicate mock. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { ReplicateVideoAdapter } from "@ai-media-factory/provider-adapters";
import { createReplicateMock } from "../helpers/mock-servers.ts";
import { isProviderError } from "@ai-media-factory/provider-adapters";

function adapterFor(mockUrl: string): ReplicateVideoAdapter {
  return new ReplicateVideoAdapter({
    apiToken: "t",
    baseUrl: `${mockUrl}/v1`,
    pollIntervalMs: 5,
    maxWaitMs: 2000,
    timeoutMs: 2000,
  });
}

describe("ReplicateVideoAdapter", () => {
  it("polls to completion and returns the provider-confirmed video", async (t) => {
    const mock = await createReplicateMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    const response = await adapter.generate({ prompt: "a moving landscape", aspectRatio: "16:9", durationSeconds: 5 });
    strictEqual(response.providerId, "replicate");
    strictEqual(response.status, "completed");
    ok(response.jobId !== undefined);
    strictEqual(response.videoId, response.jobId);
    strictEqual(response.url, "https://cdn.replicate.example/video.mp4");
    ok(mock.state.polls >= 1, "adapter must poll the provider");
  });

  it("reports failed when the provider fails the job", async (t) => {
    const mock = await createReplicateMock();
    t.after(() => mock.close());
    mock.state.mode = "fail";
    const adapter = adapterFor(mock.url);
    const response = await adapter.generate({ prompt: "x" });
    strictEqual(response.status, "failed");
    strictEqual(response.videoId, undefined, "failed job must not claim a video");
    ok(response.error !== undefined);
  });

  it("returns running (no videoId) when the job never completes before the deadline", async (t) => {
    const mock = await createReplicateMock();
    t.after(() => mock.close());
    mock.state.mode = "never-completes";
    const adapter = new ReplicateVideoAdapter({
      apiToken: "t",
      baseUrl: `${mock.url}/v1`,
      pollIntervalMs: 5,
      maxWaitMs: 60,
      timeoutMs: 1000,
    });
    const response = await adapter.generate({ prompt: "x" });
    strictEqual(response.status, "running");
    ok(response.jobId !== undefined);
    strictEqual(response.videoId, undefined, "unconfirmed completion must not carry a videoId");
  });

  it("reports failed when the provider completes without a renderable output", async (t) => {
    const mock = await createReplicateMock();
    t.after(() => mock.close());
    mock.state.mode = "no-output";
    const adapter = adapterFor(mock.url);
    const response = await adapter.generate({ prompt: "x" });
    strictEqual(response.status, "failed");
    ok((response.error?.message ?? "").includes("renderable"));
  });

  it("classifies a failed submission and never retries it", async (t) => {
    const mock = await createReplicateMock();
    t.after(() => mock.close());
    mock.state.mode = "submit-fails";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ prompt: "x" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "TRANSIENT");
    }
    strictEqual(mock.state.submissions, 1, "submission POST must not be retried");
  });
});