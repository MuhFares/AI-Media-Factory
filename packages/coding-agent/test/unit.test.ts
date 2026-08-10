/** Unit tests for CodingAgent. */

import { describe, it } from "node:test";
import { ok, rejects, strictEqual } from "node:assert";
import { createCodingAgent } from "../dist/index.js";

const task = {
  id: "coding-1",
  name: "Implement User Service",
  description: "Implement a user service with CRUD operations",
  agent: "coding",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

function createAgent(overrides = {}) {
  return createCodingAgent({
    config: {},
    execute: async () => ({
      output: {
        resultId: "00000000-0000-4000-8000-000000000000",
        taskDescription: task.description,
        status: "completed",
        summary: "Implemented user service with CRUD operations.",
        actions: [
          {
            id: "action-1",
            type: "create_file",
            description: "Create the user service implementation",
            filePath: "src/services/user.service.ts",
            content: "// User service implementation\n",
            status: "completed",
            output: "File created successfully",
          },
          {
            id: "action-2",
            type: "modify_file",
            description: "Update test file",
            filePath: "test/user.service.test.ts",
            content: "// Updated tests\n",
            status: "completed",
            output: "Test file updated",
          },
        ],
        affectedFiles: [
          {
            path: "src/services/user.service.ts",
            changeType: "created",
            description: "Created user service implementation",
          },
          {
            path: "test/user.service.test.ts",
            changeType: "modified",
            description: "Updated test file",
          },
        ],
        errors: [],
        recommendedTests: [
          {
            type: "unit",
            description: "Test user service CRUD operations",
            priority: "high",
            suggestedPath: "test/user.service.test.ts",
          },
        ],
        confidence: 0.9,
        metadata: {
          createdAt: "2026-08-10T00:00:00.000Z",
          agentVersion: "1.0.0",
          durationMs: 100,
        },
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

describe("CodingAgent", () => {
  it("normalizes a runtime coding response", async () => {
    let receivedRequest;
    const agent = createCodingAgent({
      config: {},
      execute: async (_context, request) => {
        receivedRequest = request;
        return {
          output: {
            resultId: "00000000-0000-4000-8000-000000000000",
            taskDescription: task.description,
            status: "completed",
            summary: "Implemented user service with CRUD operations.",
            actions: [
              {
                id: "action-1",
                type: "create_file",
                description: "Create the user service implementation",
                filePath: "src/services/user.service.ts",
                content: "// User service implementation\n",
                status: "completed",
                output: "File created successfully",
              },
            ],
            affectedFiles: [
              {
                path: "src/services/user.service.ts",
                changeType: "created",
                description: "Created user service implementation",
              },
            ],
            errors: [],
            recommendedTests: [
              {
                type: "unit",
                description: "Test user service CRUD operations",
                priority: "high",
                suggestedPath: "test/user.service.test.ts",
              },
            ],
            confidence: 0.9,
            metadata: {
              createdAt: "2026-08-10T00:00:00.000Z",
              agentVersion: "1.0.0",
              durationMs: 100,
            },
          },
          raw: "{}",
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
          model: "test-model",
          provider: "test",
          latencyMs: 1,
        };
      },
    });

    const result = await agent.execute({ context: {}, input: { task } }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} });

    strictEqual(result.response.model, "test-model");
    strictEqual(result.output.taskDescription, task.description);
    ok(Array.isArray(result.output.actions));
    strictEqual(result.output.actions[0].type, "create_file");
    strictEqual(receivedRequest.model, "openrouter/auto");
  });

  it("rejects invalid coding response", async () => {
    const agent = createCodingAgent({
      config: {},
      execute: async () => ({
        output: {
          resultId: "00000000-0000-4000-8000-000000000000",
          taskDescription: task.description,
          status: "completed",
          summary: "Test",
          actions: [
            {
              id: "action-1",
              type: "invalid_type",
              description: "Invalid action",
              status: "completed",
            },
          ],
          affectedFiles: [],
          errors: [],
          recommendedTests: [],
          confidence: 0.9,
          metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0", durationMs: 100 },
        },
        raw: "{}",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "test-model",
        provider: "test",
        latencyMs: 1,
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { task } }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} }),
      /Invalid coding response: invalid action structure/
    );
  });

  it("rejects response with task description mismatch", async () => {
    const agent = createCodingAgent({
      config: {},
      execute: async () => ({
        output: {
          resultId: "00000000-0000-4000-8000-000000000000",
          taskDescription: "Different task description",
          status: "completed",
          summary: "Test",
          actions: [],
          affectedFiles: [],
          errors: [],
          recommendedTests: [],
          confidence: 0.9,
          metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0", durationMs: 100 },
        },
        raw: "{}",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "test-model",
        provider: "test",
        latencyMs: 1,
      }),
    });

    await rejects(
      () => agent.execute({ context: {}, input: { task } }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} }),
      /task description does not match/
    );
  });

  it("handles blocked status", async () => {
    const agent = createCodingAgent({
      config: {},
      execute: async () => ({
        output: {
          resultId: "00000000-0000-4000-8000-000000000000",
          taskDescription: task.description,
          status: "blocked",
          summary: "Missing required tool",
          actions: [],
          affectedFiles: [],
          errors: [
            {
              code: "TOOL_UNAVAILABLE",
              message: "File write tool not available",
              recoverable: true,
            },
          ],
          recommendedTests: [],
          confidence: 0.5,
          metadata: { createdAt: "2026-08-10T00:00:00.000Z", agentVersion: "1.0.0", durationMs: 50 },
        },
        raw: "{}",
        usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        model: "test-model",
        provider: "test",
        latencyMs: 1,
      }),
    });

    const result = await agent.execute({ context: {}, input: { task } }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} });
    strictEqual(result.output.status, "blocked");
    strictEqual(result.output.errors[0].code, "TOOL_UNAVAILABLE");
  });

  it("handles cancellation", async () => {
    const agent = createCodingAgent({
      config: {},
      execute: async () => {
        throw new Error("Cancelled");
      },
    });

    const cancelledSignal = {
      isCancelled: true,
      onCancelled: () => {},
      throwIfCancelled() {
        throw new Error("Cancelled");
      },
    };

    await rejects(
      () => agent.execute({ context: {}, input: { task } }, cancelledSignal),
      /Cancelled/
    );
  });
});
