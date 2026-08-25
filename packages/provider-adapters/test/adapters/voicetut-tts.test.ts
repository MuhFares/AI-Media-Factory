/** Unit tests: VoiceTuT TTS adapter (RunPod serverless pattern). */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  VoicetutTTSAdapter,
  ProviderConfigurationError,
  isProviderError,
} from "@ai-media-factory/provider-adapters";
import { createVoicetutTTSMock } from "../helpers/mock-servers.ts";

function adapterFor(mockUrl: string, config: Record<string, unknown> = {}) {
  return new VoicetutTTSAdapter({
    apiKey: "rpa-test",
    endpointId: "vt-endpoint",
    baseUrl: mockUrl,
    timeoutMs: 5000,
    pollIntervalMs: 50,
    maxWaitMs: 3000,
    pollRetries: 0,
    ...config,
  });
}

describe("VoicetutTTSAdapter", () => {
  it("generates a data URL WAV through run+poll", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    const res = await adapter.generate({ text: "ازيك عامل ايه", language: "ar" });
    strictEqual(res.providerId, "voicetut");
    ok(res.url.startsWith("data:audio/wav;base64,"));
    ok(res.audioId.startsWith("voicetut-"));
    strictEqual(res.format, "wav");
    strictEqual(res.voice, "Mohamed");
    strictEqual(res.model, "voicetut-tts");
  });

  it("sends the RunPod-shaped request with Bearer auth", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ text: "hello egypt", voice: "Asmaa" });
    ok(mock.state.lastRunBody !== null);
    const input = mock.state.lastRunBody?.input as Record<string, unknown>;
    strictEqual(input.text, "hello egypt");
    strictEqual(input.voice, "Asmaa");
    strictEqual(input.format, "wav");
    ok(mock.state.lastRunHeaders["authorization"] === "Bearer rpa-test");
  });

  it("classifies 401 as authorization failure", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    mock.state.submitStatus = 401;
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "p" });
      ok(false, "expected throw");
    } catch (e) {
      ok(isProviderError(e));
      strictEqual((e as ProviderConfigurationError).category, "AUTHORIZATION");
    }
  });

  it("classifies job FAILED as validation failure", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    mock.state.jobStatus = "FAILED";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "p" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("FAILED"));
    }
  });

  it("surfaces handler errors truthfully", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    mock.state.audioMode = "handler-error";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "p" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("model exploded"));
    }
  });

  it("throws validation on empty audio output", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    mock.state.audioMode = "empty";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "p" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("without audio data"));
    }
  });

  it("throws validation on non-WAV audio bytes", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    mock.state.audioMode = "not-wav";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "p" });
      ok(false, "expected throw");
    } catch (e) {
      const msg = String(e);
      ok(msg.includes("not a valid WAV") || msg.includes("not valid base64"), `got: ${msg}`);
    }
  });

  it("retries poll on transient 5xx then succeeds", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    mock.state.pollFailuresLeft = 1;
    const adapter = new VoicetutTTSAdapter({
      apiKey: "k",
      endpointId: "ep",
      baseUrl: mock.url,
      pollRetries: 2,
      pollIntervalMs: 50,
      maxWaitMs: 3000,
      timeoutMs: 2000,
    });
    const res = await adapter.generate({ text: "p" });
    strictEqual(res.status === undefined, true);
    ok(res.url.startsWith("data:audio/wav;base64,"));
  });

  it("rejects unsupported format", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "p", format: "mp3" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("wav"));
    }
  });
});

describe("VoicetutTTSAdapter config", () => {
  it("requires apiKey", () => {
    try {
      new VoicetutTTSAdapter({ apiKey: "", endpointId: "ep" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("apiKey"));
    }
  });
  it("requires endpointId", () => {
    try {
      new VoicetutTTSAdapter({ apiKey: "k", endpointId: "" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("endpointId"));
    }
  });
});
