/**
 * Search contracts: semantic + keyword + hybrid (reqs #3, #10).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { MemoryQuery, RetrievalResult } from "../core/query.js";

/** Semantic search over meaning (backed by the VectorIndex). */
export interface SemanticSearch {
  search(query: MemoryQuery): Promise<RetrievalResult>;
}

/** Exact/keyword search for precise lookups. */
export interface KeywordSearch {
  search(query: MemoryQuery): Promise<RetrievalResult>;
}

/**
 * Hybrid search merges semantic + vector + graph + keyword candidates. This is
 * what search() on the MemoryEngine delegates to.
 */
export interface HybridSearch {
  search(query: MemoryQuery): Promise<RetrievalResult>;
}
