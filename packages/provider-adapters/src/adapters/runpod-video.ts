/**
 * Self-hosted video generation adapter — RunPod Serverless Wan2.2 (image-to-video).
 *
 * Flow:
 *   POST {baseUrl}/{endpointId}/run
 *     { input: { prompt, negative_prompt, image_base64, width, height, length, steps, cfg, seed } }
 *     -> { id: jobId, status: IN_QUEUE }
 *   GET  {baseUrl}/{endpointId}/status/{jobId} (poll)
 *     -> { id, status: IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED|CANCELLED|TIMED_OUT, output, error }
 *
 * On COMPLETED:
 *   { output: { video: "<base64 mp4>" } }  →  url = data:video/mp4;base64,<b64>
 *
 * Reuses RUNPOD_API_KEY for auth. Image is passed directly as base64 (no
 * public URL upload). Success only when base64 video is present and valid.
 * POST is never retried (would duplicate job); poll GETs are retried.
 */

import type {
  VideoGenerationProvider,
  VideoGenerationProviderResponse,
  VideoGenerationRequest,
} from "@ai-media-factory/tool-framework";
import { sendHttp, sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface RunPodVideoConfig {
  apiKey: string;
  endpointId: string;
  baseUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  pollRetries?: number;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://api.runpod.ai/v2";
const TERMINAL_FAILED = new Set(["FAILED", "CANCELLED", "TIMED_OUT"]);

function extractBase64Image(input: string | undefined): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.startsWith("data:")) {
    const comma = trimmed.indexOf(",");
    if (comma >= 0) return trimmed.slice(comma + 1).trim();
    return undefined;
  }
  // Heuristic: if it looks like base64 (long alphanumeric), treat as base64
  if (trimmed.length > 500 && /^[A-Za-z0-9+/=]+$/.test(trimmed.slice(0, 100))) return trimmed;
  return undefined;
}

