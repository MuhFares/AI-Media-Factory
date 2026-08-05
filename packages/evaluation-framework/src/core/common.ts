/**
 * Shared primitives for the Evaluation Framework.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

export type EvaluationId = string;
export type AgentId = string;
export type ProviderId = string;
export type WorkflowId = string;
export type StepId = string;
export type PromptId = string;
export type MemoryId = string;
export type ToolId = string;
export type OutputId = string;
export type RunId = string;
export type BenchmarkId = string;
export type GateId = string;
export type TestId = string;
export type ReportId = string;
export type LeaderboardId = string;
export type Timestamp = string; // ISO-8601 UTC

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** Types of entities that can be evaluated. */
export type EvaluationTargetType =
  | "agent"
  | "provider"
  | "workflow"
  | "prompt"
  | "memory"
  | "tool"
  | "output";

/** Evaluation trigger types. */
export type EvaluationTrigger =
  | "scheduled"           // Regular scheduled evaluation
  | "on_demand"           // Manual trigger
  | "post_execution"      // After workflow/agent run
  | "post_deployment"     // After deployment
  | "on_regression"       // Triggered by regression detection
  | "continuous";         // Continuous evaluation

/** Evaluation severity levels. */
export type EvaluationSeverity =
  | "info"
  | "warning"
  | "critical"
  | "blocking";

/** Evaluation status. */
export type EvaluationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Quality gate decision. */
export type GateDecision =
  | "pass"
  | "warn"
  | "fail"
  | "block";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };