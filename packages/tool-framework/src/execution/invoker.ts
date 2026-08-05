import type { ToolInvoker, InvocationContext, ToolResult, CancellationToken } from "./invocation.js";
import type { Tool, ToolSpec } from "../core/tool.js";
import type { ToolRegistry } from "../registry/registry.js";
import type { ToolErrorCode, ToolError } from "../results/results.js";
import type { RetryPolicy, ToolRetryPolicy } from "../resilience/retry.js";
import type { TimeoutController } from "../resilience/timeout.js";
import type { ToolSandbox, SandboxConfig, SandboxHandle } from "../sandbox/sandbox.js";
import type { CredentialResolver, ResolvedCredentials, AuthContext } from "../auth/auth.js";
import type { ApprovalGate, ApprovalRequest, ApprovalDecision, ApprovalContext } from "../gates/approval.js";
import type { PolicyEngine, PolicyEvaluationRequest, PolicyDecision } from "../policies/policies.js";
import type { PermissionEvaluator, PermissionContext } from "../permissions/permissions.js";
import type { ToolLogger } from "../observability/logging.js";
import type { ToolMetrics } from "../observability/metrics.js";
import type { CostTracker, CostEstimator } from "../observability/cost.js";
import { DEFAULT_RETRY_POLICY } from "../resilience/retry.js";
import { DEFAULT_TIMEOUT_CONFIG } from "../resilience/timeout.js";
import { DEFAULT_APPROVAL_RULES } from "../gates/approval.js";

export interface ToolInvokerDependencies {
  registry: ToolRegistry;
  sandbox: ToolSandbox;
  credentialResolver: CredentialResolver;
  approvalGate: ApprovalGate;
  policyEngine: PolicyEngine;
  permissionEvaluator: PermissionEvaluator;
  logger: ToolLogger;
  metrics: ToolMetrics;
  costTracker: CostTracker;
  costEstimator: CostEstimator;
  timeoutController: TimeoutController;
  defaultRetryPolicy: RetryPolicy;
  defaultTimeoutConfig: typeof DEFAULT_TIMEOUT_CONFIG;
}

function createCancellationToken(): CancellationToken & { cancel(): void } {
  let isCancelled = false;
  const handlers: Array<() => void> = [];

  return {
    get isCancelled() {
      return isCancelled;
    },
    onCancelled(handler: () => void) {
      handlers.push(handler);
    },
    throwIfCancelled() {
      if (isCancelled) {
        throw new Error("Operation cancelled");
      }
    },
    cancel() {
      isCancelled = true;
      handlers.forEach((h) => h());
    },
  };
}

function createDefaultRetryPolicy(): ToolRetryPolicy {
  const policy = DEFAULT_RETRY_POLICY;
  return {
    shouldRetry(error: ToolError, attempt: number): boolean {
      if (attempt >= policy.maxAttempts) return false;
      if (policy.nonRetryableErrors.includes(error.code)) return false;
      if (policy.retryableErrors.includes(error.code)) return true;
      return error.retryable;
    },
    getDelay(attempt: number): number {
      const delay = Math.min(
        policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt),
        policy.maxDelayMs
      );
      return policy.jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
    },
    get maxAttempts(): number {
      return policy.maxAttempts;
    },
  };
}

export class DefaultToolInvoker implements ToolInvoker {
  private readonly deps: ToolInvokerDependencies;
  private readonly retryPolicy: ToolRetryPolicy;

  constructor(deps: ToolInvokerDependencies) {
    this.deps = deps;
    this.retryPolicy = createDefaultRetryPolicy();
  }

