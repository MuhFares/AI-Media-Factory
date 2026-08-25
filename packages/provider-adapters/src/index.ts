/**
 * @ai-media-factory/provider-adapters — real provider adapters wired into the
 * capability framework.
 *
 * Each adapter is a concrete implementation of its provider interface in
 * @ai-media-factory/tool-framework, with:
 *  - env-driven configuration validated eagerly (deterministic errors),
 *  - timeouts, retries and classified failures,
 *  - response validation (malformed provider data is never propagated),
 *  - provider-confirmed evidence.
 *
 * The wiring factory assembles the full boundary:
 *   createProviderCapabilityBoundary({ adapters, publishStore, ... }) ->
 *     { boundary: RuntimeCapabilityExecutor, resolver: CapabilityRegistry }
 */

// core
export {
  ProviderError,
  ProviderConfigurationError,
  ProviderAuthorizationError,
  ProviderValidationError,
  ProviderTransientError,
  ProviderTimeoutError,
  isProviderError,
} from "./core/errors.js";
export type { ProviderFailureCategory, ProviderErrorOptions } from "./core/errors.js";
export type { OperationOutcome, OperationSink } from "./core/observability.js";
export { sendHttp, sendHttpWithRetry, isRetryable } from "./core/http.js";
export type { OutgoingHttpRequest, HttpResponse, HttpStatusClassifier } from "./core/http.js";

// adapters
export { BraveSearchAdapter } from "./adapters/web-search.js";
export { braveSearchAdapterFromEnv } from "./adapters/web-search.js";
export type { BraveSearchConfig } from "./adapters/web-search.js";
export { TavilySearchAdapter } from "./adapters/web-search.js";
export { tavilySearchAdapterFromEnv } from "./adapters/web-search.js";
export type { TavilySearchConfig } from "./adapters/web-search.js";
export { SerperSearchAdapter } from "./adapters/web-search.js";
export { serperSearchAdapterFromEnv } from "./adapters/web-search.js";
export type { SerperSearchConfig } from "./adapters/web-search.js";
export { ExaSearchAdapter } from "./adapters/web-search.js";
export { exaSearchAdapterFromEnv } from "./adapters/web-search.js";
export type { ExaSearchConfig } from "./adapters/web-search.js";
export { OpenAIImagesAdapter } from "./adapters/image-generation.js";
export { openAIImageAdapterFromEnv } from "./adapters/image-generation.js";
export type { OpenAIImageConfig } from "./adapters/image-generation.js";
export { RunPodComfyUIImageAdapter } from "./adapters/runpod-image.js";
export { runPodImageAdapterFromEnv } from "./adapters/runpod-image.js";
export type { RunPodImageConfig } from "./adapters/runpod-image.js";
export { ReplicateVideoAdapter } from "./adapters/video-generation.js";
export { replicateVideoAdapterFromEnv } from "./adapters/video-generation.js";
export type { ReplicateVideoConfig } from "./adapters/video-generation.js";
export { RunPodWanVideoAdapter } from "./adapters/runpod-video.js";
export { runPodVideoAdapterFromEnv } from "./adapters/runpod-video.js";
export type { RunPodVideoConfig } from "./adapters/runpod-video.js";
export { GroqTTSAdapter } from "./adapters/groq-tts.js";
export { groqTTSAdapterFromEnv, chunkText } from "./adapters/groq-tts.js";
export type { GroqTTSConfig } from "./adapters/groq-tts.js";
export { VoicetutTTSAdapter } from "./adapters/voicetut-tts.js";
export { voicetutTTSAdapterFromEnv } from "./adapters/voicetut-tts.js";
export type { VoicetutTTSConfig } from "./adapters/voicetut-tts.js";
export { YouTubePublishAdapter, markerFor, watchUrl } from "./adapters/publishing.js";
export { youTubePublishAdapterFromEnv } from "./adapters/publishing.js";
export type { YouTubePublishConfig } from "./adapters/publishing.js";
export { YouTubeAnalyticsAdapter } from "./adapters/analytics.js";
export { youTubeAnalyticsAdapterFromEnv } from "./adapters/analytics.js";
export type { YouTubeAnalyticsConfig } from "./adapters/analytics.js";

// wiring - search
export { SearchProviderRegistry, searchAdapterFromEnv } from "./wiring/search-registry.js";
export { SEARCH_PROVIDER_ORDER, SEARCH_PROVIDER_ALIASES, normalizeSearchProviderId } from "./wiring/search-registry.js";
export type { SearchProviderImplementation, SearchAdapterEnvOptions } from "./wiring/search-registry.js";
// wiring - image
export { ImageProviderRegistry, imageAdapterFromEnv } from "./wiring/image-registry.js";
export { IMAGE_PROVIDER_ORDER, IMAGE_PROVIDER_ALIASES, normalizeImageProviderId } from "./wiring/image-registry.js";
export type { ImageProviderImplementation, ImageAdapterEnvOptions } from "./wiring/image-registry.js";
// wiring - video
export { VideoProviderRegistry, videoAdapterFromEnv } from "./wiring/video-registry.js";
export { VIDEO_PROVIDER_ORDER, VIDEO_PROVIDER_ALIASES, normalizeVideoProviderId } from "./wiring/video-registry.js";
export type { VideoProviderImplementation, VideoAdapterEnvOptions } from "./wiring/video-registry.js";
// wiring - publishing
export { PublishingProviderRegistry, publishingAdapterFromEnv } from "./wiring/publishing-registry.js";
export { PUBLISH_PROVIDER_ORDER, PUBLISH_PROVIDER_ALIASES, normalizePublishProviderId } from "./wiring/publishing-registry.js";
export type { PublishingProviderImplementation, PublishingAdapterEnvOptions } from "./wiring/publishing-registry.js";
// wiring - analytics
export { AnalyticsProviderRegistry, analyticsAdapterFromEnv } from "./wiring/analytics-registry.js";
export { ANALYTICS_PROVIDER_ORDER, ANALYTICS_PROVIDER_ALIASES, normalizeAnalyticsProviderId } from "./wiring/analytics-registry.js";
export type { AnalyticsProviderImplementation, AnalyticsAdapterEnvOptions } from "./wiring/analytics-registry.js";
// wiring - tts
export { TTSProviderRegistry, ttsAdapterFromEnv } from "./wiring/tts-registry.js";
export { TTS_PROVIDER_ORDER, TTS_PROVIDER_ALIASES, normalizeTTSProviderId } from "./wiring/tts-registry.js";
export type { TTSProviderImplementation, TTSAdapterEnvOptions } from "./wiring/tts-registry.js";
export {
  createProviderCapabilityBoundary,
  createProviderCapabilityBoundaryFromEnv,
  RoutingCapabilityExecutor,
} from "./wiring/boundary.js";
export type {
  ProviderAdapters,
  ProviderCapabilityBoundary,
  ProviderCapabilityBoundaryOptions,
  ProviderCapabilityEnvOptions,
  ProviderCapabilityPolicies,
} from "./wiring/boundary.js";
export { PROVIDER_CAPABILITIES, DEFAULT_PROVIDER_GRANTS } from "./wiring/registry.js";