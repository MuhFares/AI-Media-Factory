/** Reviewer Agent types. */

import type { Json, Uuid } from "@ai-media-factory/runtime";
import type { BaseAgentDependencies, ExecutionContext, ExecutionRequest, ExecutionResponse, CancellationToken } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";

export interface ReviewContext {
  task?: PlanTask;
  code?: string;
  changeDescription?: string;
  diff?: string;
  references?: Record<string, Json>;
}

export interface ReviewerInput {
  requestId: Uuid;
  task: PlanTask;
  context?: ReviewContext;
}

export type ReviewFindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ReviewFindingCategory = "correctness" | "architecture" | "bug" | "risk" | "security" | "maintainability";

export interface ReviewFinding {
  id: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  title: string;
  description: string;
  location?: string;
  recommendation: string;
}

export interface ReviewRecommendation {
  priority: "high" | "medium" | "low";
  description: string;
  relatedFindingIds?: string[];
}

export interface ReviewReport {
  reportId: Uuid;
  taskDescription: string;
  summary: string;
  status: "approved" | "changes_requested" | "blocked";
  findings: ReviewFinding[];
  recommendations: ReviewRecommendation[];
  metadata: {
    createdAt: string;
    agentVersion: string;
  };
}

export interface ReviewerConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface ReviewerAgentDependencies extends BaseAgentDependencies {
  config: ReviewerConfig;
}

export interface ReviewerExecutionInput {
  context: ExecutionContext;
  input: ReviewerInput;
}

export interface ReviewerExecutionOutput {
  output: ReviewReport;
  response: ExecutionResponse;
}
