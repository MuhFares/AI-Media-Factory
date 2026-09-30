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
  SubmissionOutcomeUnknownError,
  isProviderError,
  parseGoogleErrorCause,
  redactSecretText,
  attachGoogleCause,
} from "./core/errors.js";
export type { ProviderFailureCategory, ProviderErrorOptions, GoogleErrorCause } from "./core/errors.js";
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
export { ApifySocialIntelligenceAdapter } from "./adapters/apify-social.js";
export { apifySocialAdapterFromEnv } from "./adapters/apify-social.js";
export type { ApifySocialConfig } from "./adapters/apify-social.js";
export { BrightDataSocialIntelligenceAdapter, brightDataSocialAdapterFromEnv } from "./adapters/bright-data-social.js";
export type { BrightDataSocialConfig } from "./adapters/bright-data-social.js";
export { OpenAIImagesAdapter } from "./adapters/image-generation.js";
export { openAIImageAdapterFromEnv } from "./adapters/image-generation.js";
export type { OpenAIImageConfig } from "./adapters/image-generation.js";
export { RunPodComfyUIImageAdapter } from "./adapters/runpod-image.js";
export { runPodImageAdapterFromEnv } from "./adapters/runpod-image.js";
export type { RunPodImageConfig } from "./adapters/runpod-image.js";
export { RunPodZImageAdapter, runPodZImageAdapterFromEnv } from "./adapters/runpod-zimage.js";
export type { RunPodZImageConfig } from "./adapters/runpod-zimage.js";
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
export { voicetutTTSAdapterFromEnv, voicetutExecutionIdentityFromEnv } from "./adapters/voicetut-tts.js";
export type { VoicetutTTSConfig, VoicetutExecutionIdentity } from "./adapters/voicetut-tts.js";
export type { VoicetutSubmissionIdentity, VoicetutSubmissionLifecycle } from "./adapters/voicetut-tts.js";
export { YouTubePublishAdapter, markerFor, watchUrl, requirePrivateVisibility, assertYouTubeTitle, YOUTUBE_TITLE_MAX_LENGTH } from "./adapters/publishing.js";
export {
  GOOGLE_OAUTH_AUTHORIZE_URL, GOOGLE_OAUTH_TOKEN_URL, YOUTUBE_CHANNELS_URL, YOUTUBE_OAUTH_SCOPES,
  readDesktopClientJson, buildAuthorizeUrl, loopbackRedirectUri, browserOpenCommand,
  exchangeCode, persistCredential, readCredential, refreshAccessToken,
  verifyChannel, credentialStatus, OAuthError,
} from "./oauth/youtube-oauth.js";
export type { DesktopClientConfig, DurableCredential, OAuthTransport, ChannelVerification } from "./oauth/youtube-oauth.js";
export {
  M4_CONTROLLED_CHANNEL_ID, M4_REJECTED_CHANNEL_ID, M4_REQUIRED_SCOPES, M4_BUDGET,
  assertCredentialScopes, assertControlledChannel, prepareM4Upload, M4GuardError,
} from "./oauth/youtube-m4-guard.js";
export type { M4BudgetPolicy, M4ReadyBundle, M4PrepareDeps, M4PrepareInput } from "./oauth/youtube-m4-guard.js";
export { youTubePublishAdapterFromEnv } from "./adapters/publishing.js";
export type { YouTubePublishConfig } from "./adapters/publishing.js";
export { YouTubeAnalyticsAdapter, NON_MONETARY_METRICS } from "./adapters/analytics.js";
export { YouTubeResearchAdapter, parseYouTubeVideoId } from "./adapters/youtube-research.js";
export type { YouTubeResearchConfig, YouTubeResearchRequest, YouTubeResearchResponse, YouTubeResearchEvidence } from "./adapters/youtube-research.js";
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
  resolveExplicitTTSProvider,
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
