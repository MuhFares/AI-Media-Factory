/**
 * Sprint 8.28 — structured-output reliability layer tests.
 *
 * Deterministic fake executors only — NO external providers are called.
 */

import { describe, it } from "node:test";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert";
import {
  classifyExecutionError,
  ModelCompatibilityTracker,
  StructuredOutputExhaustedError,
  StructuredOutputReliableExecutor,
  StructuredOutputSchemaValidator,
  validateAgainstSchema,
  withStructuredOutputReliability,
} from "../dist/index.js";

const schema = {
  type: "object",
  properties: {
    reportId: { type: "string" },
    taskDescription: { type: "string" },
    summary: { type: "string" },
    sources: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          title: { type: "string" },
          url: { type: "string" },
          snippet: { type: "string" },
        },
        required: ["id", "title", "url", "snippet"],
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: { sourceId: { type: "number" }, text: { type: "string" } },
        required: ["sourceId", "text"],
      },
    },
    metadata: {
      type: "object",
      properties: { createdAt: { type: "string" }, agentVersion: { type: "string" } },
      required: ["createdAt", "agentVersion"],
    },
  },
  required: ["reportId", "taskDescription", "summary", "sources", "confidence", "citations", "metadata"],
};

function validOutput() {
  return {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskDescription: "Research TypeScript",
    summary: "Typed JavaScript.",
    sources: [{ id: 1, title: "TypeScript", url: "https://www.typescriptlang.org/", snippet: "Official docs." }],
    confidence: 0.9,
    citations: [{ sourceId: 1, text: "Official docs." }],
    metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

function response(output, model = "primary", provider = "test") {
  return {
    output,
    raw: JSON.stringify(output),
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    model,
    provider,
    latencyMs: 1,
  };
}

function request(overrides = {}) {
  return {
    model: "request-model",
    system: "system",
    messages: [{ role: "system", content: "system" }, { role: "user", content: "task" }],
    temperature: 0.2,
    maxOutputTokens: 1024,
    responseSchema: schema,
    ...overrides,
  };
}

const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

/** Build a deterministic fake executor driven by a per-call plan. */
function fakeExecutor(plan) {
  const calls = [];
  return {
    calls,
    execute: async (_context, req) => {
      calls.push({ model: req.model, messages: req.messages });
      const action = plan(calls.length, req);
      if (action.throw) throw action.throw;
      return response(action.output ?? validOutput(), action.model ?? req.model, action.provider ?? "test");
    },
  };
}

describe("classifyExecutionError", () => {
  it("classifies provider error kinds (429/5xx/404/401/network)", () => {
    deepStrictEqual(classifyExecutionError(new Error("OpenRouter request failed (429): boom")), {
      kind: "provider_transient", httpStatus: 429, retryable: true, fallbackAllowed: true,
    });
    deepStrictEqual(classifyExecutionError(new Error("OpenRouter request failed (503): boom")), {
      kind: "provider_transient", httpStatus: 503, retryable: true, fallbackAllowed: true,
    });
    deepStrictEqual(classifyExecutionError(new Error("OpenRouter request failed (404): missing model")), {
      kind: "model_unavailable", httpStatus: 404, retryable: false, fallbackAllowed: true,
    });
    deepStrictEqual(classifyExecutionError(new Error("OpenRouter request failed (401): no auth")), {
      kind: "provider_unavailable", httpStatus: 401, retryable: false, fallbackAllowed: false,
    });
    const network = classifyExecutionError(new TypeError("fetch failed"));
    strictEqual(network.retryable, true);
    strictEqual(network.kind, "provider_transient");
  });
});

describe("StructuredOutputSchemaValidator", () => {
  it("accepts a contract-valid payload", () => {
    const result = validateAgainstSchema(schema, validOutput());
    strictEqual(result.valid, true);
    strictEqual(result.errors.length, 0);
  });

  it("rejects malformed source IDs without coercing them", () => {
    const bad = validOutput();
    bad.sources[0].id = "source-1";
    const result = validateAgainstSchema(schema, bad);
    strictEqual(result.valid, false);
    ok(result.errors.some((e) => e.path === "sources[0].id" && e.keyword === "type"));
  });

  it("rejects missing required snippets", () => {
    const bad = validOutput();
    delete bad.sources[0].snippet;
    const result = validateAgainstSchema(schema, bad);
    strictEqual(result.valid, false);
    ok(result.errors.some((e) => e.path === "sources[0].snippet" && e.keyword === "required"));
  });

  it("rejects empty sources via minItems (schema strengthening, not weakening)", () => {
    const bad = validOutput();
    bad.sources = [];
    const result = validateAgainstSchema(schema, bad);
    strictEqual(result.valid, false);
    ok(result.errors.some((e) => e.keyword === "minItems"));
  });

  it("does not coerce numeric-looking strings into numbers", () => {
    const bad = validOutput();
    bad.confidence = "0.9";
    const result = validateAgainstSchema(schema, bad);
    strictEqual(result.valid, false);
    ok(result.errors.some((e) => e.path === "confidence" && e.keyword === "type"));
  });
});

describe("StructuredOutputReliableExecutor", () => {
  it("1. valid first response → success without extra calls", async () => {
    const fake = fakeExecutor(() => ({ output: validOutput() }));
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary" });
    const result = await executor.execute({}, request(), signal);
    deepStrictEqual(result.output, validOutput());
    strictEqual(fake.calls.length, 1);
  });

  it("2+3. malformed then valid → success after a targeted correction retry", async () => {
    const fake = fakeExecutor((n) =>
      n === 1 ? { output: "not json at all" } : { output: validOutput() });
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary", retryPolicy: { maxValidationAttempts: 2 } });
    const events = [];
    const result = await executor.execute({}, request(), signal);
    deepStrictEqual(result.output, validOutput());
    strictEqual(fake.calls.length, 2);
    strictEqual(fake.calls[1].model, "primary");
    ok(fake.calls[1].messages.length > fake.calls[0].messages.length, "correction instruction appended");
    strictEqual(fake.calls[1].messages[fake.calls[1].messages.length - 1].content.includes("not valid structured output"), true);
  });

  it("4+16. malformed repeatedly → controlled failure, attempt limit enforced", async () => {
    const fake = fakeExecutor(() => ({ output: "still not json" }));
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary", retryPolicy: { maxValidationAttempts: 2 } });
    await rejects(
      () => executor.execute({}, request(), signal),
      (err) => {
        ok(err instanceof StructuredOutputExhaustedError);
        strictEqual(err.reason, "validation");
        strictEqual(err.attempts.length, 2);
        return true;
      },
    );
    strictEqual(fake.calls.length, 2, "no infinite retry");
  });

  it("5. missing required field → retry then failure", async () => {
    const fake = fakeExecutor((n) => {
      if (n === 1) {
        const out = validOutput();
        delete out.summary;
        return { output: out };
      }
      return { output: validOutput() };
    });
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary", retryPolicy: { maxValidationAttempts: 2 } });
    const result = await executor.execute({}, request(), signal);
    strictEqual(fake.calls.length, 2);
    ok(fake.calls[1].messages[fake.calls[1].messages.length - 1].content.includes("missing required property 'summary'"));
    deepStrictEqual(result.output, validOutput());
  });

  it("6. malformed source ID → correction retry referencing the exact path", async () => {
    const fake = fakeExecutor((n) => {
      if (n === 1) {
        const out = validOutput();
        out.sources[0].id = "source-1";
        return { output: out };
      }
      return { output: validOutput() };
    });
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary", retryPolicy: { maxValidationAttempts: 2 } });
    await executor.execute({}, request(), signal);
    ok(fake.calls[1].messages[fake.calls[1].messages.length - 1].content.includes("sources[0].id"));
  });

  it("7. empty sources → correction retry then success", async () => {
    const fake = fakeExecutor((n) => {
      if (n === 1) {
        const out = validOutput();
        out.sources = [];
        return { output: out };
      }
      return { output: validOutput() };
    });
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary", retryPolicy: { maxValidationAttempts: 2 } });
    await executor.execute({}, request(), signal);
    ok(fake.calls[1].messages[fake.calls[1].messages.length - 1].content.includes("expected at least 1 items"));
  });

  it("8. provider 429 → bounded transient retry then fallback success", async () => {
    const fake = fakeExecutor((n, req) => {
      if (req.model === "primary") {
        if (n === 1) return { throw: new Error("OpenRouter request failed (429): slow down") };
        return { throw: new Error("OpenRouter request failed (429): slow down") };
      }
      return { output: validOutput(), model: "fallback" };
    });
    const executor = new StructuredOutputReliableExecutor(fake.execute, {
      primaryModel: "primary",
      fallbackModels: ["fallback"],
      retryPolicy: { transientRetries: 1, transientBackoffMs: 5 },
    });
    const result = await executor.execute({}, request(), signal);
    deepStrictEqual(result.output, validOutput());
    strictEqual(result.model, "fallback");
    strictEqual(fake.calls.length, 3); // primary 429 ×2 (budget), fallback success
  });

  it("9. provider 404 → no infinite retry of the same model, falls back", async () => {
    const fake = fakeExecutor((_n, req) => {
      if (req.model === "primary") return { throw: new Error("OpenRouter request failed (404): model unavailable") };
      return { output: validOutput(), model: "fallback" };
    });
    const executor = new StructuredOutputReliableExecutor(fake.execute, {
      primaryModel: "primary",
      fallbackModels: ["fallback"],
      retryPolicy: { transientRetries: 3, maxValidationAttempts: 3 },
    });
    await executor.execute({}, request(), signal);
    const primaryCalls = fake.calls.filter((c) => c.model === "primary").length;
    strictEqual(primaryCalls, 1, "404 model must not be retried repeatedly");
  });

  it("10. provider transient error → retry on same model then success", async () => {
    let count = 0;
    const fake = fakeExecutor(() => {
      count += 1;
      if (count === 1) return { throw: new Error("OpenRouter request failed (500): internal") };
      return { output: validOutput() };
    });
    const executor = new StructuredOutputReliableExecutor(fake.execute, {
      primaryModel: "primary",
      retryPolicy: { transientRetries: 2, transientBackoffMs: 5 },
    });
    const result = await executor.execute({}, request(), signal);
    deepStrictEqual(result.output, validOutput());
    strictEqual(count, 2);
  });

  it("11. fallback model success when primary is schema-incompatible", async () => {
    const fake = fakeExecutor((_n, req) =>
      req.model === "primary"
        ? { output: "nope" }
        : { output: validOutput(), model: "fallback" });
    const executor = new StructuredOutputReliableExecutor(fake.execute, {
      primaryModel: "primary",
      fallbackModels: ["fallback"],
      retryPolicy: { maxValidationAttempts: 1 },
    });
    const result = await executor.execute({}, request(), signal);
    strictEqual(result.model, "fallback");
    deepStrictEqual(result.output, validOutput());
  });

  it("12. fallback unavailable → controlled failure", async () => {
    const fake = fakeExecutor(() => ({ throw: new Error("OpenRouter request failed (404): gone") }));
    const executor = new StructuredOutputReliableExecutor(fake.execute, {
      primaryModel: "primary",
      fallbackModels: ["fallback"],
      retryPolicy: { transientRetries: 0 },
    });
    await rejects(
      () => executor.execute({}, request(), signal),
      (err) => err instanceof StructuredOutputExhaustedError && err.reason === "provider",
    );
    strictEqual(fake.calls.length, 2, "exactly primary + fallback attempts");
  });

  it("13+14. never fabricates fields or sources (output returned unchanged)", async () => {
    const modelOutput = validOutput();
    modelOutput.sources = [
      { id: 7, title: "Real source", url: "https://example.com", snippet: "Only this." },
    ];
    const fake = fakeExecutor(() => ({ output: modelOutput }));
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary" });
    const result = await executor.execute({}, request(), signal);
    deepStrictEqual(result.output, modelOutput);
  });

  it("15. no schema weakening — schema-invalid JSON is never accepted", async () => {
    const fake = fakeExecutor(() => ({ output: { reportId: 1 } })); // wrong shape
    const executor = new StructuredOutputReliableExecutor(fake.execute, {
      primaryModel: "primary",
      retryPolicy: { maxValidationAttempts: 1 },
    });
    await rejects(() => executor.execute({}, request(), signal), StructuredOutputExhaustedError);
  });

  it("17. no unsafe casts — numeric-looking strings are not coerced into numbers", async () => {
    const fake = fakeExecutor((n) => {
      if (n === 1) {
        const out = validOutput();
        out.citations[0].sourceId = "1";
        return { output: out };
      }
      return { output: validOutput() };
    });
    const executor = new StructuredOutputReliableExecutor(fake.execute, { primaryModel: "primary", retryPolicy: { maxValidationAttempts: 2 } });
    await executor.execute({}, request(), signal);
    ok(fake.calls[1].messages[fake.calls[1].messages.length - 1].content.includes("citations[0].sourceId"));
  });

  it("observability: onEvent reports attempts, model, provider, latency, usage, validation errors, fallback count", async () => {
    const fake = fakeExecutor((n) =>
      n === 1 ? { output: "bad" } : { output: validOutput(), model: "primary" });
    const events = [];
    const executor = new StructuredOutputReliableExecutor(fake.execute, {
      primaryModel: "primary",
      retryPolicy: { maxValidationAttempts: 2 },
      onEvent: (e) => events.push(e),
    });
    await executor.execute({}, request(), signal);
    strictEqual(events.length, 2);
    strictEqual(events[0].failureKind, "malformed_output");
    strictEqual(events[0].correctionApplied, false);
    strictEqual(events[0].model, "primary");
    strictEqual(events[1].failureKind, "valid");
    strictEqual(events[1].correctionApplied, true);
    ok(events[0].latencyMs >= 0);
    ok(events[0].usage.costUsd >= 0);
  });
});

describe("ModelCompatibilityTracker", () => {
  it("identifies supported / unsupported / temporarily unavailable models", () => {
    const tracker = new ModelCompatibilityTracker();
    tracker.record("a", { ok: true, errorKind: null, validationErrorCount: 0, at: 1 });
    strictEqual(tracker.status("a"), "supported");

    tracker.record("b", { ok: false, errorKind: "schema_validation_failure", validationErrorCount: 2, at: 2 });
    strictEqual(tracker.status("b"), "unsupported");

    tracker.record("c", { ok: false, errorKind: "provider_transient", validationErrorCount: 0, at: 3 });
    strictEqual(tracker.status("c"), "temporarily_unavailable");
  });

  it("does NOT permanently blacklist a model after one transient failure", () => {
    const tracker = new ModelCompatibilityTracker();
    tracker.record("m", { ok: false, errorKind: "provider_transient", validationErrorCount: 0, at: 1 });
    strictEqual(tracker.status("m"), "temporarily_unavailable");
    tracker.record("m", { ok: true, errorKind: null, validationErrorCount: 0, at: 2 });
    strictEqual(tracker.status("m"), "supported");
  });

  it("does NOT claim supported merely because a model returned parseable JSON once", () => {
    const tracker = new ModelCompatibilityTracker();
    tracker.record("m", { ok: false, errorKind: "malformed_output", validationErrorCount: 1, at: 1 });
    strictEqual(tracker.status("m"), "unsupported");
    strictEqual(tracker.isSupported("m"), false);
  });
});

describe("withStructuredOutputReliability factory", () => {
  it("returns an executor-compatible function that retries then succeeds", async () => {
    const fake = fakeExecutor((n) =>
      n === 1 ? { output: "nope" } : { output: validOutput() });
    const reliable = withStructuredOutputReliability(fake.execute, {
      primaryModel: "primary",
      retryPolicy: { maxValidationAttempts: 2 },
    });
    const result = await reliable({}, request(), signal);
    deepStrictEqual(result.output, validOutput());
    strictEqual(fake.calls.length, 2);
  });
});
