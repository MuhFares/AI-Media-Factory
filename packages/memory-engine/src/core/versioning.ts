/**
 * Versioning contracts (req #24).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Durable memory is append-only + superseded, never blind-overwritten. Every
 * record has a version and a supersedes/superseded_by chain, so full history
 * is reconstructable and auditable.
 */

import type { MemoryId, Timestamp } from "./common.js";
import type { MemoryRecord } from "./record.js";

export interface VersionEntry {
  memory_id: MemoryId;
  version: number;
  at: Timestamp;
  reason: string;
}

/** The full lineage of a memory item across supersessions. */
export interface VersionHistory {
  head: MemoryRecord;      // current version
  lineage: VersionEntry[]; // oldest → newest
}

export interface VersionStore {
  history(memoryId: MemoryId): Promise<VersionHistory>;
  /** Resolve the current (non-superseded) version of a lineage. */
  head(memoryId: MemoryId): Promise<MemoryRecord | null>;
}
