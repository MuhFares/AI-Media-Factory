/**
 * Evaluation Request and Result - Core interfaces for the Evaluation Engine.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type {
  EvaluationId,
  EvaluationTargetType,
  EvaluationTrigger,
  EvaluationStatus,
  GateDecision,
  Timestamp,
  Json,
  EvaluationTargetType
} from "./common";

/** Request to run an evaluation. */
export interface EvaluationRequest {
  /** Unique evaluation run ID. */
  evaluationId: string;
  /** What type of entity is being evaluated. */
  targetType: EvaluationTargetType;
  /** Specific entity ID being evaluated. */
  targetId: string;
  /** What triggered this evaluation. */
  trigger: EvaluationTrigger;
  /** Specific metrics/criteria to evaluate. */
  criteria: EvaluationCriteria[];
  /** Configuration for this evaluation run. */
  config: EvaluationConfig;
  /** Correlation ID for tracing. */
  correlationId?: string;
}

export interface EvaluationCriteria {
  /** Metric name to evaluate. */
  metric: string;
  /** Expected threshold/value. */
  threshold: MetricThreshold;
  /** Weight for weighted scoring (0-1). */
  weight: number;
  /** Whether this criterion is required for pass. */
  required: boolean;
}

export interface MetricThreshold {
  /** Comparison operator. */
  operator: "gte" | "lte" | "eq" | "gt" | "lt" | "between";
  /** Expected value(s). */
  value: number | [number, number];
  /** Unit of measurement. */
  unit: string;
}

export interface EvaluationConfig {
  /** Timeout for the entire evaluation. */
  timeoutMs: number;
  /** Whether to run in parallel where possible. */
  parallel: boolean;
  /** Whether to stop on first failure. */
  failFast: boolean;
  /** Minimum score to pass (0-1). */
  passThreshold: number;
  /** Whether to generate detailed report. */
  generateReport: boolean;
}

/** Result of an evaluation run. */
export interface EvaluationResult {
  evaluationId: string;
  targetType: string;
  targetId: string;
  status: EvaluationStatus;
  startedAt: Timestamp;
  completedAt?: Timestamp;
  durationMs?: number;
  /** Overall score (0-1). */
  overallScore: number;
  /** Per-criterion scores. */
  criteriaScores: CriteriaScore[];
  /** Quality gate decisions. */
  gateDecisions: GateDecision[];
  /** Any errors encountered. */
  errors: EvaluationError[];
  /** Generated report ID. */
  reportId?: string;
  /** Metadata. */
  metadata: EvaluationMetadata;
}

export interface CriteriaScore {
  metric: string;
  value: number;
  threshold: MetricThreshold;
  score: number;           // 0-1 normalized
  passed: boolean;
  weight: number;
}

export interface EvaluationMetadata {
  trigger: string;
  evaluatorVersion: string;
  environment: string;
  totalCriteria: number;
  passedCriteria: number;
  failedCriteria: number;
  warnings: number;
}

export interface EvaluationError {
  code: string;
  message: string;
  criterion?: string;
  recoverable: boolean;
}