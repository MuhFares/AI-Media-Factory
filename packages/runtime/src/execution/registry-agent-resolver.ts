import type { AgentRegistry } from "@ai-media-factory/agent-registry";
import type { AgentId, Json } from "../interfaces/common.js";
import type { WorkflowContext } from "@ai-media-factory/shared";
import type { AgentResolver, ResolvedAgent } from "../interfaces/agent-executor-port.js";

function optionalString(value: Json): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Typed adapter from the registry lifecycle model to the runtime resolver contract. */
export class RegistryAgentResolver implements AgentResolver {
  constructor(private readonly registry: AgentRegistry) {}

  async resolve(agentId: AgentId): Promise<ResolvedAgent> {
    const instance = await this.registry.resolve(agentId);
    return {
      id: instance.id,
      execute: (input: Json, context: WorkflowContext) => instance.execute(input, {
        workflowId: context.workflowId,
        stepId: optionalString(context.data.stepId),
        correlationId: context.correlationId ?? undefined,
        traceId: optionalString(context.data.traceId),
        metadata: context.data,
      }),
    };
  }
}
