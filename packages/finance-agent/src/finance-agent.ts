/**
 * Finance Agent implementation.
 *
 * Deterministic financial analysis specialist. It validates that a completed,
 * evidence-backed analytics_report supplies revenue and that validated cost
 * data was supplied by the caller, then derives profit, ROI, margin, and (where
 * conversions support it) CPA/CAC directly from those amounts. It never invents
 * a money value, never executes a payment/refund/transfer/invoice, never touches
 * an external financial system, calls no capabilities, and imports no concrete
 * agents. Missing revenue or cost yields an explicit blocked state.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
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

/** Default finance system message (informational; the agent is deterministic). */
export const DEFAULT_FINANCE_SYSTEM_PROMPT = `You are a financial analysis specialist. Compute financial metrics only from validated revenue (from the analytics report) and validated, supplied cost data. Never invent, assume, extrapolate, or round-trip a money value. If either revenue or cost is missing, return a blocked report describing the gap. Never execute or suggest executing any financial transaction.`;

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
    model: deps.config?.model ?? "openrouter/auto",
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_FINANCE_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new FinanceAgent({ ...deps, config });
}