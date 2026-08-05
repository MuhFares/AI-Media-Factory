/**
 * Benchmarks - Standardized evaluation scenarios.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "./common";

/** Benchmark definition. */
export interface Benchmark {
  /** Unique benchmark identifier. */
  benchmarkId: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this benchmark tests. */
  description: string;
  /** Target entity type. */
  targetType: "agent" | "provider" | "workflow" | "prompt" | "memory" | "tool" | "output";
  /** Test cases that make up this benchmark. */
  testCases: BenchmarkTestCase[];
  /** Scoring configuration. */
  scoring: BenchmarkScoring;
  /** Expected baseline performance. */
  baseline: BenchmarkBaseline;
  /** Tags for categorization. */
  tags: string[];
  /** Version of this benchmark. */
  version: string;
  /** When this benchmark was created. */
  createdAt: string;
}

export interface BenchmarkTestCase {
  /** Unique test case ID. */
  caseId: string;
  /** Human-readable name. */
  name: string;
  /** Input for the test case. */
  input: any;
  /** Expected output (for validation). */
  expectedOutput?: any;
  /** Expected metrics thresholds. */
  expectedMetrics: ExpectedMetric[];
  /** Weight of this test case in overall score. */
  weight: number;
  /** Tags for categorization. */
  tags: string[];
}

export interface ExpectedMetric {
  metricId: string;
  threshold: {
    operator: "gte" | "lte" | "eq" | "gt" | "lt";
    value: number;
  };
  weight: number;
}

export interface BenchmarkScoring {
  /** How to aggregate test case scores. */
  aggregation: "weighted_average" | "min" | "max" | "median";
  /** Minimum score to pass (0-1). */
  passThreshold: number;
}

export interface BenchmarkBaseline {
  /** Expected overall score. */
  expectedScore: number;
  /** Per-metric baseline values. */
  metricBaselines: Record<string, number>;
  /** Acceptable variance (0-1). */
  acceptableVariance: number;
}

/** Benchmark run result. */
export interface BenchmarkRun {
  runId: string;
  benchmarkId: string;
  targetId: string;
  startedAt: string;
  completedAt?: string;
  status: "pending" | "running" | "completed" | "failed";
  overallScore: number;
  testCaseResults: TestCaseResult[];
  passed: boolean;
}

export interface TestCaseResult {
  caseId: string;
  passed: boolean;
  score: number;
  actualMetrics: Record<string, number>;
  expectedMetrics: Record<string, number>;
  durationMs: number;
  error?: string;
}

/** Predefined benchmarks for the platform. */
export const STANDARD_BENCHMARKS: Record<string, any> = {
  "agent.comprehensive": {
    benchmarkId: "agent.comprehensive",
    name: "Comprehensive Agent Evaluation",
    description: "Full evaluation of agent capabilities across all dimensions",
    targetType: "agent",
    testCases: [
      {
        caseId: "basic_task_completion",
        name: "Basic Task Completion",
        input: { task: "Write a 500-word article about AI in healthcare" },
        expectedMetrics: {
          "agent.task_success_rate": { operator: "gte", value: 1.0 },
          "agent.avg_latency_ms": { operator: "lte", value: 60000 },
        },
        weight: 1.0,
        tags: ["basic", "completion"]
      },
      {
        caseId: "complex_reasoning",
        name: "Complex Reasoning",
        input: { task: "Analyze quarterly financial report and extract key insights" },
        expectedMetrics: {
          "agent.task_success_rate": { operator: "gte", value: 1.0 },
          "agent.avg_latency_ms": { operator: "lte", value: 120000 },
        },
        weight: 1.5,
        tags: ["reasoning", "complex"]
      },
      {
        caseId: "tool_usage",
        name: "Tool Usage Proficiency",
        input: { task: "Research competitors and create comparison table using web search" },
        expectedMetrics: {
          "tool.success_rate": { operator: "gte", value: 1.0 },
          "tool.avg_latency_ms": { operator: "lte", value: 30000 },
        },
        weight: 1.2,
        tags: ["tools", "integration"]
      },
    ],
    scoring: { aggregation: "weighted_average", passThreshold: 0.85 },
    baseline: {
      expectedScore: 0.9,
      metricBaselines: {
        "agent.task_success_rate": 1.0,
        "agent.avg_latency_ms": 45000,
        "agent.autonomy_rate": 0.95,
      },
      acceptableVariance: 0.1,
    },
    tags: ["agent", "comprehensive", "regression"],
    version: "1.0",
    createdAt: "2026-01-01",
  },

  "provider.reliability": {
    benchmarkId: "provider.reliability",
    name: "Provider Reliability Benchmark",
    description: "Evaluate provider reliability across multiple dimensions",
    targetType: "provider",
    testCases: [
      {
        caseId: "availability",
        name: "Availability Test",
        input: { requests: 1000 },
        expectedMetrics: {
          "provider.availability": { operator: "gte", value: 0.999 },
        },
        weight: 1.0,
        tags: ["availability"]
      },
      {
        caseId: "latency_under_load",
        name: "Latency Under Load",
        input: { concurrentRequests: 100 },
        expectedMetrics: {
          "provider.latency_p95": { operator: "lte", value: 2000 },
        },
        weight: 1.0,
        tags: ["latency", "load"]
      },
    ],
    scoring: { aggregation: "weighted_average", passThreshold: 0.9 },
    baseline: {
      expectedScore: 0.95,
      metricBaselines: {
        "provider.availability": 0.9999,
        "provider.latency_p95": 500,
      },
      acceptableVariance: 0.05,
    },
    tags: ["provider", "reliability", "load"],
    version: "1.0",
    createdAt: "2026-01-01",
  },

  "workflow.content_pipeline": {
    benchmarkId: "workflow.content_pipeline",
    name: "Content Pipeline Workflow Benchmark",
    description: "End-to-end content production workflow",
    targetType: "workflow",
    testCases: [
      {
        caseId: "full_pipeline",
        name: "Full Content Pipeline",
        input: { topic: "AI in healthcare", platforms: ["youtube", "blog"] },
        expectedMetrics: {
          "workflow.success_rate": { operator: "gte", value: 1.0 },
          "workflow.autonomy_rate": { operator: "gte", value: 0.9 },
          "output.quality_score": { operator: "gte", value: 0.85 },
        },
        weight: 1.0,
        tags: ["full_pipeline", "content"]
      },
      {
        caseId: "rework_handling",
        name: "Rework Handling",
        input: { topic: "controversial topic", force_qa_reject: true },
        expectedMetrics: {
          "workflow.rework_rate": { operator: "lte", value: 0.1 },
          "workflow.success_rate": { operator: "gte", value: 1.0 },
        },
        weight: 0.8,
        tags: ["rework", "recovery"]
      },
    ],
    scoring: { aggregation: "weighted_average", passThreshold: 0.85 },
    baseline: {
      expectedScore: 0.9,
      metricBaselines: {
        "workflow.success_rate": 0.98,
        "workflow.rework_rate": 0.05,
        "workflow.autonomy_rate": 0.92,
      },
      acceptableVariance: 0.1,
    },
    tags: ["workflow", "content", "end_to_end"],
    version: "1.0",
    createdAt: "2026-01-01",
  },
};