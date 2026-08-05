/**
 * Compression + summarization (reqs #7, #8).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Collapse many low-level observations into fewer higher-level, confidence-
 * scored records. Lossy at the raw level, lossless at the lesson level.
 */

import type { MemoryRecord } from "../core/record";

/** Summarize a set of records into one higher-level record (#8). */
export interface Summarizer {
  summarize(records: MemoryRecord[]): Promise<MemoryRecord>;
}

/** Compress a scope by summarizing + deduplicating aged records (#7). */
export interface Compressor {
  /** Returns the compressed records and the count removed. */
  compress(records: MemoryRecord[]): Promise<{ output: MemoryRecord[]; removed: number }>;
  /** Reinforce an existing record instead of storing a near-duplicate. */
  dedupe(candidate: MemoryRecord, existing: MemoryRecord[]): MemoryRecord | null;
}
