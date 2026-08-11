import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
} from "@ai-media-factory/tool-framework";
import type { CapabilityExecutionPort } from "../interfaces/capability-execution.js";

export interface RuntimeCapabilityExecutorDependencies {
  resolver: CapabilityResolver;
  executor: CapabilityExecutorPort;
}

/**
 * Runtime-owned capability boundary. It authorizes a request before routing it
 * to the injected capability executor; it does not import concrete tools.
 */
export class RuntimeCapabilityExecutor implements CapabilityExecutionPort {
  constructor(private readonly deps: RuntimeCapabilityExecutorDependencies) {}

  async executeCapability(request: CapabilityRequest): Promise<CapabilityResult> {
    const descriptor = this.deps.resolver.resolve(request.capabilityId);
    if (descriptor === null) {
      return this.blocked(request, "Unknown capability");
    }
    if (!this.deps.resolver.isAuthorized(request.agentId, request.capabilityId)) {
      return this.blocked(request, "Capability is not authorized for this agent");
    }
    try {
      return await this.deps.executor.execute(request);
    } catch (error) {
      return {
        status: "failed",
        resultId: `runtime-capability-result-${request.requestId}`,
        capabilityId: request.capabilityId,
        error: {
          code: "CAPABILITY_EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Capability execution failed",
          retryable: false,
        },
      };
    }
  }

  private blocked(request: CapabilityRequest, reason: string): CapabilityResult {
    return {
      status: "blocked",
      resultId: `runtime-capability-result-${request.requestId}`,
      capabilityId: request.capabilityId,
      reason,
    };
  }
}
