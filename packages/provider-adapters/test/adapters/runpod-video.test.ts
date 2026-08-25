import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { RunPodWanVideoAdapter } from "@ai-media-factory/provider-adapters";
import { createRunPodVideoMock } from "../helpers/mock-servers.ts";

const SAMPLE_B64 = Buffer.alloc(64, 0x42).toString("base64").padEnd(600, "A");

function adapterFor(mockUrl: string, endpointId = "test-video-endpoint", config: Record<string, unknown> = {}) {
  return new RunPodWanVideoAdapter({
    apiKey: "sk-test",
    endpointId,
    baseUrl: mockUrl,
    timeoutMs: 5000,
    pollIntervalMs: 100,
    maxWaitMs: 3000,
    pollRetries: 0,
    ...config,
  });
}

describe("RunPodWanVideoAdapter", () => {
  it("maps provider response to video URL with providerId", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    const res = await adapter.generate({ prompt: "a cat video", imageBase64: SAMPLE_B64 });
    strictEqual(res.providerId, "self-hosted-video");
    strictEqual(res.status, "completed");
    ok(res.videoId?.startsWith("job-v123"));
    ok(res.url?.startsWith("data:video/mp4;base64,"), "url is data video");
  });

  it("sends RunPod-shaped request with prompt, image_base64 and Authorization Bearer", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ prompt: "hello wan", imageBase64: SAMPLE_B64, width: 480, height: 832 });
    ok(mock.state.lastRunBody !== null);
    const input = (mock.state.lastRunBody as Record<string, unknown>).input as Record<string, unknown>;
    strictEqual(input.prompt, "hello wan");
    ok((input.image_base64 as string).length > 100, "image_base64 must be forwarded");
    strictEqual(input.width, 480);
    strictEqual(input.height, 832);
    ok(mock.state.lastRunHeaders["authorization"]?.includes("Bearer sk-test"));
  });

  it("strips data: prefix from imageBase64", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ prompt: "p", imageBase64: `data:image/png;base64,${SAMPLE_B64}` });
    const input = (mock.state.lastRunBody as Record<string, unknown>).input as Record<string, unknown>;
    ok(!(input.image_base64 as string).startsWith("data:"), "must strip data: prefix");
  });

  it("throws a classified authorization error on 401", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    mock.state.runStatus = 401;
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) {
      ok((e as { category?: string }).category === "AUTHORIZATION" || String(e).includes("401"));
    }
  });

  it("classifies provider FAILED as validation failure", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    mock.state.pollStatus = "FAILED";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) { ok(String(e).includes("FAILED")); }
  });

  it("throws validation error on missing video data", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    mock.state.completeMode = "no-video";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) { ok(String(e).includes("without video data")); }
  });

  it("throws validation error on invalid base64", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    mock.state.completeMode = "invalid-b64";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) { ok(String(e).includes("not valid base64")); }
  });

  it("throws validation error on malformed provider data", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    mock.state.completeMode = "malformed";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) { ok(String(e).includes("non-object")); }
  });

  it("retries poll on transient 500 then succeeds", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    mock.state.pollFailuresLeft = 1;
    const adapter = new RunPodWanVideoAdapter({ apiKey: "k", endpointId: "ep", baseUrl: mock.url, pollRetries: 2, pollIntervalMs: 50, maxWaitMs: 3000, timeoutMs: 2000 });
    const res = await adapter.generate({ prompt: "p", imageBase64: SAMPLE_B64 });
    strictEqual(res.status, "completed");
  });
});

describe("RunPodWanVideoAdapter config", () => {
  it("requires apiKey", () => {
    try { new RunPodWanVideoAdapter({ apiKey: "", endpointId: "ep" }); ok(false); } catch (e) { ok(String(e).includes("apiKey")); }
  });
  it("requires endpointId", () => {
    try { new RunPodWanVideoAdapter({ apiKey: "k", endpointId: "" }); ok(false); } catch (e) { ok(String(e).includes("endpointId")); }
  });
});
