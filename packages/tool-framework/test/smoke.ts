import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual } from "node:assert";
import {
  DefaultToolRegistry,
  DefaultToolInvoker,
  BaseTool,
  createInvocationContext,
  createCancellationToken,
  DEFAULT_CATEGORY_CONFIGS,
  DEFAULT_RETRY_POLICY,
  DEFAULT_TIMEOUT_CONFIG,
  SANDBOX_LEVELS,
  DEFAULT_APPROVAL_RULES,
} from "../dist/index.js";
import type {
  Tool,
  ToolSpec,
  InvocationContext,
  ToolResult,
  CancellationToken,
  ToolRegistry,
  ToolInvoker,
  ToolSandbox,
  CredentialResolver,
  ApprovalGate,
  PolicyEngine,
  PermissionEvaluator,
  ToolLogger,
  ToolMetrics,
  CostTracker,
  CostEstimator,
  TimeoutController,
  ToolErrorCode,
  ToolError,
  ExecutionMetadata,
  TokenUsage,
  SandboxInfo,
  RetryPolicy,
} from "../dist/index.js";

class MockTool extends BaseTool {
  readonly spec: ToolSpec = {
    id: "test-tool",
    name: "Test Tool",
    category: "custom",
    version: "1.0.0",
    description: "A test tool",
    inputSchema: { type: "object", properties: { input: { type: "string" } } },
    outputSchema: { type: "object", properties: { output: { type: "string" } } },
    requiredPermissions: [],
    timeoutMs: 5000,
    requiresApproval: false,
    authRequirements: [{ type: "none" }],
    estimatedCostUsd: 0.001,
    tags: ["test"],
  };

  protected async execute(input: any, context: InvocationContext): Promise<any> {
    return { output: `Processed: ${input.input}` };
  }
}

class MockSandbox implements ToolSandbox {
  async prepare(config: any) {
    return { sandboxId: "mock-sandbox", cleanup: async () => {} };
  }
  async execute<T>(handle: any, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
  async cleanup(handle: any) {}
}

class MockCredentialResolver implements CredentialResolver {
  async resolve() {
    return {};
  }
}

class MockApprovalGate implements ApprovalGate {
  isApprovalRequired() { return false; }
  async requestApproval() {
    return { invocationId: "", approved: true, approver: "test", reason: "", decidedAt: new Date().toISOString() };
  }
  async applyDecision() {}
}

class MockPolicyEngine implements PolicyEngine {
  async evaluate() {
    return { allowed: true, requiredApprovals: [], overrides: [] };
  }
  getPolicy() { return null; }
  setPolicy() {}
}

class MockPermissionEvaluator implements PermissionEvaluator {
  hasPermission() { return true; }
  getGrantedPermissions() { return []; }
  getDeniedPermissions() { return []; }
}

class MockLogger implements ToolLogger {
  logInvocation() {}
  logResult() {}
  logError() {}
}

class MockMetrics implements ToolMetrics {
  recordInvocation() {}
  recordRetry() {}
  recordTimeout() {}
  recordApproval() {}
  recordCost() {}
  recordTokens() {}
  snapshot() {
    return {
      totalInvocations: 0,
      successRate: 1,
      avgLatencyMs: 0,
      p95LatencyMs: 0,
      retryRate: 0,
      timeoutRate: 0,
      approvalRate: 0,
      avgCostUsd: 0,
      totalCostUsd: 0,
      byTool: {},
      byCategory: {},
    };
  }
}

class MockCostTracker implements CostTracker {
  recordCost() {}
  recordTokens() {}
  getTotalCost() { return 0; }
  getCostBreakdown() {
    return { byTool: {}, byCategory: {}, byAgent: {}, total: 0, period: { from: "", to: "" } };
  }
  getTokenUsage() {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, byTool: {}, byAgent: {} };
  }
}

class MockCostEstimator implements CostEstimator {
  estimateCost() { return 0.001; }
  getEstimatedCostPerCall() { return 0.001; }
}

class MockTimeoutController implements TimeoutController {
  async withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    return work({} as any);
  }
  getRemainingTime() { return 5000; }
  setDeadline() {}
  clearDeadline() {}
}

