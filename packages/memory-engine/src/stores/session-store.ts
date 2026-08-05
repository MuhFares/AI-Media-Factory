/**
 * Session Memory store (req #17). Ephemeral, one workflow run.
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: Orchestrator. Distilled to durable memory before expiry (~30 days).
 */

import type { MemoryStore } from "./memory-store.js";
import type { MemoryRecord } from "../core/record.js";
import type { Uuid } from "../core/common.js";

export interface SessionStore extends MemoryStore {
  /** Append an event/artifact to a run, keyed by workflow_id. */
  appendToRun(workflowId: Uuid, record: MemoryRecord): Promise<void>;
  /** The ordered records of one run (for summarization/audit). */
  run(workflowId: Uuid): Promise<MemoryRecord[]>;
  /** Summarize a completed run's durable takeaways before expiry. */
  distill(workflowId: Uuid): Promise<MemoryRecord[]>;
}
