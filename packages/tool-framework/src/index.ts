/**
 * @ai-media-factory/tool-framework — public contract surface.
 *
 * ARCHITECTURE ONLY. Re-exports the interface/type declarations that define
 * the Tool Execution Framework. No implementation is exported.
 *
 * The Runtime and Workflow Engine import from here and call ToolInvoker.invoke()
 * to execute tools through the framework. The framework handles all policy,
 * sandbox, retry, timeout, authentication, approval, and observability.
 * See ./README.md.
 */

// core - common primitives
export type {
  ToolId,
  AgentId,
  WorkflowId,
  StepId,
  InvocationId,
  ResultId,
  TraceId,
  CorrelationId,
  Timestamp,
  Approver,
  ProviderId,
  ToolCategory,
  Json,
  JsonSchema,
  Duration,
} from "./core/common.js";

// core - tool specification and interface (primary source for shared types)
export type {
  ToolPermission,
  AuthRequirement,
  SandboxLevel,
  SandboxConfig,
  ResourceLimits,
  RetryPolicyOverride,
  ToolSpec,
  ToolMetadata,
  Tool,
  ToolHealth,
  ToolInput,
  InvocationContext,
  CancellationToken,
  ResolvedCredentials,
  Certificate,
  ApprovalDecision,
  ToolErrorCode,
  ToolError,
  ExecutionMetadata,
  TokenUsage,
  SandboxInfo,
  ToolResult,
} from "./core/tool.js";

// core - tool implementation
export { BaseTool, createToolSpec, createInvocationContext, createCancellationToken } from "./core/tool-impl.js";

// registry
export type {
  ToolRegistry,
  ToolMetadata as RegistryToolMetadata,
  ValidationReport,
  ValidationError,
  ValidationWarning,
} from "./registry/registry.js";

export { DefaultToolRegistry } from "./registry/registry-impl.js";

// categories - unique types not in tool.ts
export type {
  CategoryConfig,
  CategoryRegistry,
  RetryPolicy as CategoryRetryPolicy,
} from "./categories/categories.js";

export { DEFAULT_CATEGORY_CONFIGS } from "./categories/categories.js";

// permissions
export type {
  Permission,
  PermissionPolicy,
  ConditionalPermission,
  PermissionContext,
  PermissionEvaluator,
} from "./permissions/permissions.js";

// policies
export type {
  ToolPolicy,
  TimeWindow,
  PolicyEvaluationRequest,
  PolicyDecision,
  PolicyOverride,
  PolicyEngine,
} from "./policies/policies.js";

// execution
export type { ToolInvoker } from "./execution/invocation.js";
export { DefaultToolInvoker } from "./execution/invoker.js";

// resilience
export type {
  RetryPolicy,
  ToolRetryPolicy,
  ToolError as RetryToolError,
} from "./resilience/retry.js";

export { DEFAULT_RETRY_POLICY } from "./resilience/retry.js";

export type {
  TimeoutController,
  TimeoutConfig,
  TimeoutState,
} from "./resilience/timeout.js";

export { DEFAULT_TIMEOUT_CONFIG } from "./resilience/timeout.js";

export {
  assessNarrationFit,
  assertNarrationWillNotBeCut,
  DEFAULT_NARRATION_FIT_POLICY,
} from "./media-compose/narration-fit.js";
export type {
  NarrationFitPolicy,
  NarrationFitResult,
  NarrationFitStatus,
  VideoTailPadDecision,
  VideoTailPadPolicy,
} from "./media-compose/narration-fit.js";
export { layoutCaption, DEFAULT_VERTICAL_CAPTION_POLICY } from "./media-compose/caption-layout.js";
export type { CaptionLayoutPolicy, CaptionLayoutResult, CaptionLayoutVerdict } from "./media-compose/caption-layout.js";
export { selectVoice } from "./tts/voice-catalog.js";
export type { VoiceCatalogRecord, VoiceEvidenceProvenance, VoiceMetadataConfidence, VoiceProductionStatus } from "./tts/voice-catalog.js";

// sandbox - unique types not in tool.ts
export type {
  SandboxHandle,
  ToolSandbox,
} from "./sandbox/sandbox.js";

export { SANDBOX_LEVELS } from "./sandbox/sandbox.js";

// auth - unique types not in tool.ts
export type {
  CredentialResolver,
  AuthContext,
  CredentialStore,
} from "./auth/auth.js";

