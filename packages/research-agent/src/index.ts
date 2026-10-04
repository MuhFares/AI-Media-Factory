/**
 * @ai-media-factory/research-agent — public contract surface.
 */

export type {
  ResearchAgentDependencies,
} from "./research-agent.js";
export {
  TARGETED_VERIFICATION_MODE,
  buildTargetedVerificationPlan,
  validateTargetedReevaluation,
} from "./targeted-verification.js";
export type {
  TargetedVerificationDispatchInput,
  TargetedVerificationPlanEntry,
  TargetedCandidateReevaluation,
} from "./targeted-verification.js";

export type {
  ResearchAgentInput,
  ResearchSource,
  ResearchCitation,
  ResearchReport,
  ResearchPlan,
  ResearchCandidateStory,
  ResearchCallUsage,
  ResearchConfig,
  ResearchExecutionInput,
  ResearchExecutionOutput,
  ResearchObjective,
  ResearchMission,
  DiscoveryLane,
  CapabilitySupportEntry,
  CandidateOpportunity,
  CandidateVerificationPlan,
  ContentOpportunityAssessment,
  FactualVerification,
} from "./research-types.js";
export type { VisualResearchResult, VisualEvidence } from "@ai-media-factory/tool-framework";
export type { ResearchMode, ResearchSourceType, ResearchPlatform, ResearchCapability, AccessMode, CapabilityStatus, FreshnessRequirement, EvidenceKind, SourceCapability, ResearchBudget, ResearchSourcePlan, ResearchSourceStrategy, ResearchRequest, ResearchEvidence, OriginalityConstraints, ReferenceContentAnalysis, ContentIntelligenceResult, ResearchResult, YouTubeResearchPort } from "./content-intelligence.js";
export type { SocialPlatform, SocialProvider, SocialCapability, SocialAccessMode, SocialCapabilityStatus, SocialRunStatus, TranscriptProvenance, SocialAccessRisk, SocialCapabilityProfile, SocialProviderCapabilityRegistration, SocialEvidenceInput, SocialEvidence, SocialResearchRequest, SocialResearchResponse, SocialIntelligencePort, SocialProviderSelectionPolicy } from "./social-intelligence.js";
export { RESEARCH_MODES, DEFAULT_RESEARCH_BUDGET, canonicalizeResearchUrl, researchSurfacePlan, researchSourceStrategy, freshnessSatisfied, normalizeEvidence, normalizeSearchEvidence, newsEvidenceEligible, ResearchSourceRouter, assertProjectLocalPath, ingestLocalReferenceVideo } from "./content-intelligence.js";
export { normalizeSocialEvidence, parseSocialReferenceUrl, socialReferenceFallback, boundSocialResults, deduplicateSocialEvidence, socialResultFromUnavailable, eligibleSocialProviders, DEFAULT_SOCIAL_PROVIDER_POLICY, DEFAULT_SOCIAL_REGISTRATIONS, SocialCapabilityRouter } from "./social-intelligence.js";

export type {
  ResearchContractIdentity,
  ResearchCapabilityReasonCode,
  ResearchCapabilityLifecycleState,
  ResearchCapabilityOutcome,
} from "./research-agent.js";
export {
  ResearchAgent,
  createResearchAgent,
  DEFAULT_RESEARCH_SYSTEM_PROMPT,
  diagnoseResearchStructure,
  ResearchStructuralValidationError,
  ResearchAuthorityViolationError,
  assertResearchAuthorityBoundary,
  isRelevantResearchDescription,
  validateResearchContractIdentity,
  classifyResearchCapabilityError,
  buildVerificationQueryFor,
  MAX_DISCOVERY_REQUESTS,
  MAX_VERIFICATION_REQUESTS,
  MAX_CANDIDATES,
  FINAL_SYNTHESIS_MIN_OUTPUT_TOKENS,
  CANONICAL_DISCOVERY_LANES,
  compileDiscoveryQuery,
  packWebSearchQuery,
  finalizeWebSearchQuery,
  evaluateDiscoveryQueryQuality,
  materializeDiscoveryRetrievalPlan,
  researchCapabilityInvocationIdentity,
  researchDirectionResponseSchema,
  normalizeResearchDirectionStageForRecovery,
  RESEARCH_DIRECTION_REQUIRED_FIELDS,
  normalizeRuntimeIdentityEchoes,
} from "./research-agent.js";
export type {
  DiscoveryQueryQuality,
  ExecutableRetrievalPlanEntry,
  PackedWebSearchQuery,
  QuerySemanticPriority,
  RetainedQueryContext,
  RuntimeIdentityEcho,
  WebSearchPackingTrace,
  WebSearchSemanticRequirement,
  ResearchCapabilityInvocationIdentityInput,
} from "./research-agent.js";
