import { createServer } from "node:http";
import { strictEqual, ok } from "node:assert";
import { describe, it } from "node:test";
import { RunPodWanVideoAdapter, createProviderCapabilityBoundary } from "@ai-media-factory/provider-adapters";
import { InMemoryPublishStore } from "./helpers/in-memory-stores.ts";

describe("RunPod Wan production boundary", () => {
  it("executes the complete runtime → routing → capability → registry → adapter chain with a mock provider", async (t) => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const video = Buffer.concat([Buffer.from("fake-mp4-"), Buffer.alloc(1200, 7)]).toString("base64");
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      requests.push({ method: req.method ?? "", url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") });
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST") {
        res.end(JSON.stringify({ id: "wan-job-1", status: "IN_QUEUE" }));
        return;
      }
      res.end(JSON.stringify({ id: "wan-job-1", status: "COMPLETED", output: { video } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("mock server did not bind");

    const endpoint = "ry49lc45y50ldy";
    const adapter = new RunPodWanVideoAdapter({ apiKey: "mock-key", endpointId: endpoint, baseUrl: `http://127.0.0.1:${address.port}`, pollIntervalMs: 1, maxWaitMs: 1000 });
    const { boundary } = createProviderCapabilityBoundary({
      adapters: { webSearch: {} as never, imageGeneration: {} as never, videoGeneration: adapter, publishing: {} as never, analytics: {} as never },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability({
      requestId: "wan-boundary-test",
      capabilityId: "video.generate",
      agentId: "video",
      workflowId: "wf-wan-test",
      correlationId: "corr-wan-test",
      requestedAt: new Date().toISOString(),
      input: { prompt: "restrained Cairo documentary motion", aspectRatio: "9:16", imageBase64: Buffer.from("png").toString("base64"), width: 480, height: 832, length: 81, steps: 10, cfg: 2, seed: 731449182, runtimeIdentity: `self-hosted-video:runpod:${endpoint}` },
    });

    strictEqual(result.status, "success");
    ok(result.evidence);
    strictEqual(result.evidence.providerInvoked, true);
    strictEqual(result.evidence.providerId, "self-hosted-video");
    strictEqual(result.evidence.jobId, "wan-job-1");
    strictEqual(requests.length, 2);
    strictEqual(requests[0].method, "POST");
    strictEqual(requests[1].method, "GET");
    ok(requests[0].body?.includes("731449182"));
    ok(requests[0].body?.includes("image_base64"));
  });

  it("fails closed when submission acknowledgement times out, without permitting a retry", async (t) => {
    let postCount = 0;
    const server = createServer((req, res) => {
      if (req.method === "POST") {
        postCount += 1;
        // Simulate RunPod accepting work but delaying the acknowledgement.
        setTimeout(() => {
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ id: "remote-job-after-timeout", status: "IN_QUEUE" }));
        }, 100);
        return;
      }
      res.end(JSON.stringify({ id: "remote-job-after-timeout", status: "IN_PROGRESS" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("mock server did not bind");

    const adapter = new RunPodWanVideoAdapter({ apiKey: "mock-key", endpointId: "endpoint", baseUrl: `http://127.0.0.1:${address.port}`, timeoutMs: 20, pollIntervalMs: 1, maxWaitMs: 1000, pollRetries: 0 });
    const { boundary } = createProviderCapabilityBoundary({
      adapters: { webSearch: {} as never, imageGeneration: {} as never, videoGeneration: adapter, publishing: {} as never, analytics: {} as never },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability({
      requestId: "wan-timeout-test",
      capabilityId: "video.generate",
      agentId: "video",
      workflowId: "wf-wan-timeout",
      correlationId: "corr-wan-timeout",
      requestedAt: new Date().toISOString(),
      input: { prompt: "preserve the scene", imageBase64: Buffer.from("png").toString("base64"), width: 480, height: 832, length: 81 },
    });

    strictEqual(result.status, "failed");
    if (result.status !== "failed") return;
    strictEqual(result.error.code, "RECONCILIATION_REQUIRED");
    strictEqual(result.error.retryable, false);
    strictEqual(result.evidence?.submissionState, "RECONCILIATION_REQUIRED");
    strictEqual(result.evidence?.initialClientResult, "TIMEOUT");
    strictEqual(result.evidence?.finalRemoteResult, "UNKNOWN");
    strictEqual(result.evidence?.reconciliationRequired, true);
    strictEqual(postCount, 1);
  });
});
