/**
 * Tool Metrics (Req #13).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, ToolCategory } from "../core/common";

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

export interface ToolMetricsSnapshot {
  invocations: number;
  successes: number;
  failures: number;
  retries: number;
  timeouts: number;
  approvals: number;
  rejections: number;
  totalCostUsd: number;
  totalTokens: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}