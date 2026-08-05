/**
 * Model capability model (req #4).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The router only routes a request to a model that supports every capability
 * the request requires. New modalities extend this set without breaking routing.
 */

export type Capability =
  | "text"
  | "streaming"
  | "json_mode"
  | "function_calling"
  | "vision"
  | "embeddings"
  | "long_context";

/** Capabilities + cost/latency profile a model declares (from configs/models). */
export interface ModelCapabilities {
  capabilities: Capability[];
  /** Maximum context window in tokens. */
  contextWindow: number;
  /** Illustrative unit cost, source of truth is configs/models. */
  costPer1kInputUsd: number;
  costPer1kOutputUsd: number;
  /** Observed/expected latency profile used by latency-aware routing. */
  latencyP50Ms?: number;
  latencyP95Ms?: number;
  /** Logical quality tier this model satisfies (e.g. "large" | "medium"). */
  qualityTier: string;
}
