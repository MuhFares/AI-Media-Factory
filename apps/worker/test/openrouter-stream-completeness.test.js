/** Provider-free OpenRouter stream-completeness family. Stubbed transport only, never the network. */
import test from "node:test";
import assert from "node:assert/strict";
import { executeGovernedVisibleJson } from "../dist/production-executor.js";

const originalFetch = global.fetch;
const originalProvider = process.env.TEXT_AGENT_PROVIDER;
const originalBaseUrl = process.env.OPENROUTER_BASE_URL;
const originalApiKey = process.env.OPENROUTER_API_KEY;

function useMock(fetchImpl) {
  process.env.TEXT_AGENT_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = fetchImpl;
}
function restore() {
  global.fetch = originalFetch;
  if (originalProvider === undefined) delete process.env.TEXT_AGENT_PROVIDER; else process.env.TEXT_AGENT_PROVIDER = originalProvider;
  if (originalBaseUrl === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = originalBaseUrl;
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalApiKey;
}

function chunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}
function sseEvent(id, delta, finish, usage) {
  const choice = { delta };
  if (finish !== null && finish !== undefined) choice.finish_reason = finish;
  const event = { id, model: "openai/gpt-6-luna", choices: [choice] };
  if (usage !== undefined) event.usage = usage;
  return chunk(event);
}
function streamResponse(slices, done = true) {
  const body = slices.join("") + (done ? "data: [DONE]\n\n" : "");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
function splitStream(parts) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(enc.encode(part));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function call() {
  return executeGovernedVisibleJson({
    agentId: "research",
    workflowId: "wf-stream-fixture",
    correlationId: "corr-stream-fixture",
    provider: "openrouter",
    model: "openai/gpt-6-luna",
    system: "Return only JSON.",
    prompt: "Return only JSON.",
    maxOutputTokens: 4096,
  });
}
const USAGE = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

test("A+G. normal complete streamed structured response accepted with terminal usage", async () => {
  let calls = 0;
  useMock(async () => {
    calls += 1;
    return streamResponse([
      sseEvent("gen-a", { content: '{"status":' }),
      sseEvent("gen-a", { content: '"grounded"}' }, "stop", USAGE),
    ]);
  });
  try {
    const response = await call();
    assert.deepEqual(response.output, { status: "grounded" });
    assert.equal(response.finishReason, "stop");
    assert.equal(response.usage.outputTokens, 5);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test("B. finish_reason=length classified incomplete with exactly one transport", async () => {
  let calls = 0;
  useMock(async () => {
    calls += 1;
    return streamResponse([
      sseEvent("gen-b", { content: '{"partial":true' }),
      sseEvent("gen-b", { content: "" }, "length", USAGE),
    ]);
  });
  try {
    await assert.rejects(call(), /incomplete response \(length\)/);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test("C. missing DONE marker fails closed with exactly one transport", async () => {
  let calls = 0;
  useMock(async () => {
    calls += 1;
    return streamResponse([sseEvent("gen-c", { content: '{"a":1}' }, "stop", USAGE)], false);
  });
  try {
    await assert.rejects(call(), /missing \[DONE\]/);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test("D. content split across stream reads is reassembled without loss", async () => {
  let calls = 0;
  useMock(async () => {
    calls += 1;
    const full = sseEvent("gen-d", { content: '{"t":"ok-split"}' }, "stop", USAGE) + "data: [DONE]\n\n";
    const anchor = full.indexOf('"content"') + 11;
    assert.ok(anchor > 11, "fixture must carry a content field");
    return splitStream([full.slice(0, anchor), full.slice(anchor)]);
  });
  try {
    const response = await call();
    assert.deepEqual(response.output, { t: "ok-split" });
    assert.equal(calls, 1);
  } finally { restore(); }
});

test("E. reasoning-only output rejected without visible content", async () => {
  let calls = 0;
  useMock(async () => {
    calls += 1;
    return streamResponse([
      sseEvent("gen-e", { reasoning_content: "thinking" }),
      sseEvent("gen-e", {}, "stop", USAGE),
    ]);
  });
  try {
    await assert.rejects(call(), /no visible content/);
    assert.equal(calls, 1);
  } finally { restore(); }
});

test("F. empty content deltas rejected without visible content", async () => {
  let calls = 0;
  useMock(async () => {
    calls += 1;
    return streamResponse([
      sseEvent("gen-f", {}),
      sseEvent("gen-f", {}, "stop", USAGE),
    ]);
  });
  try {
    await assert.rejects(call(), /no visible content/);
    assert.equal(calls, 1);
  } finally { restore(); }
});
