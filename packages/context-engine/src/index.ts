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
export * from "./core/common";
export * from "./core/engine";
export * from "./core/request";
export * from "./core/package";
// brain
export * from "./brain/selector";
// context types
export * from "./context/workflow";
export * from "./context/session";
// selection
export * from "./selection/selector";
// rules
export * from "./rules/retrieval";
export * from "./rules/freshness";
export * from "./rules/relevance";
// ranking
export * from "./ranking/ranker";
// compression
export * from "./compression/compressor";
export * from "./compression/budget";
// thresholds
export * from "./thresholds/thresholds";
// cache
export * from "./cache/cache";
// observability
export * from "./observability/metrics";