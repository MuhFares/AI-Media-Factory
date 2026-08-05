/**
 * Workflow metrics (req #18).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Uuid } from "../core/common";

export interface WorkflowMetrics {
  /** Cycle time, step latencies, retries, rework loops, parallel timings. */
  recordCompletion(workflowId: Uuid, data: {
    cycleTimeMs: number;
    stepCount: number;
    retries: number;
    reworkLoops: number;
    autonomyRate: number;
    estimatedCostUsd: number;
    actualCostUsd: number;
  }): void;
  recordOutcome(workflowId: Uuid, outcome: "completed" | "failed" | "cancelled" | "dead_letter"): void;
  snapshot(): {
    running: number;
    successRate: number;
    dlqRate: number;
    p50CycleTimeMs: number;
  };
}
