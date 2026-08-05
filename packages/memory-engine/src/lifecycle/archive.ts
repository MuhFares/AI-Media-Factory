/**
 * Archival (req #6).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Moves aged-but-retained memory to cold storage (data/). Still replayable/
 * queryable, just not hot. Committed memory is archived, not deleted.
 */

import type { MemoryType, Timestamp } from "../core/common";

export interface ArchiveTarget {
  location: string; // e.g. data/ cold store path
  compacted: boolean;
}

export interface Archiver {
  /** Archive records of a type older than a cutoff to cold storage. */
  archive(type: MemoryType, olderThan: Timestamp, target: ArchiveTarget): Promise<{ archived: number }>;
  /** Restore an archived record for replay/audit. */
  restore(memoryId: string): Promise<void>;
}
