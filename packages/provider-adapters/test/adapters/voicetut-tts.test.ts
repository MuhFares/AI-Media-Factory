/** Unit tests: VoiceTuT TTS adapter (RunPod serverless pattern). */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  VoicetutTTSAdapter,
  ProviderConfigurationError,
  isProviderError,
  SubmissionOutcomeUnknownError,
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
  it("durably captures acknowledgement before polling and resumes by status without a second run", async (t) => {
    const mock = await createVoicetutTTSMock();
    t.after(() => mock.close());
    let providerJobId: string | null = null;
    let crashAfterCapture = true;
    const phases: string[] = [];
    const lifecycle = {
      findAcknowledged: async () => providerJobId === null ? null : { providerJobId },
      persistIntent: async () => { phases.push("SUBMISSION_INTENT"); },
      persistPhase: async (_identity: unknown, phase: string) => { phases.push(phase); },
      persistAcknowledged: async (_identity: unknown, id: string) => {
        providerJobId = id;
        phases.push("PROVIDER_JOB_ID_CAPTURED_DURABLY");
        if (crashAfterCapture) { crashAfterCapture = false; throw new Error("simulated process stop after durable acknowledgement"); }
      },
    };
    const request = { text: "one chunk", voice: "Mohamed", logicalSubmissionId: "logical-r3-1", workflowId: "wf-r3", textFingerprint: "a".repeat(64), configurationFingerprint: "b".repeat(64) };
    const first = adapterFor(mock.url, { submissionLifecycle: lifecycle });
    await first.generate(request).then(() => ok(false, "expected simulated stop"), (error) => ok(String(error).includes("simulated process stop")));
    strictEqual(mock.state.submissions, 1);
    strictEqual(mock.state.polls, 0);
    strictEqual(providerJobId, "vt-job-1");
    const recovered = await adapterFor(mock.url, { submissionLifecycle: lifecycle }).generate(request);
    strictEqual(recovered.providerId, "voicetut");
    strictEqual(mock.state.submissions, 1);
    ok(mock.state.polls >= 1);
    ok(phases.indexOf("PROVIDER_JOB_ID_CAPTURED_DURABLY") < phases.indexOf("PROVIDER_JOB_STATUS"));
  });

  it("retains safe receipt-unknown transport diagnostics and never retries submit", async (t) => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      const cause = Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" });
      throw Object.assign(new TypeError("fetch failed"), { cause });
    }) as typeof fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    const adapter = adapterFor("https://api.runpod.ai/v2");
    await adapter.generate({ text: "provider-free transport test", voice: "Mohamed" }).then(
      () => ok(false, "expected throw"),
      (error) => {
        ok(error instanceof SubmissionOutcomeUnknownError);
        strictEqual(error.retryable, false);
        strictEqual(error.providerAccepted, "unknown");
        strictEqual(error.providerReceiptStatus, "UNKNOWN");
        strictEqual(error.transportDiagnostic, "DNS_ERROR");
        strictEqual(error.safeCauseCode, "ENOTFOUND");
        strictEqual(error.transportPhase, "FETCH_INVOCATION_STARTED");
        strictEqual(String(error).includes("rpa-test"), false);
        strictEqual(String(error).includes("vt-endpoint"), false);
      },
    );
    strictEqual(calls, 1);
  });

  it("classifies a locally denied fetch without claiming provider non-receipt", async (t) => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("access denied"), { code: "EACCES" }),
      });
    }) as typeof fetch;
    t.after(() => { globalThis.fetch = originalFetch; });
    await adapterFor("https://api.runpod.ai/v2").generate({ text: "offline mocked failure", voice: "Mohamed" }).then(
      () => ok(false, "expected throw"),
      (error) => {
        ok(error instanceof SubmissionOutcomeUnknownError);
        strictEqual(error.safeCauseCode, "EACCES");
        strictEqual(error.transportDiagnostic, "LOCAL_TRANSPORT_ACCESS_RESTRICTION");
        strictEqual(error.providerReceiptStatus, "UNKNOWN");
        strictEqual(error.retryable, false);
      },
    );
    strictEqual(calls, 1);
  });

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
