/**
 * Growth Agent implementation.
 *
 * Deterministic decision/recommendation specialist. It validates that a
 * completed analytics_report (with matching runtime evidence) is present in the
 * validated content chain, then derives growth recommendations entirely from
 * the metrics the analytics report actually supplied. It calls no capabilities,
 * performs no network/provider/fs work, imports no concrete agents, and never
 * invents metrics — every recommendation traces to a supplied metric key.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  GrowthConfig,
  GrowthDependencies,
  GrowthExperiment,
  GrowthInput,
  GrowthPriority,
  GrowthRecommendationEntry,
  GrowthReport,
  GrowthSourceArtifact,
  GrowthStatus,
  GrowthThresholds,
  LosingPattern,
  RecommendationPriority,
  WinningPattern,
} from "./types.js";

type JsonRecord = { [key: string]: Json };

/** Default growth system message (informational; the agent is deterministic). */
export const DEFAULT_GROWTH_SYSTEM_PROMPT = `You are a growth decision specialist. Analyze only the analytics metrics actually supplied in the validated analytics report. Never invent or assume a metric that was not supplied. Every recommendation must reference the exact metric keys that support it. If the analytics report is missing, malformed, or lacks execution evidence, return a blocked report.`;

const DEFAULT_THRESHOLDS: GrowthThresholds = {
  strongCompletionRate: 0.5,
  weakCompletionRate: 0.3,
  strongClickThroughRate: 0.05,
  weakClickThroughRate: 0.01,
  strongEngagementFloor: 500,
};

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isGrowthSourceArtifact(value: Json): value is JsonRecord & GrowthSourceArtifact {
  return isRecord(value)
    && (typeof value.artifactId === "string" || typeof value.artifactId === "number")
    && typeof value.kind === "string"
    && typeof value.producerAgent === "string"
    && typeof value.workflowId === "string"
    && typeof value.correlationId === "string"
    && typeof value.status === "string"
    && isRecord(value.payload);
}

function isGrowthInput(value: Json): value is JsonRecord & GrowthInput {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "") {
    return false;
  }
  if (value.taskDescription !== undefined && typeof value.taskDescription !== "string") return false;
  if (value.validatedArtifacts !== undefined
    && !(Array.isArray(value.validatedArtifacts)
      && value.validatedArtifacts.every((item) => isGrowthSourceArtifact(item)))) {
    return false;
  }
  return true;
}

/** Describes why growth recommendations cannot be produced, or null when viable. */
interface Viability {
  ok: boolean;
  reason: string;
}

export class GrowthAgent extends BaseAgent {
  readonly id: AgentId = "growth";
  readonly name = "Growth Agent";
  readonly version = "1.0.0";

  private readonly growthConfig: GrowthDependencies["config"];
  private readonly thresholds: GrowthThresholds;

