import { providerConfigError, providerValidationError } from "../core/errors.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";
import { boundSocialResults, deduplicateSocialEvidence, normalizeSocialEvidence, type SocialEvidence, type SocialResearchRequest, type SocialResearchResponse } from "@ai-media-factory/research-agent";

export interface ApifySocialConfig { apiToken: string; instagramActorId?: string; instagramSearchActorId?: string; tiktokActorId?: string; baseUrl?: string; timeoutMs?: number; onOperation?: OperationSink; }

/** Generic Actor-backed adapter. Actor IDs and schemas stay configuration-owned. */
export class ApifySocialIntelligenceAdapter {
  readonly provider = "APIFY" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onOperation: OperationSink;
  constructor(private readonly config: ApifySocialConfig) { if (!config.apiToken?.trim()) throw providerConfigError("apify-social", "config.apiToken is required"); this.baseUrl = (config.baseUrl ?? "https://api.apify.com/v2").replace(/\/$/, ""); this.timeoutMs = config.timeoutMs ?? 30_000; this.onOperation = sinkOf(config.onOperation); }
  async research(request: SocialResearchRequest): Promise<SocialResearchResponse> {
    const isInstagram = request.platforms.length === 1 && request.platforms[0] === "INSTAGRAM";
    const actorId = isInstagram ? (request.capability === "SOCIAL_CONTENT_DISCOVERY" ? this.config.instagramSearchActorId : this.config.instagramActorId) : request.platforms.length === 1 && request.platforms[0] === "TIKTOK" ? this.config.tiktokActorId : undefined;
    if (!actorId) throw providerConfigError("apify-social", `No configured Actor for ${request.platforms.join(",")}`);
    if (!request.query?.trim() && !request.referenceUrl) throw providerValidationError("apify-social", "research", "query or referenceUrl is required");
    const isReelScraper = actorId.includes("reel-scraper");
    const input = request.referenceUrl
      ? isReelScraper
        ? { urls: [request.referenceUrl] }
        : { directUrls: [request.referenceUrl], resultsType: "posts", resultsLimit: boundSocialResults(request.maxResults) }
      : request.capability === "SOCIAL_CONTENT_DISCOVERY"
        ? { search: request.query?.trim() ?? request.topic?.trim(), searchType: "popular", searchLimit: boundSocialResults(request.maxResults) }
        : { search: request.query?.trim(), searchType: "hashtag", resultsType: "posts", resultsLimit: boundSocialResults(request.maxResults) };
    const started = Date.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items`, { method: "POST", headers: { authorization: `Bearer ${this.config.apiToken}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(input), signal: controller.signal });
      const raw: unknown = await response.json().catch(() => null); this.onOperation({ providerId: "apify-social", operation: "research", outcome: response.ok ? "success" : "failure", latencyMs: Date.now() - started, retryCount: 0, statusCode: response.status });
      if (!response.ok || !Array.isArray(raw)) throw providerValidationError("apify-social", "research", `Apify returned HTTP ${response.status}`);
      const warnings: string[] = []; const candidates = raw.slice(0, boundSocialResults(request.maxResults)).filter((item: any) => { if (item?.error === "no_items") { warnings.push("NO_ITEMS_ENVELOPE"); return false; } const usable = Boolean(item && (item.url || item.inputUrl || item.shortCode || item.id)); if (!usable) warnings.push("RESULT_WITHOUT_STABLE_ID_OR_URL"); return usable; });
      const results = deduplicateSocialEvidence(candidates.map((item: any) => normalizeSocialEvidence({ platform: request.platforms[0], provider: "APIFY", platformContentId: item.shortCode ?? item.id ?? item.postId ?? item.videoId, canonicalUrl: item.url ?? item.webVideoUrl ?? item.inputUrl, title: item.title, caption: item.caption ?? item.text, description: item.description, creatorId: item.ownerId ?? item.authorMeta?.id ?? item.authorId, creatorName: item.ownerUsername ?? item.ownerFullName ?? item.authorMeta?.name ?? item.authorMeta?.nickName ?? item.authorName, publishedAt: item.timestamp ?? item.createTimeISO ?? item.uploadDate, durationSeconds: item.videoDuration ?? item.videoMeta?.duration, thumbnail: item.displayUrl ? { url: item.displayUrl } : item.images?.[0] ? { url: item.images[0] } : undefined, mediaUrlReference: item.videoUrl, viewCount: item.videoViewCount ?? item.videoPlayCount ?? item.playCount ?? item.views, likeCount: item.likesCount ?? item.likes ?? item.diggCount, commentCount: item.commentsCount ?? item.comments ?? item.commentCount, shareCount: item.shares ?? item.shareCount, hashtags: item.hashtags, mentions: item.mentions, audioId: item.musicInfo?.audio_id ?? item.musicMeta?.musicId, audioTitle: item.musicInfo?.song_name ?? item.musicMeta?.musicName ?? item.music, audioAuthor: item.musicInfo?.artist_name ?? item.musicMeta?.musicAuthor, transcript: item.transcript, transcriptProvenance: item.transcript ? "UNKNOWN" : undefined, retrievedAt: new Date().toISOString(), query: request.query, accessMethod: "API", source: "APIFY_ACTOR_DATASET", limitations: item.transcript ? [] : ["TRANSCRIPT_UNAVAILABLE"] })));
      return { provider: "APIFY", status: "SUCCEEDED", results, requestsMade: 1, cost: { classification: "UNKNOWN" }, limitations: ["ACTOR_SCHEMA_DEPENDENT", "NO_AUTOMATIC_PAGINATION", ...(results.length === 0 ? ["NO_NORMALIZABLE_SOCIAL_RESULTS"] : [])], ...(warnings.length === 0 ? {} : { normalizationWarnings: warnings }) };
    } finally { clearTimeout(timer); }
  }
}

export function apifySocialAdapterFromEnv(onOperation?: OperationSink): ApifySocialIntelligenceAdapter {
  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken) throw providerConfigError("apify-social", "APIFY_API_TOKEN is required");
  return new ApifySocialIntelligenceAdapter({ apiToken, instagramActorId: process.env.APIFY_INSTAGRAM_ACTOR_ID, instagramSearchActorId: process.env.APIFY_INSTAGRAM_SEARCH_ACTOR_ID ?? "DrF9mzPPEuVizVF4l", tiktokActorId: process.env.APIFY_TIKTOK_ACTOR_ID, onOperation });
}
