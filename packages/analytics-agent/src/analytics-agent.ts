/**
 * Analytics Agent implementation.
 *
 * Deterministic agent: validates that a completed published_report with matching
 * runtime evidence is available (and only after the brand gate approved), then
 * requests the `analytics.fetch` capability through the injected capability
 * execution boundary. It never calls a provider or network directly and never
 * fabricates metrics without matching provider execution evidence.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";
import { ANALYTICS_CAPABILITY_ID, ANALYTICS_PLATFORM } from "@ai-media-factory/tool-framework";
import type {
  AnalyticsDependencies,
  AnalyticsInput,
  AnalyticsSourceArtifact,
  PerformanceReport,
} from "./types.js";

type JsonRecord = { [key: string]: Json };

const DEFAULT_PLATFORM = ANALYTICS_PLATFORM;

/** Default analytics system message (informational; the agent is deterministic). */
export const DEFAULT_ANALYTICS_SYSTEM_PROMPT = `You are an analytics specialist. Validate the published content and request the analytics.fetch capability through the runtime boundary. Never claim fetched metrics unless a matching runtime evidence item confirms the provider returned them.`;

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAnalyticsSourceArtifact(value: Json): value is JsonRecord & AnalyticsSourceArtifact {
  return isRecord(value)
    && (typeof value.artifactId === "string" || typeof value.artifactId === "number")
    && typeof value.kind === "string"
    && typeof value.producerAgent === "string"
    && typeof value.workflowId === "string"
    && typeof value.correlationId === "string"
    && typeof value.status === "string"
    && isRecord(value.payload);
}

function isAnalyticsInput(value: Json): value is JsonRecord & AnalyticsInput {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "") {
    return false;
  }
  if (value.taskDescription !== undefined && typeof value.taskDescription !== "string") return false;
  if (value.validatedArtifacts !== undefined
    && !(Array.isArray(value.validatedArtifacts)
      && value.validatedArtifacts.every((item) => isAnalyticsSourceArtifact(item)))) {
    return false;
  }
  return true;
}

/** Describes why analytics cannot be fetched, or null when viable. */
interface Viability {
  ok: boolean;
  reason: string;
}

export class AnalyticsAgent extends BaseAgent {
  readonly id: AgentId = "analytics";
  readonly name = "Analytics Agent";
  readonly version = "1.0.0";

  private readonly analyticsConfig: AnalyticsDependencies["config"];

