/** Unit tests for ReviewerAgent. */

import { describe, it } from "node:test";
import { ok, rejects, strictEqual } from "node:assert";
import { createReviewerAgent } from "../dist/index.js";

const task = {
  id: "review-1",
  name: "Review change",
  description: "Review the supplied service change",
  agent: "reviewer",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

const activeSignal = {
  isCancelled: false,
  onCancelled() {},
  throwIfCancelled() {},
};

function response(output: object) {
  return {
    output,
    raw: "{}",
    usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    model: "test-model",
    provider: "test",
    latencyMs: 1,
  };
}

describe("ReviewerAgent", () => {
  it("normalizes runtime review findings", async () => {
    let receivedRequest;
    const agent = createReviewerAgent({
      config: {},
      execute: async (_context, request) => {
        receivedRequest = request;
        return response({
          reportId: "00000000-0000-4000-8000-000000000000",
          taskDescription: task.description,
          summary: "The change is safe with one follow-up.",
          status: "changes_requested",
          findings: [{ id: "f-1", severity: "medium", category: "correctness", title: "Missing validation", description: "Input validation is incomplete.", recommendation: "Validate the input before processing." }],
          recommendations: [{ priority: "high", description: "Add validation.", relatedFindingIds: ["f-1"] }],
          metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
        });
      },
    });

    const result = await agent.execute({ context: {}, input: { requestId: "request-1", task, context: { code: "return value;" } } }, activeSignal);

    strictEqual(result.response.model, "test-model");
    strictEqual(result.output.status, "changes_requested");
    strictEqual(result.output.findings[0].severity, "medium");
    ok(receivedRequest.responseSchema);
    ok(receivedRequest.messages[1].content.includes("return value;"));
  });

  it("rejects a response with missing findings", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Missing findings",
        status: "blocked",
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid report structure/
    );
  });

  it("accepts a response with empty findings", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "No findings identified.",
        status: "approved",
        findings: [],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    const result = await agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal);
    strictEqual(result.output.findings.length, 0);
  });

  it("rejects an invalid review status", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Invalid status",
        status: "invalid",
        findings: [],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid report structure/
    );
  });

  it("rejects an invalid finding category", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Invalid category",
        status: "changes_requested",
        findings: [{ id: "f-1", severity: "medium", category: "invalid", title: "Bad category", description: "Invalid category.", recommendation: "Fix category." }],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid finding/
    );
  });

  it("rejects malformed findings", async () => {
    const agent = createReviewerAgent({
      config: {},
      execute: async () => response({
        reportId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        summary: "Invalid finding",
        status: "changes_requested",
        findings: [{ id: "f-1", severity: "invalid", category: "correctness", title: "Bad", description: "Bad", recommendation: "Fix" }],
        recommendations: [],
        metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0" },
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { requestId: "request-1", task } }, activeSignal),
      /Invalid review response: invalid finding/
    );
  });
});
