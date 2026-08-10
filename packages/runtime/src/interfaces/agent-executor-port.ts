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

import type { AgentId, Json } from "./common.js";
import type { WorkflowContext } from "@ai-media-factory/shared";

/** Injectable resolution boundary used by the workflow-facing executor. */
export interface AgentResolver {
  resolve(agentId: AgentId): Promise<ResolvedAgent>;
}

/** Agent execution semantics exposed after resolution; concrete agents stay behind this port. */
export interface ResolvedAgent {
  readonly id: AgentId;
  execute(input: Json, context: WorkflowContext): Promise<Json>;
}
