import type { BaseAgentDependencies, ExecutionResponse } from "@ai-media-factory/runtime";
import type { Json, Uuid } from "@ai-media-factory/runtime";

export type DocumentationType = "guide" | "api" | "tutorial" | "reference" | "readme" | "design_doc" | "report";
export type DocumentationStatus = "generated" | "blocked" | "failed";
export type DocumentationPriority = "high" | "medium" | "low";

export interface DocumentationRequest {
  type: DocumentationType;
  purpose: string;
  audience: string;
  requiredSections: string[];
  sourceContext?: Record<string, Json>;
}

export interface DocumentationInput {
  requestId: Uuid;
  objective: string;
  request: DocumentationRequest;
}

export interface DocumentationSection {
  title: string;
  content: string;
  order: number;
}

export interface DocumentationArtifact {
  title: string;
  documentationType: DocumentationType;
  content: string;
  sections: DocumentationSection[];
  generatedOnly: boolean;
}

export interface DocumentationMetadata {
  createdAt: string;
  agentVersion: string;
  persistence: "not_written" | "blocked";
}

export interface DocumentationIssue {
  code: string;
  description: string;
  severity: DocumentationPriority;
  recommendation?: string;
}

export interface DocumentationRecommendation {
  priority: DocumentationPriority;
  description: string;
  relatedIssueCodes?: string[];
}

export interface DocumentationResult {
  resultId: Uuid;
  requestId: Uuid;
  objective: string;
  documentationType: DocumentationType;
  status: DocumentationStatus;
  summary: string;
  artifact: DocumentationArtifact;
  issues: DocumentationIssue[];
  recommendations: DocumentationRecommendation[];
  metadata: DocumentationMetadata;
}

export interface DocumentationConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface DocumentationAgentDependencies extends BaseAgentDependencies { config: DocumentationConfig; }
export interface DocumentationExecutionOutput { output: DocumentationResult; response: ExecutionResponse; }
