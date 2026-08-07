/**
 * Agent Executor Port (req #4) — re-exported from shared package.
 * The Workflow Engine depends on this port; the Runtime provides the implementation.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export {
  WorkflowContext,
  AgentStep,
  StepOutcome,
  AgentExecutorPort,
} from "@ai-media-factory/shared";
