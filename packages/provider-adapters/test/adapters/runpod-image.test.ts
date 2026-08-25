import { describe, it } from "node:test";
import { strictEqual, ok, match } from "node:assert";
import { RunPodComfyUIImageAdapter } from "@ai-media-factory/provider-adapters";
import { createRunPodMock } from "../helpers/mock-servers.ts";

const VALID_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString("base64").padEnd(120, "A");

function adapterFor(mockUrl: string, endpointId = "test-endpoint", config: Record<string, unknown> = {}) {
  return new RunPodComfyUIImageAdapter({
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

describe("RunPodComfyUIImageAdapter", () => {
  it("maps provider results into capability results with providerId and data URL", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.mode = "ok";
    const adapter = adapterFor(mock.url);
    const res = await adapter.generate({ prompt: "a cat", aspectRatio: "1:1" });
    strictEqual(res.providerId, "self-hosted-image");
    ok(res.imageId.startsWith("runpod-"), "imageId prefixed");
    ok(res.url.startsWith("data:image/png;base64,"), "url is data URL");
    strictEqual(res.title, "a cat");
  });

  it("sends RunPod-shaped request with workflow and auth header", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ prompt: "hello world", aspectRatio: "16:9" });
    ok(mock.state.lastRunBody !== null, "must have captured run body");
    const body = mock.state.lastRunBody as Record<string, unknown>;
    const input = (body.input as Record<string, unknown>);
    ok((input.workflow as Record<string, unknown>)["6"], "workflow must contain CLIPTextEncode node 6");
    const n6 = (input.workflow as Record<string, unknown>)["6"] as Record<string, unknown>;
    strictEqual(((n6.inputs as Record<string, unknown>).text), "hello world");
    ok(mock.state.lastRunHeaders["authorization"]?.includes("Bearer sk-test"), "auth header must be Bearer");
  });

  it("maps width/height via aspectRatio", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ prompt: "p", aspectRatio: "16:9" });
    const wf = mock.state.lastRunBody.input.workflow as Record<string, unknown>;
    const latent = (wf["27"] as Record<string, unknown>).inputs as Record<string, unknown>;
    strictEqual(latent.width, 1344);
    strictEqual(latent.height, 768);
  });

  it("throws a classified authorization error on 401", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.runStatus = 401;
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) {
      const err = e as { category?: string };
      ok(err.category === "AUTHORIZATION" || String(e).includes("401"), "must be authorization");
    }
  });

  it("classifies provider FAILED as validation failure", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.pollStatus = "FAILED";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) {
      const err = e as { category?: string };
      ok(err.category === "VALIDATION" || String(e).includes("FAILED"));
    }
  });

  it("classifies provider CANCELLED as validation failure", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.pollStatus = "CANCELLED";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) {
      ok(String(e).includes("CANCELLED"));
    }
  });

  it("throws validation error on missing image data", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.completeMode = "no-image";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) { ok(String(e).includes("without image data")); }
  });

  it("throws validation error on invalid base64", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.completeMode = "invalid-b64";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) { ok(String(e).includes("not valid base64")); }
  });

  it("throws validation error on malformed provider data", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.completeMode = "malformed";
    const adapter = adapterFor(mock.url);
    try { await adapter.generate({ prompt: "p" }); ok(false); } catch (e) { ok(String(e).includes("non-object")); }
  });

  it("retries poll on transient 500 then succeeds", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    mock.state.pollFailuresLeft = 1;
    const adapter = new RunPodComfyUIImageAdapter({ apiKey: "k", endpointId: "ep", baseUrl: mock.url, pollRetries: 2, pollIntervalMs: 50, maxWaitMs: 3000, timeoutMs: 2000 });
    const res = await adapter.generate({ prompt: "p" });
    strictEqual(res.providerId, "self-hosted-image");
  });
});

describe("RunPodComfyUIImageAdapter config", () => {
  it("requires apiKey", () => {
    try { new RunPodComfyUIImageAdapter({ apiKey: "", endpointId: "ep" }); ok(false); } catch (e) { ok(String(e).includes("apiKey")); }
  });
  it("requires endpointId", () => {
    try { new RunPodComfyUIImageAdapter({ apiKey: "k", endpointId: "" }); ok(false); } catch (e) { ok(String(e).includes("endpointId")); }
  });
  it("builds deterministic workflow for given request", () => {
    const wf = RunPodComfyUIImageAdapter.buildWorkflowForTest({ prompt: "test", aspectRatio: "1:1" });
    ok(wf["6"] && wf["30"] && wf["27"]);
  });
});
