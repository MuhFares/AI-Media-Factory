/**
 * Runtime implementation of AgentExecutorPort.
 * Adapts the generic AgentRuntime to the AgentExecutorPort.
 */

import type { AgentExecutorPort } from "../interfaces/agent-executor-port.js";
import type { AgentStep, WorkflowContext, StepOutcome } from "@ai-media-factory/shared";
import type { AgentResolver } from "../interfaces/agent-executor-port.js";

export class RuntimeAgentExecutor implements AgentExecutorPort {
  constructor(private readonly agentResolver: AgentResolver) {}

  async executeAgentStep(step: AgentStep, context: WorkflowContext): Promise<StepOutcome> {
    try {
      const agent = await this.agentResolver.resolve(step.agent);
      const output = await agent.execute(context.data, { ...context, data: { ...context.data, stepId: step.id } });
      return { status: "completed", output };
    } catch (error) {
      return { status: "failed", output: {}, error: { message: error instanceof Error ? error.message : String(error), retryable: false } };
    }
  }
}
