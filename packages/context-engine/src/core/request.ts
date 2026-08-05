/**
 * Context Request — input to the Context Engine.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { AgentId, WorkflowId, StepId, TurnId, Json, Timestamp, Uuid } from "./common";

export type ContextTrigger =
  | "turn_start"        // Normal turn start
  | "retry"             // Retrying a failed step
  | "rework"            // Rework after gate failure
  | "recovery"          // Recovery from checkpoint
  | "manual_override";  // Manual trigger

export interface ContextOverrides {
  /** Force include specific memory types. */
  forceInclude?: MemoryType[];
  /** Exclude specific memory types. */
  exclude?: MemoryType[];
  /** Override token budget for this request. */
  tokenBudgetOverride?: number;
  /** Force include specific memory IDs. */
  forceIncludeIds?: MemoryId[];
  /** Minimum confidence threshold (0..1). */
  minConfidence?: number;
  /** Force specific brain selection. */
  forceBrains?: BrainSelectionOverride;
}

export interface BrainSelectionOverride {
  companyBrain?: boolean;
  agentBrain?: boolean;
  workflowContext?: boolean;
  sessionContext?: boolean;
  examples?: boolean;
}

export interface ContextRequest {
  /** The agent requesting context. */
  agent: AgentId;
  /** Current workflow (if in workflow). */
  workflowId?: WorkflowId;
  /** Current step (if in workflow). */
  stepId?: StepId;
  /** Current turn ID. */
  turnId: TurnId;
  /** Why context is needed. */
  trigger: ContextTrigger;
  /** Optional overrides for this request. */
  overrides?: ContextOverrides;
  /** Current workflow context (from Workflow Engine). */
  workflowContext?: WorkflowContext;
  /** Current agent state (from Memory Engine). */
  agentState?: AgentState;
}

export interface AgentState {
  /** Agent's long-term memory. */
  longTermMemory: MemoryRecord[];
  /** Agent's short-term memory (current turn). */
  shortTermMemory: Json;
  /** Agent's current KPIs. */
  kpis: Record<string, number>;
}

export interface MemoryType =
  | "session"
  | "company"
  | "agent"
  | "analytics"
  | "decision"
  | "workflow"
  | "lessons"
  | "checkpoint"
  | "knowledge";

export interface MemoryRecord {
  memory_id: string;
  type: string;
  agent: string | null;
  brand_id: string | null;
  body: any;
  confidence: number;
  provenance: {
    sources: Array<{ type: string; ref: string }>;
    derived_by: string;
  };
  created_at: string;
  last_reinforced: string | null;
  supersedes: string | null;
  superseded_by: string | null;
  version: number;
}