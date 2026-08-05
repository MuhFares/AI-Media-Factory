/**
 * Observability contracts: logging, metrics, cost tracking.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { AgentId, Json, Uuid } from "./common";

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured, correlation-keyed logging. Never logs secrets or raw prompts verbatim. */
export interface Logger {
  log(level: LogLevel, message: string, fields: LogFields): void;
}

export interface LogFields {
  workflow_id?: Uuid;
  correlation_id?: string;
  event_id?: Uuid;
  agent_id?: AgentId;
  state?: string;
  [key: string]: Json | undefined;
}

/** Records counters, latencies, and outcomes for monitoring + Analytics. */
export interface MetricsCollector {
  counter(name: string, value: number, tags: Record<string, string>): void;
  timing(name: string, ms: number, tags: Record<string, string>): void;
}

/** Accumulates spend and enforces the config budget ceiling (Margin gate). */
export interface CostTracker {
  /** Record spend from a provider response for this turn. */
  record(turnId: Uuid, usage: { costUsd: number; model: string }): void;
  /** Total spend accrued by a turn so far. */
  total(turnId: Uuid): number;
  /** True if recording this additional cost would breach the turn's ceiling. */
  wouldExceed(turnId: Uuid, ceilingUsd: number, nextCostUsd: number): boolean;
}