  constructor(deps: AnalyticsDependencies) {
    super(deps);
    this.analyticsConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isAnalyticsInput(input.input)) {
      throw new Error("Invalid analytics input: expected a validated content chain");
    }
    const viability = this.assessViability(input.input);
    const published = this.findPublished(input.input);
    let executions: readonly CapabilityResult[] = [];
    if (viability.ok) {
      const request = this.buildCapabilityRequest(input.input, published);
      if (request !== null) {
        executions = await this.runCapabilities([request]);
      }
    }
    const execution = executions[0];
    const report = this.buildReport(input.input, viability, execution, published);
    const baseOutput = this.toJson(report);
    const output: Json = isRecord(baseOutput)
      ? { ...baseOutput, capabilityExecutions: JSON.parse(JSON.stringify(executions)) as Json[] }
      : baseOutput;
    return {
      output,
      response: {
        output,
        raw: JSON.stringify(report, null, 2),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        model: this.analyticsConfig.model,
        provider: "analytics-deterministic",
        latencyMs: 0,
      },
    };
  }

  /** Gate: analytics may only be fetched for a completed, evidenced publication. */
  private assessViability(input: AnalyticsInput): Viability {
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

    const brand = artifacts.find((a) => a.kind === "brand_report");
    if (brand !== undefined && isRecord(brand.payload) && brand.payload.status !== "approved") {
      return { ok: false, reason: "the brand gate is not approved." };
    }

    const published = artifacts.find((a) => a.kind === "published_report");
    if (published === undefined) return { ok: false, reason: "a published report is required but is missing." };
    if (!isRecord(published.payload)) return { ok: false, reason: "the published report payload is malformed." };
    if (published.payload.status !== "completed") {
      return { ok: false, reason: `the publication is ${String(published.payload.status)} and cannot be analyzed.` };
    }
    if (published.payload.executionEvidencePresent !== true) {
      return { ok: false, reason: "the publication lacks matching runtime evidence of publishing." };
    }
    if (typeof published.payload.publicationId !== "string" || published.payload.publicationId.trim() === "") {
      return { ok: false, reason: "the publication lacks a publication identifier." };
    }

    return { ok: true, reason: "" };
  }

  private findPublished(input: AnalyticsInput): AnalyticsSourceArtifact | undefined {
    return (input.validatedArtifacts ?? []).find((a) => a.kind === "published_report");
  }

  /** Build the `analytics.fetch` capability request from the publication. */
  private buildCapabilityRequest(input: AnalyticsInput, published: AnalyticsSourceArtifact | undefined): CapabilityRequest | null {
    const artifacts = input.validatedArtifacts ?? [];
    const lead = artifacts[0];
    const publicationId = published !== undefined && isRecord(published.payload) && typeof published.payload.publicationId === "string"
      ? published.payload.publicationId
      : "";
    if (publicationId === "") return null;

    return {
      requestId: `analytics-${input.requestId}`,
      capabilityId: ANALYTICS_CAPABILITY_ID,
      operation: "fetch",
      agentId: this.id,
      workflowId: lead?.workflowId ?? `workflow-${input.requestId}`,
      correlationId: lead?.correlationId ?? `correlation-${input.requestId}`,
      input: {
        publicationId,
        platform: this.analyticsConfig.platform,
      },
      requestedAt: new Date().toISOString(),
    };
  }

  /** Deterministically produce the performance report from the capability execution. */
  private buildReport(input: AnalyticsInput, viability: Viability, execution: CapabilityResult | undefined, published: AnalyticsSourceArtifact | undefined): PerformanceReport {
    const artifacts = input.validatedArtifacts ?? [];
    const taskDescription = input.taskDescription ?? "Fetch and analyze performance metrics";
    const platform = this.analyticsConfig.platform;

    if (!viability.ok) {
      return this.blockedReport(input, taskDescription, platform, `Blocked: ${viability.reason}`);
    }

    if (execution === undefined || execution.status !== "success") {
      return this.blockedReport(input, taskDescription, platform, `Blocked: ${this.failureReason(execution)}`);
    }

    const evidence = execution.evidence;
    const output = isRecord(execution.output) ? execution.output : {};
    const publicationId = published !== undefined && isRecord(published.payload) && typeof published.payload.publicationId === "string" ? published.payload.publicationId : "";
    const outputPublicationId = typeof output.publicationId === "string" ? output.publicationId : "";
    const retrievedAt = typeof output.retrievedAt === "string" ? output.retrievedAt : "";
    const providerId = typeof output.providerId === "string" ? output.providerId : "";
    const metrics = isRecord(output.metrics) ? output.metrics : {};
    const sourceId = typeof evidence?.publicationId === "string" && evidence.publicationId !== "" ? evidence.publicationId : providerId && providerId !== "" ? providerId : "";

    const isGrantedCompletion = evidence !== undefined
      && evidence.capabilityId === ANALYTICS_CAPABILITY_ID
      && evidence.agentId === this.id
      && evidence.workflowId === (artifacts[0]?.workflowId ?? `workflow-${input.requestId}`)
      && evidence.correlationId === (artifacts[0]?.correlationId ?? `correlation-${input.requestId}`)
      && evidence.succeeded === true
      && evidence.platform === platform;

    if (!isGrantedCompletion || publicationId === "" || outputPublicationId === "" || retrievedAt === "") {
      return this.blockedReport(input, taskDescription, platform, "Blocked: the analytics.fetch execution did not return matching completion evidence.");
    }

    const contentId = this.deriveContentId(input, published, artifacts);
    return {
      reportId: input.requestId,
      contentId,
      publicationId,
      platform,
      retrievedAt,
      status: "completed",
      summary: "Performance metrics fetched through the analytics.fetch capability with matching execution evidence.",
      metrics,
      source: "provider",
      sourceId,
      executionEvidencePresent: true,
      capabilityExecutions: execution === undefined ? [] : [execution],
      metadata: { workflowId: artifacts[0]?.workflowId ?? "", correlationId: artifacts[0]?.correlationId ?? "", createdAt: retrievedAt, agentVersion: this.version },
      createdAt: retrievedAt,
    };
  }

  private deriveContentId(input: AnalyticsInput, published: AnalyticsSourceArtifact | undefined, artifacts: readonly AnalyticsSourceArtifact[]): string {
    const writer = artifacts.find((artifact) => artifact.kind === "writer_report");
    if (writer !== undefined && isRecord(writer.payload) && typeof writer.payload.contentId === "string" && writer.payload.contentId.trim() !== "") {
      return writer.payload.contentId;
    }
    if (published !== undefined && isRecord(published.payload) && typeof published.payload.sourceVideoId === "string" && published.payload.sourceVideoId.trim() !== "") {
      return published.payload.sourceVideoId;
    }
    return "";
  }

  private blockedReport(input: AnalyticsInput, taskDescription: string, platform: string, summary: string): PerformanceReport {
    return {
      reportId: input.requestId,
      contentId: "",
      publicationId: "",
      platform,
      retrievedAt: "",
      status: "blocked",
      summary,
      metrics: {},
      source: "none",
      sourceId: "",
      executionEvidencePresent: false,
      metadata: { workflowId: "", correlationId: "", createdAt: new Date().toISOString(), agentVersion: this.version },
      capabilityExecutions: [],
      createdAt: new Date().toISOString(),
    };
  }

  private failureReason(execution: CapabilityResult | undefined): string {
    if (execution === undefined) return "analytics.fetch was not executed or capability execution is not configured.";
    if (execution.status === "blocked") return `analytics.fetch was blocked: ${"reason" in execution ? execution.reason : "unknown"}`;
    if (execution.status === "failed") {
      const error = "error" in execution ? execution.error : undefined;
      return `analytics.fetch failed: ${error?.message ?? "unknown"}`;
    }
    return "analytics.fetch did not succeed.";
  }

  private toJson(report: PerformanceReport): Json {
    return {
      reportId: report.reportId,
      contentId: report.contentId,
      publicationId: report.publicationId,
      platform: report.platform,
      retrievedAt: report.retrievedAt,
      status: report.status,
      summary: report.summary,
      metrics: report.metrics,
      source: report.source,
      sourceId: report.sourceId,
      executionEvidencePresent: report.executionEvidencePresent,
      metadata: report.metadata,
      createdAt: report.createdAt,
    };
  }
}

/** Factory function to create an AnalyticsAgent. */
export function createAnalyticsAgent(deps: AnalyticsDependencies): AnalyticsAgent {
  const config: AnalyticsDependencies["config"] = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    platform: deps.config?.platform ?? DEFAULT_PLATFORM,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_ANALYTICS_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new AnalyticsAgent({ ...deps, config });
}