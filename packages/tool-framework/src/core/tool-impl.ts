import type { Tool, ToolSpec, ToolResult, ToolHealth, InvocationContext, JsonSchema } from "./tool.js";
import type { CancellationToken } from "./execution.js";

export abstract class BaseTool implements Tool {
  abstract readonly spec: ToolSpec;

  async invoke(input: any, context: InvocationContext): Promise<ToolResult> {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();

    try {
      const validatedInput = this.validateInput(input);
      const output = await this.execute(validatedInput, context);

      const completedAt = new Date().toISOString();
      return {
        resultId: `result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        toolId: this.spec.id,
        success: true,
        output,
        metadata: {
          toolId: this.spec.id,
          startedAt,
          completedAt,
          durationMs: Date.now() - startTime,
          costUsd: this.spec.estimatedCostUsd,
          retryCount: 0,
          cached: false,
          sandboxInfo: {
            sandboxId: `sandbox-${Date.now()}`,
            level: this.spec.sandboxConfig?.level ?? "none",
          },
        },
      };
    } catch (error) {
      const completedAt = new Date().toISOString();
      return {
        resultId: `result-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        toolId: this.spec.id,
        success: false,
        output: null,
        error: {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        },
        metadata: {
          toolId: this.spec.id,
          startedAt,
          completedAt,
          durationMs: Date.now() - startTime,
          costUsd: 0,
          retryCount: 0,
          cached: false,
          sandboxInfo: {
            sandboxId: `sandbox-${Date.now()}`,
            level: this.spec.sandboxConfig?.level ?? "none",
          },
        },
      };
    }
  }

  protected validateInput(input: any): any {
    return input;
  }

  protected abstract execute(input: any, context: InvocationContext): Promise<any>;

  async health(): Promise<ToolHealth> {
    return {
      healthy: true,
      lastCheck: new Date().toISOString(),
    };
  }
}

export function createToolSpec(spec: Omit<ToolSpec, "id"> & { id: string }): ToolSpec {
  return spec;
}

export function createInvocationContext(
  invocationId: string,
  agent: string,
  options: {
    workflowId?: string;
    stepId?: string;
    correlationId: string;
    traceId: string;
    deadline: string;
    cancellationToken: CancellationToken;
    credentials?: any;
    sandboxConfig?: any;
    approvalDecision?: any;
  }
): InvocationContext {
  return {
    invocationId,
    agent,
    workflowId: options.workflowId,
    stepId: options.stepId,
    correlationId: options.correlationId,
    traceId: options.traceId,
    deadline: options.deadline,
    cancellationToken: options.cancellationToken,
    credentials: options.credentials ?? {},
    sandboxConfig: options.sandboxConfig ?? {
      level: "none",
      networkAccess: false,
      filesystemAccess: "none",
    },
    approvalDecision: options.approvalDecision,
  };
}

export function createCancellationToken(): CancellationToken & { cancel(): void } {
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