/**
 * Thumbnail Agent implementation.
 * Deterministic agent: derives an image generation prompt from the validated
 * content chain and requests the `image.generate` capability through the
 * injected capability execution boundary. It does not call a provider directly
 * and it never claims execution that did not happen.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";
import { IMAGE_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import type {
  ThumbnailAgentDependencies,
  ThumbnailAgentInput,
  ThumbnailReport,
  ThumbnailReportStatus,
  ThumbnailSourceArtifact,
} from "./thumbnail-types.js";

type JsonRecord = { [key: string]: Json };

const DEFAULT_ASPECT_RATIOS: readonly string[] = ["16:9", "9:16", "4:3", "3:4", "1:1"];

/** Default thumbnail system message (informational; the agent is deterministic). */
export const DEFAULT_THUMBNAIL_SYSTEM_PROMPT = `You are a thumbnail designer. Derive an image-generation prompt from the approved content chain and request the image.generate capability through the runtime boundary. Never claim an image was rendered unless a matching runtime evidence item exists.`;

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isThumbnailSourceArtifact(value: Json): value is JsonRecord & ThumbnailSourceArtifact {
  return isRecord(value)
    && (typeof value.artifactId === "string" || typeof value.artifactId === "number")
    && typeof value.kind === "string"
    && typeof value.producerAgent === "string"
    && typeof value.workflowId === "string"
    && typeof value.correlationId === "string"
    && typeof value.status === "string"
    && isRecord(value.payload);
}

function isThumbnailAgentInput(value: Json): value is JsonRecord & ThumbnailAgentInput {
  if (!isRecord(value) || typeof value.requestId !== "string" || typeof value.objective !== "string" || value.objective.trim() === "") {
    return false;
  }
  if (value.taskDescription !== undefined && typeof value.taskDescription !== "string") {
    return false;
  }
  if (value.validatedArtifacts !== undefined
    && !(Array.isArray(value.validatedArtifacts)
      && value.validatedArtifacts.every((item) => isThumbnailSourceArtifact(item)))) {
    return false;
  }
  return true;
}

function stripPrefix(text: string): string {
  return text.trim().replace(/^"|"$/gu, "");
}

export class ThumbnailAgent extends BaseAgent {
  readonly id: AgentId = "thumbnail";
  readonly name = "Thumbnail Agent";
  readonly version = "1.0.0";

  private readonly thumbnailConfig: ThumbnailAgentDependencies["config"];

