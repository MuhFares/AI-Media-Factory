/**
 * Default StepExecutor implementation.
 */

import type { Json } from "../core/common.js";
import type { Step } from "../model/step.js";
import type { WorkflowContext } from "@ai-media-factory/shared";
import type { StepOutcome, StepExecutor } from "../execution/step-executor.js";
import type { AgentExecutorPort } from "@ai-media-factory/runtime";
import type { BranchRouter } from "../execution/router.js";
import type { Scheduler } from "../execution/scheduler.js";
import type { TimeoutController } from "../resilience/timeout.js";
import type { WorkflowRetryPolicy } from "../resilience/retry.js";
import type { CheckpointCoordinator } from "../resilience/checkpoint.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { WorkflowStateMachine } from "../core/common.js";

export class DefaultStepExecutor implements StepExecutor {
  constructor(
    private readonly agentExecutor: AgentExecutorPort,
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
        return this.agentExecutor.executeAgentStep(step, context);
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
