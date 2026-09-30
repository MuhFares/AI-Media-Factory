import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";

export interface YouTubeResearchRequest { query: string; maxResults?: number; publishedAfter?: string; publishedBefore?: string; language?: string; region?: string; }
export interface YouTubeResearchEvidence { videoId: string; canonicalUrl: string; title: string; description: string; channelId?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url: string; width?: number; height?: number }>; durationSeconds?: number; viewCount?: number; likeCount?: number; commentCount?: number; retrievedAt: string; query: string; quotaEstimate: number; quotaSource: "YOUTUBE_OFFICIAL_QUOTA_DOCUMENTATION"; }
export interface YouTubeResearchResponse { providerId: "youtube-data-api-v3"; results: YouTubeResearchEvidence[]; requestsMade: number; quotaEstimate: number; quotaModel: "GRANULAR_METHOD_BUCKETS"; quotaBuckets: { search: { name: "SEARCH_QUERIES"; costPerRequest: 1; defaultDailyLimit: 100 }; reads: { name: "DEFAULT"; costPerRequest: 1; defaultDailyLimit: 10000 } }; quotaSource: "YOUTUBE_OFFICIAL_QUOTA_DOCUMENTATION"; }
export interface YouTubeResearchConfig { apiKey: string; baseUrl?: string; timeoutMs?: number; onOperation?: OperationSink; }

const DEFAULT_BASE_URL = "https://www.googleapis.com/youtube/v3";
const SEARCH_CALL_COST = 1;
const READ_QUOTA = 1;
function isoDuration(value: string | undefined): number | undefined { if (value === undefined) return undefined; const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(value); return m === null ? undefined : Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0); }
function numberOrUndefined(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
export function parseYouTubeVideoId(raw: string): string | null { try { const u = new URL(raw); if (u.hostname === "youtu.be") return u.pathname.slice(1).match(/^[A-Za-z0-9_-]{11}$/)?.[0] ?? null; if (u.hostname === "youtube.com" || u.hostname === "www.youtube.com" || u.hostname === "m.youtube.com") { const id = u.pathname === "/watch" ? u.searchParams.get("v") : u.pathname.match(/^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})/)?.[1]; return id ?? null; } return null; } catch { return null; } }

export class YouTubeResearchAdapter {
  readonly providerId = "youtube-data-api-v3" as const;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly onOperation: OperationSink;
  constructor(private readonly config: YouTubeResearchConfig) { if (!config.apiKey?.trim()) throw providerConfigError(this.providerId, "config.apiKey is required"); this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, ""); this.timeoutMs = config.timeoutMs ?? 10000; this.onOperation = sinkOf(config.onOperation); }
  async search(request: YouTubeResearchRequest): Promise<YouTubeResearchResponse> {
    if (!request.query?.trim()) throw providerValidationError(this.providerId, "search", "query is required");
    const maxResults = Math.min(Math.max(request.maxResults ?? 5, 1), 10); const params = new URLSearchParams({ key: this.config.apiKey, part: "snippet", q: request.query.trim(), type: "video", maxResults: String(maxResults) });
    for (const [k, v] of [["publishedAfter", request.publishedAfter], ["publishedBefore", request.publishedBefore], ["relevanceLanguage", request.language], ["regionCode", request.region]] as const) if (v) params.set(k, v);
    const searchJson = await this.get(`/search?${params}`); const items: any[] = Array.isArray(searchJson.items) ? searchJson.items : []; const ids = items.map((x: any) => x?.id?.videoId).filter((x: unknown): x is string => typeof x === "string");
    if (ids.length === 0) return { providerId: this.providerId, results: [], requestsMade: 1, quotaEstimate: SEARCH_CALL_COST, quotaModel: "GRANULAR_METHOD_BUCKETS", quotaBuckets: { search: { name: "SEARCH_QUERIES", costPerRequest: 1, defaultDailyLimit: 100 }, reads: { name: "DEFAULT", costPerRequest: 1, defaultDailyLimit: 10000 } }, quotaSource: "YOUTUBE_OFFICIAL_QUOTA_DOCUMENTATION" };
    const detail = await this.get(`/videos?${new URLSearchParams({ key: this.config.apiKey, part: "snippet,contentDetails,statistics", id: ids.join(",") })}`); const detailById = new Map<string, any>((Array.isArray(detail.items) ? detail.items : []).map((x: any) => [x.id, x])); const retrievedAt = new Date().toISOString();
    const results = items.flatMap((item: any) => { const id = item?.id?.videoId; const d = detailById.get(id); if (typeof id !== "string" || !d) return []; const s = d.snippet ?? item.snippet ?? {}; const stats = d.statistics ?? {}; return [{ videoId: id, canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, title: String(s.title ?? ""), description: String(s.description ?? ""), channelId: typeof s.channelId === "string" ? s.channelId : undefined, channelTitle: typeof s.channelTitle === "string" ? s.channelTitle : undefined, publishedAt: typeof s.publishedAt === "string" ? s.publishedAt : undefined, thumbnails: s.thumbnails, durationSeconds: isoDuration(d.contentDetails?.duration), viewCount: numberOrUndefined(stats.viewCount), likeCount: numberOrUndefined(stats.likeCount), commentCount: numberOrUndefined(stats.commentCount), retrievedAt, query: request.query.trim(), quotaEstimate: SEARCH_CALL_COST + READ_QUOTA, quotaSource: "YOUTUBE_OFFICIAL_QUOTA_DOCUMENTATION" as const }]; });
    return { providerId: this.providerId, results, requestsMade: 2, quotaEstimate: READ_QUOTA + 1, quotaModel: "GRANULAR_METHOD_BUCKETS", quotaBuckets: { search: { name: "SEARCH_QUERIES", costPerRequest: 1, defaultDailyLimit: 100 }, reads: { name: "DEFAULT", costPerRequest: 1, defaultDailyLimit: 10000 } }, quotaSource: "YOUTUBE_OFFICIAL_QUOTA_DOCUMENTATION" };
  }
  private async get(path: string): Promise<any> { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs); const started = Date.now(); try { const res = await fetch(`${this.baseUrl}${path}`, { signal: controller.signal, headers: { accept: "application/json" } }); const json = await res.json().catch(() => null); this.onOperation({ providerId: this.providerId, operation: "read", outcome: res.ok ? "success" : "failure", latencyMs: Date.now() - started, retryCount: 0, requestKey: `${this.baseUrl}${path.replace(/key=[^&]+/, "key=[REDACTED]")}` }); if (!res.ok || json === null || typeof json !== "object") throw providerValidationError(this.providerId, "read", `YouTube API returned HTTP ${res.status}`); return json; } finally { clearTimeout(timer); } }
}
