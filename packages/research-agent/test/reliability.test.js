/**
 * Sprint 8.28 — ResearchAgent reliability integration.
 *
 * Demonstrates the reliability layer around the existing model-execution
 * boundary WITHOUT changing the ResearchAgent contract:
 *   attempt 1 malformed → targeted correction → attempt 2 valid → SUCCESS
 *   exhausted retry budget → FAILED (StructuredOutputExhaustedError).
 * Deterministic fake executors only — no external providers.
 */

import { describe, it } from "node:test";
import { deepStrictEqual, ok, rejects, strictEqual } from "node:assert";
import { createResearchAgent } from "../dist/index.js";
import { withStructuredOutputReliability } from "@ai-media-factory/runtime";

const task = {
  id: "research-1",
  name: "Research TypeScript",
  description: "Research TypeScript",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

function report() {
  return {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskDescription: task.description,
    summary: "Typed JavaScript.",
    sources: [{ id: 1, title: "TypeScript", url: "https://www.typescriptlang.org/", snippet: "Official documentation." }],
    confidence: 0.9,
    citations: [{ sourceId: 1, text: "Official documentation." }],
    metadata: { createdAt: "2026-08-14T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

function response(output) {
  return {
    output,
    raw: JSON.stringify(output),
    usage: { inputTokens: 10, outputTokens: 20, costUsd: 0 },
    model: "test-model",
    provider: "test",
    latencyMs: 3,
  };
}

const activeSignal = {
  isCancelled: false,
  onCancelled() {},
  throwIfCancelled() {},
};

function fakeExecutor(plan) {
  const calls = [];
  return {
    calls,
    execute: async (_context, req) => {
      calls.push({ model: req.model, messages: req.messages });
      return plan(calls.length, req);
    },
  };
}

function buildAgent(fake, fallbackModels = []) {
  const execute = withStructuredOutputReliability(fake.execute, {
    primaryModel: "primary",
    fallbackModels,
    retryPolicy: { maxValidationAttempts: 2, transientRetries: 1, transientBackoffMs: 5 },
  });
  return createResearchAgent({ config: {}, execute });
}

describe("ResearchAgent + structured-output reliability", () => {
  it("malformed first response → targeted correction → valid second → SUCCESS", async () => {
    const fake = fakeExecutor((n) => (n === 1 ? response("not json at all") : response(report())));
    const agent = buildAgent(fake);

    const result = await agent.execute({ context: {}, input: { task } }, activeSignal);

    strictEqual(result.output.taskDescription, task.description);
    deepStrictEqual(result.output.sources, report().sources);
    strictEqual(fake.calls.length, 2);
    ok(fake.calls[1].messages.length > fake.calls[0].messages.length, "correction instruction appended");
    ok(fake.calls[1].messages[fake.calls[1].messages.length - 1].content.includes("not valid structured output"));
  });

  it("invalid source id / missing snippet on attempt 1 → corrected attempt 2 → SUCCESS", async () => {
    const fake = fakeExecutor((n) => {
      if (n === 1) {
        const bad = report();
        bad.sources = [{ id: "source-1", title: "T", url: "https://e.com" }]; // string id, missing snippet
        return response(bad);
      }
      return response(report());
    });
    const agent = buildAgent(fake);

    const result = await agent.execute({ context: {}, input: { task } }, activeSignal);
    strictEqual(result.output.taskDescription, task.description);
    const corrected = fake.calls[1].messages[fake.calls[1].messages.length - 1].content;
    ok(corrected.includes("sources[0].id"), "correction references the failing path");
    ok(corrected.includes("sources[0].snippet"), "correction references required snippet");
  });

  it("empty sources → schema minItems failure → corrected attempt 2 → SUCCESS", async () => {
    const fake = fakeExecutor((n) => {
      if (n === 1) {
        const bad = report();
        bad.sources = [];
        return response(bad);
      }
      return response(report());
    });
    const agent = buildAgent(fake);

    const result = await agent.execute({ context: {}, input: { task } }, activeSignal);
    strictEqual(result.output.taskDescription, task.description);
    ok(
      fake.calls[1].messages[fake.calls[1].messages.length - 1].content.includes("expected at least 1 items"),
      "correction references empty sources",
    );
  });

  it("repeated malformed output → FAILED (StructuredOutputExhaustedError), never SUCCESS", async () => {
    const fake = fakeExecutor(() => response("still not json"));
    const agent = buildAgent(fake);

    await rejects(
      () => agent.execute({ context: {}, input: { task } }, activeSignal),
      (err) => {
        ok(err && typeof err.name === "string" && err.name === "StructuredOutputExhaustedError");
        strictEqual(err.reason, "validation");
        strictEqual(fake.calls.length, 2, "bounded retry budget: exactly 2 attempts");
        return true;
      },
    );
  });

  it("fallback model supplies a valid report after the primary is schema-incompatible", async () => {
    const fake = fakeExecutor((_n, req) =>
      req.model === "primary" ? response("nope") : response(report()));
    const agent = buildAgent(fake, ["fallback-model"]);

    const result = await agent.execute({ context: {}, input: { task } }, activeSignal);
    strictEqual(result.response.model, "test-model");
    strictEqual(result.output.taskDescription, task.description);
    // Primary exhausted its configured 2-attempt validation budget, then fell back.
    strictEqual(fake.calls.filter((c) => c.model === "primary").length, 2);
    strictEqual(fake.calls[fake.calls.length - 1].model, "fallback-model");
  });

  it("does not fabricate sources: output contains only what a model actually returned", async () => {
    const real = report();
    real.sources = [{ id: 9, title: "Only this", url: "https://only.example", snippet: "Real." }];
    real.citations = [{ sourceId: 9, text: "Real." }];
    const fake = fakeExecutor(() => response(real));
    const agent = buildAgent(fake);

    const result = await agent.execute({ context: {}, input: { task } }, activeSignal);
    strictEqual(result.output.sources[0].title, "Only this");
    strictEqual(fake.calls.length, 1);
  });
});