import type { BaseAgentDependencies, ExecutionResponse } from "@ai-media-factory/runtime";
import type { Json, Uuid } from "@ai-media-factory/runtime";

export type QATestStatus = "passed" | "failed" | "skipped" | "not_executed";
export type QAEvidenceSource = "runtime" | "provided-result" | "none";
export type QAFindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type QAFindingCategory = "correctness" | "regression" | "coverage" | "reliability" | "performance" | "security" | "process";
export type QAPriority = "high" | "medium" | "low";
export type QAReportStatus = "passed" | "failed" | "blocked" | "not_executed" | "reviewed";

export interface QAExecutionEvidence {
  testName: string;
  status: QATestStatus;
  executed: boolean;
  evidence?: string;
  source: QAEvidenceSource;
  durationMs?: number;
  failure?: string;
}

export interface QARequest {
  scope: string;
  requirements: string[];
  expectedTests: string[];
  suppliedEvidence?: QAExecutionEvidence[];
}

export interface QAInput {
  requestId: Uuid;
  objective: string;
  request: QARequest;
}

export interface QATestResult extends QAExecutionEvidence { recommendation?: string; }

export interface QAFinding {
  id: string;
  severity: QAFindingSeverity;
  category: QAFindingCategory;
  description: string;
  evidence?: string;
  recommendation?: string;
}

export interface QARisk { id: string; description: string; severity: QAFindingSeverity; mitigation?: string; }
export interface QARecommendation { priority: QAPriority; description: string; relatedFindingIds?: string[]; }

export interface QAReport {
  reportId: Uuid;
  requestId: Uuid;
  objective: string;
  status: QAReportStatus;
  summary: string;
  testResults: QATestResult[];
  findings: QAFinding[];
  risks: QARisk[];
  recommendations: QARecommendation[];
  metadata: { createdAt: string; agentVersion: string; executionEvidencePresent: boolean };
}

export interface QAConfig { model: string; temperature: number; maxOutputTokens: number; systemPrompt: string; includeReasoning?: boolean; }
export interface QAAgentDependencies extends BaseAgentDependencies { config: QAConfig; }
export interface QAExecutionOutput { output: QAReport; response: ExecutionResponse; }
