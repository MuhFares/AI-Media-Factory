/**
 * Checkpoint store (req #23). Resume checkpoints for turns/workflows.
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: Orchestrator/runtime. Write-ahead; replay is idempotent.
 */

import type { MemoryStore } from "./memory-store";
import type { Json, Timestamp, Uuid } from "../core/common";

export interface CheckpointRecord {
  turnId: Uuid;
  workflowId: Uuid;
  state: string;
  lastEventOffset: number;
  data: Json;
  createdAt: Timestamp;
}

export interface CheckpointStore extends MemoryStore {
  writeCheckpoint(checkpoint: CheckpointRecord): Promise<void>;
  readCheckpoint(turnId: Uuid): Promise<CheckpointRecord | null>;
}
