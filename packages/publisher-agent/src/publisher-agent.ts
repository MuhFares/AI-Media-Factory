/**
 * Publisher Agent implementation.
 *
 * Deterministic agent: validates the approved content chain (completed video
 * with matching runtime evidence, brand approved, final QA passed, no blocked
 * or failed upstream artifact) and requests the `publish.<platform>` capability
 * through the injected capability execution boundary. It never calls a provider
 * or network directly and never fabricates a published URL/ID without matching
 * runtime evidence.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";
import { PUBLISH_CAPABILITY_ID, PUBLISH_PLATFORM, idempotencyKeyFor } from "@ai-media-factory/tool-framework";
import type {
  PublishStatus,
  PublisherDependencies,
  PublisherInput,
  PublishedReport,
  PublisherSourceArtifact,
} from "./types.js";

type JsonRecord = { [key: string]: Json };

const DEFAULT_PLATFORM = PUBLISH_PLATFORM;

/** Default publisher system message (informational; the agent is deterministic). */
export const DEFAULT_PUBLISHER_SYSTEM_PROMPT = `You are a publisher. Validate the approved content chain and request the publish.youtube capability through the runtime boundary. Never claim a publication succeeded unless a matching runtime evidence item confirms it, and never publish invalid content.`;

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPublisherSourceArtifact(value: Json): value is JsonRecord & PublisherSourceArtifact {
  return isRecord(value)
    && (typeof value.artifactId === "string" || typeof value.artifactId === "number")
    && typeof value.kind === "string"
    && typeof value.producerAgent === "string"
    && typeof value.workflowId === "string"
    && typeof value.correlationId === "string"
    && typeof value.status === "string"
    && isRecord(value.payload);
}

function isPublisherInput(value: Json): value is JsonRecord & PublisherInput {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "") {
    return false;
  }
  if (value.taskDescription !== undefined && typeof value.taskDescription !== "string") {
    return false;
  }
  if (value.instructions !== undefined && typeof value.instructions !== "string") {
    return false;
  }
  if (value.validatedArtifacts !== undefined
    && !(Array.isArray(value.validatedArtifacts)
      && value.validatedArtifacts.every((item) => isPublisherSourceArtifact(item)))) {
    return false;
  }
  return true;
}

/** Describes why the content chain is not publishable, or null when viable. */
interface Viability {
  ok: boolean;
  reason: string;
}

export class PublisherAgent extends BaseAgent {
  readonly id: AgentId = "publisher";
  readonly name = "Publisher Agent";
  readonly version = "1.0.0";

  private readonly publisherConfig: PublisherDependencies["config"];

