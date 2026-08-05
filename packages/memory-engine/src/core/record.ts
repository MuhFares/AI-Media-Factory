/**
 * The MemoryRecord — the unit stored and retrieved by the engine.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { AgentId, Json, MemoryId, MemoryType, Timestamp } from "./common";

/** Where a memory came from (source attribution, req #14). Required on every write. */
export interface Provenance {
  sources: Array<{ type: string; ref: string }>;
  derived_by: AgentId;
}

/** A single memory item, with confidence + provenance + version linkage. */
export interface MemoryRecord {
  memory_id: MemoryId;
  type: MemoryType;
  agent: AgentId | null;      // null for company-wide types
  brand_id: string | null;
  body: Json;
  /** Confidence score 0..1 (req #13). */
  confidence: number;
  provenance: Provenance;     // req #14
  created_at: Timestamp;
  last_reinforced: Timestamp | null;
  /** Version linkage (req #24): this record supersedes a prior one. */
  supersedes: MemoryId | null;
  superseded_by: MemoryId | null;
  version: number;
}

/** Memory made available to one agent turn (short-term scratch + retrieved long-term). */
export interface LoadedMemory {
  shortTerm: MemoryRecord[];
  longTerm: MemoryRecord[];
}
