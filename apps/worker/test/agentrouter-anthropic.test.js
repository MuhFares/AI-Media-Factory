import test from "node:test";
import assert from "node:assert/strict";
import {
  createProductionAgentExecutor,
  extractAnthropicVisibleText,
  isIncompleteAgentRouterTermination,
  runAgentRouterStructuredOutputDiagnostic,
  safeTransportRootCause,
} from "../dist/production-executor.js";

const original = {
  fetch: global.fetch,
  provider: process.env.TEXT_AGENT_PROVIDER,
  baseUrl: process.env.ANTHROPIC_BASE_URL,
  token: process.env.ANTHROPIC_AUTH_TOKEN,
};

function configure() {
  process.env.TEXT_AGENT_PROVIDER = "agentrouter";
  process.env.ANTHROPIC_BASE_URL = "https://agentrouter.test/";
  process.env.ANTHROPIC_AUTH_TOKEN = "test-secret";
}

function restore() {
  global.fetch = original.fetch;
  process.env.TEXT_AGENT_PROVIDER = original.provider;
  process.env.ANTHROPIC_BASE_URL = original.baseUrl;
  process.env.ANTHROPIC_AUTH_TOKEN = original.token;
}

test("typed Anthropic blocks preserve visible text order and exclude thinking/unknown blocks", () => {
  assert.equal(extractAnthropicVisibleText([
    { type: "thinking", thinking: "hidden one", signature: "internal" },
    { type: "text", text: "{\"part\":" },
    { type: "thinking", thinking: "hidden two" },
    { type: "tool_use", id: "unknown", input: { private: true } },
    { type: "text", text: "\"visible\"}" },
  ]), "{\"part\":\"visible\"}");
  assert.equal(extractAnthropicVisibleText([{ type: "thinking", thinking: "hidden" }]), "");
  assert.equal(extractAnthropicVisibleText(null), "");
});

test("provider termination taxonomy recognizes token exhaustion without guessing", () => {
  assert.equal(isIncompleteAgentRouterTermination("ANTHROPIC", "max_tokens"), true);
  assert.equal(isIncompleteAgentRouterTermination("ANTHROPIC", "end_turn"), false);
  assert.equal(isIncompleteAgentRouterTermination("OPENAI_COMPATIBLE", "length"), true);
});

test("bounded transport diagnostics preserve network causes without error prose", () => {
  for (const [code, phase] of [["ECONNREFUSED", "TCP"], ["ECONNRESET", "TCP"], ["ETIMEDOUT", "TCP"], ["ENOTFOUND", "DNS"]]) {
    const cause = Object.assign(new Error("DO_NOT_PERSIST_SECRET_PROSE"), { code, errno: code, syscall: "connect", hostname: "agentrouter.org", port: 443 });
    const result = safeTransportRootCause(Object.assign(new TypeError("fetch failed"), { cause }));
    assert.equal(result.transport_error_code, code); assert.equal(result.transport_phase, phase); assert.equal(result.transport_hostname, "agentrouter.org");
    assert.equal(JSON.stringify(result).includes("DO_NOT_PERSIST_SECRET_PROSE"), false);
  }
  const nested = new AggregateError([Object.assign(new Error("private"), { code: "ECONNRESET" })], "outer private");
  const aggregate = safeTransportRootCause(Object.assign(new TypeError("fetch failed"), { cause: nested }));
  assert.equal(aggregate.transport_error_code, "ECONNRESET"); assert.equal(aggregate.nested_cause_count, 2);
  assert.equal(safeTransportRootCause(Object.assign(new Error("access"), { code: "EACCES" })).transport_phase, "LOCAL_NETWORK_POLICY");
  assert.equal(safeTransportRootCause(new Error("unknown private")).transport_error_name, "Error");
});

