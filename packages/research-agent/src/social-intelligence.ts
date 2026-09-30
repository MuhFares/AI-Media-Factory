import { createHash } from "node:crypto";
import { canonicalizeResearchUrl, normalizeEvidence, type ContentIntelligenceResult, type EvidenceKind, type ResearchBudget, type ResearchEvidence, type ResearchRequest } from "./content-intelligence.js";

export type SocialPlatform = "INSTAGRAM" | "TIKTOK" | "OTHER";
export type SocialProvider = "APIFY" | "BRIGHT_DATA" | (string & {});
  export type SocialCapability = "SOCIAL_DISCOVERY" | "SOCIAL_CONTENT_DISCOVERY" | "SOCIAL_SEARCH" | "SOCIAL_POST_METADATA" | "SOCIAL_VIDEO_METADATA" | "SOCIAL_REEL_METADATA" | "SOCIAL_CREATOR_METADATA" | "SOCIAL_PROFILE_INTELLIGENCE" | "SOCIAL_HASHTAG_DISCOVERY" | "SOCIAL_HASHTAG_INTELLIGENCE" | "SOCIAL_COMMENT_INTELLIGENCE" | "SOCIAL_ENGAGEMENT" | "SOCIAL_TRANSCRIPT" | "SOCIAL_AUDIO_METADATA" | "SOCIAL_TREND_DISCOVERY" | "SOCIAL_LISTENING" | "SOCIAL_REFERENCE_ANALYSIS" | "SOCIAL_REFERENCE_FETCH";
export type SocialAccessMode = "PUBLIC" | "API" | "AUTHENTICATED_API" | "USER_PROVIDED" | "LOCAL_FILE" | "UNAVAILABLE";
export type SocialCapabilityStatus = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "UNKNOWN" | "ACTOR_DEPENDENT" | "AUTH_REQUIRED" | "PAID";
export type SocialRunStatus = "SUBMITTED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED_OUT" | "SUBMISSION_OUTCOME_UNKNOWN";
export type TranscriptProvenance = "PLATFORM_PROVIDED" | "PROVIDER_GENERATED" | "AI_GENERATED" | "UNKNOWN";

