/** Unit tests for ResearchAgent. */

import { describe, it } from "node:test";
import { ok, rejects, strictEqual } from "node:assert";
import { createResearchAgent } from "../dist/index.js";

const task = {
  id: "research-1",
  name: "Research TypeScript",
  description: "Research TypeScript",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

function createAgent(overrides = {}) {
  return createResearchAgent({
    config: {},
    execute: async () => ({
      output: {
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Typed JavaScript.",
        sources: [{ id: 1, title: "TypeScript", url: "https://www.typescriptlang.org/", snippet: "Official documentation." }],
        confidence: 0.9,
        citations: [{ sourceId: 1, text: "Official documentation." }],
        metadata: { createdAt: "2026-08-06T00:00:00.000Z", agentVersion: "1.0.0" },
      },
      raw: "{}",
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
      model: "test-model",
      provider: "test",
      latencyMs: 1,
    }),
    ...overrides,
  });
}

const activeSignal = {
  isCancelled: false,
  onCancelled() {},
  throwIfCancelled() {},
};

describe("ResearchAgent", () => {
  it("normalizes a runtime research response", async () => {
    let receivedRequest;
    const agent = createAgent({
      execute: async (_context, request) => {
        receivedRequest = request;
        return {
          output: {
            reportId: "00000000-0000-4000-8000-000000000000",
            taskDescription: task.description,
            summary: "Typed JavaScript.",
            sources: [{ id: 1, title: "TypeScript", url: "https://www.typescriptlang.org/", snippet: "Official documentation." }],
            confidence: 0.9,
            citations: [{ sourceId: 1, text: "Official documentation." }],
            metadata: { createdAt: "2026-08-06T00:00:00.000Z", agentVersion: "1.0.0" },
          },
          raw: "{}",
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
          model: "test-model",
          provider: "test",
          latencyMs: 1,
        };
      },
    });
    const result = await agent.execute({ context: {}, input: { task } }, activeSignal);

    strictEqual(result.response.model, "test-model");
    strictEqual(result.output.taskDescription, task.description);
    ok(Array.isArray(result.output.sources));
    strictEqual(receivedRequest.model, "openrouter/auto");
  });

  it("rejects citations that do not reference a source", async () => {
    const agent = createAgent({
      execute: async () => ({
        output: {
          reportId: "00000000-0000-4000-8000-000000000000",
          taskDescription: task.description,
          summary: "Typed JavaScript.",
          sources: [],
          confidence: 0.9,
          citations: [{ sourceId: 2, text: "Unknown source." }],
          metadata: { createdAt: "2026-08-06T00:00:00.000Z", agentVersion: "1.0.0" },
        },
        raw: "{}",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "test-model",
        provider: "test",
        latencyMs: 1,
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { task } }, activeSignal),
      /unknown source/
    );
  });
});