test("Anthropic request uses native shape and headers and parses a later text block", async () => {
  configure();
  let url; let options;
  global.fetch = async (input, init) => {
    url = String(input); options = init;
    return new Response(JSON.stringify({
      type: "message", model: "claude-opus-4-8", stop_reason: "end_turn",
      content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "{\"ok\":true,\"label\":\"structured-output\"}" }],
      usage: { input_tokens: 10, output_tokens: 20, output_tokens_details: { thinking_tokens: 8 } },
    }), { status: 200, headers: { "request-id": "anthropic-request" } });
  };
  try {
    const result = await runAgentRouterStructuredOutputDiagnostic({ model: "claude-opus-4-8" });
    const body = JSON.parse(options.body);
    assert.equal(url, "https://agentrouter.test/v1/messages");
    assert.equal(options.headers["User-Agent"], "opencode/1.0");
    assert.equal(options.headers["x-api-key"], "test-secret");
    assert.equal(options.headers.authorization, undefined);
    assert.equal(body.model, "claude-opus-4-8");
    assert.equal(typeof body.system, "string");
    assert.equal(body.messages.some((message) => message.role === "system"), false);
    assert.equal(typeof body.max_tokens, "number");
    assert.equal(body.response_format, undefined);
    assert.equal(body.thinking, undefined);
    assert.deepEqual(result.output, { ok: true, label: "structured-output" });
  } finally { restore(); }
});

test("Anthropic max_tokens fails closed even when a text block contains valid JSON", async () => {
  configure();
  global.fetch = async () => new Response(JSON.stringify({
    type: "message", model: "claude-opus-4-8", stop_reason: "max_tokens",
    content: [{ type: "thinking", thinking: "hidden" }, { type: "text", text: "{\"ok\":true,\"label\":\"structured-output\"}" }],
    usage: { input_tokens: 10, output_tokens: 8192, output_tokens_details: { thinking_tokens: 5184 } },
  }), { status: 200 });
  try {
    await assert.rejects(runAgentRouterStructuredOutputDiagnostic({ model: "claude-opus-4-8" }), /incomplete response \(max_tokens\)/);
  } finally { restore(); }
});

test("Anthropic thinking-only response fails with no visible output", async () => {
  configure();
  global.fetch = async () => new Response(JSON.stringify({
    type: "message", model: "claude-opus-4-8", stop_reason: "end_turn",
    content: [{ type: "thinking", thinking: "hidden", signature: "internal" }], usage: {},
  }), { status: 200 });
  try {
    await assert.rejects(runAgentRouterStructuredOutputDiagnostic({ model: "claude-opus-4-8" }), /empty output/);
  } finally { restore(); }
});

test("Anthropic route is persisted dynamically and max_tokens is terminal incomplete", async () => {
  configure();
  const provenance = new Map();
  const store = {
    async saveExecutionProvenance(value) { provenance.set(value.executionId, structuredClone(value)); },
    async listExecutionProvenance() { return [...provenance.values()].map(structuredClone); },
    async claimReadyExecutionProvenance(executionId) {
      const value = provenance.get(executionId);
      if (value?.configuration?.lifecycleState !== "READY_FOR_SUBMISSION") return false;
      value.configuration.lifecycleState = "PROVIDER_SUBMISSION_INTENT";
      value.configuration.providerSubmissionStarted = true;
      provenance.set(executionId, structuredClone(value));
      return true;
    },
    async listArtifacts() { return []; },
  };
  global.fetch = async () => new Response(JSON.stringify({
    type: "message", model: "claude-opus-4-8", stop_reason: "max_tokens",
    content: [{ type: "text", text: "{}" }], usage: { input_tokens: 1, output_tokens: 8192 },
  }), { status: 200, headers: { "request-id": "incomplete-request" } });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep(
      { id: "research-anthropic-provenance-fixture", agent: "research" },
      { workflowId: "wf-anthropic", correlationId: "corr-anthropic", data: { strategyMode: "PRE_PUBLICATION_STRATEGY", agentRouterModelOverride: "claude-opus-4-8", objective: "fixture" } },
    );
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.artifact, undefined);
    const [record] = [...provenance.values()];
    assert.equal(record.provider, "agentrouter-anthropic");
    assert.equal(record.model, "claude-opus-4-8");
    assert.equal(record.runtime, "governed-agentrouter-llm");
    assert.equal(record.configuration.protocol, "ANTHROPIC");
    assert.equal(record.configuration.lifecycleState, "PROVIDER_RESPONSE_INCOMPLETE");
    assert.equal(record.configuration.providerFailure.incomplete, true);
  } finally { restore(); }
});
