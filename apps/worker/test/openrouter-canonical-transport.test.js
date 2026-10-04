/**
 * Provider-free proof that diagnostic probes can invoke the SAME canonical
 * production OpenRouter transport (no transcription). Stubbed transport only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { openRouterLlm } from "../dist/production-executor.js";

const originalFetch = global.fetch;
const originalKey = process.env.OPENROUTER_API_KEY;
const originalBase = process.env.OPENROUTER_BASE_URL;

function useMock(fetchImpl) {
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = fetchImpl;
}
function restore() {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
  if (originalBase === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = originalBase;
}
function sse(events, done = true) {
  return new Response(events.join("") + (done ? "data: [DONE]\n\n" : ""), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function chunk(id, delta, finish, usage) {
  const event = { id, model: "openai/gpt-6-luna", choices: [{ delta }] };
  if (finish) event.choices[0].finish_reason = finish;
  if (usage) event.usage = usage;
  return `data: ${JSON.stringify(event)}\n\n`;
}
const SCHEMA = { type: "object", properties: { status: { type: "string" } }, required: ["status"] };
function request() {
  return {
    model: "openai/gpt-6-luna",
    system: "Return only JSON.",
    messages: [{ role: "system", content: "Return only JSON." }, { role: "user", content: "Probe." }],
    temperature: 0.2,
    maxOutputTokens: 8192,
    responseSchema: SCHEMA,
    callIdentity: { callLeg: "FINAL_SYNTHESIS" },
  };
}

test("canonical openRouterLlm sends the strict-false json_schema envelope and accepts", async () => {
  let calls = 0;
  const bodies = [];
  useMock(async (_url, init) => {
    calls += 1;
    bodies.push(JSON.parse(String(init.body)));
    return sse([
      chunk("gen-1", { content: '{"status":' }),
      chunk("gen-1", { content: '"grounded"}' }, "stop", { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }),
    ]);
  });
  try {
    const response = await openRouterLlm("openai/gpt-6-luna")({}, request(), { isCancelled: false, onCancelled() {}, throwIfCancelled() {} });
    assert.deepEqual(response.output, { status: "grounded" });
    assert.equal(calls, 1);
    assert.equal(bodies[0].model, "openai/gpt-6-luna");
    assert.equal(bodies[0].stream, true);
    assert.equal(bodies[0].max_tokens, 8192);
    assert.equal(bodies[0].response_format.type, "json_schema");
    assert.equal(bodies[0].response_format.json_schema.strict, false);
    assert.deepEqual(bodies[0].response_format.json_schema.schema, SCHEMA);
  } finally { restore(); }
});

test("canonical openRouterLlm classifies length as incomplete with one transport", async () => {
  let calls = 0;
  useMock(async () => {
    calls += 1;
    return sse([chunk("gen-2", { content: '{"a":' }), chunk("gen-2", { content: "" }, "length")]);
  });
  try {
    await assert.rejects(openRouterLlm("openai/gpt-6-luna")({}, request(), { isCancelled: false, onCancelled() {}, throwIfCancelled() {} }), /incomplete response \(length\)/);
    assert.equal(calls, 1);
  } finally { restore(); }
});
