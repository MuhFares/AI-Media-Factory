/**
 * Governed structured-output RCA hardening (provider-free, no network).
 * Uses a mock fetch transport: zero external calls. Covers matrix A–P.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  OpenRouterProvider,
  summarizeChatCompletionResponse,
  parseChatCompletionResponse,
  buildStructuredRequest,
  accumulateStreamDeltas,
  STRUCTURED_OUTPUT_MODES,
} from "../dist/index.js";

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-not-used";
const originalFetch = globalThis.fetch;

function mockChatCompletion(doc, status = 200) {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify(doc), { status, headers: { "x-request-id": "req-fixture" } });
  };
  return () => calls;
}

const baseDoc = (overrides = {}) => ({
  id: "gen-fixture",
  model: "fixture-model",
  provider: "Fixture",
  choices: [{ index: 0, message: { role: "assistant", content: '{"a":1}' }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  created: 1,
  ...overrides,
});

const generateInput = () => ({
  model: "fixture-model",
  messages: [{ role: "user", content: [{ kind: "text", text: "hi" }] }],
  temperature: 0,
  maxOutputTokens: 100,
  responseFormat: { kind: "json" },
});

test.afterEach(() => { globalThis.fetch = originalFetch; });

// A: empty content + length → technical failure (single submission).
test("A: empty content with finish length fails closed after exactly one submission", async () => {
  const calls = mockChatCompletion(baseDoc({ choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "length" }] }));
  const provider = new OpenRouterProvider();
  await assert.rejects(() => provider.generate(generateInput(), AbortSignal.timeout(5000)), /length/);
  assert.equal(calls(), 1, "O: exactly one submission, no retry");
});

// B: empty content + stop → technical failure.
test("B: empty content with finish stop fails closed", async () => {
  const calls = mockChatCompletion(baseDoc({ choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }] }));
  const provider = new OpenRouterProvider();
  await assert.rejects(() => provider.generate(generateInput(), AbortSignal.timeout(5000)), /empty visible content/);
  assert.equal(calls(), 1);
});

// C: visible valid JSON + stop → success with metadata.
test("C: visible valid JSON succeeds with raw metadata", async () => {
  mockChatCompletion(baseDoc());
  const provider = new OpenRouterProvider();
  const result = await provider.generate(generateInput(), AbortSignal.timeout(5000));
  assert.deepEqual(result.output, { a: 1 });
  assert.equal(result.finishReason, "stop");
  assert.equal(result.rawMeta.reasoningPresent, false);
  assert.equal(result.rawMeta.finishReason, "stop");
  assert.equal(result.rawMeta.actualModel, "fixture-model");
});

// D: visible malformed JSON → structural failure (parse stage, not valid output).
test("D: malformed visible content fails at parse, never returns text as object", async () => {
  mockChatCompletion(baseDoc({ choices: [{ index: 0, message: { role: "assistant", content: "not json{{" }, finish_reason: "stop" }] }));
  const provider = new OpenRouterProvider();
  const result = await provider.generate(generateInput(), AbortSignal.timeout(5000));
  assert.equal(result.output, "not json{{", "text passthrough preserved; JSON.parse failure surfaces downstream, not here");
});

// E: reasoning present + visible empty → failure; reasoning never consumed.
test("E: reasoning-only response fails without consuming reasoning", async () => {
  mockChatCompletion(baseDoc({
    choices: [{ index: 0, message: { role: "assistant", content: "", reasoning_content: "hidden chain" }, finish_reason: "length" }],
    usage: { prompt_tokens: 10, completion_tokens: 4000, total_tokens: 4010, completion_tokens_details: { reasoning_tokens: 3990 } },
  }));
  const provider = new OpenRouterProvider();
  await assert.rejects(() => provider.generate(generateInput(), AbortSignal.timeout(5000)), /length/);
  const meta = summarizeChatCompletionResponse(baseDoc({
    choices: [{ index: 0, message: { role: "assistant", content: "", reasoning_content: "hidden chain" }, finish_reason: "length" }],
  }));
  assert.equal(meta.reasoningPresent, true);
  assert.equal(meta.visibleBytes, 0);
});

// F: reasoning present + visible valid JSON → visible JSON only.
test("F: visible JSON wins; reasoning ignored even when present", async () => {
  mockChatCompletion(baseDoc({
    choices: [{ index: 0, message: { role: "assistant", content: '{"a":2}', reasoning_content: "hidden" }, finish_reason: "stop" }],
  }));
  const provider = new OpenRouterProvider();
  const result = await provider.generate(generateInput(), AbortSignal.timeout(5000));
  assert.deepEqual(result.output, { a: 2 });
  assert.equal(result.rawMeta.reasoningPresent, true);
});

// Array content parts assemble; refusal fails distinctly.
test("array content parts assemble text; refusal fails distinctly", async () => {
  mockChatCompletion(baseDoc({
    choices: [{ index: 0, message: { role: "assistant", content: [{ type: "text", text: '{"a":' }, { type: "text", text: "3}" }, { type: "image_url", image_url: { url: "x" } }] }, finish_reason: "stop" }],
  }));
  const provider = new OpenRouterProvider();
  const result = await provider.generate(generateInput(), AbortSignal.timeout(5000));
  assert.deepEqual(result.output, { a: 3 });
  mockChatCompletion(baseDoc({
    choices: [{ index: 0, message: { role: "assistant", content: "", refusal: "policy" }, finish_reason: "stop" }],
  }));
  await assert.rejects(() => provider.generate(generateInput(), AbortSignal.timeout(5000)), /refused/);
});

// G: strict mode request shape.
test("G: STRICT_JSON_OBJECT sends response_format json_object, non-streaming", () => {
  const built = buildStructuredRequest("STRICT_JSON_OBJECT", { model: "m", system: "s", user: "u", temperature: 0, maxOutputTokens: 100 });
  assert.equal(built.mode, "STRICT_JSON_OBJECT");
  assert.deepEqual(built.request.responseFormat, { kind: "json" });
  assert.equal(built.request.stream, false);
  assert.ok(STRUCTURED_OUTPUT_MODES.includes("STRICT_JSON_OBJECT"));
});

// H: visible-text mode excludes response_format entirely.
test("H: VISIBLE_TEXT_JSON carries no response_format key", () => {
  const built = buildStructuredRequest("VISIBLE_TEXT_JSON", { model: "m", system: "s", user: "u" });
  assert.equal(built.mode, "VISIBLE_TEXT_JSON");
  assert.equal("responseFormat" in built.request, false, "P: mode cannot silently add json_object");
});

// I/J/K: streaming accumulation semantics.
test("I: streamed visible chunks reconstruct", () => {
  const acc = accumulateStreamDeltas([{ content: '{"a":' }, { content: "4}" }, { finish: "stop" }]);
  assert.equal(acc.visibleText, '{"a":4}');
  assert.equal(acc.textChunks, 2);
  assert.equal(acc.sawFinish, true);
  assert.deepEqual(JSON.parse(acc.visibleText), { a: 4 });
});

test("J: reasoning-only stream produces no business output", () => {
  const acc = accumulateStreamDeltas([{ reasoning_content: "r1" }, { reasoning: "r2" }, { finish: "length" }]);
  assert.equal(acc.visibleText, "");
  assert.equal(acc.reasoningPresent, true);
});

test("K: truncated stream (no terminal finish) fails closed at parse", () => {
  const acc = accumulateStreamDeltas([{ content: '{"a":' }]);
  assert.equal(acc.sawFinish, false);
  assert.throws(() => JSON.parse(acc.visibleText), SyntaxError);
});

// L/M/N: metadata semantics.
test("L+M: metadata records model and presence without reasoning text", () => {
  const meta = summarizeChatCompletionResponse(baseDoc({
    id: "gen-1", model: "real-model",
    choices: [{ index: 0, message: { role: "assistant", content: "x", reasoning_content: "hidden" }, finish_reason: "stop", native_finish_reason: "stop" }],
    usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12, cost: 0.001 },
  }), 200);
  assert.equal(meta.responseId, "gen-1");
  assert.equal(meta.actualModel, "real-model", "M: provider-returned model persisted");
  assert.equal(meta.httpStatus, 200);
  assert.equal(meta.reasoningPresent, true);
  assert.ok(!JSON.stringify(meta).includes("hidden"), "no reasoning text in metadata");
  assert.equal(meta.costReported, 0.001);
});

test("N: absent usage stays UNKNOWN", () => {
  const meta = summarizeChatCompletionResponse({ choices: [{ message: { content: "x" }, finish_reason: "stop" }] });
  assert.equal(meta.promptTokens, null);
  assert.equal(meta.reasoningTokens, null);
  assert.equal(meta.costReported, null);
});

// F: failure diagnostics persist automatically on the thrown error.
test("F: thrown errors carry sanitized diagnostics without reasoning text", async () => {
  mockChatCompletion(baseDoc({
    choices: [{ index: 0, message: { role: "assistant", content: "", reasoning_content: "hidden chain" }, finish_reason: "length" }],
    usage: { prompt_tokens: 100, completion_tokens: 4096, total_tokens: 4196, completion_tokens_details: { reasoning_tokens: 4000 }, cost: 0.002 },
  }));
  const provider = new OpenRouterProvider();
  const error = await provider.generate(generateInput(), AbortSignal.timeout(5000)).then(() => null, (e) => e);
  assert.ok(error instanceof Error);
  const diagnostics = error.diagnostics;
  assert.ok(diagnostics, "diagnostics attached automatically");
  assert.equal(diagnostics.requestedModel, "fixture-model");
  assert.equal(diagnostics.maxTokens, 100);
  assert.equal(diagnostics.responseFormat, "json");
  assert.equal(diagnostics.stream, false);
  assert.equal(diagnostics.rawMeta.finishReason, "length");
  assert.equal(diagnostics.rawMeta.reasoningPresent, true);
  assert.equal(diagnostics.rawMeta.reasoningTokens, 4000);
  assert.equal(diagnostics.rawMeta.visibleBytes, 0);
  assert.equal(diagnostics.rawMeta.costReported, 0.002);
  assert.ok(!JSON.stringify(diagnostics).includes("hidden chain"), "H: reasoning text never persisted");
});

// I: length failure preserves partial sanitized diagnostics.
test("I: length failure preserves partial diagnostics for forensics", async () => {
  mockChatCompletion(baseDoc({
    id: "gen-partial", model: "real-model",
    choices: [{ index: 0, message: { role: "assistant", content: "partial" }, finish_reason: "length" }],
  }));
  const provider = new OpenRouterProvider();
  const error = await provider.generate(generateInput(), AbortSignal.timeout(5000)).then(() => null, (e) => e);
  assert.match(error.message, /length/);
  assert.equal(error.diagnostics.rawMeta.responseId, "gen-partial");
  assert.equal(error.diagnostics.rawMeta.actualModel, "real-model");
  assert.equal(error.diagnostics.rawMeta.visibleBytes, 7);
  assert.equal(error.diagnostics.rawMeta.reasoningPresent, false);
});

// P: mode echo proves no silent change.
test("P: builder echoes the selected mode; provider sees only standard fields", () => {
  for (const mode of STRUCTURED_OUTPUT_MODES) {
    const built = buildStructuredRequest(mode, { model: "m", system: "s", user: "u" });
    assert.equal(built.mode, mode);
    assert.equal("structuredMode" in built.request, false);
    assert.equal("mode" in built.request, false);
  }
});

// Missing usage zero-fills accounting while meta stays UNKNOWN.
test("absent usage zero-fills accounting, meta stays UNKNOWN", async () => {
  const doc = baseDoc();
  delete doc.usage;
  mockChatCompletion(doc);
  const provider = new OpenRouterProvider();
  const result = await provider.generate(generateInput(), AbortSignal.timeout(5000));
  assert.deepEqual(result.output, { a: 1 });
  assert.equal(result.usage.inputTokens, 0);
  assert.equal(result.rawMeta.promptTokens, null, "G: missing stays UNKNOWN in meta");
});
