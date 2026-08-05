/**
 * Tool Cost Tracking (Req #14).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface CostTracker {
  recordCost(toolId: string, costUsd: number, agentId: string): void;
  recordTokens(toolId: string, inputTokens: number, outputTokens: number): void;
  getTotalCost(agentId?: string, toolId?: string, since?: string): number;
  getCostBreakdown(agentId: string, since: string): CostBreakdown;
  getTokenUsage(agentId?: string, toolId?: string, since?: string): TokenUsage;
}

export interface CostBreakdown {
  byTool: Record<string, number>;
  byCategory: Record<string, number>;
  byAgent: Record<string, number>;
  total: number;
  period: { from: string; to: string };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  byTool: Record<string, { input: number; output: number }>;
  byAgent: Record<string, { input: number; output: number }>;
}

export interface CostEstimator {
  estimateCost(toolId: string, input: any): number;
  getEstimatedCostPerCall(toolId: string): number;
}