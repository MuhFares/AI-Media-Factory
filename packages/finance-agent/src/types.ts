/**
 * Finance Agent types.
 *
 * A deterministic financial analysis specialist. It computes financial metrics
 * ONLY from two validated sources: revenue (from the analytics report metrics)
 * and cost (from validated, externally-supplied cost data). It never invents a
 * money value, never executes any financial transaction, and never accesses a
 * payment/ledger system directly. Any missing source amount yields an explicit
 * blocked/unavailable state.
 */

import type { BaseAgentDependencies, ExecutionContext, ExecutionResponse, Json, Uuid } from "@ai-media-factory/runtime";

/** A serialized upstream artifact in the content collaboration chain. */
export interface FinanceSourceArtifact {
  artifactId: string;
  kind: string;
  producerAgent: string;
  workflowId: string;
  correlationId: string;
  status: string;
  createdAt: string;
  parentArtifact?: { artifactId: string; kind: string };
  payload: Json;
}

/**
 * Validated, externally-supplied financial data. The caller is responsible for
 * the provenance/validation of these amounts; the Finance Agent only derives
 * analysis from them and never fabricates any value.
 */
export interface FinancialData {
  /** Total validated spend/cost for the analyzed activity. */
  cost?: number;
  /** Alternate cost field name (spend). */
  spend?: number;
  /** Optionally supplied revenue override; otherwise revenue is taken from analytics. */
  revenue?: number;
  /** ISO-4217 currency code, e.g. "USD". */
  currency?: string;
  /** Optional campaign identifier. */
  campaignId?: string;
  /** Optional external source artifact this cost/revenue data came from. */
  sourceArtifactId?: string;
  sourceArtifactKind?: string;
}

/** Input to the finance agent: analytics + growth chain and validated cost data. */
export interface FinanceInput {
  requestId: Uuid;
  objective: string;
  taskDescription?: string;
  /** The validated content chain; completed analytics_report and growth_report expected. */
  validatedArtifacts?: readonly FinanceSourceArtifact[];
  /** Validated cost/revenue data supplied by the caller. */
  financialData?: FinancialData;
}

export type FinanceStatus = "completed" | "blocked" | "failed";

/** How the cost-per-acquisition figure (if derivable) should be labeled. */
export type CpaType = "CPA" | "CAC";

export interface FinancialReport {
  reportId: Uuid;
  contentId: string;
  campaignId?: string;
  status: FinanceStatus;
  summary: string;
  revenue?: number;
  cost?: number;
  profit?: number;
  roi?: number;
  cpa?: number;
  cpaType?: CpaType;
  margin?: number;
  currency?: string;
  confidence: number;
  sourceArtifactReferences: readonly { artifactId: string; kind: string }[];
  metadata: Record<string, Json>;
  createdAt: string;
}

export interface FinanceConfig {
  /** Model, retained for interface parity; the Finance Agent is deterministic. */
  model: string;
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface FinanceDependencies extends BaseAgentDependencies {
  config: FinanceConfig;
}

export interface FinanceExecutionInput {
  context: ExecutionContext;
  input: FinanceInput;
}

export interface FinanceExecutionOutput {
  output: FinancialReport;
  response: ExecutionResponse;
}