export class RunPodWanVideoAdapter implements VideoGenerationProvider {
  readonly providerId = "self-hosted-video";
  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly pollRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: RunPodVideoConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError("self-hosted-video", "config.apiKey is required. Provide RunPod API key (RUNPOD_API_KEY).");
    }
    if (typeof config.endpointId !== "string" || config.endpointId.trim().length === 0) {
      throw providerConfigError("self-hosted-video", "config.endpointId is required. Provide RunPod video endpoint ID (RUNPOD_VIDEO_ENDPOINT_ID).");
    }
    this.apiKey = config.apiKey.trim();
    this.endpointId = config.endpointId.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 4_000;
    this.maxWaitMs = config.maxWaitMs ?? 600_000;
    this.pollRetries = config.pollRetries ?? 2;
    assertPositive("self-hosted-video", this.timeoutMs, "timeoutMs");
    assertPositive("self-hosted-video", this.pollIntervalMs, "pollIntervalMs");
    assertPositive("self-hosted-video", this.maxWaitMs, "maxWaitMs");
    this.onOperation = sinkOf(config.onOperation);
  }

  async generate(request: VideoGenerationRequest): Promise<VideoGenerationProviderResponse> {
    const prompt = request.prompt.trim();
    if (prompt.length === 0) throw providerValidationError(this.providerId, "generate", "Video prompt must not be empty");

    // Resolve image_base64: prefer explicit imageBase64, else try sourceAssetIds[0] if data URL, else try width/height source?
    let imageBase64: string | undefined = (request as unknown as Record<string, unknown>).imageBase64 as string | undefined;
    if (imageBase64 !== undefined) {
      const stripped = extractBase64Image(imageBase64);
      if (stripped !== undefined) imageBase64 = stripped;
    }
    if (imageBase64 === undefined && request.sourceAssetIds !== undefined && request.sourceAssetIds.length > 0) {
      const first = request.sourceAssetIds[0];
      const extracted = extractBase64Image(first);
      if (extracted !== undefined) imageBase64 = extracted;
    }
    // Also check if prompt itself accidentally contains data URL? No.

    const negativePrompt = request.negativePrompt?.trim() ?? "";
    const width = (request as unknown as Record<string, unknown>).width as number | undefined ?? 480;
    const height = (request as unknown as Record<string, unknown>).height as number | undefined ?? 832;
    const length = (request as unknown as Record<string, unknown>).length as number | undefined ?? 81;
    const steps = (request as unknown as Record<string, unknown>).steps as number | undefined ?? 10;
    const cfg = (request as unknown as Record<string, unknown>).cfg as number | undefined ?? 2.0;
    const seed = (request as unknown as Record<string, unknown>).seed as number | undefined ?? Math.floor(Math.random() * 1_000_000_000);

    const input: Record<string, unknown> = {
      prompt,
      negative_prompt: negativePrompt,
      width,
      height,
      length,
      steps,
      cfg,
      seed,
    };
    if (imageBase64 !== undefined && imageBase64.length > 0) {
      input.image_base64 = imageBase64;
    }

    const submitRes = await sendHttp(
      {
        method: "POST",
        url: `${this.baseUrl}/${this.endpointId}/run`,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input }),
      },
      {
        providerId: this.providerId,
        operation: "submit",
        timeoutMs: this.timeoutMs,
        onOperation: this.onOperation,
      },
    );

    const submitJson = await this.readJson(submitRes, "submit");
    const jobId = asString(submitJson.id) ?? asString((submitJson as unknown as Record<string, unknown>).jobId);
    if (!jobId || jobId.trim().length === 0) {
      throw providerValidationError(this.providerId, "submit", "Provider did not return a job id");
    }
    const immediateStatus = asString(submitJson.status);
    if (immediateStatus === "COMPLETED") {
      const b64 = this.extractVideoBase64(submitJson);
      if (b64 !== undefined) return this.toCompleted(jobId, b64, request);
    }
    if (immediateStatus !== undefined && TERMINAL_FAILED.has(immediateStatus)) {
      throw providerValidationError(this.providerId, "generate", `Provider job ${immediateStatus}: ${this.readError(submitJson)}`);
    }

    const deadline = Date.now() + this.maxWaitMs;
    while (true) {
      if (Date.now() >= deadline) {
        throw providerValidationError(this.providerId, "generate", "Provider job timed out before completion");
      }
      await this.sleep(this.pollIntervalMs);
      const pollRes = await sendHttpWithRetry(
        {
          method: "GET",
          url: `${this.baseUrl}/${this.endpointId}/status/${encodeURIComponent(jobId)}`,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
          },
        },
        {
          providerId: this.providerId,
          operation: "poll",
          timeoutMs: this.timeoutMs,
          maxRetries: this.pollRetries,
          onOperation: this.onOperation,
          requestKey: jobId,
        },
      );
      const pollJson = await this.readJson(pollRes, "poll");
      const status = asString(pollJson.status);
      if (status === "COMPLETED") {
        const b64 = this.extractVideoBase64(pollJson);
        if (b64 === undefined) {
          throw providerValidationError(this.providerId, "generate", "Provider confirmed completion without video data");
        }
        return this.toCompleted(jobId, b64, request);
      }
      if (status !== undefined && TERMINAL_FAILED.has(status)) {
        throw providerValidationError(this.providerId, "generate", `Provider job ${status}: ${this.readError(pollJson)}`);
      }
      // IN_QUEUE / IN_PROGRESS → continue
    }
  }

  private toCompleted(jobId: string, b64: string, request: VideoGenerationRequest): VideoGenerationProviderResponse {
    if (!this.isValidBase64(b64)) {
      throw providerValidationError(this.providerId, "generate", "Provider video data is not valid base64");
    }
    const url = `data:video/mp4;base64,${b64}`;
    try { new URL(url); } catch {
      throw providerValidationError(this.providerId, "generate", "Provider video URL is malformed");
    }
    // Validate MP4 container header (ftyp or moov) after decode sampling? Light check: base64 length > 1k
    if (b64.length < 1000) {
      throw providerValidationError(this.providerId, "generate", "Provider video data is too short");
    }
    return {
      providerId: this.providerId,
      status: "completed",
      jobId,
      videoId: jobId,
      url,
      title: request.prompt.trim().slice(0, 80),
      durationSeconds: (request as unknown as Record<string, unknown>).length as number | undefined ?? 81,
      width: (request as unknown as Record<string, unknown>).width as number | undefined ?? 480,
      height: (request as unknown as Record<string, unknown>).height as number | undefined ?? 832,
      model: "wan2.2",
    };
  }

  private extractVideoBase64(json: unknown): string | undefined {
    if (!isRecord(json)) return undefined;
    const output = isRecord(json.output) ? json.output : json;
    if (isRecord(output)) {
      const v = asString(output.video) ?? asString(output.data) ?? asString((output as unknown as Record<string, unknown>).video_base64);
      if (v !== undefined && v.trim().length > 0) return v.trim();
      // Alternative: output is array with video?
      if (Array.isArray(output.videos) && output.videos.length > 0 && isRecord(output.videos[0])) {
        const d = asString((output.videos[0] as Record<string, unknown>).video ?? (output.videos[0] as Record<string, unknown>).data);
        if (d) return d.trim();
      }
    }
    return undefined;
  }

  private readError(json: unknown): string {
    if (!isRecord(json)) return "unknown provider error";
    const err = json.error ?? (isRecord(json.output) ? (json.output as unknown as Record<string, unknown>).error : undefined);
    if (typeof err === "string" && err.trim().length > 0) return err.trim();
    if (isRecord(err)) {
      const m = asString(err.message) ?? asString(err.error);
      if (m) return m;
    }
    return "provider reported failure";
  }

  private isValidBase64(s: string): boolean {
    return /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 200)) && s.length > 500;
  }

  private async readJson(res: { json(): Promise<unknown> }, op: string): Promise<Record<string, unknown>> {
    let json: unknown;
    try { json = await res.json(); } catch {
      throw providerValidationError(this.providerId, op, "Provider returned a non-JSON response");
    }
    if (!isRecord(json)) throw providerValidationError(this.providerId, op, "Provider returned a non-object response");
    return json;
  }

  private sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
}

