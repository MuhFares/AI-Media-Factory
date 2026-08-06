/**
 * Step executor (req #4) — runs a single step.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * For an AgentStep it delegates to the Runtime (AgentRuntime.run) — it does NOT
 * execute the agent itself. For other step kinds it evaluates control flow.
 */

import type { Json } from "../core/common.js";
import type { Step } from "../model/step.js";
import type { WorkflowContext } from "../model/context.js";

export interface StepOutcome {
  status: "completed" | "failed" | "awaiting_approval";
  /** Output merged into WorkflowContext.outputs. */
  output: Json;
  /** For branch steps: the chosen next step id. */
  chosenNext?: string;
  error?: { message: string; retryable: boolean };
}

export interface StepExecutor {
  /**
   * Execute one step against the current context. AgentStep → Runtime;
   * BranchStep → Router; ParallelStep → Scheduler; GateStep → Approval.
   */
  execute(step: Step, context: WorkflowContext): Promise<StepOutcome>;
}
