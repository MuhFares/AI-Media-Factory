/**
 * Image provider registry / router.
 *
 * The `image.generate` capability talks to ONE `ImageGenerationProvider` — this
 * registry. It holds every *configured* image provider adapter and routes to a
 * single active provider, so switching providers is pure configuration:
 *
 *   IMAGE_PROVIDER=<providerId>  (e.g. openai-image | self-hosted-image)
 *   or simply configure exactly one credential.
 *
 * Current providers:
 *   openai-image:       OPENAI_API_KEY (+ OPENAI_BASE_URL, IMAGE_GENERATION_MODEL)
 *   self-hosted-image:  RUNPOD_API_KEY + RUNPOD_IMAGE_ENDPOINT_ID
 *                       (RunPod Serverless ComfyUI 5.8.7 + FLUX.1-dev-fp8)
 *                       Aliases: SELF_HOSTED_IMAGE_API_KEY / RUNPOD_IMAGE_API_KEY
 *                       Endpoint aliases: RUNPOD_ENDPOINT_ID / SELF_HOSTED_IMAGE_ENDPOINT_ID
 *
 * The thumbnail agent never knows which provider is active: it just calls
 * image.generate. Each provider's `providerId` travels in its own response
 * so evidence always records which provider actually rendered.
 *
 * Selection rules (deterministic):
 *   1. IMAGE_PROVIDER env (or explicit preferredId) — must be configured.
 *   2. Otherwise the first configured provider in IMAGE_PROVIDER_ORDER.
 */

import type {
  ImageGenerationProvider,
  ImageGenerationProviderResponse,
  ImageGenerationRequest,
} from "@ai-media-factory/tool-framework";
import type { OperationSink } from "../core/observability.js";
import { providerConfigError, ProviderConfigurationError } from "../core/errors.js";
import { openAIImageAdapterFromEnv } from "../adapters/image-generation.js";
import { runPodImageAdapterFromEnv } from "../adapters/runpod-image.js";

export type ImageProviderImplementation = ImageGenerationProvider & { readonly providerId: string };

export const IMAGE_PROVIDER_ORDER: readonly string[] = ["openai-image", "self-hosted-image"];

export const IMAGE_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  openai: "openai-image",
  "openai-image": "openai-image",
  selfhosted: "self-hosted-image",
  "self-hosted": "self-hosted-image",
  "self-hosted-image": "self-hosted-image",
};

export function normalizeImageProviderId(input: string): string {
  const lowered = input.trim().toLowerCase();
  if (IMAGE_PROVIDER_ALIASES[lowered] !== undefined) return IMAGE_PROVIDER_ALIASES[lowered];
  if ((IMAGE_PROVIDER_ORDER as readonly string[]).includes(lowered)) return lowered;
  throw providerConfigError(
    "image.generate",
    `Unknown IMAGE_PROVIDER '${input}'. Expected one of: ${IMAGE_PROVIDER_ORDER.join(", ")} (aliases: ${Object.keys(IMAGE_PROVIDER_ALIASES).join(", ")}).`,
  );
}

export class ImageProviderRegistry implements ImageGenerationProvider {
  private readonly providers = new Map<string, ImageGenerationProvider>();
  private activeId: string | null = null;

  register(provider: ImageProviderImplementation): this {
    this.providers.set(provider.providerId, provider);
    if (this.activeId === null) this.activeId = provider.providerId;
    return this;
  }

  setActive(providerId: string): this {
    if (!this.providers.has(providerId)) {
      throw providerConfigError(
        "image.generate",
        `Image provider '${providerId}' is not registered (available: ${this.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    this.activeId = providerId;
    return this;
  }

  get activeProviderId(): string | null {
    return this.activeId;
  }

  get configuredProviderIds(): readonly string[] {
    return [...this.providers.keys()];
  }

  get providerId(): string {
    return this.activeId ?? "image-registry";
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationProviderResponse> {
    const id = this.activeId;
    const active = id === null ? null : this.providers.get(id);
    if (active === null || active === undefined) {
      throw providerConfigError(
        "image.generate",
        "No image provider is active in the registry — configure an image provider credential or set IMAGE_PROVIDER.",
      );
    }
    return active.generate(request);
  }
}

export interface ImageAdapterEnvOptions {
  preferredId?: string;
  onOperation?: OperationSink;
}

function buildImageAdapter(id: string, onOperation?: OperationSink): ImageProviderImplementation {
  switch (id) {
    case "openai-image":
      return openAIImageAdapterFromEnv(onOperation);
    case "self-hosted-image":
      return runPodImageAdapterFromEnv(onOperation);
    default:
      throw providerConfigError("image.generate", `Unknown image provider id '${id}'.`);
  }
}

export function imageAdapterFromEnv(options: ImageAdapterEnvOptions = {}): ImageProviderRegistry {
  const registry = new ImageProviderRegistry();
  for (const id of IMAGE_PROVIDER_ORDER) {
    try {
      registry.register(buildImageAdapter(id, options.onOperation));
    } catch (error) {
      if (!(error instanceof ProviderConfigurationError)) throw error;
    }
  }
  if (registry.configuredProviderIds.length === 0) {
    throw providerConfigError(
      "image.generate",
      "No image provider is configured. Set OPENAI_API_KEY (openai-image) or SELF_HOSTED_IMAGE_API_KEY + SELF_HOSTED_IMAGE_BASE_URL (self-hosted-image).",
    );
  }
  const rawPreferred = options.preferredId ?? process.env.IMAGE_PROVIDER?.trim();
  if (rawPreferred !== undefined && rawPreferred.length > 0) {
    const preferredId = normalizeImageProviderId(rawPreferred);
    if (!registry.configuredProviderIds.includes(preferredId)) {
      throw providerConfigError(
        "image.generate",
        `IMAGE_PROVIDER '${preferredId}' is requested but not configured (configured: ${registry.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    registry.setActive(preferredId);
  }
  return registry;
}
