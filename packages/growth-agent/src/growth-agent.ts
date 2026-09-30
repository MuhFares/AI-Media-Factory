/**
 * Growth Agent implementation.
 *
 * Dual-mode specialist:
 *  - POST_PUBLICATION (deterministic): validates analytics_report evidence and derives
 *    winning/losing patterns + recommendations purely from supplied metrics.
 *  - PRE_PUBLICATION (LLM): for the business strategy council, synthesizes
 *    research, planner (execution_plan / evidence_backed_content_brief), writer,
 *    seo, and brand evidence into a GrowthStrategyAnalysis via LLM (glm-5.3
 *    via AgentRouter OPENAI_COMPATIBLE). No analytics_report is required in this
 *    mode; every insight must trace to the supplied pre-publication evidence.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, BoundedStructuralValidationError, boundedStructuralDiagnostics, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
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

/** LLM system prompt for PRE_PUBLICATION strategy council. */
export const DEFAULT_GROWTH_SYSTEM_PROMPT = `You are a growth strategy specialist for the business strategy council (PRE_PUBLICATION).

You must:
1. Analyze ONLY the supplied pre-publication evidence: research reports, planner execution plans / evidence-backed content briefs, writer reports, SEO reports, and brand gate reports.
2. Never invent or assume analytics metrics (views, CTR, completion rate, revenue) that were not supplied — this is pre-publication.
3. Propose growth opportunities, audience expansion angles, and positioning strategies grounded in the evidence.
4. Every recommendation, experiment, and priority must reference the evidence that supports it.
5. If the evidence is insufficient to form a strategy, return status "blocked" and do not fabricate.
6. Output a valid JSON GrowthStrategyAnalysis (compatible with GrowthReport). Do not include explanatory text outside the JSON.`;

export const DEFAULT_GROWTH_STRATEGY_PROMPT = DEFAULT_GROWTH_SYSTEM_PROMPT;

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