/** Construct a RunPod Wan video adapter from environment variables. */
export function runPodVideoAdapterFromEnv(onOperation?: OperationSink): RunPodWanVideoAdapter {
  const apiKey = process.env.RUNPOD_API_KEY?.trim() ?? process.env.RUNPOD_VIDEO_API_KEY?.trim();
  const endpointId = process.env.RUNPOD_VIDEO_ENDPOINT_ID?.trim() ?? process.env.RUNPOD_VIDEO_API_ENDPOINT_ID?.trim();
  if (!apiKey || apiKey.length === 0) {
    throw providerConfigError("self-hosted-video", "Missing required environment variable 'RUNPOD_API_KEY'.");
  }
  if (!endpointId || endpointId.length === 0) {
    throw providerConfigError("self-hosted-video", "Missing required environment variable 'RUNPOD_VIDEO_ENDPOINT_ID'.");
  }
  return new RunPodWanVideoAdapter({
    apiKey,
    endpointId,
    baseUrl: optionalEnv("RUNPOD_BASE_URL", DEFAULT_BASE_URL),
    timeoutMs: envNumber("self-hosted-video", "RUNPOD_VIDEO_TIMEOUT_MS", 30_000),
    pollIntervalMs: envNumber("self-hosted-video", "RUNPOD_VIDEO_POLL_INTERVAL_MS", 4_000),
    maxWaitMs: envNumber("self-hosted-video", "RUNPOD_VIDEO_MAX_WAIT_MS", 600_000),
    pollRetries: envNumber("self-hosted-video", "RUNPOD_VIDEO_POLL_RETRIES", 2),
    onOperation,
  });
}
