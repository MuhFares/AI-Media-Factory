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

/**
 * CEO NO-GO evidence gate (Golden Canary governance). When a completed
 * ceo-recommendation artifact carries any verdict other than an explicit
 * ADVANCE, arm the canonical bounded-execution halt on the live context so
 * the engine stops after this step instead of advancing into downstream
 * generation stages. Artifact presence is required: dry-run and routing-proof
 * completions carry no artifact and never arm. The halt is sticky (see
 * engine resume) until Owner-authorized action clears or replaces the
 * marker. Idempotent: never overwrites an existing Owner-authorized marker.
 */

function armCeoNoGoHalt(step: Step, outcome: StepOutcome, context: WorkflowContext): void {
  if (step.id !== "ceo-recommendation" || outcome.status !== "completed") return;
  // Only a real completed ceo_recommendation artifact can arm the halt.
  // Dry-run / routing-proof paths complete without an artifact and must
  // never arm governance side effects.
  if (outcome.artifact?.kind !== "ceo_recommendation") return;
  const payload = outcome.artifact?.payload as Record<string, unknown> | undefined;
  const decision = typeof payload?.decision === "string" ? payload.decision : null;
  // Only an explicit ADVANCE authorizes downstream generation. Any other
  // verdict — including HOLD, RETURN_TO_OWNER, NO_PRODUCTION_CANDIDATE, or
  // a missing/unrecognized decision — halts fail-closed. (CEO contract
  // validation rejects unknown decisions upstream; this is defense in depth.)
  if (decision === "ADVANCE") return;
  const data = context.data as Record<string, unknown>;
  if (data.boundedExecution !== undefined && data.boundedExecution !== null) return;
  data.boundedExecution = {
    stopAfterStepId: step.id,
    reason: `CEO_${decision ?? "UNKNOWN_DECISION"}`,
    authorization: "CANONICAL_EVIDENCE_GATE",
    recoveryExecutionId: null,
  };
}

/**
 * Sticky-halt predicate for redelivery/resume: a completed CEO halt marker
 * blocks resumption until Owner-authorized action clears or replaces it.
 * Non-CEO bounded markers keep legacy resume behavior.
 */
export function ceoNoGoHaltBlocksResume(instance: {
  readonly state: unknown;
  readonly steps: ReadonlyArray<{ readonly stepId: string; readonly status: unknown }>;
  readonly context: { readonly data: Record<string, unknown> };
}): boolean {
  const marker = instance.context.data.boundedExecution as Record<string, unknown> | undefined;
  if (marker === null || typeof marker !== "object" || Array.isArray(marker)) return false;
  const reason = typeof marker.reason === "string" ? marker.reason : "";
  if (!reason.startsWith("CEO_")) return false;
  const stopAfter = typeof marker.stopAfterStepId === "string" ? marker.stopAfterStepId : "";
  if (stopAfter === "") return false;
  return instance.steps.some((step) => step.stepId === stopAfter && step.status === "completed");
}

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
      case "agent": {
        const outcome = await this.agentExecutor.executeAgentStep(step, context);
        armCeoNoGoHalt(step, outcome, context);
        return outcome;
      }
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
