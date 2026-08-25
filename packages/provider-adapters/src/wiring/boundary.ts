/**
 * Provider capability boundary wiring.
 *
 * Builds a production capability boundary from real provider adapters:
 *
 *   createProviderCapabilityBoundary({ adapters, publishStore, ... })
 *     -> { boundary: RuntimeCapabilityExecutor, resolver: CapabilityRegistry }
 *
 * The RuntimeCapabilityExecutor authorizes and routes each request to a
 * RoutingCapabilityExecutor that dispatches by capabilityId to the matching
 * framework capability executor wired to its real provider adapter.
 *
 *   createProviderCapabilityBoundaryFromEnv(...)  constructs the same boundary
 *   with adapters configured from environment variables.
 */

import {
  ANALYTICS_CAPABILITY_ID,
  createAnalyticsCapability,
  createCapabilityRegistry,
  createImageGenerationCapability,
  createPublishingCapability,
  createTTSGenerationCapability,
  createVideoGenerationCapability,
  IMAGE_GENERATION_CAPABILITY_ID,
  PUBLISH_CAPABILITY_ID,
  TTS_GENERATION_CAPABILITY_ID,
  VIDEO_GENERATION_CAPABILITY_ID,
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
} from "@ai-media-factory/tool-framework";
import type {
  AnalyticsCapabilityPolicy,
  AnalyticsProvider,
  CapabilityDescriptor,
  CapabilityExecutorPort,
  CapabilityGrant,
  CapabilityRegistry,
  CapabilityRequest,
  CapabilityResult,
  ImageGenerationCapabilityPolicy,
  ImageGenerationProvider,
  PublishingCapabilityPolicy,
  PublishingProvider,
  PublishStore,
  TTSGenerationCapabilityPolicy,
  TTSGenerationProvider,
  VideoGenerationCapabilityPolicy,
  VideoGenerationProvider,
  WebSearchCapabilityPolicy,
  WebSearchProvider,
} from "@ai-media-factory/tool-framework";
import type { Json } from "@ai-media-factory/tool-framework";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import type { PublishSessionStore } from "@ai-media-factory/database";
import { DEFAULT_PROVIDER_GRANTS, PROVIDER_CAPABILITIES } from "./registry.js";
import { searchAdapterFromEnv } from "./search-registry.js";
import { imageAdapterFromEnv } from "./image-registry.js";
import { videoAdapterFromEnv } from "./video-registry.js";
import { publishingAdapterFromEnv } from "./publishing-registry.js";
import { analyticsAdapterFromEnv } from "./analytics-registry.js";
import { ttsAdapterFromEnv } from "./tts-registry.js";
import { openAIImageAdapterFromEnv, OpenAIImagesAdapter } from "../adapters/image-generation.js";
import { replicateVideoAdapterFromEnv, ReplicateVideoAdapter } from "../adapters/video-generation.js";
import { youTubePublishAdapterFromEnv, YouTubePublishAdapter } from "../adapters/publishing.js";
import { youTubeAnalyticsAdapterFromEnv, YouTubeAnalyticsAdapter } from "../adapters/analytics.js";
import { groqTTSAdapterFromEnv, GroqTTSAdapter } from "../adapters/groq-tts.js";
import { BraveSearchAdapter } from "../adapters/web-search.js";
import type { OperationSink } from "../core/observability.js";

export interface ProviderAdapters {
  webSearch: WebSearchProvider;
  imageGeneration: ImageGenerationProvider;
  videoGeneration: VideoGenerationProvider;
  publishing: PublishingProvider;
  analytics: AnalyticsProvider;
  /** Optional — the tts.generate capability is only registered when provided. */
  ttsGeneration?: TTSGenerationProvider;
}