const PRE_PUBLICATION_KINDS = new Set([
  "research_report",
  "execution_plan",
  "evidence_backed_content_brief",
  "writer_report",
  "seo_report",
  "brand_report",
]);

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
    // Branch: POST_PUBLICATION (analytics present) => deterministic; PRE_PUBLICATION => LLM
    const hasAnalytics = (input.input.validatedArtifacts ?? []).some((a) => a.kind === "analytics_report");
    if (hasAnalytics) {
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
    // PRE_PUBLICATION LLM path — GrowthStrategyAnalysis via glm-5.3 (AgentRouter OPENAI_COMPATIBLE)
    return this.executePrePublication(input, signal);
  }

  // -------------------------------------------------------------------------
  // PRE_PUBLICATION LLM path
  // -------------------------------------------------------------------------

  private async executePrePublication(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    const growthInput = input.input as unknown as GrowthInput;
    const artifacts = growthInput.validatedArtifacts ?? [];
    // Validate that at least one pre-publication evidence is present
    const hasEvidence = artifacts.some((a) => PRE_PUBLICATION_KINDS.has(a.kind));
    // Fallback to deterministic blocked when LLM execution is not wired (preserves legacy tests without mocks)
    const hasLlm = typeof (this.deps as unknown as { execute?: unknown }).execute === "function";
    if (!hasEvidence || !hasLlm) {
      const reason = !hasEvidence
        ? "no pre-publication evidence was supplied; research/planner/writer/seo/brand evidence is required for strategy analysis."
        : "strategy council LLM execution is not configured; no analytics_report present.";
      const blocked = this.blockedReport(growthInput, reason);
      const output: Json = this.toJson(blocked);
      return {
        output,
        response: {
          output,
          raw: JSON.stringify(blocked, null, 2),
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: this.growthConfig.model,
          provider: "growth-strategy-blocked",
          latencyMs: 0,
        },
      };
    }

    const { report, response: executionResponse } = await this.createStrategyAnalysis(growthInput, artifacts, input.context, signal);
    const output = this.toJson(report);
    const response: ExecutionResponse = { ...executionResponse, output, raw: JSON.stringify(report, null, 2) };
    return { output, response };
  }

  private async createStrategyAnalysis(
    input: GrowthInput,
    artifacts: readonly GrowthSourceArtifact[],
    context: ExecutionContext,
    signal: CancellationToken,
  ): Promise<{ report: GrowthReport; response: ExecutionResponse }> {
    signal.throwIfCancelled();
    const prompt = this.buildStrategyPrompt(input, artifacts);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);
    return { report: this.parseGrowthResponse(response.output, input, artifacts), response };
  }

  private buildStrategyPrompt(input: GrowthInput, artifacts: readonly GrowthSourceArtifact[]): string {
    const byKind = (kind: string) => artifacts.filter((a) => a.kind === kind);
    const research = byKind("research_report");
    const planner = artifacts.filter((a) => a.kind === "execution_plan" || a.kind === "evidence_backed_content_brief");
    const writer = byKind("writer_report");
    const seo = byKind("seo_report");
    const brand = byKind("brand_report");
    const describe = (list: readonly GrowthSourceArtifact[]) => list.length === 0 ? "(none)" : list.map((a) => `- ${a.kind}:${a.artifactId} status=${a.status} payload=${JSON.stringify(a.payload).slice(0, 1500)}`).join("\n");
    const workflowId = artifacts[0]?.workflowId ?? "";
    const correlationId = artifacts[0]?.correlationId ?? "";
    return `${this.growthConfig.systemPrompt}

PRE_PUBLICATION Growth Strategy Analysis (strategy council) — synthesize the supplied pre-publication evidence into a GrowthStrategyAnalysis.

Objective:
${input.objective}

Task description:
${input.taskDescription ?? "(none supplied)"}

Workflow:
workflowId=${workflowId} correlationId=${correlationId}

RESEARCH evidence (grounding — do not invent metrics):
${describe(research)}

PLANNER evidence (execution_plan / evidence_backed_content_brief):
${describe(planner)}

WRITER evidence (writer_report):
${describe(writer)}

SEO evidence (seo_report):
${describe(seo)}

BRAND evidence (brand_report):
${describe(brand)}

Produce a valid GrowthReport / GrowthStrategyAnalysis JSON with:
- recommendationId (set to exactly the requestId "${input.requestId}"),
- objective (copy the objective above),
- contentId (derive from writer or research payload if present, else empty string),
- status ("completed" | "blocked"),
- summary (concise strategy summary grounded in the evidence),
- winningPatterns (array of { metric, value, observation } — use 0 for value if pre-pub, or omit if no metric),
- losingPatterns (array of { metric, value, reason }),
- recommendations (array of { id, action, rationale, basedOn, priority } — basedOn must reference evidence kinds or metrics actually supplied),
- experiments (array of { id, hypothesis, expectedImpact, successMetric }),
- priorities (array of { rank, focus, reason }),
- confidence (0-1),
- sourceArtifactReferences (array of { artifactId, kind } — include every supplied pre-publication artifact you used, never invent ids),
- metadata (workflowId, correlationId, createdAt, agentVersion),
- createdAt (ISO string)

Keep the response compact: at most 2 recommendations, 2 experiments, 2 priorities, and 2 patterns in each pattern array. The summary must explicitly cover audience growth, distribution/platform role, retention, discoverability, growth loop, risk, and assumptions/unknowns.

Constraints:
- Do NOT require or invent analytics_report metrics; this is PRE_PUBLICATION.
- Every recommendation must trace to at least one supplied evidence kind.
- Do not invent artifact ids — use only the ids listed above.
- If evidence is insufficient, return status "blocked" with empty arrays and confidence 0.
- Output ONLY the JSON object, no explanatory text.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.growthConfig.model,
      system: this.growthConfig.systemPrompt,
      messages: [
        { role: "system", content: this.growthConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: (this.growthConfig as unknown as { temperature?: number }).temperature ?? 0.3,
      maxOutputTokens: (this.growthConfig as unknown as { maxOutputTokens?: number }).maxOutputTokens ?? 16384,
      responseSchema: this.getGrowthResponseSchema(),
    };
  }

  private getGrowthResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        recommendationId: { type: "string" },
        objective: { type: "string" },
        contentId: { type: "string" },
        status: { type: "string", enum: ["completed", "blocked", "failed"] },
        summary: { type: "string" },
        winningPatterns: { type: "array", items: { type: "object", properties: { metric: { type: "string" }, value: { type: "number" }, observation: { type: "string" } }, required: ["metric", "value", "observation"] } },
        losingPatterns: { type: "array", items: { type: "object", properties: { metric: { type: "string" }, value: { type: "number" }, reason: { type: "string" } }, required: ["metric", "value", "reason"] } },
        recommendations: { type: "array", items: { type: "object", properties: { id: { type: "string" }, action: { type: "string" }, rationale: { type: "string" }, basedOn: { type: "array", items: { type: "string" } }, priority: { type: "string", enum: ["high", "medium", "low"] } }, required: ["id", "action", "rationale", "basedOn", "priority"] } },
        experiments: { type: "array", items: { type: "object", properties: { id: { type: "string" }, hypothesis: { type: "string" }, expectedImpact: { type: "string" }, successMetric: { type: "string" } }, required: ["id", "hypothesis", "expectedImpact", "successMetric"] } },
        priorities: { type: "array", items: { type: "object", properties: { rank: { type: "number" }, focus: { type: "string" }, reason: { type: "string" } }, required: ["rank", "focus", "reason"] } },
        confidence: { type: "number" },
        sourceArtifactReferences: { type: "array", items: { type: "object", properties: { artifactId: { type: "string" }, kind: { type: "string" } }, required: ["artifactId", "kind"] } },
        metadata: { type: "object", properties: { workflowId: { type: "string" }, correlationId: { type: "string" }, createdAt: { type: "string" }, agentVersion: { type: "string" } } },
        createdAt: { type: "string" },
      },
      required: ["recommendationId", "objective", "contentId", "status", "summary", "winningPatterns", "losingPatterns", "recommendations", "experiments", "priorities", "confidence", "sourceArtifactReferences", "metadata", "createdAt"],
    };
  }

  private parseGrowthResponse(output: Json, input: GrowthInput, artifacts: readonly GrowthSourceArtifact[]): GrowthReport {
    if (!isRecord(output)) throw new BoundedStructuralValidationError("Invalid growth response: report must be an object", boundedStructuralDiagnostics("growth", "GrowthReport", output, [{ path:"$",code:"wrong_type",expected:"object",actual:output }]));
    // Do not allow parser defaults to manufacture a completed strategy report.
    // Structural normalization belongs at the boundary; substantive analysis,
    // evidence linkage, and recommendations must originate with the LLM.
    const required = ["recommendationId", "objective", "contentId", "status", "summary", "winningPatterns", "losingPatterns", "recommendations", "experiments", "priorities", "confidence", "sourceArtifactReferences", "metadata", "createdAt"];
    for (const key of required) {
      if ((output as JsonRecord)[key] === undefined) throw new BoundedStructuralValidationError(`Invalid growth response: missing field ${key}`, boundedStructuralDiagnostics("growth", "GrowthReport", output, [{path:key,code:"missing_required"}], ["metadata"]));
    }
    const allowedIds = new Set(artifacts.map((a) => String(a.artifactId)));
    const refs = Array.isArray(output.sourceArtifactReferences) ? output.sourceArtifactReferences : [];
    for (const r of refs) {
      if (!isRecord(r) || typeof r.artifactId !== "string" || typeof r.kind !== "string") throw new Error("Invalid growth response: invalid sourceArtifactReference");
      if (!allowedIds.has(String(r.artifactId))) throw new Error("Invalid growth response: source reference not present in supplied evidence");
    }
    // Status guard: LLM must not invent failures outside blocked/completed
    const status = String(output.status);
    if (!["completed", "blocked", "failed"].includes(status)) throw new Error("Invalid growth response: invalid status");
    if (String(output.summary).trim().length < 40) throw new Error("Invalid growth response: summary is not substantive");
    if (!Number.isFinite(Number(output.confidence)) || Number(output.confidence) < 0 || Number(output.confidence) > 1) throw new Error("Invalid growth response: confidence must be between 0 and 1");
    if (status === "completed" && (refs.length === 0 || !Array.isArray(output.recommendations) || output.recommendations.length === 0 || !Array.isArray(output.priorities) || output.priorities.length === 0)) {
      throw new Error("Invalid growth response: completed strategy analysis requires evidence-linked recommendations and priorities");
    }
    // Cross-check recommendation linkage is not fabricated beyond supplied kinds/metrics
    return {
      recommendationId: String(output.recommendationId),
      objective: String(output.objective),
      contentId: String(output.contentId),
      status: status as GrowthStatus,
      summary: String(output.summary),
      winningPatterns: Array.isArray(output.winningPatterns) ? (output.winningPatterns as unknown as WinningPattern[]).map((p) => ({ metric: String((p as unknown as JsonRecord).metric), value: Number((p as unknown as JsonRecord).value), observation: String((p as unknown as JsonRecord).observation) })) : [],
      losingPatterns: Array.isArray(output.losingPatterns) ? (output.losingPatterns as unknown as LosingPattern[]).map((p) => ({ metric: String((p as unknown as JsonRecord).metric), value: Number((p as unknown as JsonRecord).value), reason: String((p as unknown as JsonRecord).reason) })) : [],
      recommendations: Array.isArray(output.recommendations) ? (output.recommendations as unknown as GrowthRecommendationEntry[]).map((r) => ({ id: String((r as unknown as JsonRecord).id), action: String((r as unknown as JsonRecord).action), rationale: String((r as unknown as JsonRecord).rationale), basedOn: Array.isArray((r as unknown as JsonRecord).basedOn) ? ((r as unknown as JsonRecord).basedOn as Json[]).map((x) => String(x)) : [], priority: String((r as unknown as JsonRecord).priority) as RecommendationPriority })) : [],
      experiments: Array.isArray(output.experiments) ? (output.experiments as unknown as GrowthExperiment[]).map((e) => ({ id: String((e as unknown as JsonRecord).id), hypothesis: String((e as unknown as JsonRecord).hypothesis), expectedImpact: String((e as unknown as JsonRecord).expectedImpact), successMetric: String((e as unknown as JsonRecord).successMetric) })) : [],
      priorities: Array.isArray(output.priorities) ? (output.priorities as unknown as GrowthPriority[]).map((p) => ({ rank: Number((p as unknown as JsonRecord).rank), focus: String((p as unknown as JsonRecord).focus), reason: String((p as unknown as JsonRecord).reason) })) : [],
      confidence: Number(output.confidence),
      sourceArtifactReferences: (refs as unknown as { artifactId: string; kind: string }[]).map((r) => ({ artifactId: String(r.artifactId), kind: String(r.kind) })),
      metadata: isRecord(output.metadata) ? (output.metadata as Record<string, Json>) : { workflowId: artifacts[0]?.workflowId ?? "", correlationId: artifacts[0]?.correlationId ?? "", createdAt: new Date().toISOString(), agentVersion: this.version },
      createdAt: String(output.createdAt),
    };
  }

  // -------------------------------------------------------------------------
  // Deterministic helpers (POST_PUBLICATION) — retained for calculations/validation
  // -------------------------------------------------------------------------

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
    model: deps.config?.model ?? "glm-5.3",
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_GROWTH_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
    temperature: (deps.config as unknown as { temperature?: number })?.temperature ?? 0.3,
    maxOutputTokens: (deps.config as unknown as { maxOutputTokens?: number })?.maxOutputTokens ?? 4096,
    ...(deps.config?.thresholds === undefined ? {} : { thresholds: deps.config.thresholds }),
  };
  return new GrowthAgent({ ...deps, config });
}
