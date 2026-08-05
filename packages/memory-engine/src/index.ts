/**
 * @ai-media-factory/memory-engine — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the centralized Memory Engine. No implementation is exported.
 *
 * This is the single interface every agent uses for memory. Agents and the
 * runtime import from here; this package imports from nobody upstream (one
 * canonical definition, no cycles). See ./README.md.
 */

// core
export * from "./core/common.js";
export * from "./core/record.js";
export * from "./core/query.js";
export * from "./core/engine.js";
export * from "./core/versioning.js";
// stores
export * from "./stores/memory-store.js";
export * from "./stores/session-store.js";
export * from "./stores/company-store.js";
export * from "./stores/agent-store.js";
export * from "./stores/analytics-store.js";
export * from "./stores/decision-store.js";
export * from "./stores/workflow-store.js";
export * from "./stores/lessons-store.js";
export * from "./stores/checkpoint-store.js";
// retrieval
export * from "./retrieval/pipeline.js";
export * from "./retrieval/search.js";
export * from "./retrieval/vector.js";
export * from "./retrieval/graph.js";
export * from "./retrieval/ranking.js";
// intelligence
export * from "./intelligence/confidence.js";
export * from "./intelligence/attribution.js";
export * from "./intelligence/conflict.js";
export * from "./intelligence/lessons.js";
// lifecycle
export * from "./lifecycle/compression.js";
export * from "./lifecycle/expiration.js";
export * from "./lifecycle/archive.js";
// observability
export * from "./observability/metrics.js";
// memory layer (implementation)
export * from "./memory-layer.js";
export * from "./inmemory.js";
export * from "./factory.js";
