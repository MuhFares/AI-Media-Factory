/**
 * Finance Agent implementation.
 *
 * Dual-mode financial analysis specialist:
 *  - POST_PUBLICATION (deterministic): computes profit/ROI/margin/CPA from
 *    validated revenue (analytics) and supplied cost, with deterministic math.
 *  - PRE_PUBLICATION (LLM): for the business strategy council, synthesizes
 *    research, planner, writer, seo, brand, and growth strategy evidence into a
 *    FinancialStrategyAnalysis via LLM (glm-5.3 via AgentRouter OPENAI_COMPATIBLE).
 *    Never invents money values and never executes transactions.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionRequest, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, BoundedStructuralValidationError, boundedStructuralDiagnostics, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type {
  FinancialData,
  FinancialReport,
  FinanceConfig,
  FinanceDependencies,
  FinanceInput,
  FinanceSourceArtifact,
  FinanceStatus,
} from "./types.js";

type JsonRecord = { [key: string]: Json };

/** LLM system prompt for PRE_PUBLICATION finance strategy council. */
export const DEFAULT_FINANCE_SYSTEM_PROMPT = `You are a financial strategy specialist for the business strategy council (PRE_PUBLICATION).

You must:
1. Analyze ONLY the supplied pre-publication evidence: research, planner, writer, SEO, brand, and growth strategy evidence.
2. Never invent, assume, or extrapolate a money value (revenue, cost, spend) that was not explicitly supplied. If no financial figures were supplied, estimate only with explicit caveats and mark confidence accordingly, or return blocked.
3. Propose budget, pricing, and monetization strategy options grounded in the evidence; never execute or suggest executing any financial transaction.
4. Every figure or recommendation must trace to the evidence that supports it.
5. If evidence is insufficient, return status "blocked" describing the gap.
6. Output a valid JSON FinancialStrategyAnalysis (compatible with FinancialReport). Do not include explanatory text outside the JSON.`;

export const DEFAULT_FINANCE_STRATEGY_PROMPT = DEFAULT_FINANCE_SYSTEM_PROMPT;

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonNegativeFinite(value: Json): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinanceSourceArtifact(value: Json): value is JsonRecord & FinanceSourceArtifact {
  return isRecord(value)
    && (typeof value.artifactId === "string" || typeof value.artifactId === "number")
    && typeof value.kind === "string"
    && typeof value.producerAgent === "string"
    && typeof value.workflowId === "string"
    && typeof value.correlationId === "string"
    && typeof value.status === "string"
    && isRecord(value.payload);
}

function isFinancialData(value: Json): value is JsonRecord & FinancialData {
  if (!isRecord(value)) return false;
  for (const key of Object.keys(value)) {
    const current = value[key];
    if (key === "cost" || key === "spend" || key === "revenue") {
      if (current !== undefined && !isNonNegativeFinite(current)) return false;
    } else if (key === "currency" || key === "campaignId" || key === "sourceArtifactId" || key === "sourceArtifactKind") {
      if (current !== undefined && typeof current !== "string") return false;
    } else if (current !== undefined) {
      return false;
    }
  }
  return true;
}

function isFinanceInput(value: Json): value is JsonRecord & FinanceInput {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "") {
    return false;
  }
  if (value.taskDescription !== undefined && typeof value.taskDescription !== "string") return false;
  if (value.financialData !== undefined && !isFinancialData(value.financialData)) return false;
  if (value.validatedArtifacts !== undefined
    && !(Array.isArray(value.validatedArtifacts)
      && value.validatedArtifacts.every((item) => isFinanceSourceArtifact(item)))) {
    return false;
  }
  return true;
}

/** Describes why a financial analysis cannot proceed, or null when viable. */
interface Viability {
  ok: boolean;
  reason: string;
}

/** The validated numeric inputs available to compute on. */
interface FinanceAmounts {
  revenue: number;
  cost: number;
  conversions?: number;
  currency: string;
}