function createTestContext(): InvocationContext {
  return createInvocationContext(
    "inv-1",
    "test-agent",
    {
      workflowId: "wf-1",
      stepId: "step-1",
      correlationId: "corr-1",
      traceId: "trace-1",
      deadline: new Date(Date.now() + 30000).toISOString(),
      cancellationToken: createCancellationToken(),
    }
  );
}

describe("Tool Framework smoke tests", () => {
  let registry: ToolRegistry;
  let invoker: ToolInvoker;
  let tool: Tool;

  beforeEach(() => {
    registry = new DefaultToolRegistry();
    tool = new MockTool();
    registry.register(tool);

    invoker = new DefaultToolInvoker({
      registry,
      sandbox: new MockSandbox(),
      credentialResolver: new MockCredentialResolver(),
      approvalGate: new MockApprovalGate(),
      policyEngine: new MockPolicyEngine(),
      permissionEvaluator: new MockPermissionEvaluator(),
      logger: new MockLogger(),
      metrics: new MockMetrics(),
      costTracker: new MockCostTracker(),
      costEstimator: new MockCostEstimator(),
      timeoutController: new MockTimeoutController(),
      defaultRetryPolicy: {
        maxAttempts: 3,
        baseDelayMs: 1000,
        maxDelayMs: 30000,
        backoffMultiplier: 2,
        jitter: true,
        retryableErrors: ["TIMEOUT", "RATE_LIMITED"],
        nonRetryableErrors: ["VALIDATION_ERROR"],
      },
      defaultTimeoutConfig: {
        defaultStepTimeoutMs: 60000,
        defaultWorkflowTimeoutMs: 300000,
        maxTimeoutMs: 3600000,
        warningThresholdPercent: 0.8,
      },
    });
  });

  it("should register and retrieve a tool", () => {
    const retrieved = registry.get("test-tool");
    ok(retrieved);
    strictEqual(retrieved!.spec.id, "test-tool");
    strictEqual(retrieved!.spec.name, "Test Tool");
  });

  it("should list all tools", () => {
    const all = registry.all();
    strictEqual(all.length, 1);
    strictEqual(all[0].spec.id, "test-tool");
  });

  it("should validate tool specs", () => {
    const report = registry.validate();
    strictEqual(report.valid, true);
    strictEqual(report.errors.length, 0);
  });

  it("should get tools by category", () => {
    const tools = registry.getByCategory("custom");
    strictEqual(tools.length, 1);
    strictEqual(tools[0].spec.id, "test-tool");
  });

  it("should invoke a tool successfully", async () => {
    const context = createTestContext();
    const result: ToolResult = await invoker.invoke("test-tool", { input: "hello" }, context);

    strictEqual(result.success, true);
    strictEqual(result.toolId, "test-tool");
    ok(result.resultId);
    strictEqual(result.output.output, "Processed: hello");
    ok(result.metadata.durationMs >= 0);
  });

  it("should return error for unknown tool", async () => {
    const context = createTestContext();
    const result: ToolResult = await invoker.invoke("unknown-tool", { input: "hello" }, context);

    strictEqual(result.success, false);
    strictEqual(result.error!.code, "VALIDATION_ERROR");
    ok(result.error!.message.includes("not found"));
  });

  it("should create invocation context", () => {
    const context = createInvocationContext(
      "inv-1",
      "test-agent",
      {
        correlationId: "corr-1",
        traceId: "trace-1",
        deadline: new Date(Date.now() + 30000).toISOString(),
        cancellationToken: createCancellationToken(),
      }
    );

    strictEqual(context.invocationId, "inv-1");
    strictEqual(context.agent, "test-agent");
    strictEqual(context.correlationId, "corr-1");
    ok(context.cancellationToken);
  });

  it("should create cancellation token", () => {
    const token = createCancellationToken();
    strictEqual(token.isCancelled, false);
    token.cancel();
    strictEqual(token.isCancelled, true);
  });

  it("should throw on cancelled token", () => {
    const token = createCancellationToken();
    token.cancel();
    try {
      token.throwIfCancelled();
      ok(false, "should have thrown");
    } catch (e) {
      ok(e instanceof Error);
      strictEqual(e.message, "Operation cancelled");
    }
  });

  it("should handle tool health check", async () => {
    const health = await tool.health();
    strictEqual(health.healthy, true);
    ok(health.lastCheck);
  });
});