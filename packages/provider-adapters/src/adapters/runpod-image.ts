/**
 * Self-hosted image generation adapter — RunPod Serverless ComfyUI (FLUX.1-dev-fp8).
 *
 * Flow (matches deployed RunPod ComfyUI 5.8.7 worker):
 *   POST {baseUrl}/{endpointId}/run
 *     { input: { workflow: <ComfyUI API workflow> } }
 *     -> { id: jobId, status: IN_QUEUE | IN_PROGRESS }
 *   GET  {baseUrl}/{endpointId}/status/{jobId}  (poll)
 *     -> { id, status: IN_QUEUE|IN_PROGRESS|COMPLETED|FAILED|CANCELLED, output, error }
 *
 * The worker uses FLUX.1-dev-fp8 (flux1-dev-fp8.safetensors) with nodes:
 *   CheckpointLoaderSimple → CLIPTextEncode(prompt) → FluxGuidance →
 *   EmptyLatentImage(width/height) → KSampler → VAEDecode → SaveImage
 *
 * On COMPLETED the worker returns:
 *   { output: { images: [{ data: "<base64 PNG>" }] } }
 * or { output: { image: "<base64>" } } depending on worker version.
 *
 * Success is only claimed when a valid base64 image is extracted and
 * converted to a data: URL. All other states are classified failures.
 * Never auto-retries the submit POST; only poll GETs are retried.
 */

