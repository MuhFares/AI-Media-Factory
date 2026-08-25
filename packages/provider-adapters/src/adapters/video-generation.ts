/**
 * Video generation adapter — Replicate Predictions API (async, polled).
 *
 * Flow (matches the provider's real API):
 *   POST {baseUrl}/predictions             -> { id, status, output, error }
 *   GET  {baseUrl}/predictions/{id}?wait=.. -> poll until terminal
 *
 * Completion is only reported when the provider confirms status "succeeded"
 * with a renderable output URL. If the configured wait deadline expires before
 * completion, the adapter returns status "running" with the provider job id and
 * NO videoId — the executor then returns a retryable VIDEO_NOT_COMPLETED result.
 * Never auto-retries the submission POST (a retry would create a second job);
 * only the idempotent GET polls are retried.
 */

import type {
  VideoGenerationProvider,
  VideoGenerationProviderResponse,
  VideoGenerationRequest,
} from "@ai-media-factory/tool-framework";
import { sendHttp, sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv, requiredEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface ReplicateVideoConfig {
  apiToken: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  pollRetries?: number;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://api.replicate.com/v1";
const DEFAULT_MODEL = "stability-ai/stable-video-diffusion";
const TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output: unknown;
  error?: unknown;
}

export class ReplicateVideoAdapter implements VideoGenerationProvider {
  readonly providerId = "replicate";
  private readonly apiToken: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly pollRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: ReplicateVideoConfig) {
    if (typeof config.apiToken !== "string" || config.apiToken.trim().length === 0) {
      throw providerConfigError(
        "replicate",
        "config.apiToken is required. Provide a Replicate API token (REPLICATE_API_TOKEN).",
      );
    }
    this.apiToken = config.apiToken.trim();
    this.model = config.model ?? DEFAULT_MODEL;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 4_000;
    this.maxWaitMs = config.maxWaitMs ?? 120_000;
    this.pollRetries = config.pollRetries ?? 2;
    assertPositive("replicate", this.timeoutMs, "timeoutMs");
    assertPositive("replicate", this.pollIntervalMs, "pollIntervalMs");
    assertPositive("replicate", this.maxWaitMs, "maxWaitMs");
    this.onOperation = sinkOf(config.onOperation);
  }

  async generate(request: VideoGenerationRequest): Promise<VideoGenerationProviderResponse> {
    const headers = {
      Authorization: `Token ${this.apiToken}`,
      "Content-Type": "application/json",
    } as Record<string, string>;

    const submission = await sendHttp(
      {
        method: "POST",
        url: `${this.baseUrl.replace(/\/$/, "")}/predictions`,
        headers,
        body: JSON.stringify({ model: this.model, input: this.buildInput(request) }),
      },
      {
        providerId: this.providerId,
        operation: "submit",
        timeoutMs: this.timeoutMs,
        onOperation: this.onOperation,
      },
    );

    let prediction = this.parsePrediction(await this.readJson(submission));
    if (TERMINAL_STATUSES.has(prediction.status)) {
      return this.toProviderResponse(prediction, request);
    }

    const deadline = Date.now() + this.maxWaitMs;
    while (prediction.status === "starting" || prediction.status === "processing") {
      if (Date.now() >= deadline) {
        return {
          providerId: this.providerId,
          status: "running",
          jobId: prediction.id,
        };
      }
      await this.sleep(this.pollIntervalMs);
      const polled = await sendHttpWithRetry(
        {
          method: "GET",
          url: `${this.baseUrl.replace(/\/$/, "")}/predictions/${prediction.id}`,
          headers: { Authorization: `Token ${this.apiToken}`, Accept: "application/json" },
        },
        {
          providerId: this.providerId,
          operation: "poll",
          timeoutMs: this.timeoutMs,
          maxRetries: this.pollRetries,
          onOperation: this.onOperation,
          requestKey: prediction.id,
        },
      );
      prediction = this.parsePrediction(await this.readJson(polled));
    }
    return this.toProviderResponse(prediction, request);
  }

  private buildInput(request: VideoGenerationRequest): Record<string, unknown> {
    const input: Record<string, unknown> = { prompt: request.prompt };
    if (request.negativePrompt !== undefined) input.negative_prompt = request.negativePrompt;
    if (request.durationSeconds !== undefined) input.duration = request.durationSeconds;
    if (request.aspectRatio !== undefined) input.aspect_ratio = request.aspectRatio;
    return input;
  }

  private parsePrediction(json: unknown): Prediction {
    if (!isRecord(json) || typeof json.id !== "string" || json.id.trim().length === 0) {
      throw providerValidationError(this.providerId, "predict", "Provider returned a prediction without a job id");
    }
    const status = json.status;
    if (
      status !== "starting" &&
      status !== "processing" &&
      status !== "succeeded" &&
      status !== "failed" &&
      status !== "canceled"
    ) {
      throw providerValidationError(this.providerId, "predict", `Provider returned an unknown prediction status: ${String(status)}`);
    }
    return { id: json.id, status, output: json.output, error: json.error };
  }

  private toProviderResponse(prediction: Prediction, request: VideoGenerationRequest): VideoGenerationProviderResponse {
    if (prediction.status === "succeeded") {
      const videoUrl = this.extractOutputUrl(prediction.output);
      if (videoUrl === undefined) {
        return {
          providerId: this.providerId,
          status: "failed",
          jobId: prediction.id,
          error: { code: "PROVIDER_FAILED", message: "Provider confirmed completion without a renderable video output" },
        };
      }
      return {
        providerId: this.providerId,
        status: "completed",
        jobId: prediction.id,
        videoId: prediction.id,
        url: videoUrl,
        title: request.prompt.trim().slice(0, 80),
        model: this.model,
      };
    }
    return {
      providerId: this.providerId,
      status: "failed",
      jobId: prediction.id,
      error: {
        code: "PROVIDER_FAILED",
        message: this.readErrorMessage(prediction.error),
      },
    };
  }

  private extractOutputUrl(output: unknown): string | undefined {
    if (typeof output === "string" && output.trim().length > 0) return output.trim();
    if (Array.isArray(output)) {
      for (const entry of output) {
        if (typeof entry === "string" && entry.trim().length > 0) return entry.trim();
      }
    }
    if (isRecord(output)) {
      const video = asString(output.url) ?? asString(output.video);
      if (video !== undefined) return video;
    }
    return undefined;
  }

  private readErrorMessage(error: unknown): string {
    if (typeof error === "string" && error.trim().length > 0) return error.trim();
    if (isRecord(error)) {
      const message = asString(error.message);
      if (message !== undefined && message.trim().length > 0) return message.trim();
    }
    return "Provider reported a video generation failure";
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "predict", "Provider returned a non-JSON response");
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Construct a Replicate video adapter from environment variables. */
export function replicateVideoAdapterFromEnv(onOperation?: OperationSink): ReplicateVideoAdapter {
  return new ReplicateVideoAdapter({
    apiToken: requiredEnv("replicate", "REPLICATE_API_TOKEN", "Replicate API token"),
    model: optionalEnv("VIDEO_GENERATION_MODEL", DEFAULT_MODEL),
    baseUrl: optionalEnv("REPLICATE_BASE_URL", DEFAULT_BASE_URL),
    timeoutMs: envNumber("replicate", "VIDEO_GENERATION_TIMEOUT_MS", 15_000),
    pollIntervalMs: envNumber("replicate", "VIDEO_POLL_INTERVAL_MS", 4_000),
    maxWaitMs: envNumber("replicate", "VIDEO_MAX_WAIT_MS", 120_000),
    pollRetries: envNumber("replicate", "VIDEO_POLL_RETRIES", 2),
    onOperation,
  });
}