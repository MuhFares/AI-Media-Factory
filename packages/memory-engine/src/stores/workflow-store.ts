/**
 * Workflow Memory store (req #22). Per-workflow state/events; summarized then expired.
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: Orchestrator. Distinct from Session: workflow = pipeline-level state.
 */

import type { MemoryStore } from "./memory-store.js";
import type { MemoryRecord } from "../core/record.js";
import type { Uuid } from "../core/common.js";

export interface WorkflowStore extends MemoryStore {
  /** Persist a workflow state transition or milestone. */
  recordTransition(workflowId: Uuid, record: MemoryRecord): Promise<void>;
  /** The state/event history of one workflow. */
  history(workflowId: Uuid): Promise<MemoryRecord[]>;
  /** Summarize a completed workflow into durable outcomes. */
  summarize(workflowId: Uuid): Promise<MemoryRecord>;
}
