/**
 * Business feedback loop decision gateway.
 *
 * Closes the autonomous cycle AnalyticsReport → GrowthRecommendation →
 * FinancialReport → CEO → ExecutiveDirective → existing Orchestrator by REUSING
 * the existing CEO Decision Layer and ExecutiveDirective contract.
 *
 * It is a thin decision-layer producer: it validates the upstream artifacts,
 * grounds an objective/priority/success criteria ONLY in the validated figures
 * (never fabricating a business metric), and calls the existing CEOAgent to
 * produce a validated ExecutiveDirective. It never executes agents,
 * capabilities, or tools and never fabricates money values.
 *
 * Dependency boundary → { shared, orchestrator } + this package's types.
 */

import type { Json, Timestamp, Uuid } from "@ai-media-factory/shared";
import type { RegistryLookup } from "@ai-media-factory/orchestrator";
import type {
  ExecutiveDirective,
  Priority,
  WorkflowIntent,
} from "./types.js";
import { CEOAgent } from "./ceo-agent.js";

/** Serialized upstream artifact in the business feedback chain (mirror of finance chain). */
export interface BusinessFeedbackArtifact {
  readonly artifactId: string;
  readonly kind: string;
  readonly producerAgent: string;
  readonly workflowId: string;
  readonly correlationId: string;
  readonly status: string;
  readonly createdAt: string;
  readonly parentArtifact?: { readonly artifactId: string; readonly kind: string };
  readonly payload: Json;
}

/** Decision source constants used to tag business directives. */
export type BusinessDecisionSource = "business-feedback-executive-policy";

export interface BusinessFeedbackInput {
  readonly requestId: Uuid;
  /** Current loop iteration (1-based). */
  readonly cycle: number;
  /** Hard ceiling for the loop. cycle > maxCycles ⇔ no decision. */
  readonly maxCycles: number;
  /** identity preserved across the loop and forwarded to the Orchestrator. */
  readonly workflowId: Uuid;
  readonly correlationId?: string;
  readonly brandId?: string | null;
  /** validated analytics + growth + finance artifacts (all three required). */
  readonly validatedArtifacts?: readonly BusinessFeedbackArtifact[];
  /** if true the loop may continue; otherwise the gateway refuses further cycles. */
  readonly allowFurtherCycles?: boolean;
  readonly registry?: RegistryLookup;
  readonly clock?: () => Timestamp;
}

export type FeedbackDecisionStatus = "issued" | "no_decision";

export interface BusinessFeedbackDecision {
  readonly status: FeedbackDecisionStatus;
  readonly cycle: number;
  readonly maxCycles: number;
  /** present only when status === "issued". */
  readonly directive?: ExecutiveDirective;
  /** present only when status === "no_decision". */
  readonly reason?: string;
  readonly sourceArtifactReferences: readonly { artifactId: string; kind: string }[];
}

const BUSINESS_SOURCE: BusinessDecisionSource = "business-feedback-executive-policy";

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Reducer that finds the newest artifact of a given kind in the chain. */
function findByKind(artifacts: readonly BusinessFeedbackArtifact[], kind: string): BusinessFeedbackArtifact | undefined {
  return artifacts.find((a) => a.kind === kind);
}

function isCompleted(artifact: BusinessFeedbackArtifact | undefined): artifact is BusinessFeedbackArtifact {
  return artifact !== undefined && artifact.status === "completed";
}

function isBlockedOrFailed(artifact: BusinessFeedbackArtifact | undefined): boolean {
  return artifact !== undefined && (artifact.status === "blocked" || artifact.status === "failed");
}

function hasNumericMetricCount(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  const metrics = payload.metrics;
  if (!isRecord(metrics)) return false;
  return Object.values(metrics).some((v) => typeof v === "number");
}

function hasExecutionEvidence(payload: unknown): boolean {
  if (!isRecord(payload)) return false;
  return payload.executionEvidencePresent === true;
}

