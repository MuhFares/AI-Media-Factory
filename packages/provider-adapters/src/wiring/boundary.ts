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
  createMediaComposeCapability,
  createPublishingCapability,
  createTimelinePlanCapability,
  createTTSGenerationCapability,
  createVideoGenerationCapability,
  IMAGE_GENERATION_CAPABILITY_ID,
  MEDIA_COMPOSE_CAPABILITY_ID,
  PUBLISH_CAPABILITY_ID,
  TIMELINE_PLAN_CAPABILITY_ID,
  TTS_GENERATION_CAPABILITY_ID,
  VIDEO_GENERATION_CAPABILITY_ID,
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
  WEB_SEARCH_MAX_QUERY_LENGTH,
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
import { IMAGE_PROMPT_MAX_CHARS, IMAGE_NEGATIVE_PROMPT_MAX_CHARS } from "@ai-media-factory/tool-framework";
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
import type { VoicetutSubmissionLifecycle } from "../adapters/voicetut-tts.js";

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
  mediaCompose?: Partial<import("@ai-media-factory/tool-framework").MediaComposeCapabilityPolicy>;
  timelinePlan?: Partial<import("@ai-media-factory/tool-framework").TimelinePlanCapabilityPolicy>;
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
  /**
   * MEDIA CAPABILITY PREFLIGHT V1: the ids of the provider-backed (and
   * deterministic) capabilities actually REGISTERED in this boundary's
   * routing executor. Constructed from the same wiring the live worker
   * uses — no provider is constructed or contacted by reading this.
   */
  readonly registeredCapabilityIds: readonly string[];
  readonly resolvedProviderIds: Readonly<Record<string, string>>;
  /** Safe launcher classification supplied by the production composition root. */
  readonly workerExecutionEnvironment?: {
    readonly status: "SUPPORTED" | "UNSUPPORTED";
    readonly mediaLiveExecutionAllowed: boolean;
    readonly reasonCode: string | null;
  };
  /**
   * Safe worker runtime identity supplied by the production composition root
   * (mode/launcher/instance/node — no secrets). Reported verbatim by the
   * zero-network media capability preflight so future live authorizations can
   * prove WORKER_RUNTIME_MODE = PERSISTENT_PRODUCTION_WORKER.
   */
  readonly workerRuntime?: {
    readonly mode: string;
    readonly launcherClassification: string;
    readonly instanceId: string;
    readonly nodeVersion: string;
  };
  /**
   * Safe media execution-configuration derivations supplied by the production
   * composition root (endpoint identity hash + base hostname — never raw
   * endpoint IDs, keys, or credentials). Feeds the governed v2 configuration
   * fingerprint so endpoint swaps change the fingerprint.
   */
  readonly mediaConfiguration?: {
    readonly ttsEndpointIdentityHash: string | null;
    readonly ttsBaseHost: string | null;
  };
}

const DEFAULT_WEB_SEARCH_POLICY: WebSearchCapabilityPolicy = {
  maxResults: 10,
  maxQueryLength: WEB_SEARCH_MAX_QUERY_LENGTH,
};
const DEFAULT_IMAGE_POLICY: ImageGenerationCapabilityPolicy = {
  maxPromptLength: IMAGE_PROMPT_MAX_CHARS,
  maxNegativePromptLength: IMAGE_NEGATIVE_PROMPT_MAX_CHARS,
  maxWidth: 2048,
  maxHeight: 2048,
  allowedAspectRatios: ["16:9", "9:16", "4:3", "3:4", "1:1"],
};
const DEFAULT_RUNPOD_ZIMAGE_PROMPT_LENGTH = 4000;
const MAX_RUNPOD_ZIMAGE_PROMPT_LENGTH = 8192;

