/**
 * Context Types — Session Context, Agent Brain, Company Brain.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { AgentId, Json, Timestamp, Uuid } from "../core/common";

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