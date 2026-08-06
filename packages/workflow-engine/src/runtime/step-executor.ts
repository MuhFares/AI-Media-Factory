/**
 * Default StepExecutor implementation.
 */

import type { Json } from "../core/common.js";
import type { Step } from "../model/step.js";
import type { WorkflowContext } from "../model/context.js";
import type { StepOutcome, StepExecutor } from "../execution/step-executor.js";
import type { AgentRuntime, RuntimeInput } from "@ai-media-factory/runtime";
import type { BranchRouter } from "../execution/router.js";
import type { Scheduler } from "../execution/scheduler.js";
import type { TimeoutController } from "../resilience/timeout.js";
import type { WorkflowRetryPolicy } from "../resilience/retry.js";
import type { CheckpointCoordinator } from "../resilience/checkpoint.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { WorkflowStateMachine } from "../core/common.js";

export class DefaultStepExecutor implements StepExecutor {
  constructor(
    private readonly agentRuntime: AgentRuntime,
    private readonly branchRouter: BranchRouter,
    private readonly scheduler: Scheduler,
    private readonly timeoutController: TimeoutController,
    private readonly retryPolicy: WorkflowRetryPolicy,
    private readonly checkpointCoordinator: CheckpointCoordinator,
    private readonly getWorkflowInstance: (workflowId: string) => Promise<WorkflowInstance | null>,
    private readonly stateMachine: WorkflowStateMachine
  ) {}

  async execute(step: Step, context: WorkflowContext): Promise<StepOutcome> {
    switch (step.kind) {
      case "agent":
        return this.executeAgentStep(step, context);
      case "branch":
        return this.executeBranchStep(step, context);
      case "parallel":
        return this.executeParallelStep(step, context);
      case "gate":
        return this.executeGateStep(step, context);
      case "compensation":
        return this.executeCompensationStep(step, context);
      default:
        throw new Error(`Unknown step kind: ${(step as Step).kind}`);
    }
  }

  private async executeAgentStep(step: any, context: WorkflowContext): Promise<StepOutcome> {
    const workflowId = context.workflowId;
    const instance = await this.getWorkflowInstance(workflowId);
    if (!instance) {
      throw new Error(`Workflow instance not found: ${workflowId}`);
    }

    const deadline = step.timeoutSeconds
      ? this.timeoutController.stepDeadline(step.id, step.timeoutSeconds)
      : this.timeoutController.workflowDeadline(workflowId, 300);

    let attempt = 0;
    while (true) {
      try {
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
          await this.checkpointCoordinator.checkpoint(instance);
          return {
            status: "completed",
            output: result.emitted?.payload ?? {},
          };
        }

        throw new Error(`Agent step failed: ${result.error?.message ?? "Unknown error"}`);
      } catch (error) {
        attempt++;
        const stepError = {
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        };

        if (!this.retryPolicy.shouldRetry(stepError, attempt)) {
          return {
            status: "failed",
            output: {},
            error: { message: stepError.message, retryable: false },
          };
        }

        const delay = this.retryPolicy.backoffMs(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  private async executeBranchStep(step: any, context: WorkflowContext): Promise<StepOutcome> {
    const chosenNext = this.branchRouter.choose(step, context);
    return {
      status: "completed",
      output: {},
      chosenNext,
    };
  }

  private async executeParallelStep(step: any, context: WorkflowContext): Promise<StepOutcome> {
    // Parallel step just advances the workflow; branches are handled by scheduler
    return {
      status: "completed",
      output: { branches: step.branches },
    };
  }

  private async executeGateStep(step: any, context: WorkflowContext): Promise<StepOutcome> {
    // Gate step pauses the workflow and awaits approval
    // The actual approval request is handled by the engine
    return {
      status: "awaiting_approval",
      output: { approver: step.approver, reason: step.reason },
    };
  }

  private async executeCompensationStep(step: any, context: WorkflowContext): Promise<StepOutcome> {
    // Compensation step execution
    return {
      status: "completed",
      output: { undoes: step.undoes },
    };
  }
}