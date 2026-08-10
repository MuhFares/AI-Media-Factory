import { describe, it } from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";

describe("capability contracts", () => {
  const request = {
    requestId: "request-1",
    capabilityId: "filesystem.read",
    agentId: "reviewer",
    workflowId: "workflow-1",
    correlationId: "correlation-1",
    input: { path: "src/index.ts" },
    requestedAt: "2026-08-11T00:00:00.000Z",
  };

  it("preserves capability request identity and context", () => {
    strictEqual(request.capabilityId, "filesystem.read");
    strictEqual(request.agentId, "reviewer");
    strictEqual(request.workflowId, "workflow-1");
    strictEqual(request.correlationId, "correlation-1");
  });

  it("distinguishes success, blocked, and failed results", () => {
    const success = { status: "success", resultId: "result-1", capabilityId: request.capabilityId, output: { content: "..." } };
    const blocked = { status: "blocked", resultId: "result-2", capabilityId: request.capabilityId, reason: "not authorized" };
    const failed = { status: "failed", resultId: "result-3", capabilityId: request.capabilityId, error: { code: "FAILED", message: "unavailable", retryable: false } };

    strictEqual(success.status, "success");
    strictEqual(blocked.status, "blocked");
    strictEqual(failed.status, "failed");
    deepStrictEqual(Object.keys(blocked).sort(), ["capabilityId", "reason", "resultId", "status"]);
  });

  it("supports injectable resolver and executor boundaries", async () => {
    const resolver = {
      resolve: (capabilityId) => capabilityId === request.capabilityId
        ? { capabilityId, description: "Read content", inputSchema: { type: "object" }, outputSchema: { type: "object" } }
        : null,
      isAuthorized: (agentId, capabilityId) => agentId === request.agentId && capabilityId === request.capabilityId,
    };
    const executor = {
      execute: async (value) => ({ status: "blocked", resultId: "result-4", capabilityId: value.capabilityId, reason: "no implementation in Step 8.1" }),
    };

    strictEqual(resolver.resolve(request.capabilityId)?.capabilityId, request.capabilityId);
    strictEqual(resolver.isAuthorized(request.agentId, request.capabilityId), true);
    strictEqual((await executor.execute(request)).status, "blocked");
  });

  it("represents execution evidence without implementing execution", () => {
    const evidence = {
      evidenceId: "evidence-1",
      capabilityId: "execution.command",
      executedAt: "2026-08-11T00:00:01.000Z",
      durationMs: 12,
      command: "npm test",
      exitCode: 0,
      stdoutRef: "artifact://stdout-1",
      stderrRef: "artifact://stderr-1",
      workingDirectory: "workspace",
    };

    strictEqual(evidence.capabilityId, "execution.command");
    strictEqual(evidence.exitCode, 0);
    strictEqual(typeof evidence.durationMs, "number");
  });
});
