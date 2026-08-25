/**
 * Video provider registry / router.
 *
 * The `video.generate` capability talks to ONE `VideoGenerationProvider` — this
 * registry. Switching providers is pure configuration:
 *
 *   VIDEO_PROVIDER=<providerId>  (e.g. replicate | self-hosted-video)
 *   or simply configure exactly one credential.
 *
 * Current providers:
 *   replicate:          REPLICATE_API_TOKEN (+ REPLICATE_BASE_URL, VIDEO_GENERATION_MODEL)
 *   self-hosted-video:  RUNPOD_API_KEY + RUNPOD_VIDEO_ENDPOINT_ID
 *                       (RunPod Serverless Wan2.2 image-to-video)
 *                       width=480 height=832 length=81 steps=10 cfg=2.0 seed=random
 *
 * The video agent never knows which provider renders: polling, timeout and
 * completion semantics are identical behind the registry.
 */

import type {
  VideoGenerationProvider,
  VideoGenerationProviderResponse,
  VideoGenerationRequest,
} from "@ai-media-factory/tool-framework";
import type { OperationSink } from "../core/observability.js";
import { providerConfigError, ProviderConfigurationError } from "../core/errors.js";
import { replicateVideoAdapterFromEnv } from "../adapters/video-generation.js";
import { runPodVideoAdapterFromEnv } from "../adapters/runpod-video.js";

export type VideoProviderImplementation = VideoGenerationProvider & { readonly providerId: string };

export const VIDEO_PROVIDER_ORDER: readonly string[] = ["replicate", "self-hosted-video"];

export const VIDEO_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  replicate: "replicate",
  selfhosted: "self-hosted-video",
  "self-hosted": "self-hosted-video",
  "self-hosted-video": "self-hosted-video",
  wan: "self-hosted-video",
};

export function normalizeVideoProviderId(input: string): string {
  const lowered = input.trim().toLowerCase();
  if (VIDEO_PROVIDER_ALIASES[lowered] !== undefined) return VIDEO_PROVIDER_ALIASES[lowered];
  if ((VIDEO_PROVIDER_ORDER as readonly string[]).includes(lowered)) return lowered;
  throw providerConfigError(
    "video.generate",
    `Unknown VIDEO_PROVIDER '${input}'. Expected one of: ${VIDEO_PROVIDER_ORDER.join(", ")} (aliases: ${Object.keys(VIDEO_PROVIDER_ALIASES).join(", ")}).`,
  );
}

export class VideoProviderRegistry implements VideoGenerationProvider {
  private readonly providers = new Map<string, VideoGenerationProvider>();
  private activeId: string | null = null;

  register(provider: VideoProviderImplementation): this {
    this.providers.set(provider.providerId, provider);
    if (this.activeId === null) this.activeId = provider.providerId;
    return this;
  }

  setActive(providerId: string): this {
    if (!this.providers.has(providerId)) {
      throw providerConfigError(
        "video.generate",
        `Video provider '${providerId}' is not registered (available: ${this.configuredProviderIds.join(", ") || "none"}).`,
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
    return this.activeId ?? "video-registry";
  }

  async generate(request: VideoGenerationRequest): Promise<VideoGenerationProviderResponse> {
    const id = this.activeId;
    const active = id === null ? null : this.providers.get(id);
    if (active === null || active === undefined) {
      throw providerConfigError(
        "video.generate",
        "No video provider is active in the registry — configure a video provider credential or set VIDEO_PROVIDER.",
      );
    }
    return active.generate(request);
  }
}

export interface VideoAdapterEnvOptions {
  preferredId?: string;
  onOperation?: OperationSink;
}

function buildVideoAdapter(id: string, onOperation?: OperationSink): VideoProviderImplementation {
  switch (id) {
    case "replicate":
      return replicateVideoAdapterFromEnv(onOperation);
    case "self-hosted-video":
      return runPodVideoAdapterFromEnv(onOperation);
    default:
      throw providerConfigError("video.generate", `Unknown video provider id '${id}'.`);
  }
}

export function videoAdapterFromEnv(options: VideoAdapterEnvOptions = {}): VideoProviderRegistry {
  const registry = new VideoProviderRegistry();
  for (const id of VIDEO_PROVIDER_ORDER) {
    try {
      registry.register(buildVideoAdapter(id, options.onOperation));
    } catch (error) {
      if (!(error instanceof ProviderConfigurationError)) throw error;
    }
  }
  if (registry.configuredProviderIds.length === 0) {
    throw providerConfigError(
      "video.generate",
      "No video provider is configured. Set REPLICATE_API_TOKEN (replicate) or RUNPOD_API_KEY + RUNPOD_VIDEO_ENDPOINT_ID (self-hosted-video).",
    );
  }
  const rawPreferred = options.preferredId ?? process.env.VIDEO_PROVIDER?.trim();
  if (rawPreferred !== undefined && rawPreferred.length > 0) {
    const preferredId = normalizeVideoProviderId(rawPreferred);
    if (!registry.configuredProviderIds.includes(preferredId)) {
      throw providerConfigError(
        "video.generate",
        `VIDEO_PROVIDER '${preferredId}' is requested but not configured (configured: ${registry.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    registry.setActive(preferredId);
  }
  return registry;
}
