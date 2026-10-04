/**
 * @ai-media-factory/context-engine — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the Context Engine. No implementation is exported.
 *
 * The Context Engine is the single authority for what context an agent receives
 * before every execution. It decides WHAT the Runtime sends to every provider.
 * See ./README.md.
 */

// core
export * from "./core/common.js";
export * from "./core/engine.js";
export * from "./core/request.js";
export * from "./core/package.js";
// brain
export * from "./brain/selector.js";
// context types
export { type NorthStarMetric } from "./context/session.js";
// selection
export {
  type ContextSelector,
  type ContextSelectionRequest,
  type SelectionResult,
  type LoadedMemory,
  type RankingSummary,
} from "./selection/selector.js";
// rules
export * from "./rules/freshness.js";
export { type RelevanceScorer } from "./rules/relevance.js";
// ranking
export { type ContextRanker, type RankedRecord, type RankSignals, type RankingContext } from "./ranking/ranker.js";
// compression
export * from "./compression/compressor.js";
export * from "./compression/budget.js";
// thresholds
export * from "./thresholds/thresholds.js";
// cache
export { type ContextCache, type CacheEntry, type CacheConfig } from "./cache/cache.js";
// observability
export * from "./observability/metrics.js";
