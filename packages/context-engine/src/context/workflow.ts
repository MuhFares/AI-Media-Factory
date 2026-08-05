/**
 * Context Type Definitions.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Defines the structure of each context section that goes into the final package.
 */

import type { AgentId, Json, Timestamp, Uuid, WorkflowId, StepId, TurnId, BrandId, CorrelationId } from "./common";

/** Workflow Context Section — data from the current workflow. */
export interface WorkflowContextSection {
  workflowId: string;
  correlationId: string | null;
  brandId: string | null;
  currentStep: string;
  /** Completed step outputs relevant to current task. */
  relevantOutputs: Record<string, any>;
  /** Current workflow data bag. */
  data: Record<string, any>;
  tokens: number;
}

/** Session Context Section — per-turn scratch memory. */
export interface SessionContextSection {
  turnId: string;
  workflowId: string | null;
  agent: string;
  scratch: any;
  recentEvents: EventSummary[];
  tokens: number;
}

export interface EventSummary {
  eventId: string;
  type: string;
  stepId: string | null;
  timestamp: string;
  outcome: "success" | "failure" | "partial";
}

/** Agent Brain Section — agent's identity, role, KPIs, authority. */
export interface AgentBrainSection {
  agent: string;
  role: string;
  responsibilities: string[];
  kpis: string[];
  authority: DecisionAuthority;
  escalationRules: string;
  tokens: number;
}

export interface DecisionAuthority {
  canDecide: string[];
  mustEscalate: string[];
  budgetAuthorityUsd: number;
}

/** Company Brain Section — vision, mission, values, north star, decision framework. */
export interface CompanyBrainSection {
  vision: string;
  mission: string;
  values: string[];
  northStar: NorthStarMetric;
  decisionFramework: string;
  kpis: string;
  brandGuidelines: string;
  tokens: number;
}

export interface NorthStarMetric {
  name: string;
  formula: string;
  drivers: string[];
  currentValue: number;
  targetValue: number;
}

export interface DecisionAuthority {
  canDecide: string[];
  mustEscalate: string[];
  budgetAuthorityUsd: number;
}