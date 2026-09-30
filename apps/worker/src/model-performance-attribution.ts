import { createHash, randomUUID } from "node:crypto";
import type { CollaborationArtifact } from "@ai-media-factory/shared";
import type { ArtifactAttributionOutcome, ExecutionProvenanceRecord, ModelPerformanceObservation } from "@ai-media-factory/workflow-engine";

type RecordValue = Record<string, unknown>;

const SECRET_KEY = /(?:api[_-]?key|authorization|auth(?:orization)?|access[_-]?token|password|secret|cookie|signed|signature)/i;
const SIGNED_URL = /[?&](?:signature|sig|token|x-amz-signature|x-goog-signature)=/i;

function record(value: unknown): RecordValue { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {}; }

/** Canonical JSON is intentionally small, stable, and removes secret material. */
export function safeAttributionConfiguration(value: unknown): RecordValue | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return { values: value.map((item) => safeAttributionValue(item)).filter((item) => item !== undefined) };
  const source = record(value); const safe: RecordValue = {};
  for (const key of Object.keys(source).sort()) {
    if (SECRET_KEY.test(key)) continue;
    const next = safeAttributionValue(source[key]);
    if (next !== undefined) safe[key] = next;
  }
  return safe;
}

function safeAttributionValue(value: unknown): unknown {
  if (typeof value === "string") return SIGNED_URL.test(value) ? "[REDACTED_URL]" : value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(safeAttributionValue).filter((item) => item !== undefined);
  if (typeof value === "object") return safeAttributionConfiguration(value);
  return undefined;
}

export function configurationFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(safeAttributionConfiguration(value) ?? {})).digest("hex");
}

export function executionProvenance(input: Omit<ExecutionProvenanceRecord, "executionId" | "configurationFingerprint" | "configuration"> & { executionId?: string; configuration?: unknown }): ExecutionProvenanceRecord {
  const configuration = safeAttributionConfiguration(input.configuration);
  return {
    ...input,
    executionId: input.executionId ?? randomUUID(),
    configuration,
    configurationFingerprint: configurationFingerprint(configuration),
  };
}

export function artifactAttribution(artifacts: readonly CollaborationArtifact[], executions: readonly ExecutionProvenanceRecord[], decisions: readonly { payload: RecordValue }[]): ArtifactAttributionOutcome[] {
  return artifacts.map((artifact) => {
    const producer = executions.find((execution) => execution.artifactIds.includes(artifact.artifactId)) ?? null;
    const payload = record(artifact.payload);
    const reviews = artifacts.filter((item) => item.kind === "review_report" || item.kind === "final_product_review").map((item) => record(item.payload));
    const qas = artifacts.filter((item) => item.kind === "qa_report" || item.kind === "final_technical_qa").map((item) => record(item.payload));
    const review = reviews.find((item) => item.artifactId === artifact.artifactId || item.finalMediaArtifactId === artifact.artifactId) ?? null;
    const qa = qas.find((item) => item.artifactId === artifact.artifactId || item.finalMediaArtifactId === artifact.artifactId) ?? null;
    const decision = decisions.map((item) => item.payload).find((item) => item.artifactId === artifact.artifactId || item.finalMediaArtifactId === artifact.artifactId) ?? null;
    return { artifactId: artifact.artifactId, producedByExecutionId: producer?.executionId ?? null,
      reviewStatus: typeof review?.status === "string" ? review.status : null,
      qaStatus: typeof qa?.status === "string" ? qa.status : null,
      humanDecision: typeof decision?.outcome === "string" ? decision.outcome : null };
  });
}

export function modelPerformanceObservations(executions: readonly ExecutionProvenanceRecord[]): ModelPerformanceObservation[] {
  const groups = new Map<string, ExecutionProvenanceRecord[]>();
  for (const execution of executions) {
    const key = [execution.provider, execution.model, execution.agentId, execution.capability, execution.configurationFingerprint].join("|");
    groups.set(key, [...(groups.get(key) ?? []), execution]);
  }
  return [...groups.values()].map((items) => {
    const first = items[0]; const knownCosts = items.filter((item) => item.cost !== null).map((item) => item.cost!);
    const usages = items.map((item) => item.usage?.totalTokens).filter((value): value is number => typeof value === "number");
    return { provider: first.provider, model: first.model, agentId: first.agentId, capability: first.capability,
      configurationFingerprint: first.configurationFingerprint, executionCount: items.length,
      successCount: items.filter((item) => item.status === "success").length,
      failureCount: items.filter((item) => item.status === "failed").length,
      blockedCount: items.filter((item) => item.status === "blocked").length,
      latencyAverageMs: items.reduce((total, item) => total + item.latencyMs, 0) / items.length,
      costTotal: knownCosts.length === 0 ? null : knownCosts.reduce((total, cost) => total + cost, 0),
      costAverage: knownCosts.length === 0 ? null : knownCosts.reduce((total, cost) => total + cost, 0) / knownCosts.length,
      usageTotal: usages.length === 0 ? null : usages.reduce((total, usage) => total + usage, 0) };
  });
}
