/**
 * Context Engine — the single entry point for context assembly.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The Context Engine is the single authority for what context an agent receives.
 * It is called by the Runtime (for agent turns) and Workflow Engine (for workflow steps).
 */

import type { AgentId, WorkflowId, StepId, TurnId, Uuid, Timestamp, Json } from "./common";
import type { ContextRequest } from "./request";
import type { ContextPackage } from "./package";

export interface ContextEngine {
  /**
   * Build a context package for an agent turn.
   * This is the single entry point used by Runtime and Workflow Engine.
   */
  buildContext(request: ContextRequest): Promise<ContextPackage>;

  /** Build context without using cache (for testing/debugging). */
  buildContextUncached(request: ContextRequest): Promise<ContextPackage>;

  /** Invalidate cache entries for an agent. */
  invalidateCache(agent: AgentId): Promise<void>;

  /** Invalidate cache for a specific workflow. */
  invalidateWorkflow(workflowId: WorkflowId): Promise<void>;

  /** Get cache statistics. */
  getCacheStats(): Promise<CacheStats>;
}

export interface CacheStats {
  size: number;
  hitRate: number;
  missRate: number;
  evictionRate: number;
  avgAgeMs: number;
}