export interface SocialAccessRisk { publicDataOnly: boolean; loginRequired: boolean; providerManagedAccess: boolean; platformRestrictionRisk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; dataAvailabilityRisk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; schemaDriftRisk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; actorMaintenanceRisk: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; termsRisk: "REVIEW_REQUIRED" | "UNKNOWN"; copyrightRisk: "REVIEW_REQUIRED" | "UNKNOWN"; privacyRisk: "REVIEW_REQUIRED" | "UNKNOWN"; geographicRestriction?: string; knownLimitations: string[]; }
export interface SocialCapabilityProfile { provider: SocialProvider; platform: SocialPlatform; capability: SocialCapability; status: SocialCapabilityStatus; accessMode: SocialAccessMode; costClassification: "FREE_PUBLIC" | "FREE_QUOTA" | "PAID_API" | "AUTH_REQUIRED" | "USER_PROVIDED" | "UNKNOWN"; source?: string; limitations?: string[]; }
export interface SocialProviderCapabilityRegistration extends SocialCapabilityProfile { product?: string; providerDataset?: string; remainingFreeAllowance?: number; estimatedCostUsd?: number; historicalSuccessRate?: number; dataRichness?: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN"; }
export interface SocialEvidenceInput { platform: SocialPlatform; provider: SocialProvider; platformContentId?: string; canonicalUrl?: string; title?: string; caption?: string; description?: string; creatorId?: string; creatorName?: string; publishedAt?: string; durationSeconds?: number; thumbnail?: Record<string, unknown>; mediaUrlReference?: string; viewCount?: number; likeCount?: number; commentCount?: number; shareCount?: number; saveCount?: number; hashtags?: string[]; mentions?: string[]; audioId?: string; audioTitle?: string; audioAuthor?: string; transcript?: string; transcriptProvenance?: TranscriptProvenance; language?: string; retrievedAt: string; query?: string; accessMethod: SocialAccessMode; source?: string; limitations?: string[]; kind?: EvidenceKind; }
export interface SocialEvidence extends ResearchEvidence { platformContentId?: string; provider?: SocialProvider; creatorId?: string; caption?: string; hashtags?: string[]; mentions?: string[]; audioId?: string; audioTitle?: string; audioAuthor?: string; transcriptProvenance?: TranscriptProvenance; }
export interface SocialResearchRequest extends ResearchRequest { platforms: ("INSTAGRAM" | "TIKTOK")[]; capability: SocialCapability; maxResults?: number; referenceUrl?: string; }
export interface SocialResearchResponse { provider: SocialProvider; status: SocialRunStatus; results: SocialEvidence[]; runId?: string; requestsMade: number; cost?: { amountUsd?: number; classification: "UNKNOWN" | "ESTIMATED" | "PROVIDER_REPORTED" }; limitations: string[]; normalizationWarnings?: string[]; }
export interface SocialIntelligencePort { research(request: SocialResearchRequest): Promise<SocialResearchResponse>; }

export interface SocialProviderSelectionPolicy {
  preferredProviders?: Partial<Record<SocialCapability, SocialProvider>>;
  allowFallback?: boolean;
}

export const DEFAULT_SOCIAL_PROVIDER_POLICY: SocialProviderSelectionPolicy = {
  preferredProviders: {
    SOCIAL_CONTENT_DISCOVERY: "APIFY",
    SOCIAL_DISCOVERY: "APIFY",
    SOCIAL_REEL_METADATA: "APIFY",
    SOCIAL_POST_METADATA: "APIFY",
  },
  allowFallback: true,
};

export const DEFAULT_SOCIAL_REGISTRATIONS: SocialProviderCapabilityRegistration[] = [
  { provider: "APIFY", platform: "INSTAGRAM", capability: "SOCIAL_CONTENT_DISCOVERY", status: "SUPPORTED", accessMode: "API", costClassification: "PAID_API", dataRichness: "HIGH" },
  { provider: "APIFY", platform: "INSTAGRAM", capability: "SOCIAL_REEL_METADATA", status: "SUPPORTED", accessMode: "API", costClassification: "PAID_API", dataRichness: "HIGH" },
  { provider: "APIFY", platform: "INSTAGRAM", capability: "SOCIAL_POST_METADATA", status: "SUPPORTED", accessMode: "API", costClassification: "PAID_API", dataRichness: "HIGH" },
  { provider: "BRIGHT_DATA", platform: "INSTAGRAM", capability: "SOCIAL_REEL_METADATA", status: "SUPPORTED", accessMode: "API", costClassification: "PAID_API", dataRichness: "MEDIUM" },
  { provider: "BRIGHT_DATA", platform: "INSTAGRAM", capability: "SOCIAL_POST_METADATA", status: "SUPPORTED", accessMode: "API", costClassification: "PAID_API", dataRichness: "MEDIUM" },
];

function isKnownTerminalFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { category?: string; statusCode?: number; retryable?: boolean; reconciliationRequired?: boolean };
  if (value.reconciliationRequired === true || value.retryable === true || value.category === "TIMEOUT" || value.category === "TRANSIENT") return false;
  return value.category === "AUTHORIZATION" || value.category === "VALIDATION" || value.statusCode === 401 || value.statusCode === 403 || value.statusCode === 400;
}

export class SocialCapabilityRouter implements SocialIntelligencePort {
  private externalRequests = 0;
  private paidProviderRuns = 0;
  constructor(
    private readonly registrations: SocialProviderCapabilityRegistration[] = DEFAULT_SOCIAL_REGISTRATIONS,
    private readonly providers: Partial<Record<string, SocialIntelligencePort>> = {},
    private readonly budget: ResearchBudget = { maxExternalRequests: 6, maxPaidProviderRuns: 2, maxEstimatedCostUsd: 0.05, maxResultsPerSource: 3, allowFallback: true, allowExperimentalProviders: false },
    private readonly policy: SocialProviderSelectionPolicy = DEFAULT_SOCIAL_PROVIDER_POLICY,
  ) {}

  eligibleProviders(capability: SocialCapability, platform: SocialPlatform): SocialProviderCapabilityRegistration[] {
    const preferred = this.policy.preferredProviders?.[capability];
    return eligibleSocialProviders(capability, platform, this.registrations)
      .filter((entry) => entry.status === "SUPPORTED" || entry.status === "PAID")
      .filter((entry) => this.policy.allowFallback !== false || entry.provider === preferred)
      .sort((a, b) => (a.provider === preferred ? -1 : 0) - (b.provider === preferred ? -1 : 0));
  }

  async research(request: SocialResearchRequest): Promise<SocialResearchResponse> {
    if (request.platforms.length !== 1) throw new Error("SocialCapabilityRouter requires one platform per provider operation");
    const candidates = this.eligibleProviders(request.capability, request.platforms[0]);
    if (candidates.length === 0) throw new Error(`No production-eligible social provider for ${request.platforms[0]} ${request.capability}`);
    let lastError: unknown;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const provider = this.providers[candidate.provider];
      if (provider === undefined) continue;
      if (this.externalRequests >= this.budget.maxExternalRequests || this.paidProviderRuns >= this.budget.maxPaidProviderRuns) throw new Error("Research budget exhausted before social provider execution");
      this.externalRequests += 1;
      this.paidProviderRuns += 1;
      try {
        return await provider.research({ ...request, maxResults: Math.min(request.maxResults ?? this.budget.maxResultsPerSource, this.budget.maxResultsPerSource) });
      } catch (error) {
        lastError = error;
        const canFallback = this.policy.allowFallback !== false && this.budget.allowFallback && index < candidates.length - 1 && isKnownTerminalFailure(error);
        if (!canFallback) throw error;
      }
    }
    throw lastError ?? new Error("No configured social provider for the eligible registrations");
  }
}

