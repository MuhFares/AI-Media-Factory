/** CodingAgent + real capability layer integration through the Runtime boundary. */
import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import {
  FilesystemCapabilityExecutor,
  FILESYSTEM_CAPABILITY_ID,
  CommandCapabilityExecutor,
  COMMAND_CAPABILITY_ID,
} from "@ai-media-factory/tool-framework";
import { createCodingAgent } from "../dist/index.js";

const task = {
  id: "coding-cap-1",
  name: "Write a module",
  description: "Create a user module",
  agent: "coding",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

function codingReport(status = "completed") {
  return {
    resultId: "00000000-0000-4000-8000-000000000001",
    taskDescription: task.description,
    status,
    summary: "Created the user module file and ran a verification command.",
    actions: [
      { id: "a-1", type: "create_file", description: "Create module", filePath: "src/user.ts", status: "completed", output: "File created" },
      { id: "a-2", type: "run_command", description: "Verify", command: "node", status: "completed", output: "ok" },
    ],
    affectedFiles: [{ path: "src/user.ts", changeType: "created", description: "Created module" }],
    errors: [],
    recommendedTests: [],
    confidence: 0.9,
    metadata: { createdAt: "2026-08-11T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

function buildBoundary(root) {
  const fsExecutor = new FilesystemCapabilityExecutor({
    allowedRoots: [root],
    allowedOperations: ["read", "write", "create", "modify", "delete"],
    maxFileSizeBytes: 1_000_000,
  });
  const commandExecutor = new CommandCapabilityExecutor({
    allowedCommands: [{ command: "node", args: ["--version"] }],
    allowedWorkingDirectoryRoots: [root],
    timeoutMs: 5000,
    maxStdoutBytes: 1024,
    maxStderrBytes: 1024,
    environment: { inherit: false, allowedKeys: [] },
  });
  const descriptors = {
    [FILESYSTEM_CAPABILITY_ID]: { capabilityId: FILESYSTEM_CAPABILITY_ID, description: "Filesystem", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
    [COMMAND_CAPABILITY_ID]: { capabilityId: COMMAND_CAPABILITY_ID, description: "Command", inputSchema: { type: "object" }, outputSchema: { type: "object" } },
  };
  const resolver = {
    resolve: (id) => descriptors[id] ?? null,
    isAuthorized: () => true,
  };
  const executor = {
    execute: (request) => {
      if (request.capabilityId === FILESYSTEM_CAPABILITY_ID) return fsExecutor.execute(request);
      if (request.capabilityId === COMMAND_CAPABILITY_ID) return commandExecutor.execute(request);
      return { status: "blocked", resultId: `blocked-${request.requestId}`, capabilityId: request.capabilityId, reason: "Unknown capability" };
    },
  };
  return { boundary: new RuntimeCapabilityExecutor({ resolver, executor }), fsExecutor, commandExecutor };
}

function request(id, capabilityId, input) {
  return {
    requestId: id,
    capabilityId,
    operation: input.operation,
    agentId: "coding",
    workflowId: "workflow-1",
    correlationId: "correlation-1",
    input,
    requestedAt: "2026-08-11T00:00:00.000Z",
  };
}

describe("CodingAgent capability integration", () => {
  it("executes a real filesystem capability through the Runtime boundary and embeds real evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "coding-cap-"));
    try {
      const { boundary } = buildBoundary(root);
      const filePath = join(root, "user.ts");
      const agent = createCodingAgent({
        config: {},
        execute: async () => ({ output: codingReport(), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
        capabilityExecution: boundary,
      });
      const result = await agent.execute({
        context: {},
        input: {
          task,
          capabilityRequests: [
            request("cap-1", FILESYSTEM_CAPABILITY_ID, { operation: "create", path: filePath, content: "export const user = {};\n" }),
            request("cap-2", COMMAND_CAPABILITY_ID, { command: "node", args: ["--version"], cwd: root }),
          ],
        },
      }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} });

      const executions = result.output.capabilityExecutions;
      strictEqual(executions.length, 2);
      strictEqual(executions[0].status, "success");
      strictEqual(executions[0].evidence.capabilityId, FILESYSTEM_CAPABILITY_ID);
      strictEqual(executions[0].evidence.agentId, "coding");
      strictEqual(executions[0].evidence.workflowId, "workflow-1");
      strictEqual(executions[0].evidence.correlationId, "correlation-1");
      strictEqual(executions[0].evidence.succeeded, true);
      strictEqual(executions[1].status, "success");
      strictEqual(executions[1].evidence.exitCode, 0);
      strictEqual(executions[1].evidence.capabilityId, COMMAND_CAPABILITY_ID);
      strictEqual(result.output.status, "completed");
      const onDisk = await readFile(filePath, "utf8");
      ok(onDisk.includes("export const user"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps real evidence distinct from agent claims and does not let the agent fabricate it", async () => {
    const root = await mkdtemp(join(tmpdir(), "coding-cap-"));
    try {
      const { boundary } = buildBoundary(root);
      const agent = createCodingAgent({
        config: {},
        execute: async () => ({ output: codingReport("completed"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
        capabilityExecution: boundary,
      });
      const result = await agent.execute({
        context: {},
        input: { task, capabilityRequests: [] },
      }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} });
      strictEqual(result.output.capabilityExecutions, undefined);
      strictEqual(result.output.status, "blocked");
      strictEqual(result.output.errors[0].code, "TOOLS_UNAVAILABLE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks the stage truthfully when the capability is not authorized", async () => {
    const root = await mkdtemp(join(tmpdir(), "coding-cap-"));
    try {
      const fsExecutor = new FilesystemCapabilityExecutor({
        allowedRoots: [root],
        allowedOperations: ["read", "write", "create", "modify", "delete"],
        maxFileSizeBytes: 1_000_000,
      });
      const descriptor = { capabilityId: FILESYSTEM_CAPABILITY_ID, description: "Filesystem", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
      const resolver = { resolve: () => descriptor, isAuthorized: () => false };
      const boundary = new RuntimeCapabilityExecutor({ resolver, executor: { execute: (r) => fsExecutor.execute(r) } });
      const agent = createCodingAgent({
        config: {},
        execute: async () => ({ output: codingReport("completed"), raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
        capabilityExecution: boundary,
      });
      const result = await agent.execute({
        context: {},
        input: {
          task,
          capabilityRequests: [
            request("cap-1", FILESYSTEM_CAPABILITY_ID, { operation: "create", path: join(root, "blocked.ts"), content: "x" }),
          ],
        },
      }, { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} });
      strictEqual(result.output.capabilityExecutions[0].status, "blocked");
      strictEqual(result.output.status, "blocked");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