// gates - unique types not in tool.ts
export type {
  ApprovalGate,
  ApprovalRequest,
  ApprovalDecision as GateApprovalDecision,
  ApprovalContext,
  ApprovalRule,
} from "./gates/approval.js";

export { DEFAULT_APPROVAL_RULES } from "./gates/approval.js";

// results - all re-exported from tool.ts (ToolResult, ToolError, ToolErrorCode, ExecutionMetadata, TokenUsage, SandboxInfo)

// observability
export type { LogLevel, ToolLogger, InvocationLogEntry } from "./observability/logging.js";

export type { ToolMetrics, ToolMetricsSnapshot } from "./observability/metrics.js";

export type { CostTracker, CostBreakdown, TokenUsage as CostTokenUsage, CostEstimator } from "./observability/cost.js";

// capabilities - injectable boundary contracts (no implementations)
export type {
  CapabilityId,
  CapabilityPattern,
  CapabilityRequest,
  CapabilityResult,
  CapabilitySuccess,
  CapabilityBlocked,
  CapabilityFailure,
  CapabilityExecutorPort,
  CapabilityDescriptor,
  CapabilityAuthorization,
  CapabilityResolver,
  ExecutionEvidence,
  ProviderFailureMetadata,
} from "./capabilities.js";
export { sanitizeProviderFailureMetadata } from "./core/provider-failure.js";
export { chunkNarration, reconstructNarration } from "./tts/chunking.js";
export type { TTSChunk } from "./tts/chunking.js";
export { TTSChunkExecutionCoordinator } from "./tts/chunk-execution-coordinator.js";
export type { TTSChunkProviderResult, TTSChunkExecution, TTSChunkArtifact, TTSChunkCoordinatorStore, TTSChunkCoordinatorOptions } from "./tts/chunk-execution-coordinator.js";

// capability registry + authorization policy
export type {
  AuthorizationPolicy,
  CapabilityGrant,
} from "./capability-registry/authorization-policy.js";
export {
  DefaultAuthorizationPolicy,
} from "./capability-registry/authorization-policy.js";
export type {
  CapabilityRegistry,
  CapabilityRegistryOptions,
  CreateCapabilityRegistryOptions,
} from "./capability-registry/capability-registry.js";
export {
  DefaultCapabilityRegistry,
  createCapabilityRegistry,
} from "./capability-registry/capability-registry.js";

// filesystem capability
export {
  FilesystemCapabilityExecutor,
  FILESYSTEM_CAPABILITY_ID,
} from "./filesystem/filesystem-capability.js";
export type {
  FilesystemOperation,
  FilesystemCapabilityInput,
  FilesystemCapabilityOutput,
  FilesystemCapabilityPolicy,
} from "./filesystem/filesystem-capability.js";

// command capability
export {
  CommandCapabilityExecutor,
  COMMAND_CAPABILITY_ID,
} from "./command/command-capability.js";
export type {
  AllowedCommand,
  CommandCapabilityInput,
  CommandCapabilityOutput,
  CommandCapabilityPolicy,
  CommandEnvironmentPolicy,
} from "./command/command-capability.js";

// web search capability
export {
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
  WEB_SEARCH_MAX_QUERY_LENGTH,
} from "./web-search/web-search-capability.js";
export type {
  WebSearchRequest,
  WebSearchResult,
  WebSearchProviderResponse,
  WebSearchProvider,
  WebSearchCapabilityInput,
  WebSearchCapabilityOutput,
  WebSearchCapabilityPolicy,
} from "./web-search/web-search-capability.js";

