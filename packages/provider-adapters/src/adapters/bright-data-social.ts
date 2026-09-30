import { providerConfigError, providerValidationError } from "../core/errors.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";
import { boundSocialResults, deduplicateSocialEvidence, normalizeSocialEvidence, type SocialResearchRequest, type SocialResearchResponse } from "@ai-media-factory/research-agent";

export interface BrightDataSocialConfig { apiToken: string; instagramReelDatasetId?: string; instagramPostDatasetId?: string; baseUrl?: string; timeoutMs?: number; onOperation?: OperationSink; }

function sanitizedResponseDiagnostic(response: Response, bodyText: string): string {
  let parsed: unknown; try { parsed = bodyText ? JSON.parse(bodyText) : undefined; } catch { parsed = undefined; }
  const bodyShape = parsed !== undefined ? (Array.isArray(parsed) ? "array" : typeof parsed === "object" ? "object" : typeof parsed) : bodyText ? "text" : "empty";
  const redacted = parsed !== undefined && typeof parsed === "object" ? JSON.parse(JSON.stringify(parsed, (key, value) => /token|authorization|cookie|secret|password/i.test(key) ? "[REDACTED]" : value)) : undefined;
  const safeBody = redacted !== undefined ? JSON.stringify(redacted).slice(0, 2000) : bodyText.slice(0, 1000);
  return JSON.stringify({ httpStatus: response.status, statusText: response.statusText, providerErrorCode: typeof parsed === "object" && parsed !== null ? (parsed as any).code ?? (parsed as any).error_code : undefined, providerMessage: typeof parsed === "object" && parsed !== null ? (parsed as any).message ?? (parsed as any).error : undefined, responseContentType: response.headers.get("content-type"), responseBodyShape: bodyShape, responseBodySanitized: safeBody, requestId: response.headers.get("x-request-id") ?? response.headers.get("x-correlation-id") });
}

/** Bright Data's URL-oriented Instagram API. Discovery remains product-specific and is not guessed here. */
export class BrightDataSocialIntelligenceAdapter {
  readonly provider = "BRIGHT_DATA" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onOperation: OperationSink;
  constructor(private readonly config: BrightDataSocialConfig) { if (!config.apiToken?.trim()) throw providerConfigError("bright-data-social", "config.apiToken is required"); this.baseUrl = (config.baseUrl ?? "https://api.brightdata.com").replace(/\/$/, ""); this.timeoutMs = config.timeoutMs ?? 60_000; this.onOperation = sinkOf(config.onOperation); }
  async research(request: SocialResearchRequest): Promise<SocialResearchResponse> {
    if (request.platforms.length !== 1 || request.platforms[0] !== "INSTAGRAM") throw providerValidationError("bright-data-social", "research", "Only Instagram is configured in V1");
    if (!request.referenceUrl) throw providerValidationError("bright-data-social", "research", "Bright Data V1 requires a user-provided Instagram reference URL");
    const datasetId = request.capability === "SOCIAL_REEL_METADATA" ? this.config.instagramReelDatasetId : this.config.instagramPostDatasetId;
    if (!datasetId) throw providerConfigError("bright-data-social", "An Instagram dataset ID is required for this capability");
    const started = Date.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/datasets/v3/scrape?dataset_id=${encodeURIComponent(datasetId)}&format=json`, { method: "POST", headers: { authorization: `Bearer ${this.config.apiToken}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify([{ url: request.referenceUrl }]), signal: controller.signal });
      const bodyText = await response.text().catch(() => ""); let raw: unknown; try { raw = bodyText ? JSON.parse(bodyText) : null; } catch { raw = null; } this.onOperation({ providerId: "bright-data-social", operation: "research", outcome: response.ok ? "success" : "failure", latencyMs: Date.now() - started, retryCount: 0, statusCode: response.status });
      if (!response.ok || !Array.isArray(raw)) throw providerValidationError("bright-data-social", "research", `Bright Data returned HTTP ${response.status}`, response.status, sanitizedResponseDiagnostic(response, bodyText));
      const results = deduplicateSocialEvidence(raw.slice(0, boundSocialResults(request.maxResults)).filter((item: any) => item && (item.url || item.shortcode || item.shortCode)).map((item: any) => { const rawDuration = Number(item.length ?? item.video_duration); return normalizeSocialEvidence({ platform: "INSTAGRAM", provider: "BRIGHT_DATA", platformContentId: item.shortcode ?? item.shortCode ?? item.id, canonicalUrl: item.url, creatorName: item.user_posted ?? item.username, caption: item.description ?? item.caption, publishedAt: item.date_posted ?? item.timestamp, durationSeconds: Number.isFinite(rawDuration) ? rawDuration : undefined, viewCount: item.views ?? item.video_view_count, likeCount: item.likes, commentCount: item.num_comments ?? item.comments, shareCount: item.shares, hashtags: item.hashtags, mentions: item.mentions, audioId: item.audio_id, audioTitle: item.audio_title, audioAuthor: item.audio_artist, mediaUrlReference: item.video_url ?? item.videoUrl, retrievedAt: new Date().toISOString(), query: request.query, accessMethod: "API", source: `BRIGHT_DATA_DATASET:${datasetId}`, limitations: ["TRANSCRIPT_UNAVAILABLE", "RESEARCH_REFERENCE_ONLY"] }); }));
      return { provider: "BRIGHT_DATA", status: "SUCCEEDED", results, requestsMade: 1, cost: { classification: "UNKNOWN" }, limitations: ["URL_REFERENCE_ONLY_IN_V1", "NO_AUTOMATIC_PAGINATION", "PAY_PER_SUCCESSFUL_RECORD"] };
    } finally { clearTimeout(timer); }
  }
}

export function brightDataSocialAdapterFromEnv(onOperation?: OperationSink): BrightDataSocialIntelligenceAdapter {
  const apiToken = process.env.BRIGHTDATA_API_TOKEN;
  if (!apiToken) throw providerConfigError("bright-data-social", "BRIGHTDATA_API_TOKEN is required");
  return new BrightDataSocialIntelligenceAdapter({ apiToken, instagramReelDatasetId: process.env.BRIGHTDATA_INSTAGRAM_REEL_DATASET_ID ?? "gd_lyclm20il4r5helnj", instagramPostDatasetId: process.env.BRIGHTDATA_INSTAGRAM_POST_DATASET_ID ?? "gd_lk5ns7kz21pck8jpis", onOperation });
}
