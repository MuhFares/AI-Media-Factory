/**
 * Leaderboards - Ranking entities by performance.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "../core/common";

/** Leaderboard for a specific metric/category. */
export interface Leaderboard {
  /** Unique leaderboard identifier. */
  leaderboardId: string;
  /** Human-readable name. */
  name: string;
  /** What this leaderboard ranks. */
  entityType: "agent" | "provider" | "workflow" | "prompt" | "tool";
  /** Metric used for ranking. */
  metricId: string;
  /** Ranking direction. */
  order: "asc" | "desc";
  /** Time window for rankings. */
  window: LeaderboardWindow;
  /** Current rankings. */
  entries: LeaderboardEntry[];
  /** Last updated timestamp. */
  lastUpdated: string;
  /** Total entities ranked. */
  totalEntries: number;
}

export type LeaderboardWindow =
  | "1h"
  | "24h"
  | "7d"
  | "30d"
  | "90d"
  | "all_time";

export interface LeaderboardEntry {
  /** Rank position (1-based). */
  rank: number;
  /** Entity ID. */
  entityId: string;
  /** Entity display name. */
  entityName: string;
  /** Current metric value. */
  value: number;
  /** Change from previous period. */
  change?: number;
  changePercent?: number;
  /** Previous rank. */
  previousRank?: number;
  /** Additional metadata. */
  metadata?: Record<string, any>;
}

export interface LeaderboardConfig {
  /** How often to refresh. */
  refreshInterval: string; // cron expression
  /** Minimum data points required. */
  minDataPoints: number;
  /** Minimum sample size for inclusion. */
  minSampleSize: number;
  /** Whether to include ties. */
  includeTies: boolean;
}

/** Predefined leaderboards. */
export const STANDARD_LEADERBOARDS: Record<string, any> = {
  "agent.top_performers": {
    leaderboardId: "agent.top_performers",
    name: "Top Performing Agents",
    entityType: "agent",
    metricId: "agent.task_success_rate",
    order: "desc",
    window: "7d",
    config: {
      refreshInterval: "0 * * * *", // Hourly
      minDataPoints: 10,
      minSampleSize: 5,
      includeTies: true,
    },
  },
  "agent.fastest": {
    leaderboardId: "agent.fastest",
    name: "Fastest Agents",
    entityType: "agent",
    metricId: "agent.avg_latency_ms",
    order: "asc",
    window: "7d",
    config: {
      refreshInterval: "0 * * * *",
      minDataPoints: 10,
      minSampleSize: 5,
      includeTies: true,
    },
  },
  "agent.most_autonomous": {
    leaderboardId: "agent.most_autonomous",
    name: "Most Autonomous Agents",
    entityType: "agent",
    metricId: "agent.autonomy_rate",
    order: "desc",
    window: "7d",
    config: {
      refreshInterval: "0 * * * *",
      minDataPoints: 10,
      minSampleSize: 5,
      includeTies: true,
    },
  },
  "provider.best_uptime": {
    leaderboardId: "provider.best_uptime",
    name: "Most Reliable Providers",
    entityType: "provider",
    metricId: "provider.availability",
    order: "desc",
    window: "30d",
    config: {
      refreshInterval: "0 0 * * *", // Daily
      minDataPoints: 100,
      minSampleSize: 10,
      includeTies: true,
    },
  },
  "provider.lowest_cost": {
    leaderboardId: "provider.lowest_cost",
    name: "Most Cost-Effective Providers",
    entityType: "provider",
    metricId: "provider.cost_per_1k_tokens",
    order: "asc",
    window: "30d",
    config: {
      refreshInterval: "0 0 * * *",
      minDataPoints: 100,
      minSampleSize: 10,
      includeTies: true,
    },
  },
  "workflow.most_reliable": {
    leaderboardId: "workflow.most_reliable",
    name: "Most Reliable Workflows",
    entityType: "workflow",
    metricId: "workflow.success_rate",
    order: "desc",
    window: "30d",
    config: {
      refreshInterval: "0 0 * * *",
      minDataPoints: 50,
      minSampleSize: 10,
      includeTies: true,
    },
  },
  "tool.most_reliable": {
    leaderboardId: "tool.most_reliable",
    name: "Most Reliable Tools",
    entityType: "tool",
    metricId: "tool.success_rate",
    order: "desc",
    window: "30d",
    config: {
      refreshInterval: "0 0 * * *",
      minDataPoints: 100,
      minSampleSize: 20,
      includeTies: true,
    },
  },
  "tool.most_cost_effective": {
    leaderboardId: "tool.most_cost_effective",
    name: "Most Cost-Effective Tools",
    entityType: "tool",
    metricId: "tool.cost_per_call",
    order: "asc",
    window: "30d",
    config: {
      refreshInterval: "0 0 * * *",
      minDataPoints: 100,
      minSampleSize: 20,
      includeTies: true,
    },
  },
  "prompt.highest_quality": {
    leaderboardId: "prompt.highest_quality",
    name: "Highest Quality Prompts",
    entityType: "prompt",
    metricId: "output.quality_score",
    order: "desc",
    window: "30d",
    config: {
      refreshInterval: "0 0 * * *",
      minDataPoints: 50,
      minSampleSize: 10,
      includeTies: true,
    },
  },
  "prompt.most_efficient": {
    leaderboardId: "prompt.most_efficient",
    name: "Most Token Efficient Prompts",
    entityType: "prompt",
    metricId: "prompt.token_efficiency",
    order: "desc",
    window: "30d",
    config: {
      refreshInterval: "0 0 * * *",
      minDataPoints: 50,
      minSampleSize: 10,
      includeTies: true,
    },
  },
};