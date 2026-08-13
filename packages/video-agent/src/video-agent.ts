/**
 * Video Agent implementation.
 * Deterministic agent: validates the approved content chain (thumbnail present,
 * brand approved, upstream lineage valid) and requests the `video.generate`
 * capability through the injected capability execution boundary. It does not
 * call a provider directly and never claims completion without matching
 * runtime evidence.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";
import { VIDEO_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import type {
  VideoAgentDependencies,
  VideoAgentInput,
  VideoReport,
  VideoReportStatus,
  VideoSourceArtifact,
} from "./video-types.js";

type JsonRecord = { [key: string]: Json };

const DEFAULT_ASPECT_RATIOS: readonly string[] = ["16:9", "9:16", "4:3", "3:4", "1:1"];

/** Default video system message (informational; the agent is deterministic). */
export const DEFAULT_VIDEO_SYSTEM_PROMPT = `You are a video designer. Validate the approved content chain and request the video.generate capability through the runtime boundary. Never claim a video was rendered unless a matching runtime evidence item confirms completion.`;

function isRecord(value: Json): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isVideoSourceArtifact(value: Json): value is JsonRecord & VideoSourceArtifact {
  return isRecord(value)
    && (typeof value.artifactId === "string" || typeof value.artifactId === "number")
    && typeof value.kind === "string"
    && typeof value.producerAgent === "string"
    && typeof value.workflowId === "string"
    && typeof value.correlationId === "string"
    && typeof value.status === "string"
    && isRecord(value.payload);
}

function isVideoAgentInput(value: Json): value is JsonRecord & VideoAgentInput {
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
      && value.validatedArtifacts.every((item) => isVideoSourceArtifact(item)))) {
    return false;
  }
  return true;
}

/** Describes why the content chain is not viable for video generation, or null when viable. */
interface Viability {
  ok: boolean;
  reason: string;
}

function stripPrefix(text: string): string {
  return text.trim().replace(/^"|"$/gu, "");
}

export class VideoAgent extends BaseAgent {
  readonly id: AgentId = "video";
  readonly name = "Video Agent";
  readonly version = "1.0.0";

  private readonly videoConfig: VideoAgentDependencies["config"];

  constructor(deps: VideoAgentDependencies) {
    super(deps);
    this.videoConfig = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isVideoAgentInput(input.input)) {
      throw new Error("Invalid video input: expected a validated content chain");
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
    const output: Json = executions.length > 0 && isRecord(baseOutput)
      ? { ...baseOutput, capabilityExecutions: JSON.parse(JSON.stringify(executions)) as Json[] }
      : baseOutput;
    return {
      output,
      response: {
        output,
        raw: JSON.stringify(report, null, 2),
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        model: this.videoConfig.model,
        provider: "video-deterministic",
        latencyMs: 0,
      },
    };
  }

  /** Gate: video is only generated for a valid, approved content chain. */
  private assessViability(input: VideoAgentInput): Viability {
    const artifacts = input.validatedArtifacts ?? [];
    if (artifacts.length === 0) return { ok: false, reason: "the content chain is empty." };

    const workflowIds = new Set(artifacts.map((a) => a.workflowId));
    const correlationIds = new Set(artifacts.map((a) => a.correlationId));
    if (workflowIds.size !== 1) return { ok: false, reason: "the workflowId is inconsistent across the content chain." };
    if (correlationIds.size !== 1) return { ok: false, reason: "the correlationId is inconsistent across the content chain." };

    const blocked = artifacts.find((a) => a.status === "blocked" || a.status === "failed");
    if (blocked !== undefined) {
      return { ok: false, reason: `an upstream artifact (${blocked.kind}) is ${blocked.status} and cannot feed video generation.` };
    }

    const brand = artifacts.find((a) => a.kind === "brand_report");
    if (brand !== undefined && isRecord(brand.payload) && brand.payload.status !== "approved") {
      return { ok: false, reason: "the brand gate is not approved." };
    }

    const thumbnail = artifacts.find((a) => a.kind === "thumbnail_report");
    if (thumbnail === undefined) return { ok: false, reason: "a thumbnail artifact is required but is missing." };
    if (!isRecord(thumbnail.payload)) return { ok: false, reason: "the thumbnail artifact payload is malformed." };
    if (thumbnail.payload.status !== "completed") {
      return { ok: false, reason: `the thumbnail is ${String(thumbnail.payload.status)} and cannot feed video generation.` };
    }
    if (thumbnail.payload.executionEvidencePresent !== true) {
      return { ok: false, reason: "the thumbnail lacks matching runtime evidence of image generation." };
    }

    return { ok: true, reason: "" };
  }

