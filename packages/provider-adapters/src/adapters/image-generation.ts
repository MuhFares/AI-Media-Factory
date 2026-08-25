/**
 * Image generation adapter — OpenAI Images API (POST /v1/images/generations).
 *
 * Mapping:
 *  POST {baseUrl}/v1/images/generations
 *    { model, prompt, n: 1, size, response_format: "b64_json" }
 *  -> { providerId, imageId, title, url, parameters }
 *
 * The provider confirms the image by returning a d.i.d created timestamp and a
 * base64 payload (or a hosted url); the returned url may be a data: URL carrying
 * the rendered image (valid for the executor's URL check) and imageId is
 * derived from the provider-confirmed `created` timestamp. Unsupported fields
 * (negativePrompt, explicit width/height) are not forwarded to this provider's
 * API; the requested aspect ratio is mapped to the nearest supported size.
 */

import type {
  ImageGenerationProvider,
  ImageGenerationProviderResponse,
  ImageGenerationRequest,
} from "@ai-media-factory/tool-framework";
import { sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv, requiredEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface OpenAIImageConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "dall-e-3";

const SIZE_BY_ASPECT: Record<string, string> = {
  "1:1": "1024x1024",
  "16:9": "1792x1024",
  "9:16": "1024x1792",
  "4:3": "1792x1024",
  "3:4": "1024x1792",
};

export class OpenAIImagesAdapter implements ImageGenerationProvider {
  readonly providerId = "openai-image";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: OpenAIImageConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError(
        "openai-image",
        "config.apiKey is required. Provide an OpenAI API key (OPENAI_API_KEY).",
      );
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 1;
    assertPositive("openai-image", this.timeoutMs, "timeoutMs");
    assertPositive("openai-image", this.maxRetries + 1, "maxRetries + 1");
    this.onOperation = sinkOf(config.onOperation);
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationProviderResponse> {
    const size = SIZE_BY_ASPECT[request.aspectRatio ?? "1:1"] ?? "1024x1024";
    const url = `${this.baseUrl.replace(/\/$/, "")}/images/generations`;
    const res = await sendHttpWithRetry(
      {
        method: "POST",
        url,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: request.prompt,
          n: 1,
          size,
          response_format: "b64_json",
        }),
      },
      {
        providerId: this.providerId,
        operation: "generate",
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        onOperation: this.onOperation,
      },
    );

    const json = await this.readJson(res);
    if (!isRecord(json)) {
      throw providerValidationError(this.providerId, "generate", "Provider returned a non-object response");
    }
    if (isRecord(json.error)) {
      const message = asString(json.error.message) ?? asString(json.error.code) ?? "Provider reported an image generation error";
      throw providerValidationError(this.providerId, "generate", `Provider returned an error: ${message}`);
    }
    if (!Array.isArray(json.data) || json.data.length === 0 || !isRecord(json.data[0])) {
      throw providerValidationError(this.providerId, "generate", "Provider response has no generated image data");
    }
    const item = json.data[0];
    const hostedUrl = asString(item.url);
    const b64 = asString(item.b64_json);
    const imageUrl = hostedUrl ?? (b64 === undefined ? undefined : `data:image/png;base64,${b64}`);
    if (imageUrl === undefined || imageUrl.trim().length === 0) {
      throw providerValidationError(this.providerId, "generate", "Provider response has no image url or payload");
    }
    const created = typeof json.created === "number" ? json.created : Date.now();
    return {
      providerId: this.providerId,
      imageId: `openai-${created}-0`,
      title: request.prompt.trim().slice(0, 80),
      url: imageUrl,
      parameters: { prompt: request.prompt.trim() },
    };
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "generate", "Provider returned a non-JSON response");
    }
  }
}

/** Construct an OpenAI Images adapter from environment variables. */
export function openAIImageAdapterFromEnv(onOperation?: OperationSink): OpenAIImagesAdapter {
  return new OpenAIImagesAdapter({
    apiKey: requiredEnv("openai-image", "OPENAI_API_KEY", "OpenAI API credential"),
    baseUrl: optionalEnv("OPENAI_BASE_URL", DEFAULT_BASE_URL),
    model: optionalEnv("IMAGE_GENERATION_MODEL", DEFAULT_MODEL),
    timeoutMs: envNumber("openai-image", "IMAGE_GENERATION_TIMEOUT_MS", 30_000),
    maxRetries: envNumber("openai-image", "IMAGE_GENERATION_MAX_RETRIES", 1),
    onOperation,
  });
}