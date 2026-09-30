import type { ImageGenerationProvider, ImageGenerationProviderResponse, ImageGenerationRequest } from "@ai-media-factory/tool-framework";
import { sendHttp } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";
import { createHash } from "node:crypto";

export interface RunPodZImageConfig { apiKey: string; endpointId?: string; baseUrl?: string; timeoutMs?: number; onOperation?: OperationSink; }
const DEFAULT_BASE_URL = "https://api.runpod.ai/v2";
const MAX_REFERENCE_BYTES = 16 * 1024 * 1024;
const SIZES = new Set(["512*512", "768*768", "1024*1024", "1280*1280", "1024*768", "768*1024", "1280*720", "720*1280"]);

export class RunPodZImageAdapter implements ImageGenerationProvider {
  readonly providerId = "runpod-zimage";
  readonly model = "z-image-turbo";
  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onOperation: OperationSink;
  constructor(config: RunPodZImageConfig) {
    if (!config.apiKey?.trim()) throw providerConfigError(this.providerId, "config.apiKey is required");
    if (!config.endpointId?.trim()) throw providerConfigError(this.providerId, "config.endpointId is required (use RUNPOD_ZIMAGE_ENDPOINT_ID or z-image-turbo)");
    this.apiKey = config.apiKey.trim(); this.endpointId = config.endpointId.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? 120_000; assertPositive(this.providerId, this.timeoutMs, "timeoutMs");
    this.onOperation = sinkOf(config.onOperation);
  }
  async generate(request: ImageGenerationRequest): Promise<ImageGenerationProviderResponse> {
    const input: Record<string, string | number | boolean> = { prompt: request.prompt.trim() };
    if (request.referenceImageUrl !== undefined || request.referenceImageBase64 !== undefined) {
      if (request.referenceImageUrl === undefined) throw providerValidationError(this.providerId, "generate", "REFERENCE_IMAGE_URL_REQUIRED");
      const mime = request.referenceImageMimeType;
      if (mime !== "image/png" && mime !== "image/jpeg") throw providerValidationError(this.providerId, "generate", "reference image mime type must be image/png or image/jpeg");
      try { new URL(request.referenceImageUrl); } catch { throw providerValidationError(this.providerId, "generate", "reference image URL is malformed"); }
      input.image = request.referenceImageUrl;
      if (request.strength === undefined || !Number.isFinite(request.strength) || request.strength < 0 || request.strength > 1) throw providerValidationError(this.providerId, "generate", "strength must be between 0 and 1 with a reference image");
      input.strength = request.strength;
    } else if (request.strength !== undefined) throw providerValidationError(this.providerId, "generate", "strength requires a reference image");
    const size = request.size ?? (request.width !== undefined && request.height !== undefined ? `${request.width}*${request.height}` : undefined);
    if (size !== undefined) { if (!SIZES.has(size)) throw providerValidationError(this.providerId, "generate", `unsupported size '${size}'`); input.size = size; }
    if (request.seed !== undefined) { if (!Number.isSafeInteger(request.seed) || request.seed < -1) throw providerValidationError(this.providerId, "generate", "seed must be -1 or a non-negative safe integer"); input.seed = request.seed; }
    if (request.outputFormat !== undefined) { if (!["png", "jpeg", "webp"].includes(request.outputFormat)) throw providerValidationError(this.providerId, "generate", "unsupported output format"); input.output_format = request.outputFormat; }
    if (request.safetyChecker !== undefined) input.enable_safety_checker = request.safetyChecker;
    const response = await sendHttp({ method: "POST", url: `${this.baseUrl}/${this.endpointId}/runsync`, headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ input }) }, { providerId: this.providerId, operation: "generate", timeoutMs: this.timeoutMs, onOperation: this.onOperation });
    const json = await response.json();
    if (!isRecord(json)) throw providerValidationError(this.providerId, "generate", "Provider returned malformed response");
    const id = asString(json.id);
    if (!id) throw providerValidationError(this.providerId, "submit", "Provider did not return a request id");
    if (asString(json.status) !== "COMPLETED") throw providerValidationError(this.providerId, "generate", `Provider returned status ${asString(json.status) ?? "unknown"}`);
    const output = isRecord(json.output) ? json.output : undefined;
    const resultUrl = output ? this.httpUrl(asString(output.result)) : undefined;
    const legacyUrl = output ? this.httpUrl(asString(output.image_url)) : undefined;
    const imageUrl = resultUrl ?? legacyUrl;
    if (!imageUrl) {
      const outputType = Array.isArray(json.output) ? "array" : json.output === null ? "null" : typeof json.output;
      const outputKeys = output === undefined ? "n/a" : Object.keys(output).join(",");
      const result = output?.result;
      const resultType = Array.isArray(result) ? "array" : result === null ? "null" : typeof result;
      const resultLength = typeof result === "string" ? `, resultLength=${result.length}` : "";
      const resultPrefix = typeof result === "string" ? `, resultPrefixClass=${this.safePrefix(result)}` : "";
      const resultKeys = isRecord(result) ? `, resultObjectKeys=${Object.keys(result).join(",")}` : "";
      const resultArray = Array.isArray(result) ? `, resultArrayLength=${result.length}` : "";
      throw providerValidationError(this.providerId, "generate", `Unexpected Z-Image response shape: status=COMPLETED, requestId=${id}, outputType=${outputType}, outputKeys=${outputKeys}, resultType=${resultType}${resultLength}${resultPrefix}${resultKeys}${resultArray}`);
    }
    try { new URL(imageUrl); } catch { throw providerValidationError(this.providerId, "generate", "Provider image_url is malformed"); }
    const imageResponse = await sendHttp({ method: "GET", url: imageUrl, headers: { Accept: "image/png,image/jpeg,image/webp" } }, { providerId: this.providerId, operation: "download", timeoutMs: this.timeoutMs, onOperation: this.onOperation });
    const contentType = imageResponse.headers.get("content-type")?.split(";", 1)[0] ?? "";
    if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) throw providerValidationError(this.providerId, "download", "Provider image has unsupported MIME type");
    const bytes = await imageResponse.bytes(); if (bytes.length === 0 || bytes.length > 32 * 1024 * 1024) throw providerValidationError(this.providerId, "download", "Provider image size is invalid");
    const hash = createHash("sha256").update(bytes).digest("hex");
    const mimeType = contentType;
    return { providerId: this.providerId, imageId: id, title: request.prompt.trim().slice(0, 80), url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`, parameters: request, metadata: { model: this.model, runtime: "RunPod Serverless", endpointId: this.endpointId, negativeConditioning: "NOT_SUPPORTED", ephemeralProviderUrl: imageUrl, imageSha256: hash, outputCost: isRecord(output) && typeof output.cost === "number" ? output.cost : 0, delayTime: typeof json.delayTime === "number" ? json.delayTime : 0, executionTime: typeof json.executionTime === "number" ? json.executionTime : 0 } };
  }
  private httpUrl(value: string | undefined): string | undefined { if (!value) return undefined; try { const url = new URL(value); return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined; } catch { return undefined; } }
  private safePrefix(value: string): string { if (value.startsWith("https://")) return "https://"; if (value.startsWith("http://")) return "http://"; if (value.startsWith("data:image/")) return "data:image/"; return /^[A-Za-z0-9+/=]+$/.test(value) ? "base64-like" : "other"; }
}

export function runPodZImageAdapterFromEnv(onOperation?: OperationSink): RunPodZImageAdapter {
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  const endpointId = process.env.RUNPOD_ZIMAGE_ENDPOINT_ID?.trim() ?? "z-image-turbo";
  if (!apiKey) throw providerConfigError("runpod-zimage", "Missing RUNPOD_API_KEY");
  return new RunPodZImageAdapter({ apiKey, endpointId, baseUrl: optionalEnv("RUNPOD_BASE_URL", DEFAULT_BASE_URL), timeoutMs: envNumber("runpod-zimage", "RUNPOD_ZIMAGE_TIMEOUT_MS", 120_000), onOperation });
}
