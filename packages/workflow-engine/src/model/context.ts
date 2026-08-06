/**
 * Workflow context — the typed data threaded through steps.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json, StepId, Uuid } from "../core/common.js";

/** Data carried across steps; snapshotted into checkpoints for resume. */
export interface WorkflowContext {
  workflowId: Uuid;
  correlationId: string | null;
  brandId: string | null;
  /** Accumulated outputs of completed steps, keyed by step id. */
  outputs: Record<StepId, Json>;
  /** Free-form working data set by branch predicates and steps. */
  data: Record<string, Json>;
}