import type {
  ImageGenerationProvider,
  ImageGenerationProviderResponse,
  ImageGenerationRequest,
} from "@ai-media-factory/tool-framework";
import { sendHttp, sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface RunPodImageConfig {
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

function clampDim(v: number | undefined, fallback: number): number {
  if (v === undefined || !Number.isSafeInteger(v) || v < 64) return fallback;
  if (v > 2048) return 2048;
  // ComfyUI latent requires multiple of 8; round to nearest 8
  return Math.round(v / 8) * 8;
}

function dimensionsFor(request: ImageGenerationRequest): { width: number; height: number } {
  if (request.width !== undefined && request.height !== undefined) {
    return { width: clampDim(request.width, 1024), height: clampDim(request.height, 1024) };
  }
  const ratio = request.aspectRatio ?? "1:1";
  switch (ratio) {
    case "16:9": return { width: 1344, height: 768 };
    case "9:16": return { width: 768, height: 1344 };
    case "4:3": return { width: 1152, height: 896 };
    case "3:4": return { width: 896, height: 1152 };
    default: return { width: 1024, height: 1024 };
  }
}

function buildFluxWorkflow(request: ImageGenerationRequest): Record<string, unknown> {
  const prompt = request.prompt.trim().slice(0, 1000);
  const { width, height } = dimensionsFor(request);
  const seed = Math.floor(Math.random() * 1_000_000_000);

  // Minimal FLUX.1-dev-fp8 API workflow
  return {
    "30": {
      inputs: { ckpt_name: "flux1-dev-fp8.safetensors" },
      class_type: "CheckpointLoaderSimple",
    },
    "6": {
      inputs: { text: prompt, clip: ["30", 1] },
      class_type: "CLIPTextEncode",
    },
    "7": {
      inputs: { text: "", clip: ["30", 1] },
      class_type: "CLIPTextEncode",
    },
    "33": {
      inputs: { guidance: 3.5, conditioning: ["6", 0] },
      class_type: "FluxGuidance",
    },
    "27": {
      inputs: { width, height, batch_size: 1 },
      class_type: "EmptyLatentImage",
    },
    "13": {
      inputs: {
        seed,
        steps: 20,
        cfg: 1,
        sampler_name: "euler",
        scheduler: "simple",
        denoise: 1,
        model: ["30", 0],
        positive: ["33", 0],
        negative: ["7", 0],
        latent_image: ["27", 0],
      },
      class_type: "KSampler",
    },
    "8": {
      inputs: { samples: ["13", 0], vae: ["30", 2] },
      class_type: "VAEDecode",
    },
    "9": {
      inputs: { filename_prefix: "ComfyUI", images: ["8", 0] },
      class_type: "SaveImage",
    },
  };
}

export class RunPodComfyUIImageAdapter implements ImageGenerationProvider {
  readonly providerId = "self-hosted-image";
  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly pollRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: RunPodImageConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError("self-hosted-image", "config.apiKey is required. Provide RunPod API key (RUNPOD_API_KEY).");
    }
    if (typeof config.endpointId !== "string" || config.endpointId.trim().length === 0) {
      throw providerConfigError("self-hosted-image", "config.endpointId is required. Provide RunPod endpoint ID (RUNPOD_IMAGE_ENDPOINT_ID).");
    }
    this.apiKey = config.apiKey.trim();
    this.endpointId = config.endpointId.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 4_000;
    this.maxWaitMs = config.maxWaitMs ?? 180_000;
    this.pollRetries = config.pollRetries ?? 2;
    assertPositive("self-hosted-image", this.timeoutMs, "timeoutMs");
    assertPositive("self-hosted-image", this.pollIntervalMs, "pollIntervalMs");
    assertPositive("self-hosted-image", this.maxWaitMs, "maxWaitMs");
    this.onOperation = sinkOf(config.onOperation);
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationProviderResponse> {
    const workflow = buildFluxWorkflow(request);

    // Submit — never retried (would create duplicate job)
    const submitRes = await sendHttp(
      {
        method: "POST",
        url: `${this.baseUrl}/${this.endpointId}/run`,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { workflow } }),
      },
      {
        providerId: this.providerId,
        operation: "submit",
        timeoutMs: this.timeoutMs,
        onOperation: this.onOperation,
      },
    );

    const submitJson = await this.readJson(submitRes, "submit");
    const jobId = asString(submitJson.id) ?? asString((submitJson as Record<string, unknown>).jobId);
    if (jobId === undefined || jobId.trim().length === 0) {
      throw providerValidationError(this.providerId, "submit", "Provider did not return a job id");
    }
    // If runsync returned immediately completed, handle it
    const immediateStatus = asString(submitJson.status);
    if (immediateStatus === "COMPLETED") {
      const b64 = this.extractBase64(submitJson);
      if (b64 !== undefined) return this.toResponse(b64, request, jobId);
    }
    if (immediateStatus !== undefined && TERMINAL_FAILED.has(immediateStatus)) {
      throw providerValidationError(this.providerId, "generate", `Provider job ${immediateStatus}: ${this.readError(submitJson)}`);
    }

    // Poll for completion
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
        const b64 = this.extractBase64(pollJson);
        if (b64 === undefined) {
          throw providerValidationError(this.providerId, "generate", "Provider confirmed completion without image data");
        }
        return this.toResponse(b64, request, jobId);
      }
      if (status !== undefined && TERMINAL_FAILED.has(status)) {
        throw providerValidationError(this.providerId, "generate", `Provider job ${status}: ${this.readError(pollJson)}`);
      }
      // IN_QUEUE / IN_PROGRESS → continue polling
      if (status !== "IN_QUEUE" && status !== "IN_PROGRESS" && status !== undefined) {
        // Unknown status — treat as transient and continue polling until deadline
      }
    }
  }

  private toResponse(b64: string, request: ImageGenerationRequest, jobId: string): ImageGenerationProviderResponse {
    if (!this.isValidBase64(b64)) {
      throw providerValidationError(this.providerId, "generate", "Provider image data is not valid base64");
    }
    const url = `data:image/png;base64,${b64}`;
    // Validate URL shape for capability contract
    try { new URL(url); } catch {
      throw providerValidationError(this.providerId, "generate", "Provider image URL is malformed");
    }
    return {
      providerId: this.providerId,
      imageId: `runpod-${jobId}`,
      title: request.prompt.trim().slice(0, 80),
      url,
      parameters: { prompt: request.prompt.trim() },
    };
  }

  private extractBase64(json: unknown): string | undefined {
    if (!isRecord(json)) return undefined;
    // RunPod wraps output in { output: { images: [{ data }] } } or { output: { image } }
    const output = isRecord(json.output) ? json.output : json;
    if (isRecord(output)) {
      // images: [{ data: base64 }]
      if (Array.isArray(output.images) && output.images.length > 0 && isRecord(output.images[0])) {
        const d = asString((output.images[0] as Record<string, unknown>).data) ?? asString((output.images[0] as Record<string, unknown>).image);
        if (d !== undefined && d.trim().length > 0) return d.trim();
      }
      if (Array.isArray(output.output) && output.output.length > 0) {
        // nested output.output
        return this.extractBase64({ output: output.output[0] });
      }
      const direct = asString(output.image) ?? asString(output.data);
      if (direct !== undefined && direct.trim().length > 0) return direct.trim();
    }
    return undefined;
  }

  private readError(json: unknown): string {
    if (!isRecord(json)) return "unknown provider error";
    const err = json.error ?? (isRecord(json.output) ? json.output.error : undefined);
    if (typeof err === "string" && err.trim().length > 0) return err.trim();
    if (isRecord(err)) {
      const m = asString(err.message) ?? asString(err.error);
      if (m !== undefined) return m;
    }
    return "provider reported failure";
  }

  private isValidBase64(s: string): boolean {
    if (s.length === 0 || s.length % 4 !== 0) {
      // Base64 length should be multiple of 4, but allow without strict check
      // just validate characters
    }
    return /^[A-Za-z0-9+/=]+$/.test(s) && s.length > 100;
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

  /** Exposed for tests — build the workflow for a given request. */
  static buildWorkflowForTest(request: ImageGenerationRequest): Record<string, unknown> {
    return buildFluxWorkflow(request);
  }
}

