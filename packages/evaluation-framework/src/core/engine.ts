/**
 * Evaluation Engine - Main entry point for all evaluations.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type {
  EvaluationId,
  EvaluationStatus,
  Timestamp,
  Json
} from "./common.js";
import type { EvaluationRequest, EvaluationResult } from "./request.js";

export interface EvaluationEngine {
  /**
   * Run a complete evaluation based on the request.
   * This is the main entry point for all evaluations.
   */
  evaluate(request: EvaluationRequest): Promise<EvaluationResult>;

  /**
   * Run evaluation asynchronously (fire and forget).
   * Returns immediately with evaluation ID.
   */
  evaluateAsync(request: EvaluationRequest): Promise<EvaluationId>;

  /**
   * Get status of a running evaluation.
   */
  getStatus(evaluationId: string): Promise<EvaluationStatus>;

  /**
   * Cancel a running evaluation.
   */
  cancel(evaluationId: string): Promise<void>;

  /**
   * Get result of a completed evaluation.
   */
  getResult(evaluationId: string): Promise<EvaluationResult>;

  /**
   * List evaluations with optional filters.
   */
  listEvaluations(filters: EvaluationFilters): Promise<EvaluationSummary[]>;

  /**
   * Cancel all running evaluations.
   */
  cancelAll(): Promise<void>;
}

export interface EvaluationFilters {
  targetType?: string;
  targetId?: string;
  status?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

export interface EvaluationSummary {
  evaluationId: string;
  targetType: string;
  targetId: string;
  status: string;
  overallScore: number;
  startedAt: string;
  completedAt?: string;
}