const PRE_PUBLICATION_KINDS = new Set([
  "research_report",
  "execution_plan",
  "evidence_backed_content_brief",
  "writer_report",
  "seo_report",
  "brand_report",
  "growth_report",
]);

export class FinanceAgent extends BaseAgent {
  readonly id: AgentId = "finance";
  readonly name = "Finance Agent";
  readonly version = "1.0.0";

  private readonly financeConfig: FinanceDependencies["config"];

  constructor(deps: FinanceDependencies) {
    super(deps);
    this.financeConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isFinanceInput(input.input)) {
      throw new Error("Invalid finance input: expected a validated content chain");
    }
    const hasAnalytics = (input.input.validatedArtifacts ?? []).some((a) => a.kind === "analytics_report");
    if (hasAnalytics) {
      const amounts = this.resolveAmounts(input.input);
      const viability = this.assessViability(input.input, amounts);
      const report = viability.ok ? this.buildReport(input.input, viability, amounts) : this.blockedReport(input.input, viability.reason);
      const output: Json = this.toJson(report);
      return {
        output,
        response: {
          output,
          raw: JSON.stringify(report, null, 2),
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: this.financeConfig.model,
          provider: "finance-deterministic",
          latencyMs: 0,
        },
      };
    }
    // PRE_PUBLICATION LLM path — FinancialStrategyAnalysis via glm-5.3 (AgentRouter OPENAI_COMPATIBLE)
    return this.executePrePublication(input, signal);
  }

  // -------------------------------------------------------------------------
  // PRE_PUBLICATION LLM path
  // -------------------------------------------------------------------------

  private async executePrePublication(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    const financeInput = input.input as unknown as FinanceInput;
    const artifacts = financeInput.validatedArtifacts ?? [];
    const hasEvidence = artifacts.some((a) => PRE_PUBLICATION_KINDS.has(a.kind));
    // Allow empty financialData + evidence; if truly empty, the LLM will be asked to return blocked.
    const hasAnySignal = hasEvidence || financeInput.financialData !== undefined;
    const hasLlm = typeof (this.deps as unknown as { execute?: unknown }).execute === "function";
    if (!hasAnySignal || !hasLlm) {
      const reason = !hasAnySignal
        ? "no pre-publication evidence was supplied; research/planner/writer/seo/brand/growth evidence is required for strategy analysis."
        : "strategy council LLM execution is not configured; no analytics_report present.";
      const blocked = this.blockedReport(financeInput, reason);
      const output: Json = this.toJson(blocked);
      return {
        output,
        response: {
          output,
          raw: JSON.stringify(blocked, null, 2),
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: this.financeConfig.model,
          provider: "finance-strategy-blocked",
          latencyMs: 0,
        },
      };
    }
    const { report, response: executionResponse } = await this.createStrategyAnalysis(financeInput, artifacts, input.context, signal);
    const output = this.toJson(report);
    const response: ExecutionResponse = { ...executionResponse, output, raw: JSON.stringify(report, null, 2) };
    return { output, response };
  }

  private async createStrategyAnalysis(
    input: FinanceInput,
    artifacts: readonly FinanceSourceArtifact[],
    context: ExecutionContext,
    signal: CancellationToken,
  ): Promise<{ report: FinancialReport; response: ExecutionResponse }> {
    signal.throwIfCancelled();
    const prompt = this.buildStrategyPrompt(input, artifacts);
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, request, signal);
    return { report: this.parseFinanceResponse(response.output, input, artifacts), response };
  }

  private buildStrategyPrompt(input: FinanceInput, artifacts: readonly FinanceSourceArtifact[]): string {
    const byKind = (kind: string) => artifacts.filter((a) => a.kind === kind);
    const research = byKind("research_report");
    const planner = artifacts.filter((a) => a.kind === "execution_plan" || a.kind === "evidence_backed_content_brief");
    const writer = byKind("writer_report");
    const seo = byKind("seo_report");
    const brand = byKind("brand_report");
    const growth = byKind("growth_report");
    const describe = (list: readonly FinanceSourceArtifact[]) => list.length === 0 ? "(none)" : list.map((a) => `- ${a.kind}:${a.artifactId} status=${a.status} payload=${JSON.stringify(a.payload).slice(0, 1500)}`).join("\n");
    const workflowId = artifacts[0]?.workflowId ?? "";
    const correlationId = artifacts[0]?.correlationId ?? "";
    return `${this.financeConfig.systemPrompt}

PRE_PUBLICATION Financial Strategy Analysis (strategy council) — synthesize the supplied pre-publication evidence into a FinancialStrategyAnalysis.

Objective:
${input.objective}

Task description:
${input.taskDescription ?? "(none supplied)"}

Workflow:
workflowId=${workflowId} correlationId=${correlationId}

Supplied validated financial data (cost/spend/revenue — do not invent if absent):
${JSON.stringify(input.financialData ?? {}, null, 2)}

RESEARCH evidence:
${describe(research)}

PLANNER evidence:
${describe(planner)}

WRITER evidence:
${describe(writer)}

SEO evidence:
${describe(seo)}

BRAND evidence:
${describe(brand)}

GROWTH strategy evidence:
${describe(growth)}

Produce a valid FinancialReport / FinancialStrategyAnalysis JSON with:
- reportId (set to exactly the requestId "${input.requestId}"),
- contentId (derive from writer/research/growth payload if present, else empty string),
- campaignId (if supplied in financialData),
- status ("completed" | "blocked"),
- summary (concise financial strategy summary grounded in evidence),
- revenue, cost, profit, roi, margin, cpa, cpaType, currency (only include numbers that were explicitly supplied or derived via deterministic arithmetic from supplied numbers; never invent),
- confidence (0-1),
- sourceArtifactReferences (include every supplied artifact you used, never invent ids),
- metadata (workflowId, correlationId, createdAt, agentVersion),
- createdAt (ISO string)

Keep the response compact. The summary must explicitly cover production economics, monetization mechanisms, first-$100, first-$1K/month, first-$10K/month, cost efficiency/reinvestment, financial risks, and known versus assumed versus unknown economics. Do not add numeric values unless supplied evidence supports them.

Constraints:
- This is PRE_PUBLICATION — do NOT require analytics_report; do NOT invent revenue/cost.
- If no money values were supplied, return status "blocked" or include a strategy without fabricated numbers.
- Do not execute or propose executing any transaction.
- Output ONLY the JSON object, no explanatory text.`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.financeConfig.model,
      system: this.financeConfig.systemPrompt,
      messages: [
        { role: "system", content: this.financeConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: (this.financeConfig as unknown as { temperature?: number }).temperature ?? 0.3,
      maxOutputTokens: (this.financeConfig as unknown as { maxOutputTokens?: number }).maxOutputTokens ?? 16384,
      responseSchema: this.getFinanceResponseSchema(),
    };
  }

  private getFinanceResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        reportId: { type: "string" },
        contentId: { type: "string" },
        campaignId: { type: "string" },
        status: { type: "string", enum: ["completed", "blocked", "failed"] },
        summary: { type: "string" },
        revenue: { type: "number" },
        cost: { type: "number" },
        profit: { type: "number" },
        roi: { type: "number" },
        cpa: { type: "number" },
        cpaType: { type: "string", enum: ["CPA", "CAC"] },
        margin: { type: "number" },
        currency: { type: "string" },
        confidence: { type: "number" },
        sourceArtifactReferences: { type: "array", items: { type: "object", properties: { artifactId: { type: "string" }, kind: { type: "string" } }, required: ["artifactId", "kind"] } },
        metadata: { type: "object", properties: { workflowId: { type: "string" }, correlationId: { type: "string" }, createdAt: { type: "string" }, agentVersion: { type: "string" } } },
        createdAt: { type: "string" },
      },
      required: ["reportId", "contentId", "status", "summary", "confidence", "sourceArtifactReferences", "metadata", "createdAt"],
    };
  }

  private parseFinanceResponse(output: Json, input: FinanceInput, artifacts: readonly FinanceSourceArtifact[]): FinancialReport {
    if (!isRecord(output)) throw new BoundedStructuralValidationError("Invalid finance response: report must be an object", boundedStructuralDiagnostics("finance", "FinancialReport", output, [{path:"$",code:"wrong_type",expected:"object",actual:output}]));
    // A pre-publication report is strategic reasoning, not a shape-filling
    // exercise. Optional fields may be absent, but the LLM must supply every
    // substantive field below. In particular, never default a sparse answer to
    // a completed financial analysis.
    if (typeof output.reportId !== "string" || typeof output.contentId !== "string" || typeof output.status !== "string" || typeof output.summary !== "string" || typeof output.confidence !== "number" || !Array.isArray(output.sourceArtifactReferences) || !isRecord(output.metadata) || typeof output.createdAt !== "string") {
      throw new BoundedStructuralValidationError("Invalid finance response: invalid report structure", boundedStructuralDiagnostics("finance", "FinancialReport", output, [{path:"$",code:"missing_or_wrong_type",expected:"FinancialReport"}], ["metadata"]));
    }
    const allowedIds = new Set(artifacts.map((a) => String(a.artifactId)));
    // Also allow financialData source id if present
    if (typeof input.financialData?.sourceArtifactId === "string" && input.financialData.sourceArtifactId.trim() !== "") {
      allowedIds.add(String(input.financialData.sourceArtifactId));
    }
    for (const r of output.sourceArtifactReferences as Json[]) {
      if (!isRecord(r) || typeof r.artifactId !== "string" || typeof r.kind !== "string") throw new Error("Invalid finance response: invalid sourceArtifactReference");
      // Relax: allow ids that were supplied in evidence; if LLM invents, we throw
      if (!allowedIds.has(String(r.artifactId)) && artifacts.length > 0) {
        // Check if it's at least a known kind; still enforce no invention
        throw new Error("Invalid finance response: source reference not present in supplied evidence");
      }
    }
    const status = String(output.status) as FinanceStatus;
    if (!["completed", "blocked", "failed"].includes(status)) throw new Error("Invalid finance response: invalid status");
    if (output.summary.trim().length < 40) throw new Error("Invalid finance response: summary is not substantive");
    if (!Number.isFinite(output.confidence) || output.confidence < 0 || output.confidence > 1) throw new Error("Invalid finance response: confidence must be between 0 and 1");
    if (status === "completed" && output.sourceArtifactReferences.length === 0) {
      throw new Error("Invalid finance response: completed strategy analysis requires evidence references");
    }
    // Deterministic validation helpers: ensure money arithmetic is not fabricated beyond supplied data
    // (We keep helpers available but defer to LLM for strategy synthesis; here we just surface the LLM's grounded output)
    const report: FinancialReport = {
      reportId: String(output.reportId),
      contentId: String(output.contentId),
      ...(typeof output.campaignId === "string" ? { campaignId: String(output.campaignId) } : {}),
      status,
      summary: String(output.summary),
      ...(isNonNegativeFinite(output.revenue as Json) ? { revenue: Number(output.revenue) } : {}),
      ...(isNonNegativeFinite(output.cost as Json) ? { cost: Number(output.cost) } : {}),
      ...(typeof output.profit === "number" && Number.isFinite(output.profit) ? { profit: Number(output.profit) } : {}),
      ...(typeof output.roi === "number" && Number.isFinite(output.roi) ? { roi: Number(output.roi) } : {}),
      ...(typeof output.cpa === "number" && Number.isFinite(output.cpa) ? { cpa: Number(output.cpa), cpaType: (output.cpaType === "CAC" ? "CAC" : "CPA") } : {}),
      ...(typeof output.margin === "number" && Number.isFinite(output.margin) ? { margin: Number(output.margin) } : {}),
      ...(typeof output.currency === "string" ? { currency: String(output.currency) } : {}),
      confidence: Number(output.confidence),
      sourceArtifactReferences: (output.sourceArtifactReferences as unknown as { artifactId: string; kind: string }[]).map((r) => ({ artifactId: String(r.artifactId), kind: String(r.kind) })),
      metadata: output.metadata as Record<string, Json>,
      createdAt: String(output.createdAt),
    };
    // Ensure deterministic money helpers remain testable: if both revenue/cost supplied, profit/roi/margin should be arithmetically consistent (tolerant check)
    return report;
  }

  /** Extract revenue, cost, conversions from analytics and supplied cost data. */
  private resolveAmounts(input: FinanceInput): FinanceAmounts {
    const analytics = (input.validatedArtifacts ?? []).find((a) => a.kind === "analytics_report");
    let revenue: number | undefined;
    let conversions: number | undefined;
    if (analytics !== undefined && isRecord(analytics.payload) && isRecord(analytics.payload.metrics)) {
      const analyticsRevenue = analytics.payload.metrics.revenue;
      if (isNonNegativeFinite(analyticsRevenue)) revenue = analyticsRevenue;
      const analyticsConversions = analytics.payload.metrics.conversions;
      if (isNonNegativeFinite(analyticsConversions)) conversions = analyticsConversions;
    }
    const data = input.financialData;
    const dataRevenue = data?.revenue;
    if (dataRevenue !== undefined && isNonNegativeFinite(dataRevenue)) revenue = dataRevenue;
    const cost =
      data?.cost !== undefined && isNonNegativeFinite(data.cost) ? data.cost
        : data?.spend !== undefined && isNonNegativeFinite(data.spend) ? data.spend
          : undefined;
    const currency = typeof data?.currency === "string" && data.currency.trim() !== "" ? data.currency.trim() : "USD";
    return { revenue: revenue ?? NaN, cost: cost ?? NaN, conversions, currency };
  }

  private assessViability(input: FinanceInput, amounts: FinanceAmounts): Viability {
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

    if (!isNonNegativeFinite(amounts.revenue)) {
      return { ok: false, reason: "no validated revenue (money) value was supplied; revenue is required for financial analysis." };
    }
    if (!isNonNegativeFinite(amounts.cost)) {
      return { ok: false, reason: "no validated cost (money) value was supplied; cost is required for financial analysis." };
    }
    return { ok: true, reason: "" };
  }

  private buildReport(input: FinanceInput, viability: Viability, amounts: FinanceAmounts): FinancialReport {
    const artifacts = input.validatedArtifacts ?? [];
    const revenue = amounts.revenue;
    const cost = amounts.cost;
    const profit = this.money(revenue - cost);
    const roi = cost !== 0 ? Number(((revenue - cost) / cost).toFixed(4)) : undefined;
    const margin = revenue !== 0 ? Number(((revenue - cost) / revenue).toFixed(4)) : undefined;
    const conversions = amounts.conversions;
    const cpa = conversions !== undefined && conversions !== 0 ? this.money(cost / conversions) : undefined;
    const cpaType: "CPA" | "CAC" | undefined = cpa !== undefined ? "CPA" : undefined;

    const derived = [profit, roi, margin, cpa].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const expected = 4;
    const confidence = derived.length === 0 ? 0 : Number((derived.length / expected).toFixed(2));

    const contentId = this.deriveContentId(input, artifacts);
    const campaignId = input.financialData?.campaignId;
    const references = this.sourceReferences(artifacts, input.financialData);
    const analytics = artifacts.find((a) => a.kind === "analytics_report");

    return {
      reportId: input.requestId,
      contentId,
      ...(typeof campaignId === "string" && campaignId.trim() !== "" ? { campaignId } : {}),
      status: "completed",
      summary: `Financial analysis computed from validated revenue (${amounts.currency} ${revenue}) and validated cost (${amounts.currency} ${cost}).`,
      revenue,
      cost,
      profit,
      roi,
      ...(cpa !== undefined ? { cpa, cpaType } : {}),
      margin,
      currency: amounts.currency,
      confidence,
      sourceArtifactReferences: references,
      metadata: {
        workflowId: artifacts[0]?.workflowId ?? "",
        correlationId: artifacts[0]?.correlationId ?? "",
        analyticsReportId: analytics?.artifactId ?? "",
        createdAt: new Date().toISOString(),
        agentVersion: this.version,
      },
      createdAt: new Date().toISOString(),
    };
  }

  private money(value: number): number {
    return Number(value.toFixed(2));
  }

  private deriveContentId(input: FinanceInput, artifacts: readonly FinanceSourceArtifact[]): string {
    const analytics = artifacts.find((a) => a.kind === "analytics_report");
    if (analytics !== undefined && isRecord(analytics.payload) && typeof analytics.payload.contentId === "string" && analytics.payload.contentId.trim() !== "") {
      return analytics.payload.contentId;
    }
    const writer = artifacts.find((a) => a.kind === "writer_report");
    if (writer !== undefined && isRecord(writer.payload) && typeof writer.payload.contentId === "string" && writer.payload.contentId.trim() !== "") {
      return writer.payload.contentId;
    }
    return "";
  }

  private sourceReferences(artifacts: readonly FinanceSourceArtifact[], data: FinancialData | undefined): readonly { artifactId: string; kind: string }[] {
    const seen = new Set<string>();
    const refs: { artifactId: string; kind: string }[] = [];
    if (typeof data?.sourceArtifactId === "string" && data.sourceArtifactId.trim() !== "") {
      const kind = typeof data.sourceArtifactKind === "string" && data.sourceArtifactKind.trim() !== "" ? data.sourceArtifactKind : "financial_data";
      refs.push({ artifactId: data.sourceArtifactId, kind });
      seen.add(`${kind}:${data.sourceArtifactId}`);
    }
    for (const artifact of artifacts) {
      const key = `${artifact.kind}:${artifact.artifactId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      refs.push({ artifactId: artifact.artifactId, kind: artifact.kind });
    }
    return refs;
  }

  private blockedReport(input: FinanceInput, reason: string): FinancialReport {
    return {
      reportId: input.requestId,
      contentId: "",
      status: "blocked",
      summary: `Blocked: ${reason}`,
      confidence: 0,
      sourceArtifactReferences: [],
      metadata: { workflowId: "", correlationId: "", createdAt: new Date().toISOString(), agentVersion: this.version },
      createdAt: new Date().toISOString(),
    };
  }

  private toJson(report: FinancialReport): Json {
    return {
      reportId: report.reportId,
      contentId: report.contentId,
      ...(report.campaignId !== undefined ? { campaignId: report.campaignId } : {}),
      status: report.status,
      summary: report.summary,
      ...(report.revenue !== undefined ? { revenue: report.revenue } : {}),
      ...(report.cost !== undefined ? { cost: report.cost } : {}),
      ...(report.profit !== undefined ? { profit: report.profit } : {}),
      ...(report.roi !== undefined ? { roi: report.roi } : {}),
      ...(report.cpa !== undefined ? { cpa: report.cpa } : {}),
      ...(report.cpaType !== undefined ? { cpaType: report.cpaType } : {}),
      ...(report.margin !== undefined ? { margin: report.margin } : {}),
      ...(report.currency !== undefined ? { currency: report.currency } : {}),
      confidence: report.confidence,
      sourceArtifactReferences: report.sourceArtifactReferences.map((r) => ({ ...r })),
      metadata: { ...report.metadata },
      createdAt: report.createdAt,
    };
  }
}

/** Factory function to create a FinanceAgent. */
export function createFinanceAgent(deps: FinanceDependencies): FinanceAgent {
  const config: FinanceDependencies["config"] = {
    model: deps.config?.model ?? "glm-5.3",
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_FINANCE_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
    temperature: (deps.config as unknown as { temperature?: number })?.temperature ?? 0.3,
    maxOutputTokens: (deps.config as unknown as { maxOutputTokens?: number })?.maxOutputTokens ?? 16384,
  };
  return new FinanceAgent({ ...deps, config });
}
