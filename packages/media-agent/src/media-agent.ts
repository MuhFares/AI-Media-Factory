/**
 * Media/Composition Agent — smallest correct agent for media.compose.
 * Receives video+audio artifacts and requests media.compose through the
 * runtime boundary. Never invokes FFmpeg directly, never fabricates output.
 */

import type { AgentId, Json } from "@ai-media-factory/runtime";
import type { CancellationToken, CapabilityResult, ExecutionResponse } from "@ai-media-factory/runtime";
import { BaseAgent, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import { MEDIA_COMPOSE_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import type { MediaAgentConfig, MediaAgentDependencies, MediaAgentInput, MediaReport } from "./media-types.js";
import { isMediaAgentInput, mediaInputPaths, toCapabilityRequest } from "./media-types.js";

const DEFAULT_MEDIA_SYSTEM_PROMPT = `You are a media composition agent. Validate the video and audio inputs and request the media.compose capability through the runtime boundary. Never claim a final media was produced unless matching runtime evidence confirms FFmpeg executed successfully.`;

export { DEFAULT_MEDIA_SYSTEM_PROMPT };

type JsonRecord = { [key: string]: Json };

function isRecord(v: Json): v is JsonRecord { return v !== null && typeof v === "object" && !Array.isArray(v); }

export class MediaAgent extends BaseAgent {
  readonly id: AgentId = "composer";
  readonly name = "Media Agent";
  readonly version = "1.0.0";
  private readonly config: MediaAgentConfig;

  constructor(deps: MediaAgentDependencies) {
    super(deps as unknown as ConstructorParameters<typeof BaseAgent>[0]);
    this.config = deps.config;
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    signal.throwIfCancelled();
    if (!isMediaAgentInput(input.input)) {
      throw new Error("Invalid media input: expected a valid legacy source pair or ordered production scene clips");
    }
    // No capability call for obviously invalid — matches spec: agent must gate before invoking.
    // But we still let the capability do strict validation; this throw is for completely malformed.
    const request = toCapabilityRequest(
      input.input,
      this.id,
      typeof input.input.workflowId === "string" ? input.input.workflowId : `workflow-${input.input.requestId}`,
      typeof input.input.correlationId === "string" ? input.input.correlationId : "",
    );
    const executions = await this.runCapabilities([request]);
    const execution = executions[0];
    return this.buildOutput(input.input, execution);
  }

  private buildOutput(input: MediaAgentInput, execution: CapabilityResult | undefined): { output: Json; response: ExecutionResponse } {
    const taskDescription = input.taskDescription ?? "Compose video and narration into final MP4";
    const paths = mediaInputPaths(input);
    const executionRecord: JsonRecord | undefined = execution === undefined ? undefined : (JSON.parse(JSON.stringify(execution)) as JsonRecord);

    if (executionRecord === undefined || executionRecord["status"] !== "success") {
      const report = this.report(input, taskDescription, "blocked", this.failureReason(executionRecord), {
        mediaId: "", outputPath: "", mimeType: "", bytes: 0, sha256: "", durationMs: 0, width: 0, height: 0, videoCodec: "", audioCodec: "", strategy: "", videoCopied: false,
      });
      return this.wrap(report, executionRecord);
    }

    const evidence = isRecord(executionRecord["evidence"] as Json) ? (executionRecord["evidence"] as JsonRecord) : {};
    const output = isRecord(executionRecord["output"] as Json) ? (executionRecord["output"] as JsonRecord) : {};

    const isGranted = evidence["capabilityId"] === MEDIA_COMPOSE_CAPABILITY_ID && evidence["agentId"] === this.id && evidence["succeeded"] === true;
    const mediaId = typeof output["mediaId"] === "string" ? output["mediaId"] : "";
    const out = isRecord(output["output"] as Json) ? (output["output"] as JsonRecord) : {};
    const outputPath = typeof out["path"] === "string" ? out["path"] : "";
    const bytes = typeof out["bytes"] === "number" ? out["bytes"] : 0;

    if (!isGranted || mediaId === "" || outputPath === "" || bytes === 0) {
      const report = this.report(input, taskDescription, "blocked",
        "Blocked: media.compose did not return matching completion evidence.",
        { mediaId: "", outputPath: "", mimeType: "", bytes: 0, sha256: "", durationMs: 0, width: 0, height: 0, videoCodec: "", audioCodec: "", strategy: "", videoCopied: false });
      return this.wrap(report, executionRecord);
    }

    const final = isRecord(output["final"] as Json) ? (output["final"] as JsonRecord) : {};
    const comp = isRecord(output["composition"] as Json) ? (output["composition"] as JsonRecord) : {};
    const report = this.report(input, taskDescription, "completed",
      "Final media composed via media.compose with matching FFmpeg evidence.",
      {
        mediaId,
        outputPath,
        mimeType: typeof out["mimeType"] === "string" ? out["mimeType"] : "video/mp4",
        bytes,
        sha256: typeof out["sha256"] === "string" ? out["sha256"] : "",
        durationMs: typeof final["durationMs"] === "number" ? final["durationMs"] as number : 0,
        width: typeof final["width"] === "number" ? final["width"] as number : 0,
        height: typeof final["height"] === "number" ? final["height"] as number : 0,
        videoCodec: typeof final["videoCodec"] === "string" ? final["videoCodec"] as string : "",
        audioCodec: typeof final["audioCodec"] === "string" ? final["audioCodec"] as string : "",
        strategy: typeof comp["strategy"] === "string" ? comp["strategy"] as string : "",
        videoCopied: comp["videoCopied"] === true,
      });
    return this.wrap(report, executionRecord);
  }

  private report(input: MediaAgentInput, taskDescription: string, status: "completed" | "blocked", summary: string, f: { mediaId: string; outputPath: string; mimeType: string; bytes: number; sha256: string; durationMs: number; width: number; height: number; videoCodec: string; audioCodec: string; strategy: string; videoCopied: boolean }): MediaReport {
    const paths = mediaInputPaths(input);
    return {
      reportId: input.requestId,
      taskDescription,
      objective: input.objective,
      status,
      summary,
      video: paths.video,
      audio: paths.audio,
      mediaId: f.mediaId,
      outputPath: f.outputPath,
      mimeType: f.mimeType,
      bytes: f.bytes,
      sha256: f.sha256,
      durationMs: f.durationMs,
      width: f.width,
      height: f.height,
      videoCodec: f.videoCodec,
      audioCodec: f.audioCodec,
      strategy: f.strategy,
      videoCopied: f.videoCopied,
      executionEvidencePresent: status === "completed",
      metadata: { createdAt: new Date().toISOString(), agentVersion: this.version, providerId: "ffmpeg" },
    };
  }

  private failureReason(ex: JsonRecord | undefined): string {
    if (ex === undefined) return "media.compose was not executed or capability execution is not configured.";
    if (ex["status"] === "blocked") return `media.compose was blocked: ${typeof ex["reason"] === "string" ? ex["reason"] : "unknown"}`;
    if (ex["status"] === "failed") {
      const err = isRecord(ex["error"] as Json) ? (ex["error"] as JsonRecord) : {};
      return `media.compose failed: ${typeof err["message"] === "string" ? err["message"] : "unknown"}`;
    }
    return "media.compose did not succeed.";
  }

  private wrap(report: MediaReport, execution: JsonRecord | undefined): { output: Json; response: ExecutionResponse } {
    const base = this.toJson(report) as unknown as JsonRecord;
    const withExec: Json = execution !== undefined ? { ...base, capabilityExecutions: [execution] as unknown as Json } : (base as unknown as Json);
    return {
      output: withExec,
      response: { output: withExec, raw: JSON.stringify(report, null, 2), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, model: this.config.model, provider: "media-deterministic", latencyMs: 0 },
    };
  }

  private toJson(r: MediaReport): Json {
    return {
      reportId: r.reportId, taskDescription: r.taskDescription, objective: r.objective, status: r.status, summary: r.summary,
      video: r.video, audio: r.audio, mediaId: r.mediaId, outputPath: r.outputPath, mimeType: r.mimeType, bytes: r.bytes, sha256: r.sha256,
      durationMs: r.durationMs, width: r.width, height: r.height, videoCodec: r.videoCodec, audioCodec: r.audioCodec, strategy: r.strategy, videoCopied: r.videoCopied,
      executionEvidencePresent: r.executionEvidencePresent, metadata: { ...r.metadata },
    };
  }
}

export function createMediaAgent(deps: MediaAgentDependencies): MediaAgent {
  const config: MediaAgentConfig = {
    ...deps.config,
    model: deps.config?.model ?? "deterministic",
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_MEDIA_SYSTEM_PROMPT,
  };
  return new MediaAgent({ ...deps, config });
}
