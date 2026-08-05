/**
 * Query + result contracts for retrieve()/search() and write ops.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { AgentId, Json, MemoryId, MemoryType } from "./common";
import type { MemoryRecord } from "./record";

export type SearchMode = "semantic" | "vector" | "graph" | "keyword" | "hybrid";

/** A memory query. The engine scopes it to the types the agent may read. */
export interface MemoryQuery {
  agent: AgentId;
  /** Restrict to specific memory types, or omit for all readable types. */
  scope?: MemoryType[];
  text?: string;
  filter?: Json;          // structured filters (brand_id, topic, time range...)
  mode?: SearchMode;      // default hybrid
  topK?: number;          // budget cap; tuned per agent
  minConfidence?: number; // confidence gate (req #13)
}

/** One ranked hit with its score breakdown. */
export interface RankedRecord {
  record: MemoryRecord;
  score: number;
  signals: {
    relevance: number;
    recency: number;
    performance: number;
    confidence: number;
    conflictPenalty: number;
  };
}

export interface RetrievalResult {
  records: RankedRecord[];
  /** Records dropped as superseded/conflicting, for transparency/audit. */
  suppressed: MemoryId[];
}

export interface WriteResult {
  memory_id: MemoryId;
  version: number;
  /** If this write superseded a prior record. */
  supersededId: MemoryId | null;
}