function runpodZImagePromptLength(): number {
  const raw = process.env.RUNPOD_ZIMAGE_MAX_PROMPT_LENGTH?.trim();
  if (!raw) return DEFAULT_RUNPOD_ZIMAGE_PROMPT_LENGTH;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1000 || value > MAX_RUNPOD_ZIMAGE_PROMPT_LENGTH) {
    throw new Error(`RUNPOD_ZIMAGE_MAX_PROMPT_LENGTH must be an integer between 1000 and ${MAX_RUNPOD_ZIMAGE_PROMPT_LENGTH}`);
  }
  return value;
}
const DEFAULT_VIDEO_POLICY: VideoGenerationCapabilityPolicy = {
  maxPromptLength: 3000,
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
  /** Registered capability ids (read-only inspection for the provider-free preflight). */
  get registeredIds(): Iterable<string> { return this.routes.keys(); }

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
  const imagePolicy: ImageGenerationCapabilityPolicy = {
    ...DEFAULT_IMAGE_POLICY,
    ...((options.adapters.imageGeneration as ImageGenerationProvider & { providerId?: string }).providerId === "runpod-zimage"
      ? { maxPromptLength: runpodZImagePromptLength() }
      : {}),
    ...options.policies?.imageGeneration,
  };
  routing.register(
    IMAGE_GENERATION_CAPABILITY_ID,
    createImageGenerationCapability({
      provider: options.adapters.imageGeneration,
      resolver,
      policy: imagePolicy,
    }),
  );
  routing.register(
    VIDEO_GENERATION_CAPABILITY_ID,
    createVideoGenerationCapability({
      provider: options.adapters.videoGeneration,
      resolver,
      // Video prompts are derived from validated director/image prompts
      // (1700–2100 chars reconciled) plus image base64; the default 500 was
      // sized for a placeholder and blocks the validated path. 3000 aligns
      // with the image adapter's evidence-backed AMF bound.
      policy: { maxPromptLength: 3000, ...options.policies?.videoGeneration },
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
  // media.compose is a deterministic local engine (FFmpeg), not a provider.
  routing.register(
    MEDIA_COMPOSE_CAPABILITY_ID,
    createMediaComposeCapability({ resolver, policy: options.policies?.mediaCompose }),
  );
  // timeline.plan is deterministic planning (zero external calls), always registered.
  routing.register(
    TIMELINE_PLAN_CAPABILITY_ID,
    createTimelinePlanCapability({ resolver, policy: options.policies?.timelinePlan }),
  );

  return {
    boundary: new RuntimeCapabilityExecutor({ resolver, executor: routing }),
    resolver,
    registeredCapabilityIds: [...routing.registeredIds].sort(),
    resolvedProviderIds: {
      ...(options.adapters.ttsGeneration === undefined ? {} : { [TTS_GENERATION_CAPABILITY_ID]: String((options.adapters.ttsGeneration as TTSGenerationProvider & { providerId?: string }).providerId ?? "unknown") }),
      [IMAGE_GENERATION_CAPABILITY_ID]: String((options.adapters.imageGeneration as ImageGenerationProvider & { providerId?: string }).providerId ?? "unknown"),
      [TIMELINE_PLAN_CAPABILITY_ID]: "deterministic-local",
    },
  };
}

export interface ProviderCapabilityEnvOptions {
  publishStore: PublishStore;
  publishSessionStore?: PublishSessionStore;
  onOperation?: OperationSink;
  capabilities?: readonly CapabilityDescriptor[];
  grants?: readonly CapabilityGrant[];
  policies?: ProviderCapabilityPolicies;
  ttsProvider?: TTSGenerationProvider;
  ttsSubmissionLifecycle?: VoicetutSubmissionLifecycle;
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
    ttsGeneration: resolveExplicitTTSProvider(options),
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
export function resolveExplicitTTSProvider(options: Pick<ProviderCapabilityEnvOptions, "ttsProvider" | "onOperation" | "ttsSubmissionLifecycle"> = {}): TTSGenerationProvider | undefined {
  if (options.ttsProvider !== undefined) return options.ttsProvider;
  if (process.env.TTS_PROVIDER === undefined || process.env.TTS_PROVIDER.trim().length === 0) {
    // TTS stays unregistered unless explicitly enabled via TTS_PROVIDER.
    return undefined;
  }
  try {
    return ttsAdapterFromEnv({ onOperation: options.onOperation, submissionLifecycle: options.ttsSubmissionLifecycle });
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
