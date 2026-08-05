/**
 * Scorecard generation and evaluation.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "./common";

/** Scorecard for a specific evaluation target. */
export interface Scorecard {
  /** Entity being scored. */
  entityType: "agent" | "provider" | "workflow" | "prompt" | "memory" | "tool" | "output";
  entityId: string;
  /** Overall weighted score (0-1). */
  overallScore: number;
  /** Per-metric scores. */
  metrics: MetricScore[];
  /** Aggregated scores by category. */
  categoryScores: CategoryScore[];
  /** Quality gate results. */
  gateResults: GateResult[];
  /** Evaluation metadata. */
  metadata: ScorecardMetadata;
}

export interface MetricScore {
  metricId: string;
  metricName: string;
  rawValue: number;
  normalizedScore: number;     // 0-1 normalized
  weight: number;
  passed: boolean;
  threshold: number;
  actualValue: number;
}

export interface CategoryScore {
  category: string;
  score: number;               // 0-1 weighted average
  weight: number;
  metrics: MetricScore[];
  passed: boolean;
}

export interface GateResult {
  gateId: string;
  gateName: string;
  decision: "pass" | "warn" | "fail" | "block";
  score: number;
  threshold: number;
  message: string;
}

export interface ScorecardMetadata {
  evaluationId: string;
  generatedAt: string;
  evaluatorVersion: string;
  totalMetrics: number;
  passedMetrics: number;
  failedMetrics: number;
  warnings: number;
}