function numberAt(payload: unknown, key: string): number | undefined {
  if (!isRecord(payload)) return undefined;
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asContentId(payload: unknown, fallback: string | undefined): string {
  if (isRecord(payload) && typeof payload.contentId === "string" && payload.contentId.trim() !== "") {
    return payload.contentId;
  }
  return fallback ?? "";
}

/** Build a grounded objective referencing only validated figures. */
function deriveObjective(
  analytics: BusinessFeedbackArtifact,
  finance: BusinessFeedbackArtifact,
): string {
  const contentId = asContentId(
    finance.payload,
    asContentId(analytics.payload, undefined),
  );
  const roi = numberAt(finance.payload, "roi");
  const margin = numberAt(finance.payload, "margin");
  const parts: string[] = [];
  if (contentId !== "") parts.push(`improve business outcome for ${contentId}`);
  if (roi !== undefined) parts.push(`lift ROI above ${roi}`);
  if (margin !== undefined) parts.push(`raise margin above ${margin}`);
  return parts.length > 0 ? parts.join("; ") : "improve the next-cycle business outcome";
}

/** Grounded priority derived from validated figures only. */
function derivePriority(finance: BusinessFeedbackArtifact): Priority {
  const profit = numberAt(finance.payload, "profit");
  const roi = numberAt(finance.payload, "roi");
  if (profit !== undefined && profit < 0) return "urgent";
  if (roi !== undefined && roi < 1) return "high";
  return "medium";
}

/** Grounded success criteria derived from validated growth/finance figures only. */
function deriveSuccessCriteria(
  growth: BusinessFeedbackArtifact,
  finance: BusinessFeedbackArtifact,
): readonly string[] {
  const criteria: string[] = [];
  if (isRecord(growth.payload) && Array.isArray(growth.payload.losingPatterns)) {
    for (const pattern of growth.payload.losingPatterns) {
      if (isRecord(pattern) && typeof pattern.metric === "string") {
        criteria.push(`improve losing metric: ${pattern.metric}`);
      }
    }
  }
  const roi = numberAt(finance.payload, "roi");
  if (roi !== undefined) criteria.push(`sustain ROI above ${roi}`);
  if (criteria.length === 0) criteria.push("show measurable improvement in the next cycle");
  return criteria;
}

/** Grounded rationale referencing only the validated source artifacts. */
function deriveRationale(
  artifacts: readonly { artifactId: string; kind: string }[],
  analytics: BusinessFeedbackArtifact,
  growth: BusinessFeedbackArtifact,
  finance: BusinessFeedbackArtifact,
): string {
  const metricCount = isRecord(analytics.payload) && isRecord(analytics.payload.metrics)
    ? Object.keys(analytics.payload.metrics).length
    : 0;
  const losingCount = isRecord(growth.payload) && Array.isArray(growth.payload.losingPatterns)
    ? growth.payload.losingPatterns.length
    : 0;
  const refs = artifacts.map((r) => `${r.kind}:${r.artifactId}`).join(", ");
  return (
    `decision grounded in validated analytics (${metricCount} metrics), ` +
    `growth (${losingCount} losing patterns), and finance ` +
    `(reference: ${refs}).`
  );
}

function sourceReferences(
  artifacts: readonly BusinessFeedbackArtifact[],
  kinds: readonly string[],
): readonly { artifactId: string; kind: string }[] {
  return kinds
    .map((kind) => findByKind(artifacts, kind))
    .filter((a): a is BusinessFeedbackArtifact => a !== undefined)
    .map((a) => ({ artifactId: a.artifactId, kind: a.kind }));
}

/**
 * Validate the upstream chain. Requires completed, evidence-backed analytics
 * AND completed growth AND completed finance. Missing or blocked/failed upstream
 * yields an explicit reason instead of a directive.
 */
export function validateBusinessFeedback(input: BusinessFeedbackInput): { ok: boolean; reason?: string } {
  if (!Number.isInteger(input.cycle) || input.cycle < 1) {
    return { ok: false, reason: "cycle must be a positive integer" };
  }
  if (!Number.isInteger(input.maxCycles) || input.maxCycles < 1) {
    return { ok: false, reason: "maxCycles must be a positive integer" };
  }
  if (input.cycle > input.maxCycles) {
    return { ok: false, reason: `cycle limit reached (cycle ${input.cycle} > maxCycles ${input.maxCycles})` };
  }
  if (input.allowFurtherCycles === false) {
    return { ok: false, reason: "further business cycles are not allowed" };
  }
  const artifacts = input.validatedArtifacts ?? [];
  const analytics = findByKind(artifacts, "analytics_report");
  const growth = findByKind(artifacts, "growth_report");
  const finance = findByKind(artifacts, "finance_report");

  if (isBlockedOrFailed(analytics) || isBlockedOrFailed(growth) || isBlockedOrFailed(finance)) {
    return { ok: false, reason: "upstream business artifact is blocked/failed; no decision" };
  }
  if (!isCompleted(analytics)) {
    return { ok: false, reason: "missing or incomplete analytics_report; no decision" };
  }
  if (!isCompleted(growth)) {
    return { ok: false, reason: "missing or incomplete growth_report; no decision" };
  }
  if (!isCompleted(finance)) {
    return { ok: false, reason: "missing or incomplete finance_report; no decision" };
  }
  if (!hasNumericMetricCount(analytics.payload)) {
    return { ok: false, reason: "analytics_report has no numeric metrics; no decision" };
  }
  if (!hasExecutionEvidence(analytics.payload)) {
    return { ok: false, reason: "analytics_report lacks execution evidence; no decision" };
  }
  return { ok: true };
}

/**
 * Produce a business feedback decision by reusing the existing CEOAgent decision
 * layer. Grounds objective/priority/success criteria in validated figures and
 * attaches source-artifact references + cycle metadata to the directive.
 */
export function decideBusinessCycle(input: BusinessFeedbackInput): BusinessFeedbackDecision {
  const gate = validateBusinessFeedback(input);
  const refs = sourceReferences(input.validatedArtifacts ?? [], [
    "analytics_report",
    "growth_report",
    "finance_report",
  ]);
  if (!gate.ok) {
    return {
      status: "no_decision",
      cycle: input.cycle,
      maxCycles: input.maxCycles,
      reason: gate.reason,
      sourceArtifactReferences: refs,
    };
  }

  const artifacts = input.validatedArtifacts ?? [];
  const analytics = findByKind(artifacts, "analytics_report") as BusinessFeedbackArtifact;
  const growth = findByKind(artifacts, "growth_report") as BusinessFeedbackArtifact;
  const finance = findByKind(artifacts, "finance_report") as BusinessFeedbackArtifact;

  const objective = `${deriveObjective(analytics, finance)} (cycle ${input.cycle})`;
  const priority = derivePriority(finance);
  const successCriteria = deriveSuccessCriteria(growth, finance);
  const rationale = deriveRationale(refs, analytics, growth, finance);
  const intent: WorkflowIntent = "implement";

  const ceo = new CEOAgent({ registry: input.registry, clock: input.clock, decisionSource: BUSINESS_SOURCE });
  const decided = ceo.decide({ objective, intent, priority });

  const directive: ExecutiveDirective = {
    ...decided,
    successCriteria,
    rationale,
    sourceArtifactReferences: refs,
    cycle: input.cycle,
  };

  return {
    status: "issued",
    cycle: input.cycle,
    maxCycles: input.maxCycles,
    directive,
    sourceArtifactReferences: refs,
  };
}