  constructor(deps: ThumbnailAgentDependencies) {
    super(deps);
    this.thumbnailConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isThumbnailAgentInput(input.input)) {
      throw new Error("Invalid thumbnail input: expected a validated content chain");
    }
    const request = this.buildCapabilityRequest(input.input);
    const executions = request === null ? [] : await this.runCapabilities([request]);
    const execution = executions[0];
    const report = this.buildReport(input.input, execution);
    const baseOutput = this.toJson(report);
    const output: Json = executions.length > 0 && isRecord(baseOutput)
      ? { ...baseOutput, capabilityExecutions: JSON.parse(JSON.stringify(executions)) as Json[] }
      : baseOutput;
    return {
      output,
      response: {
        output,
        raw: JSON.stringify(report, null, 2),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        model: this.thumbnailConfig.model,
        provider: "thumbnail-deterministic",
        latencyMs: 0,
      },
    };
  }

  /** Build the `image.generate` capability request from the content chain, or null when the chain is not viable. */
  private buildCapabilityRequest(input: ThumbnailAgentInput): CapabilityRequest | null {
    const artifacts = input.validatedArtifacts ?? [];
    const seed = this.derivePrompt(input, artifacts);
    if (seed === null) return null;
    const lead = artifacts[0];
    return {
      requestId: `thumbnail-${input.requestId}`,
      capabilityId: IMAGE_GENERATION_CAPABILITY_ID,
      operation: "generate",
      agentId: this.id,
      workflowId: lead?.workflowId ?? `workflow-${input.requestId}`,
      correlationId: lead?.correlationId ?? `correlation-${input.requestId}`,
      input: {
        prompt: seed.prompt,
        aspectRatio: seed.aspectRatio,
      },
      requestedAt: new Date().toISOString(),
    };
  }

  /** Derive a safe, bounded prompt from the writer/seo/brand artifacts. Returns null when core content is missing. */
  private derivePrompt(input: ThumbnailAgentInput, artifacts: readonly ThumbnailSourceArtifact[]): { prompt: string; aspectRatio: string } | null {
    const writer = artifacts.find((artifact) => artifact.kind === "writer_report");
    const seo = artifacts.find((artifact) => artifact.kind === "seo_report");
    if (writer === undefined || !isRecord(writer.payload)) return null;

    const title = typeof writer.payload.title === "string" ? writer.payload.title : "";
    const content = typeof writer.payload.content === "string" ? writer.payload.content : "";
    if (title.trim() === "" && content.trim() === "") return null;

    const seoTitle = seo !== undefined && isRecord(seo.payload) && typeof seo.payload.optimizedTitle === "string"
      ? seo.payload.optimizedTitle
      : title;
    const topic = stripPrefix(seoTitle).slice(0, 120) || stripPrefix(title).slice(0, 120) || "media content";

    const maxPromptLength = this.thumbnailConfig.maxPromptLength;
    let prompt = `A click-worthy thumbnail for an article titled "${topic}". Emphasize clarity, contrast, and a compelling focal point.`;
    if (prompt.length > maxPromptLength) {
      prompt = prompt.slice(0, maxPromptLength);
    }
    const aspectRatio = this.thumbnailConfig.allowedAspectRatios.includes(this.thumbnailConfig.aspectRatio)
      ? this.thumbnailConfig.aspectRatio
      : DEFAULT_ASPECT_RATIOS[0];
    return { prompt, aspectRatio };
  }

  /** Deterministically produce the thumbnail report from the capability execution. */
  private buildReport(input: ThumbnailAgentInput, execution: CapabilityResult | undefined): ThumbnailReport {
    const artifacts = input.validatedArtifacts ?? [];
    const taskDescription = input.taskDescription ?? "Generate a thumbnail for the approved content";

    if (execution === undefined || execution.status !== "success") {
      const reason = this.failureReason(execution);
      return {
        reportId: input.requestId,
        taskDescription,
        objective: input.objective,
        status: "blocked",
        summary: `Blocked: ${reason}`,
        imageId: "",
        imageUrl: "",
        imageTitle: "",
        providerId: "",
        executionEvidencePresent: false,
        metadata: { createdAt: new Date().toISOString(), agentVersion: this.version },
      };
    }

    const evidence = execution.evidence;
    const isGrantedSuccess = evidence !== undefined
      && evidence.capabilityId === IMAGE_GENERATION_CAPABILITY_ID
      && evidence.agentId === this.id
      && evidence.workflowId === (artifacts[0]?.workflowId ?? `workflow-${input.requestId}`)
      && evidence.correlationId === (artifacts[0]?.correlationId ?? `correlation-${input.requestId}`)
      && evidence.succeeded === true;

    const output = isRecord(execution.output) ? execution.output : {};
    const imageId = typeof output.imageId === "string" ? output.imageId : "";
    const imageUrl = typeof output.url === "string" ? output.url : "";
    const imageTitle = typeof output.title === "string" ? output.title : "";
    const providerId = typeof output.providerId === "string" ? output.providerId : "";

    if (!isGrantedSuccess || imageId === "" || imageUrl === "") {
      return {
        reportId: input.requestId,
        taskDescription,
        objective: input.objective,
        status: imageId === "" ? "blocked" : "failed",
        summary: imageId === ""
          ? "Blocked: the image.generate execution did not return a usable image."
          : "Failed: the image.generate execution did not return matching runtime evidence.",
        imageId,
        imageUrl,
        imageTitle,
        providerId,
        executionEvidencePresent: false,
        metadata: { createdAt: new Date().toISOString(), agentVersion: this.version },
      };
    }

    return {
      reportId: input.requestId,
      taskDescription,
      objective: input.objective,
      status: "completed",
      summary: "Thumbnail generated through the image.generate capability with runtime evidence.",
      imageId,
      imageUrl,
      imageTitle,
      providerId,
      executionEvidencePresent: true,
      metadata: { createdAt: new Date().toISOString(), agentVersion: this.version },
    };
  }

  private failureReason(execution: CapabilityResult | undefined): string {
    if (execution === undefined) return "the content chain is not viable for image generation or capability execution is not configured.";
    if (execution.status === "blocked") return `image.generate was blocked: ${"reason" in execution ? execution.reason : "unknown"}`;
    if (execution.status === "failed") return `image.generate failed: ${"error" in execution ? execution.error.message : "unknown"}`;
    return "image.generate did not succeed.";
  }

  private toJson(report: ThumbnailReport): Json {
    return {
      reportId: report.reportId,
      taskDescription: report.taskDescription,
      objective: report.objective,
      status: report.status,
      summary: report.summary,
      imageId: report.imageId,
      imageUrl: report.imageUrl,
      imageTitle: report.imageTitle,
      providerId: report.providerId,
      executionEvidencePresent: report.executionEvidencePresent,
      metadata: { ...report.metadata },
    };
  }
}

/** Factory function to create a ThumbnailAgent. */
export function createThumbnailAgent(deps: ThumbnailAgentDependencies): ThumbnailAgent {
  const config: ThumbnailAgentDependencies["config"] = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    maxPromptLength: deps.config?.maxPromptLength ?? 500,
    aspectRatio: deps.config?.aspectRatio ?? "16:9",
    allowedAspectRatios: deps.config?.allowedAspectRatios ?? DEFAULT_ASPECT_RATIOS,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_THUMBNAIL_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new ThumbnailAgent({ ...deps, config });
}