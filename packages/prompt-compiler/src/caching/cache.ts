/**
 * Prompt Caching (Req #16).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Caches assembled prompts to avoid re-compilation. Keys include agent,
 * template version, context hash (memory/workflow/task), and schema hash.
 */

import type { PromptVersion, FinalPrompt, CacheKey } from "../sections/sections";

export interface PromptCache {
  get(key: CacheKey): Promise<FinalPrompt | null>;
  set(key: CacheKey, prompt: FinalPrompt): Promise<void>;
  invalidate(key: CacheKey): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
  /** Clear all entries for an agent (e.g. on template version bump). */
  invalidateAgent(agent: string): Promise<void>;
  /** Cache statistics. */
  stats(): Promise<CacheStats>;
}

export interface CacheKey {
  agent: string;
  templateVersion: PromptVersion;
  contextHash: string;      // hash of dynamic inputs (memory, workflow, task)
  schemaHash: string;       // hash of output schema
}

export interface CacheStats {
  size: number;
  hitRate: number;
  missRate: number;
  evictionRate: number;
  oldestEntry: string;      // timestamp
  newestEntry: string;      // timestamp
}

/** Cache eviction policy. */
export type EvictionPolicy = "lru" | "lfu" | "ttl";

export interface CacheConfig {
  maxSize: number;          // max entries
  ttlSeconds: number;       // time to live
  evictionPolicy: EvictionPolicy;
}