  constructor(deps: GrowthDependencies) {
    super(deps);
    this.growthConfig = deps.config;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(deps.config?.thresholds ?? {}) };
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isGrowthInput(input.input)) {
      throw new Error("Invalid growth input: expected a validated content chain");
    }
    const viability = this.assessViability(input.input);
    const analytics = this.findAnalytics(input.input);
    const report = viability.ok && analytics !== undefined
      ? this.buildRecommendation(input.input, viability, analytics)
      : this.blockedReport(input.input, viability.reason);
    const output: Json = this.toJson(report);
    return {
      output,
      response: {
        output,
        raw: JSON.stringify(report, null, 2),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        model: this.growthConfig.model,
        provider: "growth-deterministic",
        latencyMs: 0,
      },
    };
  }

  /** Gate: recommendations require a completed, evidenced analytics report. */
  private assessViability(input: GrowthInput): Viability {
    const artifacts = input.validatedArtifacts ?? [];
    if (artifacts.length === 0) return { ok: false, reason: "the content chain is empty." };

    const workflowIds = new Set(artifacts.map((a) => a.workflowId));
    const correlationIds = new Set(artifacts.map((a) => a.correlationId));
    if (workflowIds.size !== 1) return { ok: false, reason: "the workflowId is inconsistent across the content chain." };
    if (correlationIds.size !== 1) return { ok: false, reason: "the correlationId is inconsistent across the content chain." };

    const blocked = artifacts.find((a) => a.status === "blocked" || a.status === "failed");
    if (blocked !== undefined) {
      return { ok: false, reason: `an upstream artifact (${blocked.kind}) is ${blocked.status} and cannot be analyzed.` };
    }

    const analytics = artifacts.find((a) => a.kind === "analytics_report");
    if (analytics === undefined) return { ok: false, reason: "an analytics report is required but is missing." };
    if (!isRecord(analytics.payload)) return { ok: false, reason: "the analytics report payload is malformed." };
    if (analytics.payload.status !== "completed") {
      return { ok: false, reason: `the analytics report is ${String(analytics.payload.status)} and cannot be analyzed.` };
    }
    if (analytics.payload.executionEvidencePresent !== true) {
      return { ok: false, reason: "the analytics report lacks matching runtime evidence of fetched analytics." };
    }
    const metrics = analytics.payload.metrics;
    if (!isRecord(metrics) || Object.keys(metrics).length === 0) {
      return { ok: false, reason: "the analytics report contains no metrics to analyze." };
    }
    for (const key of Object.keys(metrics)) {
      const value = metrics[key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, reason: `the analytics report contains a non-numeric metric (${key}).` };
      }
    }
    return { ok: true, reason: "" };
  }

  private findAnalytics(input: GrowthInput): GrowthSourceArtifact | undefined {
    return (input.validatedArtifacts ?? []).find((a) => a.kind === "analytics_report");
  }

  private buildRecommendation(input: GrowthInput, viability: Viability, analytics: GrowthSourceArtifact): GrowthReport {
    const artifacts = input.validatedArtifacts ?? [];
    const metricsBase = isRecord(analytics.payload) && isRecord(analytics.payload.metrics) ? analytics.payload.metrics : {};
    const metrics = new Map<string, number>();
    for (const key of Object.keys(metricsBase)) {
      const value = metricsBase[key];
      if (typeof value === "number" && Number.isFinite(value)) metrics.set(key, value);
    }

    const winningPatterns: WinningPattern[] = [];
    const losingPatterns: LosingPattern[] = [];
    for (const [metric, value] of metrics) {
      const winning = this.winningObservation(metric, value);
      if (winning !== null) winningPatterns.push({ metric, value, observation: winning });
      const losing = this.losingReason(metric, value);
      if (losing !== null) losingPatterns.push({ metric, value, reason: losing });
    }

    const recommendations: GrowthRecommendationEntry[] = [];
    const experiments: GrowthExperiment[] = [];
    const priorities: GrowthPriority[] = [];

    for (const [metric, value] of metrics) {
      const template = this.recommendationTemplate(metric);
      const losing = this.losingReason(metric, value) !== null;
      const winning = this.winningObservation(metric, value) !== null;
      const priority: RecommendationPriority = losing ? "high" : winning ? "medium" : "medium";
      const action = losing ? `Improve ${template.action}` : template.action;
      const rationale = `${template.rationale} Observed ${metric}=${value}.`;
      recommendations.push({ id: `rec-${metric}`, action, rationale, basedOn: [metric], priority });
      experiments.push({
        id: `exp-${metric}`,
        hypothesis: `Testing changes to ${metric} will move the metric in the intended direction.`,
        expectedImpact: `A measurable change in ${metric}.`,
        successMetric: metric,
      });
      priorities.push({ rank: priorities.length + 1, focus: metric, reason: `${metric}=${value} was analyzed from the supplied analytics report.` });
    }

    const total = metrics.size;
    const analyzed = new Set<string>();
    for (const p of winningPatterns) analyzed.add(p.metric);
    for (const p of losingPatterns) analyzed.add(p.metric);
    const confidence = total === 0 ? 0 : Number((analyzed.size / total).toFixed(2));

    const contentId = this.deriveContentId(input, artifacts, analytics);
    const references = this.sourceReferences(artifacts, analytics);

    return {
      recommendationId: input.requestId,
      objective: input.objective,
      contentId,
      status: "completed",
      summary: `Growth recommendations derived exclusively from the supplied analytics report (${total} metric${total === 1 ? "" : "s"}).`,
      winningPatterns,
      losingPatterns,
      recommendations,
      experiments,
      priorities,
      confidence,
      sourceArtifactReferences: references,
      metadata: {
        workflowId: artifacts[0]?.workflowId ?? "",
        correlationId: artifacts[0]?.correlationId ?? "",
        analyticsReportId: analytics.artifactId,
        createdAt: new Date().toISOString(),
        agentVersion: this.version,
      },
      createdAt: new Date().toISOString(),
    };
  }

  private winningObservation(metric: string, value: number): string | null {
    const t = this.thresholds;
    switch (metric) {
      case "completionRate":
        return value >= t.strongCompletionRate ? "Completion rate is strong, signaling high retention." : null;
      case "clickThroughRate":
        return value >= t.strongClickThroughRate ? "Click-through rate is strong, signaling an effective hook." : null;
      case "likes":
      case "comments":
      case "shares":
        return value >= t.strongEngagementFloor ? `Engagement (${metric}) is strong.` : null;
      default:
        return null;
    }
  }

  private losingReason(metric: string, value: number): string | null {
    const t = this.thresholds;
    switch (metric) {
      case "completionRate":
        return value < t.weakCompletionRate ? "Completion rate is weak, signaling a retention or quality problem." : null;
      case "clickThroughRate":
        return value < t.weakClickThroughRate ? "Click-through rate is weak, signaling a weak hook or packaging." : null;
      default:
        return null;
    }
  }

  private recommendationTemplate(metric: string): { action: string; rationale: string } {
    switch (metric) {
      case "completionRate": return { action: "content retention", rationale: "Retention is a core quality signal." };
      case "clickThroughRate": return { action: "thumbnail and title packaging", rationale: "The packaging hook directly drives click-through." };
      case "likes": return { action: "audience resonance", rationale: "Likes indicate audience affinity with the content." };
      case "comments": return { action: "conversation and engagement", rationale: "Comments signal community engagement worth amplifying." };
      case "shares": return { action: "sharing and reach", rationale: "Shares extend organic reach beyond the initial audience." };
      case "views": return { action: "reach and distribution", rationale: "Views measure how widely the content is seen." };
      case "impressions": return { action: "distribution and surface promotion", rationale: "Impressions measure how often the content is surfaced." };
      case "watchTimeSeconds": return { action: "watch-time and retention", rationale: "Watch-time drives algorithmic promotion." };
      case "conversions": return { action: "conversion flow", rationale: "Conversions tie content performance to business outcomes." };
      case "revenue": return { action: "revenue capture", rationale: "Revenue directly reflects monetized performance." };
      default: return { action: metric, rationale: `Observations are grounded in the supplied ${metric} metric.` };
    }
  }

  private deriveContentId(input: GrowthInput, artifacts: readonly GrowthSourceArtifact[], analytics: GrowthSourceArtifact): string {
    if (isRecord(analytics.payload) && typeof analytics.payload.contentId === "string" && analytics.payload.contentId.trim() !== "") {
      return analytics.payload.contentId;
    }
    const writer = artifacts.find((a) => a.kind === "writer_report");
    if (writer !== undefined && isRecord(writer.payload) && typeof writer.payload.contentId === "string" && writer.payload.contentId.trim() !== "") {
      return writer.payload.contentId;
    }
    return "";
  }

  private sourceReferences(artifacts: readonly GrowthSourceArtifact[], analytics: GrowthSourceArtifact): readonly { artifactId: string; kind: string }[] {
    const seen = new Set<string>();
    const refs: { artifactId: string; kind: string }[] = [];
    for (const artifact of [analytics, ...artifacts]) {
      const key = `${artifact.kind}:${artifact.artifactId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ artifactId: artifact.artifactId, kind: artifact.kind });
    }
    return refs;
  }

  private blockedReport(input: GrowthInput, reason: string): GrowthReport {
    return {
      recommendationId: input.requestId,
      objective: input.objective,
      contentId: "",
      status: "blocked",
      summary: `Blocked: ${reason}`,
      winningPatterns: [],
      losingPatterns: [],
      recommendations: [],
      experiments: [],
      priorities: [],
      confidence: 0,
      sourceArtifactReferences: [],
      metadata: { workflowId: "", correlationId: "", createdAt: new Date().toISOString(), agentVersion: this.version },
      createdAt: new Date().toISOString(),
    };
  }

  private toJson(report: GrowthReport): Json {
    return {
      recommendationId: report.recommendationId,
      objective: report.objective,
      contentId: report.contentId,
      status: report.status,
      summary: report.summary,
      winningPatterns: report.winningPatterns.map((p) => ({ ...p })),
      losingPatterns: report.losingPatterns.map((p) => ({ ...p })),
      recommendations: report.recommendations.map((r) => ({ ...r, basedOn: [...r.basedOn] })),
      experiments: report.experiments.map((e) => ({ ...e })),
      priorities: report.priorities.map((p) => ({ ...p })),
      confidence: report.confidence,
      sourceArtifactReferences: report.sourceArtifactReferences.map((r) => ({ ...r })),
      metadata: { ...report.metadata },
      createdAt: report.createdAt,
    };
  }
}

/** Factory function to create a GrowthAgent. */
export function createGrowthAgent(deps: GrowthDependencies): GrowthAgent {
  const config: GrowthDependencies["config"] = {
    model: deps.config?.model ?? "openrouter/auto",
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_GROWTH_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
    ...(deps.config?.thresholds === undefined ? {} : { thresholds: deps.config.thresholds }),
  };
  return new GrowthAgent({ ...deps, config });
}