export interface ProviderCapabilityPolicies {
  webSearch?: Partial<WebSearchCapabilityPolicy>;
  imageGeneration?: Partial<ImageGenerationCapabilityPolicy>;
  videoGeneration?: Partial<VideoGenerationCapabilityPolicy>;
  publishing?: Partial<PublishingCapabilityPolicy>;
  analytics?: Partial<AnalyticsCapabilityPolicy>;
  ttsGeneration?: Partial<TTSGenerationCapabilityPolicy>;
}

export interface ProviderCapabilityBoundaryOptions {
  adapters: ProviderAdapters;
  publishStore: PublishStore;
  publishSessionStore?: PublishSessionStore;
  capabilities?: readonly CapabilityDescriptor[];
  grants?: readonly CapabilityGrant[];
  policies?: ProviderCapabilityPolicies;
}

export interface ProviderCapabilityBoundary {
  boundary: RuntimeCapabilityExecutor;
  resolver: CapabilityRegistry;
}

const DEFAULT_WEB_SEARCH_POLICY: WebSearchCapabilityPolicy = {
  maxResults: 10,
  maxQueryLength: 200,
};
const DEFAULT_IMAGE_POLICY: ImageGenerationCapabilityPolicy = {
  maxPromptLength: 1000,
  maxNegativePromptLength: 1000,
  maxWidth: 2048,
  maxHeight: 2048,
  allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
};
const DEFAULT_VIDEO_POLICY: VideoGenerationCapabilityPolicy = {
  maxPromptLength: 1000,
  maxNegativePromptLength: 1000,
  maxDurationSeconds: 600,
  allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
  maxSourceAssets: 5,
};
const DEFAULT_PUBLISH_POLICY: PublishingCapabilityPolicy = {
  maxTitleLength: 200,
  maxDescriptionLength: 1000,
  maxAssetIdLength: 500,
  maxTags: 30,
  maxTagLength: 30,
  allowedVisibility: ["public", "unlisted", "private"],
};
const DEFAULT_ANALYTICS_POLICY: AnalyticsCapabilityPolicy = {
  maxPublicationIdLength: 200,
};
const DEFAULT_TTS_POLICY: TTSGenerationCapabilityPolicy = {
  maxTextLength: 2000,
  allowedFormats: ["wav", "mp3"],
  maxSpeed: 2.0,
  minSpeed: 0.5,
};

/**
 * Routes capability requests to the executor registered for the capability id.
 * Requests for an unknown capability are blocked (never executed).
 */
export class RoutingCapabilityExecutor implements CapabilityExecutorPort {
  private readonly routes = new Map<string, CapabilityExecutorPort<Json, Json>>();

  register<I = Json, O = Json>(capabilityId: string, executor: CapabilityExecutorPort<I, O>): void {
    // The runtime boundary passes a CapabilityRequest<Json>; each registered
    // executor validates its own typed input before executing, so the erased
    // cast is safe: malformed input never reaches a provider.
    this.routes.set(capabilityId, executor as unknown as CapabilityExecutorPort<Json, Json>);
  }

  async execute(request: CapabilityRequest): Promise<CapabilityResult> {
    const executor = this.routes.get(request.capabilityId);
    if (executor === undefined) {
      return {
        status: "blocked",
        resultId: `routing-result-${request.requestId}`,
        capabilityId: request.capabilityId,
        reason: "Unknown capability",
      };
    }
    return executor.execute(request);
  }
}