export function eligibleSocialProviders(capability: SocialCapability, platform: SocialPlatform, registrations: SocialProviderCapabilityRegistration[]): SocialProviderCapabilityRegistration[] {
  return registrations.filter((entry) => entry.platform === platform && entry.capability === capability && ["SUPPORTED", "PARTIAL", "PAID"].includes(entry.status));
}

export function normalizeSocialEvidence(input: SocialEvidenceInput): SocialEvidence {
  const url = input.canonicalUrl ?? input.mediaUrlReference;
  const engagement: Record<string, number> = {};
  for (const [key, value] of Object.entries({ viewCount: input.viewCount, likeCount: input.likeCount, commentCount: input.commentCount, shareCount: input.shareCount, saveCount: input.saveCount })) if (value !== undefined) engagement[key] = value;
  const evidence = normalizeEvidence({ evidenceId: `social-${input.platformContentId ?? createHash("sha256").update(`${input.platform}:${url ?? input.title ?? "unknown"}`).digest("hex").slice(0, 16)}`, sourceType: "SOCIAL_PLATFORM", platform: input.platform, accessMethod: input.accessMethod, retrievedAt: input.retrievedAt, sourceUrl: url, canonicalUrl: url === undefined ? undefined : canonicalizeResearchUrl(url), title: input.title, authorOrCreator: input.creatorName, publishedAt: input.publishedAt, description: input.description, text: input.caption, transcript: input.transcript, language: input.language, query: input.query, provenance: input.source ?? "social-provider-result", kind: input.kind ?? "SOURCE_CLAIM", confidence: "MEDIUM", limitations: input.limitations, engagement });
  return { ...evidence, platformContentId: input.platformContentId, provider: input.provider, creatorId: input.creatorId, caption: input.caption, hashtags: input.hashtags, mentions: input.mentions, audioId: input.audioId, audioTitle: input.audioTitle, audioAuthor: input.audioAuthor, transcriptProvenance: input.transcriptProvenance ?? (input.transcript === undefined ? undefined : "UNKNOWN") };
}

export function parseSocialReferenceUrl(raw: string): { platform: "INSTAGRAM" | "TIKTOK"; canonicalUrl: string; contentId?: string } | null {
  try {
    const url = new URL(raw); const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "instagram.com" || host === "instagr.am") { const match = url.pathname.match(/^\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); return match ? { platform: "INSTAGRAM", canonicalUrl: `https://www.instagram.com/${url.pathname.split("/")[1]}/${match[1]}/`, contentId: match[1] } : null; }
    if (host === "tiktok.com") { const match = url.pathname.match(/^\/@[^/]+\/video\/(\d+)/); return match ? { platform: "TIKTOK", canonicalUrl: `https://www.tiktok.com${url.pathname}`, contentId: match[1] } : null; }
    return null;
  } catch { return null; }
}

export function socialReferenceFallback(raw: string): { status: "REFERENCE_ACCESS_BLOCKED" | "UPLOAD_VIDEO_REQUIRED"; limitation: string; parsed?: ReturnType<typeof parseSocialReferenceUrl> } {
  const parsed = parseSocialReferenceUrl(raw);
  return parsed ? { status: "UPLOAD_VIDEO_REQUIRED", limitation: "Direct social reference access is unavailable without an approved provider credential; user-supplied media is required for local analysis.", parsed } : { status: "REFERENCE_ACCESS_BLOCKED", limitation: "URL is not a supported public Instagram/TikTok content URL." };
}

export function boundSocialResults(maxResults = 3): number { return Math.min(Math.max(Math.trunc(maxResults), 1), 10); }
export function deduplicateSocialEvidence(items: SocialEvidence[]): SocialEvidence[] { const seen = new Set<string>(); return items.filter(item => { const key = item.platformContentId ?? item.canonicalUrl ?? item.evidenceId; if (seen.has(key)) return false; seen.add(key); return true; }); }

export function socialResultFromUnavailable(request: SocialResearchRequest, provider: SocialProvider, limitation: string): ContentIntelligenceResult {
  return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources: [], keyFacts: [], unknowns: ["SOCIAL_PROVIDER_UNAVAILABLE"], freshness: request.freshness, confidence: "UNKNOWN", limitations: [limitation, "NO_LIVE_SOCIAL_CALL_EXECUTED"] };
}
