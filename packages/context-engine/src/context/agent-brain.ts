/**
 * Agent Brain Section.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json } from "../core/common";

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