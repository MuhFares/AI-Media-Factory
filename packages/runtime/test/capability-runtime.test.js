import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { BaseAgent, DefaultAgentRuntime, RuntimeCapabilityExecutor } from "../dist/index.js";

const descriptor = {
  capabilityId: "web.search",
  description: "Search the web",
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
};

function request() {
  return {
    requestId: "capability-request-1",
    capabilityId: "web.search",
    agentId: "research",
    workflowId: "workflow-1",
    correlationId: "correlation-1",
    input: { query: "runtime capability" },
    requestedAt: "2026-08-11T00:00:00.000Z",
  };
}

function resolver(authorized = true, known = true) {
  return {
    resolve: () => known ? descriptor : null,
    isAuthorized: () => authorized,
  };
}

describe("runtime capability execution", () => {
  it("exposes the same injected boundary to agents without exposing implementations", async () => {
    class TestAgent extends BaseAgent {
      id = "research";
      name = "Test Agent";
      version = "1.0.0";

      async execute(input) {
        const result = await this.executeCapability(input.input);
        return { output: result, response: {} };
      }
    }
    const capabilityRequest = request();
    let received;
    const agent = new TestAgent({
      execute: async () => ({}),
      capabilityExecution: {
        executeCapability: async (value) => {
          received = value;
          return {
            status: "success",
            resultId: "agent-result",
            capabilityId: value.capabilityId,
            output: { executed: true },
            evidence: {
              evidenceId: "agent-evidence",
              capabilityId: value.capabilityId,
              agentId: value.agentId,
              workflowId: value.workflowId,
              correlationId: value.correlationId,
              executedAt: "2026-08-11T00:00:01.000Z",
              durationMs: 1,
              succeeded: true,
            },
          };
        },
      },
    });
    const result = await agent.execute({ context: {}, input: capabilityRequest }, { cancelled: false });
    strictEqual(result.output.status, "success");
    deepStrictEqual(received, capabilityRequest);
  });

  it("forwards an authorized typed request to the injected executor", async () => {
    let received;
    const executor = {
      execute: async (value) => {
        received = value;
        return {
          status: "success",
          resultId: "result-1",
          capabilityId: value.capabilityId,
          output: { results: [] },
          evidence: {
            evidenceId: "evidence-1",
            capabilityId: value.capabilityId,
            executedAt: "2026-08-11T00:00:01.000Z",
            durationMs: 1,
            workflowId: value.workflowId,
            correlationId: value.correlationId,
            agentId: value.agentId,
            succeeded: true,
          },
        };
      },
    };
    const result = await new RuntimeCapabilityExecutor({ resolver: resolver(), executor }).executeCapability(request());
    strictEqual(result.status, "success");
    deepStrictEqual(received, request());
    strictEqual(result.evidence.workflowId, "workflow-1");
    strictEqual(result.evidence.correlationId, "correlation-1");
    strictEqual(result.evidence.agentId, "research");
  });

  it("blocks unauthorized and unknown capabilities before executor invocation", async () => {
    let invoked = false;
    const executor = { execute: async () => { invoked = true; return { status: "success", resultId: "unexpected", capabilityId: "web.search", output: {} }; } };
    const unauthorized = await new RuntimeCapabilityExecutor({ resolver: resolver(false), executor }).executeCapability(request());
    strictEqual(unauthorized.status, "blocked");
    const unknown = await new RuntimeCapabilityExecutor({ resolver: resolver(true, false), executor }).executeCapability(request());
    strictEqual(unknown.status, "blocked");
    strictEqual(invoked, false);
  });

  it("preserves explicit capability failures and converts executor throws to failures", async () => {
    const explicit = new RuntimeCapabilityExecutor({
      resolver: resolver(),
      executor: { execute: async (value) => ({ status: "failed", resultId: "failure-1", capabilityId: "web.search", error: { code: "TIMEOUT", message: "timed out", retryable: false }, evidence: { evidenceId: "failure-evidence", capabilityId: value.capabilityId, agentId: value.agentId, workflowId: value.workflowId, correlationId: value.correlationId, executedAt: "2026-08-11T00:00:01.000Z", durationMs: 1, succeeded: false } }) },
    });
    const explicitResult = await explicit.executeCapability(request());
    strictEqual(explicitResult.status, "failed");
    strictEqual(explicitResult.error.code, "TIMEOUT");
    const throwing = new RuntimeCapabilityExecutor({ resolver: resolver(), executor: { execute: async () => { throw new Error("executor unavailable"); } } });
    const throwingResult = await throwing.executeCapability(request());
    strictEqual(throwingResult.status, "failed");
    strictEqual(throwingResult.error.code, "CAPABILITY_EXECUTION_ERROR");
  });

  it("exposes the injected boundary through DefaultAgentRuntime without a second path", async () => {
    const runtime = new DefaultAgentRuntime({
      configLoader: {}, promptLoader: {}, schemaLoader: {}, memoryLoader: {}, memoryEngine: {}, promptCompiler: {}, router: {},
      capabilityResolver: resolver(), capabilityExecutor: { execute: async (value) => ({ status: "success", resultId: "runtime-result", capabilityId: value.capabilityId, output: { executed: true }, evidence: { evidenceId: "runtime-evidence", capabilityId: value.capabilityId, agentId: value.agentId, workflowId: value.workflowId, correlationId: value.correlationId, executedAt: "2026-08-11T00:00:01.000Z", durationMs: 1, succeeded: true } }) },
    });
    const result = await runtime.executeCapability(request());
    strictEqual(result.status, "success");
    const unconfigured = new DefaultAgentRuntime({ configLoader: {}, promptLoader: {}, schemaLoader: {}, memoryLoader: {}, memoryEngine: {}, promptCompiler: {}, router: {} });
    strictEqual((await unconfigured.executeCapability(request())).status, "blocked");
    const throwingRuntime = new DefaultAgentRuntime({
      configLoader: {}, promptLoader: {}, schemaLoader: {}, memoryLoader: {}, memoryEngine: {}, promptCompiler: {}, router: {},
      capabilityResolver: resolver(), capabilityExecutor: { execute: async () => { throw new Error("boundary unavailable"); } },
    });
    const failed = await throwingRuntime.executeCapability(request());
    strictEqual(failed.status, "failed");
    strictEqual(failed.error.code, "CAPABILITY_EXECUTION_ERROR");
  });

  it("rejects success or failure results without matching execution evidence", async () => {
    const boundary = new RuntimeCapabilityExecutor({
      resolver: resolver(),
      executor: { execute: async () => ({ status: "success", resultId: "fake", capabilityId: "web.search", output: {} }) },
    });
    const result = await boundary.executeCapability(request());
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "MISSING_EXECUTION_EVIDENCE");
  });
});