  /** Build the `video.generate` capability request from the content chain. */
  private buildCapabilityRequest(input: VideoAgentInput): CapabilityRequest | null {
    const artifacts = input.validatedArtifacts ?? [];
    const seed = this.derivePrompt(input, artifacts);
    if (seed === null) return null;
    const lead = artifacts[0];
    const thumbnail = artifacts.find((a) => a.kind === "thumbnail_report");
    const thumbnailId = thumbnail !== undefined && isRecord(thumbnail.payload) && typeof thumbnail.payload.imageId === "string"
      ? thumbnail.payload.imageId
      : "";
    return {
      requestId: `video-${input.requestId}`,
      capabilityId: VIDEO_GENERATION_CAPABILITY_ID,
      operation: "generate",
      agentId: this.id,
      workflowId: lead?.workflowId ?? `workflow-${input.requestId}`,
      correlationId: lead?.correlationId ?? `correlation-${input.requestId}`,
      input: {
        prompt: seed.prompt,
        aspectRatio: seed.aspectRatio,
        durationSeconds: this.videoConfig.durationSeconds,
        ...(thumbnailId === "" ? {} : { sourceAssetIds: [thumbnailId] }),
        ...(input.instructions === undefined ? {} : { negativePrompt: input.instructions }),
      },
      requestedAt: new Date().toISOString(),
    };
  }

  /** Derive a safe, bounded prompt from the writer/seo/thumnail artifacts. */
  private derivePrompt(input: VideoAgentInput, artifacts: readonly VideoSourceArtifact[]): { prompt: string; aspectRatio: string } | null {
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

    const maxPromptLength = this.videoConfig.maxPromptLength;
    let prompt = `Create a cinematic short video for an article titled "${topic}". Emphasize clear pacing, a compelling visual hook, and on-brand tone.`;
    if (prompt.length > maxPromptLength) {
      prompt = prompt.slice(0, maxPromptLength);
    }
    const aspectRatio = this.videoConfig.allowedAspectRatios.includes(this.videoConfig.aspectRatio)
      ? this.videoConfig.aspectRatio
      : DEFAULT_ASPECT_RATIOS[0];
    return { prompt, aspectRatio };
  }

