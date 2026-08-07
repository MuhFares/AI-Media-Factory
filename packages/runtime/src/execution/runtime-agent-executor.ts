/**
 * Runtime implementation of AgentExecutorPort.
 * Adapts the generic AgentRuntime to the AgentExecutorPort.
 */

import type { AgentExecutorPort } from "../interfaces/agent-executor-port.js";
import type { AgentRuntime, RuntimeInput } from "../interfaces/runtime.js";
import type { AgentStep, WorkflowContext, StepOutcome } from "@ai-media-factory/shared";

export class RuntimeAgentExecutor implements AgentExecutorPort {
  constructor(private readonly agentRuntime: AgentRuntime) {}

  async executeAgentStep(step: AgentStep, context: WorkflowContext): Promise<StepOutcome> {
    const workflowId = context.workflowId;

    const input: RuntimeInput = {
      agent: step.agent,
      event: {
        schema_version: "1.0.0",
        event_id: `evt-${Date.now()}`,
        workflow_id: workflowId,
        correlation_id: context.correlationId,
        brand_id: context.brandId,
        asset_id: null,
        timestamp: new Date().toISOString(),
        type: step.emits,
        source_agent: "workflow-engine",
        target_agent: step.agent,
        payload: context.data,
        metadata: {},
      },
    };

    const result = await this.agentRuntime.run(input);

    if (result.status === "COMPLETED") {
      return {
        status: "completed",
        output: result.emitted?.payload ?? {},
      };
    }

    throw new Error(`Agent step failed: ${result.error?.message ?? "Unknown error"}`);
  }
}
