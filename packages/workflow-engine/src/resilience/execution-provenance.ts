/** Durable, secret-safe record of one actual execution attempt. */
export type AttributionCostKind = "ACTUAL" | "ESTIMATED" | "FREE" | "UNKNOWN";
import type { ProviderFailureMetadata } from "@ai-media-factory/tool-framework";

export interface ExecutionUsage {
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly totalTokens?: number | null;
  readonly units?: Record<string, number>;
}

export interface ExecutionProvenanceRecord {
  readonly executionId: string;
  readonly workflowId: string;
  readonly correlationId: string | null;
  readonly agentId: string;
  readonly stage: string;
  readonly capability: string | null;
  readonly provider: string | null;
  /** Exact provider model identity. Null for non-model local tools. */
  readonly model: string | null;
  /** Runtime/tool identity, e.g. ffmpeg, when distinct from a model. */
  readonly runtime: string | null;
  readonly promptVersion: string | null;
  readonly configurationFingerprint: string | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly latencyMs: number;
  readonly status: "success" | "failed" | "blocked";
  readonly usage: ExecutionUsage | null;
  readonly costKind: AttributionCostKind;
  readonly cost: number | null;
  readonly currency: string | null;
  readonly artifactIds: readonly string[];
  readonly parentExecutionIds: readonly string[];
  readonly attemptNumber: number;
  readonly providerRequestId: string | null;
  readonly providerJobId: string | null;
  readonly errorClassification: string | null;
  /** Immutable strategic context snapshot used by this execution (Strategic Layer V1; null = pre-layer). */
  readonly strategicSnapshotId?: string | null;
  readonly failureMetadata?: ProviderFailureMetadata | null;
  /** Immutable provider catalog price snapshot selected at execution time, if provider evidence was available. */
  readonly providerModelSnapshotId?: string | null;
  /** Planning estimate, calculable cost from recorded usage, and provider-billed cost remain distinct. */
  readonly estimatedCost?: number | null;
  readonly actualCalculableCost?: number | null;
  readonly providerBilledCost?: number | null;
  readonly costEvidence?: Record<string, unknown> | null;
  /** Safe normalized configuration only; never credentials or signed URLs. */
  readonly configuration: Record<string, unknown> | null;
}

export interface ArtifactAttributionOutcome {
  readonly artifactId: string;
  readonly producedByExecutionId: string | null;
  readonly reviewStatus: string | null;
  readonly qaStatus: string | null;
  readonly humanDecision: string | null;
}

export interface ModelPerformanceObservation {
  readonly provider: string | null;
  readonly model: string | null;
  readonly agentId: string;
  readonly capability: string | null;
  readonly configurationFingerprint: string | null;
  readonly executionCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly blockedCount: number;
  readonly latencyAverageMs: number;
  readonly costTotal: number | null;
  readonly costAverage: number | null;
  readonly usageTotal: number | null;
}