/** Construct a RunPod ComfyUI adapter from environment variables. */
export function runPodImageAdapterFromEnv(onOperation?: OperationSink): RunPodComfyUIImageAdapter {
  const apiKey =
    process.env.RUNPOD_API_KEY?.trim() ??
    process.env.RUNPOD_IMAGE_API_KEY?.trim() ??
    process.env.SELF_HOSTED_IMAGE_API_KEY?.trim() ??
    process.env.IMAGE_SELF_HOSTED_API_KEY?.trim();
  const endpointId =
    process.env.RUNPOD_IMAGE_ENDPOINT_ID?.trim() ??
    process.env.RUNPOD_ENDPOINT_ID?.trim() ??
    process.env.SELF_HOSTED_IMAGE_ENDPOINT_ID?.trim() ??
    process.env.SELF_HOSTED_IMAGE_BASE_URL?.trim();
  // SELF_HOSTED_IMAGE_BASE_URL may contain full URL with endpoint; extract last path segment if it looks like URL
  let resolvedEndpointId = endpointId;
  if (resolvedEndpointId !== undefined && resolvedEndpointId.includes("/")) {
    const parts = resolvedEndpointId.split("/").filter(Boolean);
    resolvedEndpointId = parts[parts.length - 1];
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw providerConfigError("self-hosted-image", "Missing required environment variable 'RUNPOD_API_KEY' (or SELF_HOSTED_IMAGE_API_KEY).");
  }
  if (resolvedEndpointId === undefined || resolvedEndpointId.length === 0) {
    throw providerConfigError("self-hosted-image", "Missing required environment variable 'RUNPOD_IMAGE_ENDPOINT_ID' (or RUNPOD_ENDPOINT_ID).");
  }
  return new RunPodComfyUIImageAdapter({
    apiKey,
    endpointId: resolvedEndpointId,
    baseUrl: optionalEnv("RUNPOD_BASE_URL", DEFAULT_BASE_URL),
    timeoutMs: envNumber("self-hosted-image", "RUNPOD_IMAGE_TIMEOUT_MS", 30_000),
    pollIntervalMs: envNumber("self-hosted-image", "RUNPOD_IMAGE_POLL_INTERVAL_MS", 4_000),
    maxWaitMs: envNumber("self-hosted-image", "RUNPOD_IMAGE_MAX_WAIT_MS", 180_000),
    pollRetries: envNumber("self-hosted-image", "RUNPOD_IMAGE_POLL_RETRIES", 2),
    onOperation,
  });
}