export function createProviderCapabilityBoundary(
  options: ProviderCapabilityBoundaryOptions,
): ProviderCapabilityBoundary {
  const resolver = createCapabilityRegistry({
    capabilities: options.capabilities ?? PROVIDER_CAPABILITIES,
    grants: options.grants ?? DEFAULT_PROVIDER_GRANTS,
  });

  const routing = new RoutingCapabilityExecutor();
  routing.register(
    WEB_SEARCH_CAPABILITY_ID,
    new WebSearchCapabilityExecutor(
      options.adapters.webSearch,
      resolver,
      { ...DEFAULT_WEB_SEARCH_POLICY, ...options.policies?.webSearch },
    ),
  );
  routing.register(
    IMAGE_GENERATION_CAPABILITY_ID,
    createImageGenerationCapability({
      provider: options.adapters.imageGeneration,
      resolver,
      policy: { ...DEFAULT_IMAGE_POLICY, ...options.policies?.imageGeneration },
    }),
  );
  routing.register(
    VIDEO_GENERATION_CAPABILITY_ID,
    createVideoGenerationCapability({
      provider: options.adapters.videoGeneration,
      resolver,
      policy: { ...DEFAULT_VIDEO_POLICY, ...options.policies?.videoGeneration },
    }),
  );
  routing.register(
    PUBLISH_CAPABILITY_ID,
    createPublishingCapability({
      provider: options.adapters.publishing,
      store: options.publishStore,
      resolver,
      policy: { ...DEFAULT_PUBLISH_POLICY, ...options.policies?.publishing },
    }),
  );
  routing.register(
    ANALYTICS_CAPABILITY_ID,
    createAnalyticsCapability({
      provider: options.adapters.analytics,
      resolver,
      policy: { ...DEFAULT_ANALYTICS_POLICY, ...options.policies?.analytics },
    }),
  );
  if (options.adapters.ttsGeneration !== undefined) {
    routing.register(
      TTS_GENERATION_CAPABILITY_ID,
      createTTSGenerationCapability({
        provider: options.adapters.ttsGeneration,
        resolver,
        policy: { ...DEFAULT_TTS_POLICY, ...options.policies?.ttsGeneration },
      }),
    );
  }

  return { boundary: new RuntimeCapabilityExecutor({ resolver, executor: routing }), resolver };
}

export interface ProviderCapabilityEnvOptions {
  publishStore: PublishStore;
  publishSessionStore?: PublishSessionStore;
  onOperation?: OperationSink;
  capabilities?: readonly CapabilityDescriptor[];
  grants?: readonly CapabilityGrant[];
  policies?: ProviderCapabilityPolicies;
  ttsProvider?: TTSGenerationProvider;
}

/** Build the full provider capability boundary with adapters configured from env. */
export function createProviderCapabilityBoundaryFromEnv(
  options: ProviderCapabilityEnvOptions,
): ProviderCapabilityBoundary {
  const adapters: ProviderAdapters = {
    webSearch: searchAdapterFromEnv({ onOperation: options.onOperation }),
    imageGeneration: imageAdapterFromEnv({ onOperation: options.onOperation }),
    videoGeneration: videoAdapterFromEnv({ onOperation: options.onOperation }),
    publishing: publishingAdapterFromEnv({
      publishSessionStore: options.publishSessionStore,
      onOperation: options.onOperation,
    }),
    analytics: analyticsAdapterFromEnv({ onOperation: options.onOperation }),
    ttsGeneration: loadOrBlockTTS(options),
  };
  return createProviderCapabilityBoundary({
    adapters,
    publishStore: options.publishStore,
    publishSessionStore: options.publishSessionStore,
    capabilities: options.capabilities,
    grants: options.grants,
    policies: options.policies,
  });
}

/** TTS is optional: a missing credential blocks the capability instead of the boundary. */
function loadOrBlockTTS(options: ProviderCapabilityEnvOptions): TTSGenerationProvider | undefined {
  if (options.ttsProvider !== undefined) return options.ttsProvider;
  if (process.env.TTS_PROVIDER === undefined || process.env.TTS_PROVIDER.trim().length === 0) {
    // TTS stays unregistered unless explicitly enabled via TTS_PROVIDER.
    return undefined;
  }
  try {
    return ttsAdapterFromEnv({ onOperation: options.onOperation });
  } catch {
    return undefined;
  }
}

export type {
  BraveSearchAdapter,
  OpenAIImagesAdapter,
  ReplicateVideoAdapter,
  YouTubePublishAdapter,
  YouTubeAnalyticsAdapter,
  GroqTTSAdapter,
};