  /** Deterministically produce the video report from the capability execution. */
  private buildReport(input: VideoAgentInput, viability: Viability, execution: CapabilityResult | undefined): VideoReport {
    const artifacts = input.validatedArtifacts ?? [];
    const taskDescription = input.taskDescription ?? "Generate a video for the approved content";

    if (!viability.ok) {
      return this.blockedReport(input, taskDescription, `Blocked: ${viability.reason}`);
    }

    if (execution === undefined || execution.status !== "success") {
      const reason = this.failureReason(execution);
      return this.blockedReport(input, taskDescription, `Blocked: ${reason}`);
    }

    const evidence = execution.evidence;
    const isGrantedCompletion = evidence !== undefined
      && evidence.capabilityId === VIDEO_GENERATION_CAPABILITY_ID
      && evidence.agentId === this.id
      && evidence.workflowId === (artifacts[0]?.workflowId ?? `workflow-${input.requestId}`)
      && evidence.correlationId === (artifacts[0]?.correlationId ?? `correlation-${input.requestId}`)
      && evidence.succeeded === true
      && evidence.videoStatus === "completed";

    const output = isRecord(execution.output) ? execution.output : {};
    const videoId = typeof output.videoId === "string" ? output.videoId : "";
    const videoUrl = typeof output.url === "string" ? output.url : "";
    const videoTitle = typeof output.title === "string" ? output.title : "";
    const providerId = typeof output.providerId === "string" ? output.providerId : "";
    const jobId = typeof output.jobId === "string" ? output.jobId : "";
    const durationSeconds = typeof output.durationSeconds === "number" && Number.isFinite(output.durationSeconds) ? output.durationSeconds : 0;

    if (!isGrantedCompletion || videoId === "" || videoUrl === "") {
      return this.blockedReport(
        input,
        taskDescription,
        videoId === ""
          ? "Blocked: the video.generate execution did not return a completed video."
          : "Blocked: the video.generate execution did not return matching completion evidence.",
      );
    }

    return {
      reportId: input.requestId,
      taskDescription,
      objective: input.objective,
      status: "completed",
      summary: "Video generated through the video.generate capability with matching completion evidence.",
      videoId,
      videoUrl,
      videoTitle,
      providerId,
      jobId,
      durationSeconds,
      aspectRatio: this.videoConfig.aspectRatio,
      executionEvidencePresent: true,
      metadata: { createdAt: new Date().toISOString(), agentVersion: this.version },
    };
  }

  private blockedReport(input: VideoAgentInput, taskDescription: string, summary: string): VideoReport {
    return {
      reportId: input.requestId,
      taskDescription,
      objective: input.objective,
      status: "blocked",
      summary,
      videoId: "",
      videoUrl: "",
      videoTitle: "",
      providerId: "",
      jobId: "",
      durationSeconds: 0,
      aspectRatio: this.videoConfig.aspectRatio,
      executionEvidencePresent: false,
      metadata: { createdAt: new Date().toISOString(), agentVersion: this.version },
    };
  }

  private failureReason(execution: CapabilityResult | undefined): string {
    if (execution === undefined) return "video.generate was not executed or capability execution is not configured.";
    if (execution.status === "blocked") return `video.generate was blocked: ${"reason" in execution ? execution.reason : "unknown"}`;
    if (execution.status === "failed") {
      const error = "error" in execution ? execution.error : undefined;
      if (error !== undefined && error.code === "VIDEO_NOT_COMPLETED") {
        const state = "evidence" in execution ? execution.evidence?.videoStatus : undefined;
        return `video.generate is ${state ?? "in progress"} and not yet complete.`;
      }
      return `video.generate failed: ${error?.message ?? "unknown"}`;
    }
    return "video.generate did not succeed.";
  }

  private toJson(report: VideoReport): Json {
    return {
      reportId: report.reportId,
      taskDescription: report.taskDescription,
      objective: report.objective,
      status: report.status,
      summary: report.summary,
      videoId: report.videoId,
      videoUrl: report.videoUrl,
      videoTitle: report.videoTitle,
      providerId: report.providerId,
      jobId: report.jobId,
      durationSeconds: report.durationSeconds,
      aspectRatio: report.aspectRatio,
      executionEvidencePresent: report.executionEvidencePresent,
      metadata: { ...report.metadata },
    };
  }
}

/** Factory function to create a VideoAgent. */
export function createVideoAgent(deps: VideoAgentDependencies): VideoAgent {
  const config: VideoAgentDependencies["config"] = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    maxPromptLength: deps.config?.maxPromptLength ?? 500,
    aspectRatio: deps.config?.aspectRatio ?? "16:9",
    allowedAspectRatios: deps.config?.allowedAspectRatios ?? DEFAULT_ASPECT_RATIOS,
    durationSeconds: deps.config?.durationSeconds ?? 30,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_VIDEO_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };
  return new VideoAgent({ ...deps, config });
}