// image generation capability
export {
  ImageGenerationCapabilityExecutor,
  IMAGE_GENERATION_CAPABILITY_ID,
  IMAGE_PROMPT_MAX_CHARS,
  IMAGE_NEGATIVE_PROMPT_MAX_CHARS,
  createImageGenerationCapability,
} from "./image-generation/image-generation-capability.js";
export type { VisualDirection } from "./image-generation/visual-direction.js";
export { assembleAppearancePrompt, assembleNegativeConstraints, deterministicImageSeed } from "./image-generation/visual-direction.js";
export { VISUAL_MODE_V2, TEXT_POLICIES, UI_POLICIES, validateVisualDirectionContract, compileScenePrompt, compileScenePromptForTarget, routeVisualSemanticStatus, checkWorldScope, SEMANTIC_QA_DIMENSIONS, unknownSemanticDimensions } from "./visual-direction/visual-direction-contract-v2.js";
export type { VisualModeV2, TextPolicy, UiPolicy, StoryVisualIdentity, GlobalContinuity, CharacterContract, TextUiPolicy, SceneContractV2, VisualDirectionContractV2, CompiledScenePrompt, PromptEnvelopeV2, ContractValidation, CompileResult, SemanticRoute, SemanticQaDimension, ImageTarget, WorldScope, TargetCompileResult, WorldScopeExpectation } from "./visual-direction/visual-direction-contract-v2.js";
export { VISUAL_DIRECTOR_AGENT_ID, VISUAL_DIRECTOR_ROLE, VISUAL_DIRECTOR_RESPONSIBILITIES, VISUAL_DIRECTOR_CONSTRAINTS, VISUAL_DIRECTOR_INPUT_KINDS, VISUAL_DIRECTOR_OUTPUT_KIND, buildVisualDirectorInputPackage, buildCompactVisualDirectorInput } from "./visual-direction/visual-director-spec.js";
export type { VisualDirectorInputPackage, CompactVisualDirectorInput } from "./visual-direction/visual-director-spec.js";
export { VISUAL_MODES, REFERENCE_STRATEGIES, createVisualStrategy, evaluateImageGate, isVisualResearchResult } from "./visual-capability/visual-capability.js";
export type { VisualMode, ReferenceStrategy, VisualEvidence, VisualResearchResult, VisualStrategy, ImageReviewInput, ImageQAInput, ImageGateResult } from "./visual-capability/visual-capability.js";
export { calculateVisualCost } from "./visual-capability/cost-accounting.js";
export type { VisualCostConfidence, VisualCostInput, VisualCostResult } from "./visual-capability/cost-accounting.js";
export {
  VISUAL_CONTENT_DOMAINS,
  VISUAL_CAPABILITY_REQUIREMENTS,
  VISUAL_EXECUTION_ROUTES,
  selectVisualRoute,
  MANUAL_EXTERNAL_GENERATION_STATES,
  canAdvanceManualGeneration,
  VISUAL_REVIEW_ORDER,
  AUTOMATED_SEMANTIC_REVIEW_UNAVAILABLE,
  VISUAL_PROVIDER_ROUTING_BENCHMARK_V1,
} from "./visual-capability/visual-production-routing.js";
export type {
  VisualContentDomain,
  VisualCapabilityRequirement,
  VisualExecutionRoute,
  EvidenceVerdict,
  ReviewVerdict,
  ProviderCapabilityProfile,
  VisualRoutingRequest,
  VisualRoutingDecision,
  ManualExternalGenerationState,
  ManualExternalGenerationRequest,
  HumanAssetProvenance,
  RoutingBenchmarkCase,
} from "./visual-capability/visual-production-routing.js";
export type {
  ImageGenerationRequest,
  ImageGenerationProviderResponse,
  ImageGenerationProvider,
  ImageGenerationCapabilityInput,
  ImageGenerationCapabilityOutput,
  ImageGenerationCapabilityPolicy,
} from "./image-generation/image-generation-capability.js";
export {
  FLUX_SELF_HOSTED_PROFILE,
  ZIMAGE_PROFILE,
  profileForProvider,
  fitsPromptBudget,
  checkReferenceSupport,
  recommendImageCapability,
} from "./visual-capability/image-capability-profiles.js";
export type {
  ImageEndpointClass,
  ImagePromptLimit,
  ImageReferenceSupport,
  ImageCapabilityProfile,
  ImageReferenceRole,
  ImageReferenceInput,
  BatchRoutingInput,
  BatchRoutingDecision,
} from "./visual-capability/image-capability-profiles.js";

// video generation capability
export {
  VideoGenerationCapabilityExecutor,
  VIDEO_GENERATION_CAPABILITY_ID,
  videoGenerationIdentity,
  createVideoGenerationCapability,
} from "./video-generation/video-generation-capability.js";
export type {
  VideoGenerationStatus,
  VideoGenerationRequest,
  VideoGenerationProviderResponse,
  VideoGenerationProvider,
  VideoGenerationCapabilityInput,
  VideoGenerationCapabilityOutput,
  VideoGenerationCapabilityPolicy,
} from "./video-generation/video-generation-capability.js";

