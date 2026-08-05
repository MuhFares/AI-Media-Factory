/**
 * The MemoryEngine facade — the SINGLE interface every agent uses for memory.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * No agent accesses stores or files directly. All eight core operations are
 * scoped by MemoryType; the engine routes to the correct store and enforces
 * per-type rules (permanent types refuse delete/overwrite; ephemeral expire).
 */

import type { MemoryId, MemoryType, Timestamp } from "./common";
import type { MemoryRecord } from "./record";
import type { MemoryQuery, RetrievalResult, WriteResult } from "./query";

export interface ArchiveReport { archived: number; movedTo: string; }
export interface CompressionReport { inputRecords: number; outputRecords: number; ratio: number; }
export interface ExpirationReport { expired: number; promoted: number; }

/** A partial change to an existing record (applied via supersede, not overwrite). */
export interface MemoryPatch {
  body?: unknown;
  confidenceDelta?: number;
  reinforce?: boolean;
  reason: string;
}

/**
 * The one facade. Implementations compose the stores, retrieval pipeline,
 * intelligence layer, lifecycle, caching, and observability behind these 8 ops.
 */
export interface MemoryEngine {
  /** #1 Persist a memory (append/supersede, versioned, provenance required). */
  save(scope: MemoryType, record: MemoryRecord): Promise<WriteResult>;

  /** #2 Retrieve ranked, confidence-scored memory for a query. */
  retrieve(query: MemoryQuery): Promise<RetrievalResult>;

  /** #3 Search across semantic + vector + graph + keyword (hybrid). */
  search(query: MemoryQuery): Promise<RetrievalResult>;

  /** #4 Update by superseding a prior record (never blind overwrite). */
  update(id: MemoryId, patch: MemoryPatch): Promise<WriteResult>;

  /** #5 Delete — policy-gated; refused for permanent types (Company/Decision/Lessons). */
  delete(scope: MemoryType, id: MemoryId, reason: string): Promise<void>;

  /** #6 Archive aged-but-retained memory to cold storage. */
  archive(scope: MemoryType, criteria: { olderThan: Timestamp }): Promise<ArchiveReport>;

  /** #7/#8 Compress + summarize many records into higher-level lessons. */
  compress(scope: MemoryType, criteria: { olderThan: Timestamp }): Promise<CompressionReport>;

  /** #9 Expire ephemeral/rolling memory (after promoting durable residue). */
  expire(scope: MemoryType, asOf: Timestamp): Promise<ExpirationReport>;
}
