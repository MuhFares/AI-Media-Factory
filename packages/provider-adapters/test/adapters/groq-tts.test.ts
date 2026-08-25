/** Unit tests: Groq TTS adapter + TTS provider registry. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  GroqTTSAdapter,
  chunkText,
  TTSProviderRegistry,
  ttsAdapterFromEnv,
  ProviderConfigurationError,
  isProviderError,
} from "@ai-media-factory/provider-adapters";
import { createGroqTTSMock } from "../helpers/mock-servers.ts";

const VALID_WAV_BASE64 = Buffer.from(
  (() => {
    const buf = Buffer.alloc(1024);
    buf.write("RIFF", 0);
    return buf;
  })(),
).toString("base64");

function adapterFor(mockUrl: string, config: Record<string, unknown> = {}) {
  return new GroqTTSAdapter({ apiKey: "gsk-test", baseUrl: mockUrl, timeoutMs: 5000, maxRetries: 0, ...config });
}

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    strictEqual(chunkText("hello world", 200).length, 1);
  });
  it("splits long Arabic text at sentence boundaries within 200 chars", () => {
    const long = "جملة أولى هنا. جملة ثانية هناك. ".repeat(20);
    const chunks = chunkText(long, 200);
    ok(chunks.length > 1, "must split");
    for (const c of chunks) ok(c.length <= 200, `chunk too long: ${c.length}`);
    ok(chunks.every((c) => c.trim().length > 0));
  });
  it("hard-splits an over-long sentence at word boundaries", () => {
    const long = "word ".repeat(120);
    const chunks = chunkText(long, 200);
    ok(chunks.length > 1);
    for (const c of chunks) ok(c.length <= 200);
  });
});

describe("GroqTTSAdapter", () => {
  it("generates a data URL WAV for short English text", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    const res = await adapter.generate({ text: "Hello narration", language: "en" });
    strictEqual(res.providerId, "groq");
    ok(res.url.startsWith("data:audio/wav;base64,"), "must be wav data URL");
    ok(res.audioId.startsWith("groq-"));
    strictEqual(res.format, "wav");
    strictEqual(res.model, "canopylabs/orpheus-v1-english");
    strictEqual(res.voice, "troy");
  });

  it("maps Arabic language to the arabic-saudi model and default voice", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ text: "مرحبا بالعالم", language: "ar" });
    strictEqual(mock.state.lastBody?.model, "canopylabs/orpheus-arabic-saudi");
    strictEqual(mock.state.lastBody?.voice, "fahad");
    strictEqual(mock.state.lastBody?.response_format, "wav");
  });

  it("detects Arabic script without a language hint", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ text: "نص عربي بدون لغة" });
    strictEqual(mock.state.lastBody?.model, "canopylabs/orpheus-arabic-saudi");
  });

  it("sends Bearer auth header", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    await adapter.generate({ text: "hi", language: "en" });
    ok(mock.state.lastHeaders["authorization"] === "Bearer gsk-test", "must be Bearer gsk-test");
  });

  it("passes Arabic text unchanged in the request body", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    const text = "اليوم سنستكشف كيف يغيّر الذكاء الاصطناعي طريقة عمل الشركات.";
    await adapter.generate({ text, language: "ar" });
    strictEqual(mock.state.lastBody?.input, text);
  });

  it("chunks long text into multiple provider calls and merges WAVs", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    const long = "جملة قصيرة هنا. ".repeat(40); // > 200 chars
    const res = await adapter.generate({ text: long, language: "ar" });
    ok(mock.state.requests > 1, `expected multiple calls, got ${mock.state.requests}`);
    ok(res.url.startsWith("data:audio/wav;base64,"));
  });

  it("rejects unsupported format (mp3) as validation", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en", format: "mp3" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("wav"));
    }
  });

  it("rejects unknown voice as validation", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en", voice: "nonexistent" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("voice"));
    }
  });

  it("classifies 401 as authorization failure", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    mock.state.statusMode = "unauthorized";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en" });
      ok(false, "expected throw");
    } catch (e) {
      ok(isProviderError(e));
      strictEqual((e as ProviderConfigurationError).category, "AUTHORIZATION");
    }
  });

  it("classifies 403 as authorization failure", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    mock.state.statusMode = "forbidden";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en" });
      ok(false, "expected throw");
    } catch (e) {
      ok(isProviderError(e));
      strictEqual((e as ProviderConfigurationError).category, "AUTHORIZATION");
    }
  });

  it("classifies 429 as transient", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    mock.state.statusMode = "rate-limited";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en" });
      ok(false, "expected throw");
    } catch (e) {
      ok(isProviderError(e));
      strictEqual((e as ProviderConfigurationError).category, "TRANSIENT");
    }
  });

  it("classifies 5xx as transient and exhausts retries", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    mock.state.statusMode = "server-error";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en" });
      ok(false, "expected throw");
    } catch (e) {
      ok(isProviderError(e));
      strictEqual((e as ProviderConfigurationError).category, "TRANSIENT");
    }
  });

  it("throws validation on empty audio", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    mock.state.audioMode = "empty";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("empty") || String(e).includes("non-WAV"));
    }
  });

  it("throws validation on non-WAV payload", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    mock.state.audioMode = "not-wav";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("non-WAV"));
    }
  });

  it("throws validation on JSON-instead-of-audio response", async (t) => {
    const mock = await createGroqTTSMock();
    t.after(() => mock.close());
    mock.state.audioMode = "malformed-json";
    const adapter = adapterFor(mock.url);
    try {
      await adapter.generate({ text: "hi", language: "en" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("non-WAV"));
    }
  });

  it("requires apiKey at construction", () => {
    try {
      new GroqTTSAdapter({ apiKey: "" });
      ok(false, "expected throw");
    } catch (e) {
      ok(String(e).includes("apiKey"));
    }
  });
});

describe("TTSProviderRegistry", () => {
  function fakeProvider(id: string) {
    return {
      providerId: id,
      generate: async () => ({
        providerId: id,
        audioId: `${id}-audio`,
        url: `data:audio/wav;base64,${VALID_WAV_BASE64}`,
        format: "wav" as const,
      }),
    };
  }

  it("routes to the first registered provider by default", async () => {
    const r = new TTSProviderRegistry();
    r.register(fakeProvider("groq"));
    strictEqual(r.activeProviderId, "groq");
    const res = await r.generate({ text: "hi" });
    strictEqual(res.providerId, "groq");
  });

  it("rejects selecting an unregistered provider", () => {
    const r = new TTSProviderRegistry();
    r.register(fakeProvider("groq"));
    try {
      r.setActive("chatterbox");
      ok(false, "expected throw");
    } catch (e) {
      ok(isProviderError(e));
    }
  });

  it("throws a classified CONFIGURATION error when no provider is active", async () => {
    const r = new TTSProviderRegistry();
    try {
      await r.generate({ text: "hi" });
      ok(false, "expected throw");
    } catch (e) {
      ok(isProviderError(e));
      strictEqual((e as ProviderConfigurationError).category, "CONFIGURATION");
    }
  });
});

describe("ttsAdapterFromEnv", () => {
  const backup = { ...process.env };
  function withEnv(c: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(c)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  function clear() {
    withEnv({ TTS_PROVIDER: undefined, GROQ_API_KEY: undefined, GROQ_BASE_URL: undefined });
  }

  it("registers groq when GROQ_API_KEY is present", () => {
    try {
      clear();
      withEnv({ GROQ_API_KEY: "k" });
      const r = ttsAdapterFromEnv();
      strictEqual(r.activeProviderId, "groq");
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("throws a classified CONFIGURATION error when no credential", () => {
    try {
      clear();
      try {
        ttsAdapterFromEnv();
        ok(false, "expected throw");
      } catch (e) {
        ok(isProviderError(e));
        strictEqual((e as ProviderConfigurationError).category, "CONFIGURATION");
      }
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("throws when TTS_PROVIDER requested but not configured", () => {
    try {
      clear();
      withEnv({ TTS_PROVIDER: "chatterbox", GROQ_API_KEY: "k" });
      try {
        ttsAdapterFromEnv();
        ok(false, "expected throw");
      } catch (e) {
        ok(String((e as Error).message).includes("TTS_PROVIDER"));
      }
    } finally {
      Object.assign(process.env, backup);
    }
  });
});