// tts generation capability
export {
  TTSGenerationCapabilityExecutor,
  TTS_GENERATION_CAPABILITY_ID,
  createTTSGenerationCapability,
} from "./tts/tts-capability.js";
export type {
  TTSGenerationRequest,
  TTSGenerationProviderResponse,
  TTSGenerationProvider,
  TTSGenerationCapabilityInput,
  TTSGenerationCapabilityOutput,
  TTSGenerationCapabilityPolicy,
} from "./tts/tts-capability.js";

// publishing capability
export {
  PublishingCapabilityExecutor,
  PUBLISH_CAPABILITY_ID,
  PUBLISH_PLATFORM,
  idempotencyKeyFor,
  createPublishingCapability,
} from "./publishing/publishing-capability.js";
export { mediaTransportFingerprint, preflightMediaTransport, readVerifiedLocalMedia } from "./publishing/media-transport.js";
export type { MediaTransportRef, MediaTransportPreflight } from "./publishing/media-transport.js";
export { normalizeFinalTechnicalQa } from "./publishing/final-technical-qa.js";
export type { NormalizedTechnicalQa, NormalizedTechnicalQaState } from "./publishing/final-technical-qa.js";
export {
  PUBLICATION_VALIDATOR_VERSION,
  PUBLICATION_VALIDATION_SCOPE,
  PUBLIC_PUBLISH_SCOPE,
  PRIVATE_VALIDATION_SCOPE,
  canonicalJson,
  sha256Canonical,
  publicationIdentityV2,
  validationPublicationIdentity,
  validatePublicationIntegration,
} from "./publishing/publication-validation.js";
export type {
  CanonicalPublicationPayload,
  PublicationAuthority,
  PublicationValidationInput,
  PublicationIntegrationValidation,
  PublicationIdentityV2Input,
} from "./publishing/publication-validation.js";
export type {
  PublishingPlatform,
  PublishStatus,
  PublishRequest,
  PublishingProviderResponse,
  PublishingProvider,
  PublishStore,
  PublishingCapabilityInput,
  PublishingCapabilityOutput,
  PublishingCapabilityPolicy,
} from "./publishing/publishing-capability.js";

// analytics capability
export {
  AnalyticsCapabilityExecutor,
  ANALYTICS_CAPABILITY_ID,
  ANALYTICS_PLATFORM,
  createAnalyticsCapability,
} from "./analytics/analytics-capability.js";
export type {
  AnalyticsPlatform,
  AnalyticsStatus,
  PerformanceMetrics,
  AnalyticsFetchRequest,
  AnalyticsProviderResponse,
  AnalyticsProvider,
  AnalyticsCapabilityInput,
  AnalyticsCapabilityOutput,
  AnalyticsCapabilityPolicy,
} from "./analytics/analytics-capability.js";

// media compose capability (deterministic local FFmpeg engine, not a provider)
export {
  MediaComposeCapabilityExecutor,
  MEDIA_COMPOSE_CAPABILITY_ID,
  createMediaComposeCapability,
} from "./media-compose/media-compose-capability.js";
export type {
  MediaComposeCapabilityInput,
  MediaComposeCapabilityOutput,
  MediaComposeCapabilityPolicy,
} from "./media-compose/media-compose-capability.js";
export { padVideoTail, probeAudioFile, probeVideoFile, stitchVideoClips, videoTailPadArgs } from "./media-compose/media-compose-adapter.js";
export type { ComposeEditPlan, VideoProbe } from "./media-compose/media-compose-adapter.js";