  constructor(deps: PublisherDependencies) {
    super(deps);
    this.publisherConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isPublisherInput(input.input)) {
      throw new Error("Invalid publisher input: expected a validated content chain");
    }
    const viability = this.assessViability(input.input);
    let executions: readonly CapabilityResult[] = [];
    if (viability.ok) {
      const request = this.buildCapabilityRequest(input.input);
      if (request !== null) {
        executions = await this.runCapabilities([request]);
      }
    }
    const execution = executions[0];
    const report = this.buildReport(input.input, viability, execution);
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
        model: this.publisherConfig.model,
        provider: "publisher-deterministic",
        latencyMs: 0,
      },
    };
  }

  /** Gate: only a validated, approved content chain may be published. */
  private assessViability(input: PublisherInput): Viability {
    const artifacts = input.validatedArtifacts ?? [];
    if (artifacts.length === 0) return { ok: false, reason: "the content chain is empty." };

    const workflowIds = new Set(artifacts.map((a) => a.workflowId));
    const correlationIds = new Set(artifacts.map((a) => a.correlationId));
    if (workflowIds.size !== 1) return { ok: false, reason: "the workflowId is inconsistent across the content chain." };
    if (correlationIds.size !== 1) return { ok: false, reason: "the correlationId is inconsistent across the content chain." };

    const blocked = artifacts.find((a) => a.status === "blocked" || a.status === "failed");
    if (blocked !== undefined) {
      return { ok: false, reason: `an upstream artifact (${blocked.kind}) is ${blocked.status} and cannot be published.` };
    }

    const brand = artifacts.find((a) => a.kind === "brand_report");
    if (brand !== undefined && isRecord(brand.payload) && brand.payload.status !== "approved") {
      return { ok: false, reason: "the brand gate is not approved." };
    }

    // Publishing must only follow a passing final QA gate.
    const qa = artifacts.find((a) => a.kind === "qa_report");
    if (qa === undefined || !isRecord(qa.payload)) {
      return { ok: false, reason: "a QA gate is required before publishing." };
    }
    if (qa.payload.status !== "passed") {
      return { ok: false, reason: `the QA gate is ${String(qa.payload.status)} and cannot precede publishing.` };
    }

    const video = artifacts.find((a) => a.kind === "video_report");
    if (video === undefined) return { ok: false, reason: "a completed video artifact is required but is missing." };
    if (!isRecord(video.payload)) return { ok: false, reason: "the video artifact payload is malformed." };
    if (video.payload.status !== "completed") {
      return { ok: false, reason: `the video is ${String(video.payload.status)} and cannot be published.` };
    }
    if (video.payload.executionEvidencePresent !== true) {
      return { ok: false, reason: "the video lacks matching runtime evidence of video generation." };
    }
    if (typeof video.payload.videoId !== "string" || video.payload.videoId.trim() === "") {
      return { ok: false, reason: "the video lacks a video identifier." };
    }

    return { ok: true, reason: "" };
  }

  /** Build the `publish.<platform>` capability request from the content chain. */
  private buildCapabilityRequest(input: PublisherInput): CapabilityRequest | null {
    const artifacts = input.validatedArtifacts ?? [];
    const lead = artifacts[0];
    const video = artifacts.find((a) => a.kind === "video_report");
    const writer = artifacts.find((a) => a.kind === "writer_report");
    const videoId = video !== undefined && isRecord(video.payload) && typeof video.payload.videoId === "string" ? video.payload.videoId : "";
    if (videoId === "") return null;

    const title = this.deriveTitle(input, artifacts, writer);
    const assetId = videoId;
    const idempotencyKey = idempotencyKeyFor(lead?.workflowId ?? `workflow-${input.requestId}`, assetId, this.publisherConfig.platform);

    return {
      requestId: `publish-${input.requestId}`,
      capabilityId: PUBLISH_CAPABILITY_ID,
      operation: "publish",
      agentId: this.id,
      workflowId: lead?.workflowId ?? `workflow-${input.requestId}`,
      correlationId: lead?.correlationId ?? `correlation-${input.requestId}`,
      input: {
        assetId,
        title,
        ...(input.instructions === undefined ? {} : { description: input.instructions }),
        idempotencyKey,
        metadata: { workflowId: lead?.workflowId ?? "", correlationId: lead?.correlationId ?? "" },
      },
      requestedAt: new Date().toISOString(),
    };
  }

  /** Derive a bounded, safe title for the publication from writer/seo context. */
  private deriveTitle(input: PublisherInput, artifacts: readonly PublisherSourceArtifact[], writer: PublisherSourceArtifact | undefined): string {
    const seo = artifacts.find((artifact) => artifact.kind === "seo_report");
    const seoTitle = seo !== undefined && isRecord(seo.payload) && typeof seo.payload.optimizedTitle === "string"
      ? seo.payload.optimizedTitle
      : "";
    const writerTitle = writer !== undefined && isRecord(writer.payload) && typeof writer.payload.title === "string"
      ? writer.payload.title
      : "";
    const title = seoTitle || writerTitle || "Published Media Content";
    return title.slice(0, 200).trim();
  }

  /** Deterministically produce the published report from the capability execution. */
  private buildReport(input: PublisherInput, viability: Viability, execution: CapabilityResult | undefined): PublishedReport {
    const artifacts = input.validatedArtifacts ?? [];
    const taskDescription = input.taskDescription ?? "Publish the approved content";
    const platform = this.publisherConfig.platform;

    if (!viability.ok) {
      return this.blockedReport(input, taskDescription, platform, `Blocked: ${viability.reason}`);
    }

    if (execution === undefined || execution.status !== "success") {
      const reason = this.failureReason(execution);
      return this.blockedReport(input, taskDescription, platform, `Blocked: ${reason}`);
    }

    const evidence = execution.evidence;
    const output = isRecord(execution.output) ? execution.output : {};
    const publicationId = typeof output.publicationId === "string" ? output.publicationId : "";
    const publishedUrl = typeof output.url === "string" ? output.url : "";
    const publishedAt = typeof output.publishedAt === "string" ? output.publishedAt : "";
    const providerId = typeof output.providerId === "string" ? output.providerId : "";
    const idempotencyKey = typeof output.idempotencyKey === "string" ? output.idempotencyKey : "";

    const isGrantedCompletion = evidence !== undefined
      && evidence.capabilityId === PUBLISH_CAPABILITY_ID
      && evidence.agentId === this.id
      && evidence.workflowId === (artifacts[0]?.workflowId ?? `workflow-${input.requestId}`)
      && evidence.correlationId === (artifacts[0]?.correlationId ?? `correlation-${input.requestId}`)
      && evidence.succeeded === true
      && evidence.platform === platform;

    const video = artifacts.find((a) => a.kind === "video_report");
    const sourceVideoId = video !== undefined && isRecord(video.payload) && typeof video.payload.videoId === "string"
      ? video.payload.videoId
      : "";

    if (!isGrantedCompletion || publicationId === "" || publishedUrl === "") {
      return this.blockedReport(
        input,
        taskDescription,
        platform,
        publicationId === ""
          ? "Blocked: the publish.youtube execution did not return a confirmed publication."
          : "Blocked: the publish.youtube execution did not return matching completion evidence.",
      );
    }

    return {
      reportId: input.requestId,
      taskDescription,
      objective: input.objective,
      status: "completed",
      summary: "Content published through the publish.youtube capability with matching completion evidence.",
      publicationId,
      platform,
      idempotencyKey,
      publishedUrl,
      publishedAt,
      sourceVideoId,
      providerId,
      executionEvidencePresent: true,
      capabilityExecutions: execution === undefined ? [] : [execution],
      metadata: { workflowId: artifacts[0]?.workflowId ?? "", correlationId: artifacts[0]?.correlationId ?? "", createdAt: publishedAt, agentVersion: this.version },
      createdAt: publishedAt,
    };
  }

  private blockedReport(input: PublisherInput, taskDescription: string, platform: string, summary: string): PublishedReport {
    return {
      reportId: input.requestId,
      taskDescription,
      objective: input.objective,
      status: "blocked",
      summary,
      publicationId: "",
      platform,
      idempotencyKey: "",
      publishedUrl: "",
      publishedAt: "",
      sourceVideoId: "",
      providerId: "",
      executionEvidencePresent: false,
      metadata: { workflowId: "", correlationId: "", createdAt: new Date().toISOString(), agentVersion: this.version },
      capabilityExecutions: [],
      createdAt: new Date().toISOString(),
    };
  }

  private failureReason(execution: CapabilityResult | undefined): string {
    if (execution === undefined) return "publish.youtube was not executed or capability execution is not configured.";
    if (execution.status === "blocked") return `publish.youtube was blocked: ${"reason" in execution ? execution.reason : "unknown"}`;
    if (execution.status === "failed") {
      const error = "error" in execution ? execution.error : undefined;
      return `publish.youtube failed: ${error?.message ?? "unknown"}`;
    }
    return "publish.youtube did not succeed.";
  }

  private toJson(report: PublishedReport): Json {
    return {
      reportId: report.reportId,
      taskDescription: report.taskDescription,
      objective: report.objective,
      status: report.status,
      summary: report.summary,
      publicationId: report.publicationId,
      platform: report.platform,
      idempotencyKey: report.idempotencyKey,
      publishedUrl: report.publishedUrl,
      publishedAt: report.publishedAt,
      sourceVideoId: report.sourceVideoId,
      providerId: report.providerId,
      executionEvidencePresent: report.executionEvidencePresent,
      metadata: report.metadata,
      createdAt: report.createdAt,
    };
  }
}

/** Factory function to create a PublisherAgent. */
export function createPublisherAgent(deps: PublisherDependencies): PublisherAgent {
  const config: PublisherDependencies["config"] = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    platform: deps.config?.platform ?? DEFAULT_PLATFORM,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_PUBLISHER_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new PublisherAgent({ ...deps, config });
}