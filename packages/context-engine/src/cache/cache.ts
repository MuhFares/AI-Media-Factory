/**
 * Context Cache (Req #13).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface CacheKey {
  agent: string;
  workflowId: string | null;
  stepId: string | null;
  trigger: string;
  contextHash: string;
  budgetHash: string;
}

export interface CacheEntry {
  package: any; // ContextPackage
  createdAt: string;
  accessCount: number;
  lastAccessed: string;
}

export interface ContextCache {
  get(key: string): Promise<any | null>;
  set(key: string, pkg: any): Promise<void>;
  invalidate(key: string): Promise<void>;
  invalidatePrefix(prefix: string): Promise<void>;
  invalidateAgent(agent: string): Promise<void>;
  invalidateWorkflow(workflowId: string): Promise<void>;
  stats(): Promise<CacheStats>;
}

export interface CacheStats {
  size: number;
  hitRate: number;
  missRate: number;
  evictionRate: number;
  avgAgeMs: number;
}

export interface CacheConfig {
  maxSize: number;
  ttlSeconds: number;
  evictionPolicy: "lru" | "lfu" | "ttl";
}