  async invoke(toolId: string, input: any, context: InvocationContext): Promise<ToolResult> {
    const tool = this.deps.registry.get(toolId);
    if (!tool) {
      return this.createErrorResult(toolId, "VALIDATION_ERROR", `Tool not found: ${toolId}`, false, context);
    }

    this.deps.logger.logInvocation({
      invocationId: context.invocationId,
      toolId,
      agent: context.agent,
      workflowId: context.workflowId,
      inputHash: this.hashInput(input),
      startedAt: new Date().toISOString(),
      status: "started",
    });

    try {
      const permissionCheck = await this.checkPermissions(tool, context);
      if (!permissionCheck.allowed) {
        return this.createErrorResult(toolId, "PERMISSION_DENIED", permissionCheck.reason!, false, context);
      }

      const policyDecision = await this.deps.policyEngine.evaluate({
        toolId,
        agentId: context.agent,
        workflowId: context.workflowId,
        estimatedCostUsd: tool.spec.estimatedCostUsd,
        currentConcurrency: 0,
        agentRateThisMinute: 0,
      });

      if (!policyDecision.allowed) {
        return this.createErrorResult(toolId, "PERMISSION_DENIED", policyDecision.reason ?? "Policy denied", false, context);
      }

      const approvalRequired = await this.checkApproval(tool, context, input);
      if (approvalRequired && !context.approvalDecision?.approved) {
        return this.createErrorResult(toolId, "APPROVAL_REJECTED", "Approval required but not granted", false, context);
      }

      const credentials = await this.deps.credentialResolver.resolve(
        tool.spec.authRequirements as any,
        { agent: context.agent, toolId, workflowId: context.workflowId, environment: "production" }
      );

      const sandboxHandle = await this.deps.sandbox.prepare(tool.spec.sandboxConfig ?? {
        level: "none",
        networkAccess: false,
        filesystemAccess: "none",
      });

      const deadline = new Date(context.deadline);
      const timeoutMs = Math.max(0, deadline.getTime() - Date.now());

      let result: ToolResult;
      let attempt = 0;

      while (true) {
        context.cancellationToken.throwIfCancelled();

        try {
          const executionContext: InvocationContext = {
            ...context,
            credentials,
            sandboxConfig: tool.spec.sandboxConfig ?? {
              level: "none",
              networkAccess: false,
              filesystemAccess: "none",
            },
          };

          result = await this.deps.timeoutController.withTimeout(
            Math.min(timeoutMs, tool.spec.timeoutMs),
            async (signal) => {
              return await this.deps.sandbox.execute(sandboxHandle, async () => {
                return await tool.invoke(input, executionContext);
              });
            }
          );

          if (result.success) {
            break;
          }

          const toolError = result.error!;
          if (!this.retryPolicy.shouldRetry(toolError, attempt)) {
            break;
          }

          attempt++;
          this.deps.metrics.recordRetry(toolId, attempt);
          const delay = this.retryPolicy.getDelay(attempt);
          await this.sleep(delay);
        } catch (error) {
          if (error instanceof Error && error.name === "TimeoutError") {
            this.deps.metrics.recordTimeout(toolId);
            return this.createErrorResult(toolId, "TIMEOUT", "Tool invocation timed out", true, context);
          }
          throw error;
        }
      }

      await this.deps.sandbox.cleanup(sandboxHandle);

      this.deps.metrics.recordInvocation(toolId, result.metadata.durationMs, result.success);
      this.deps.costTracker.recordCost(toolId, result.metadata.costUsd, context.agent);

      if (result.success) {
        this.deps.logger.logResult(result);
      } else {
        this.deps.logger.logError(result.error!, { toolId, context });
      }

      return result;
    } catch (error) {
      const toolError: ToolError = {
        code: "UNKNOWN",
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      };
      this.deps.logger.logError(toolError, { toolId, context });
      return this.createErrorResult(toolId, "UNKNOWN", toolError.message, false, context);
    }
  }

  private async checkPermissions(tool: Tool, context: InvocationContext): Promise<{ allowed: boolean; reason?: string }> {
    for (const permission of tool.spec.requiredPermissions) {
      const permContext: PermissionContext = {
        agent: context.agent,
        toolId: tool.spec.id,
        workflowId: context.workflowId,
        stepId: context.stepId,
        timeOfDay: new Date().toISOString(),
      };
      if (!this.deps.permissionEvaluator.hasPermission(context.agent, permission, permContext)) {
        return { allowed: false, reason: `Missing permission: ${permission}` };
      }
    }
    return { allowed: true };
  }

  private async checkApproval(tool: Tool, context: InvocationContext, input: any): Promise<boolean> {
    const approvalContext: ApprovalContext = {
      toolId: tool.spec.id,
      agent: context.agent,
      workflowId: context.workflowId,
      input,
      estimatedCostUsd: tool.spec.estimatedCostUsd,
      riskLevel: tool.spec.estimatedCostUsd > 0.5 ? "high" : "medium",
    };

    for (const rule of DEFAULT_APPROVAL_RULES) {
      if (rule.toolId === tool.spec.id && rule.condition(approvalContext)) {
        return true;
      }
    }

    return tool.spec.requiresApproval;
  }

  private createErrorResult(
    toolId: string,
    code: ToolErrorCode,
    message: string,
    retryable: boolean,
    context: InvocationContext
  ): ToolResult {
    return {
      resultId: `result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      toolId,
      success: false,
      output: null,
      error: { code, message, retryable },
      metadata: {
        toolId,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        costUsd: 0,
        retryCount: 0,
        cached: false,
        sandboxInfo: { sandboxId: "", level: "none" },
      },
    };
  }

  private hashInput(input: any): string {
    return Buffer.from(JSON.stringify(input)).toString("base64").slice(0, 16);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}