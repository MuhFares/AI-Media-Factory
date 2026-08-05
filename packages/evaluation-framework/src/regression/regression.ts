/**
 * Regression Tests - Detect performance regressions.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "../core/common";

/** Regression test definition. */
export interface RegressionTest {
  /** Unique test identifier. */
  testId: string;
  /** Human-readable name. */
  name: string;
  /** What component/version this test covers. */
  target: RegressionTarget;
  /** Test configuration. */
  config: RegressionTestConfig;
  /** Expected baseline metrics. */
  baseline: RegressionBaseline;
  /** Alert configuration. */
  alerts: RegressionAlert[];
  /** Whether this test is active. */
  active: boolean;
  /** Test version. */
  version: string;
}

export interface RegressionTarget {
  /** Type of entity being tested. */
  targetType: "agent" | "provider" | "workflow" | "prompt" | "model" | "tool";
  /** Specific entity ID. */
  entityId: string;
  /** Version/commit being tested. */
  version: string;
}

export interface RegressionTestConfig {
  /** Benchmark to run for regression detection. */
  benchmarkId: string;
  /** Comparison strategy. */
  comparison: "previous_version" | "baseline" | "control_group";
  /** Statistical significance threshold (p-value). */
  significanceLevel: number;
  /** Minimum effect size to flag (0-1). */
  minimumEffectSize: number;
  /** Number of runs for statistical significance. */
  sampleSize: number;
}

export interface RegressionBaseline {
  /** Expected metric values from known-good version. */
  expectedMetrics: Record<string, number>;
  /** Acceptable variance from baseline (0-1). */
  acceptableVariance: number;
  /** When baseline was established. */
  establishedAt: string;
  /** Commit/version that established baseline. */
  baselineVersion: string;
}

export interface RegressionAlert {
  /** Alert severity. */
  severity: "info" | "warning" | "critical";
  /** Notification channels. */
  channels: ("email" | "slack" | "pagerduty" | "webhook")[];
  /** Cooldown period to avoid spam. */
  cooldownMinutes: number;
}

/** Regression test result. */
export interface RegressionTestResult {
  testId: string;
  target: RegressionTarget;
  status: "passed" | "regression_detected" | "improvement" | "inconclusive" | "error";
  /** Statistical significance of change. */
  pValue: number;
  /** Effect size (Cohen's d or similar). */
  effectSize: number;
  /** Direction of change. */
  direction: "improved" | "degraded" | "unchanged";
  /** Per-metric comparison results. */
  metricComparisons: MetricComparison[];
  /** Overall verdict. */
  verdict: "no_regression" | "regression_detected" | "significant_improvement" | "inconclusive";
  /** Recommended action. */
  recommendedAction: "none" | "investigate" | "rollback" | "alert_team";
  completedAt: string;
  details: RegressionDetails;
}

export interface MetricComparison {
  metricId: string;
  metricName: string;
  baselineValue: number;
  currentValue: number;
  changePercent: number;
  pValue: number;
  significant: boolean;
  direction: "improved" | "degraded" | "unchanged";
}

export interface RegressionDetails {
  totalMetricsCompared: number;
  metricsImproved: number;
  metricsDegraded: number;
  metricsUnchanged: number;
  statisticallySignificantChanges: number;
  largestRegression: MetricComparison | null;
  largestImprovement: MetricComparison | null;
}

/** Scheduled regression test run. */
export interface ScheduledRegressionRun {
  runId: string;
  scheduledAt: string;
  triggeredBy: "schedule" | "deployment" | "manual";
  testIds: string[];
  status: "scheduled" | "running" | "completed" | "failed";
  results: RegressionTestResult[];
}

export const REGRESSION_TEST_SCHEDULES = {
  "daily_full_regression": {
    schedule: "0 2 * * *", // Daily at 2 AM
    testIds: ["agent.comprehensive", "provider.reliability", "workflow.content_pipeline"],
    enabled: true,
  },
  "deployment_regression": {
    trigger: "deployment",
    testIds: ["agent.comprehensive", "provider.reliability"],
    enabled: true,
  },
  "weekly_comprehensive": {
    schedule: "0 3 * * 0", // Weekly Sunday 3 AM
    testIds: ["agent.comprehensive", "provider.reliability", "workflow.content_pipeline", "prompt.quality"],
    enabled: true,
  },
};