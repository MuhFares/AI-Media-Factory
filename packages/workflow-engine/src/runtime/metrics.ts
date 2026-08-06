/**
 * Default WorkflowMetrics implementation.
 */

import type { Uuid, WorkflowMetrics } from "../observability/metrics.js";

interface WorkflowCompletionData {
  cycleTimeMs: number;
  stepCount: number;
  retries: number;
  reworkLoops: number;
  autonomyRate: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
}

export class DefaultWorkflowMetrics implements WorkflowMetrics {
  private completions: WorkflowCompletionData[] = [];
  private outcomes = new Map<string, number>();
  private runningCount = 0;

  recordCompletion(workflowId: Uuid, data: WorkflowCompletionData): void {
    this.completions.push(data);
  }

  recordOutcome(workflowId: Uuid, outcome: "completed" | "failed" | "cancelled" | "dead_letter"): void {
    const count = this.outcomes.get(outcome) ?? 0;
    this.outcomes.set(outcome, count + 1);
  }

  snapshot(): {
    running: number;
    successRate: number;
    dlqRate: number;
    p50CycleTimeMs: number;
  } {
    const total = this.completions.length;
    if (total === 0) {
      return { running: this.runningCount, successRate: 1, dlqRate: 0, p50CycleTimeMs: 0 };
    }

    const completed = this.outcomes.get("completed") ?? 0;
    const deadLetter = this.outcomes.get("dead_letter") ?? 0;
    const successRate = completed / total;
    const dlqRate = deadLetter / total;

    const sortedTimes = this.completions.map((c) => c.cycleTimeMs).sort((a, b) => a - b);
    const p50Index = Math.floor(sortedTimes.length * 0.5);
    const p50CycleTimeMs = sortedTimes[p50Index] ?? 0;

    return {
      running: this.runningCount,
      successRate,
      dlqRate,
      p50CycleTimeMs,
    };
  }
}