// timeline planning capability (deterministic, zero external calls)
export {
  TimelinePlanCapabilityExecutor,
  TIMELINE_PLAN_CAPABILITY_ID,
  createTimelinePlanCapability,
} from "./timeline/timeline-capability.js";
export type {
  TimelinePlanCapabilityInput,
  TimelinePlanCapabilityOutput,
  TimelinePlanCapabilityPolicy,
} from "./timeline/timeline-capability.js";
export { DeterministicTimelinePlanner } from "./timeline/timeline-planner.js";
export type {
  TimelinePlan,
  TimelineScene,
  TimelineCharacter,
  TimelinePlanner,
  TimelinePlannerInput,
  VisualType,
  SpeakingMode,
} from "./timeline/timeline-planner.js";
export {
  CONTEMPORARY_CAIRO_GROUNDING,
  TEXT_FREE_IMAGE_POLICY,
  SINGLE_SHOT_POLICY,
  buildSceneVisualBrief,
  buildBriefImagePrompt,
  buildBriefNegativePrompt,
  evaluatePreWanImage,
  validateSceneVisualBrief,
} from "./timeline/visual-brief.js";
export type { CairoVisualGrounding, SceneVisualBrief, PreWanGateStatus, PreWanImageSignals, PreWanImageGateResult } from "./timeline/visual-brief.js";
export { evaluatePreWanGovernance, issueWanAuthorization, validateWanAuthorization } from "./timeline/pre-wan-governance.js";
export type { GeneratedVisualArtifact, VisualSemanticReview, VisualTechnicalQA, HumanVisualApproval, WanAuthorization, PreWanDecision } from "./timeline/pre-wan-governance.js";
export { assertMeasuredNarration, assertSceneLineage } from "./media-chain/contracts.js";
export type { NarrationArtifact, FinalMediaArtifact } from "./media-chain/contracts.js";
export {
  PROGRAM_04_MEDIA_POLICY_VERSION,
  assertCanonicalMediaInput,
  preflightReferenceAsset,
  mediaConfigurationFingerprint,
  evaluateMediaConfigurationAuthorization,
  evaluateCaptionVerification,
  evaluateVisualContinuity,
  InMemoryVideoSubmissionLedger,
  assertCanonicalFinalMedia,
  assertCanonicalAnalyticsJoin,
  assertLearningEvidenceBinding,
  LEGACY_MEDIA_POLICY,
  assertCanonicalNewProductionArtifact,
  assertMediaAccountingIdentity,
} from "./media-chain/program-04-contracts.js";
export type {
  MediaFailureClass, CanonicalMediaInput, ReferenceTransport, ReferenceAsset,
  ReferencePreflightContext, ReferencePreflightResult, FrozenMediaConfiguration,
  CaptionVerification, VideoSubmissionIntent, VideoSubmissionState,
  VideoSubmissionRecord, CanonicalFinalMedia, CanonicalAnalyticsJoin,
  CostProvenance, MediaAccountingIdentity,
} from "./media-chain/program-04-contracts.js";
export { assertResearchEvidence, assertSceneContract, assertProviderAccounting, evaluateFinalDelivery, assertNoExternalCalls } from "./production-policy.js";
export { resolveConsistencyRoute, identityConditioningSupported } from "./visual-capability/consistency-routing.js";
export type { ConsistencyResolution, ConsistencyRouteInput } from "./visual-capability/consistency-routing.js";
export { FORMAT_PROFILES, formatProfile, orderScenesForComposition } from "./content-factory/formats.js";
export type { FormatProfile } from "./content-factory/formats.js";
export { subjectToCharacterContract, sceneSpecToSceneContract, brandContextSummary, compositionSceneOrder } from "./content-factory/subject-contracts.js";
export type { BrandContextInput } from "./content-factory/subject-contracts.js";
export { assembleScenePrompt } from "./content-factory/prompt-assembly.js";
export type { PromptAssemblyInput, AssembledPrompt } from "./content-factory/prompt-assembly.js";
export { checkImageArtifact, consistencyState, thumbnailPresent } from "./content-factory/media-qa.js";
export type { ImageArtifactView, ImageExpectation, ImageCheck, ConsistencyState } from "./content-factory/media-qa.js";
export { intentToImageRequest } from "./content-factory/generation-intent.js";
export type { ReferenceResolution, SceneGenerationIntent, AdapterImageRequest, CapabilityResolution } from "./content-factory/generation-intent.js";
export type { ClosureDisposition, ResearchEvidenceContract, SceneContract, FinalDeliveryContract, ProviderAccountingContract } from "./production-policy.js";
export {
  STORAGE_CLASSES,
  SHA256_PATTERN,
  assertArtifactStorageIdentity,
  canonicalStorageKey,
} from "./artifact-storage/contracts.js";
export type {
  StorageClass,
  DurabilityStatus,
  RetentionClass,
  ArtifactStorageIdentity,
  ArtifactStorageReceipt,
  PutObjectRequest,
  StoredObjectHead,
  ReadTransportReference,
  DeleteObjectGuard,
  ObjectStorageAdapter,
} from "./artifact-storage/contracts.js";
export { LocalDurableObjectStorage, LOCAL_DURABLE_TEST_ACKNOWLEDGEMENT } from "./artifact-storage/local-durable-backend.js";
export { resolveDurablePublicationTransport } from "./publishing/durable-media-transport.js";
export type { DurablePublicationMedia } from "./publishing/durable-media-transport.js";
