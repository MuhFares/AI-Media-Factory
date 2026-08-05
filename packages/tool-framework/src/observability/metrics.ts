/**
 * Tool Metrics (Req #13).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, ToolCategory } from "../core/common.js";

export interface ToolMetrics {
  recordInvocation(toolId: ToolId, durationMs: number, success: boolean): void;
  recordRetry(toolId: ToolId, attempt: number): void;
  recordTimeout(toolId: ToolId): void;
  recordApproval(toolId: ToolId, approved: boolean): void;
  recordCost(toolId: ToolId, costUsd: number): void;
  recordTokens(toolId: ToolId, inputTokens: number, outputTokens: number): void;
  snapshot(): ToolMetricsSnapshot;
}

export interface ToolMetricsSnapshot {
  totalInvocations: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  retryRate: number;
  timeoutRate: number;
  approvalRate: number;
  avgCostUsd: number;
  totalCostUsd: number;
  byTool: Record<string, ToolMetricsSnapshot>;
  byCategory: Record<string, ToolMetricsSnapshot>;
}