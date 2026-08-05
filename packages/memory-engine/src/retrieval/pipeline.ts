/**
 * The retrieval pipeline (the funnel behind retrieve()/search()).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * scope filter → candidate fetch (vector + graph + keyword) → merge/dedupe →
 * conflict check → rank → confidence gate → budget cap → RetrievalResult.
 */

import type { MemoryQuery, RetrievalResult } from "../core/query.js";

export interface RetrievalPipeline {
  /** Run the full funnel for a query and return a ranked, gated result set. */
  run(query: MemoryQuery): Promise<RetrievalResult>;
}
