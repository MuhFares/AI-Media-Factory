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
export * from "./core/common";
export * from "./core/record";
export * from "./core/query";
export * from "./core/engine";
export * from "./core/versioning";
// stores
export * from "./stores/memory-store";
export * from "./stores/session-store";
export * from "./stores/company-store";
export * from "./stores/agent-store";
export * from "./stores/analytics-store";
export * from "./stores/decision-store";
export * from "./stores/workflow-store";
export * from "./stores/lessons-store";
export * from "./stores/checkpoint-store";
// retrieval
export * from "./retrieval/pipeline";
export * from "./retrieval/search";
export * from "./retrieval/vector";
export * from "./retrieval/graph";
export * from "./retrieval/ranking";
// intelligence
export * from "./intelligence/confidence";
export * from "./intelligence/attribution";
export * from "./intelligence/conflict";
export * from "./intelligence/lessons";
// lifecycle
export * from "./lifecycle/compression";
export * from "./lifecycle/expiration";
export * from "./lifecycle/archive";
// observability
export * from "./observability/metrics";
