/** QAAgent + real command capability through the Runtime boundary. */
import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { CommandCapabilityExecutor, COMMAND_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { createQAAgent } from "../dist/index.js";

const requestId = "00000000-0000-4000-8000-000000000001";
const objective = "Validate the workflow";

function input(capabilityRequests) {
  return {
    requestId,
    objective,
    request: { scope: "workflow", requirements: ["build succeeds"], expectedTests: ["node --version"] },
    capabilityRequests,
  };
}

function buildBoundary(root) {
  const commandExecutor = new CommandCapabilityExecutor({
    allowedCommands: [{ command: "node", args: ["--version"] }],
    allowedWorkingDirectoryRoots: [root],
    timeoutMs: 5000,
    maxStdoutBytes: 1024,
    maxStderrBytes: 1024,
    environment: { inherit: false, allowedKeys: [] },
  });
  const descriptor = { capabilityId: COMMAND_CAPABILITY_ID, description: "Command", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
  const resolver = { resolve: (id) => (id === COMMAND_CAPABILITY_ID ? descriptor : null), isAuthorized: () => true };
  const boundary = new RuntimeCapabilityExecutor({ resolver, executor: { execute: (r) => commandExecutor.execute(r) } });
  return boundary;
}

function signal() { return { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} }; }

describe("QAAgent capability integration", () => {
  it("executes a real command through the Runtime boundary and derives runtime-supplied evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "qa-cap-"));
    try {
      const boundary = buildBoundary(root);
      const expectedTest = "node --version";
      const agent = createQAAgent({
        config: {},
        execute: async (context, executionRequest) => {
          const prompt = executionRequest.messages[1].content;
          const version = /node --version/.test(prompt);
          return {
            output: {
              reportId: "00000000-0000-4000-8000-000000000002",
              requestId,
              objective,
              status: version ? "passed" : "reviewed",
              summary: version ? "Runtime evidence confirms the build test passed." : "Reviewed supplied evidence",
              testResults: [{
                testName: expectedTest,
                status: "passed",
                executed: true,
                source: "runtime",
                evidence: "v20",
              }],
              findings: [],
              risks: [],
              recommendations: [],
              metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: true },
            },
            raw: "{}",
            usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
            model: "test",
            provider: "test",
            latencyMs: 1,
          };
        },
        capabilityExecution: boundary,
      });
      const result = await agent.execute({
        context: {},
        input: input([
          { requestId: "cap-1", capabilityId: COMMAND_CAPABILITY_ID, agentId: "qa", workflowId: "workflow-1", correlationId: "correlation-1", input: { command: "node", args: ["--version"], cwd: root }, requestedAt: "2026-08-11T00:00:00.000Z" },
        ]),
      }, signal());

      const executions = result.output.capabilityExecutions;
      strictEqual(executions.length, 1);
      strictEqual(executions[0].status, "success");
      strictEqual(executions[0].evidence.exitCode, 0);
      strictEqual(executions[0].evidence.capabilityId, COMMAND_CAPABILITY_ID);
      strictEqual(executions[0].evidence.agentId, "qa");
      strictEqual(executions[0].evidence.workflowId, "workflow-1");
      strictEqual(executions[0].evidence.correlationId, "correlation-1");
      strictEqual(executions[0].evidence.succeeded, true);
      strictEqual(result.output.status, "passed");
      strictEqual(result.output.metadata.executionEvidencePresent, true);
      strictEqual(result.output.testResults[0].source, "runtime");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not claim passed when the command capability is blocked", async () => {
    const root = await mkdtemp(join(tmpdir(), "qa-cap-"));
    try {
      const commandExecutor = new CommandCapabilityExecutor({
        allowedCommands: [{ command: "node", args: ["--version"] }],
        allowedWorkingDirectoryRoots: [root],
        timeoutMs: 5000,
        maxStdoutBytes: 1024,
        maxStderrBytes: 1024,
        environment: { inherit: false, allowedKeys: [] },
      });
      const descriptor = { capabilityId: COMMAND_CAPABILITY_ID, description: "Command", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
      const resolver = { resolve: () => descriptor, isAuthorized: () => false };
      const boundary = new RuntimeCapabilityExecutor({ resolver, executor: { execute: (r) => commandExecutor.execute(r) } });
      const agent = createQAAgent({
        config: {},
        execute: async () => ({
          output: {
            reportId: "00000000-0000-4000-8000-000000000003",
            requestId,
            objective,
            status: "blocked",
            summary: "Blocked: no execution evidence.",
            testResults: [],
            findings: [],
            risks: [],
            recommendations: [],
            metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0", executionEvidencePresent: false },
          },
          raw: "{}",
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
          model: "test",
          provider: "test",
          latencyMs: 1,
        }),
        capabilityExecution: boundary,
      });
      const result = await agent.execute({
        context: {},
        input: input([
          { requestId: "cap-1", capabilityId: COMMAND_CAPABILITY_ID, agentId: "qa", workflowId: "workflow-1", correlationId: "correlation-1", input: { command: "node", args: ["--version"], cwd: root }, requestedAt: "2026-08-11T00:00:00.000Z" },
        ]),
      }, signal());
      strictEqual(result.output.capabilityExecutions[0].status, "blocked");
      strictEqual(result.output.metadata.executionEvidencePresent, false);
      strictEqual(result.output.status, "blocked");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
