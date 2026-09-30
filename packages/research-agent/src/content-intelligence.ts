import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, join } from "node:path";
import { spawn } from "node:child_process";
import type { SocialIntelligencePort, SocialResearchRequest } from "./social-intelligence.js";

export const RESEARCH_MODES = ["FACT_RESEARCH", "NEWS_RESEARCH", "TREND_RESEARCH", "CONTENT_DISCOVERY", "COMPETITOR_RESEARCH", "REFERENCE_ANALYSIS", "VISUAL_RESEARCH", "HYBRID"] as const;
export type ResearchMode = typeof RESEARCH_MODES[number];
export type ResearchSourceType = "WEB" | "NEWS" | "IMAGE" | "VIDEO_PLATFORM" | "SOCIAL_PLATFORM" | "REFERENCE_URL" | "UPLOADED_MEDIA";
export type ResearchPlatform = "GENERIC_WEB" | "YOUTUBE" | "INSTAGRAM" | "TIKTOK" | "OTHER";
export type ResearchCapability = "SEARCH" | "DISCOVER" | "FETCH_METADATA" | "FETCH_TRANSCRIPT" | "FETCH_MEDIA" | "FETCH_ENGAGEMENT" | "ANALYZE_REFERENCE" | "TREND_DISCOVERY";
export type AccessMode = "PUBLIC" | "API" | "AUTHENTICATED_API" | "USER_PROVIDED" | "LOCAL_FILE" | "UNAVAILABLE";
export type CapabilityStatus = "AVAILABLE" | "PARTIAL" | "BLOCKED" | "REQUIRES_AUTH" | "REQUIRES_UPLOAD" | "UNPROVEN";
export type FreshnessRequirement = "REALTIME_OR_NEAR_REALTIME" | "LAST_24_HOURS" | "LAST_7_DAYS" | "LAST_30_DAYS" | "EVERGREEN" | "CUSTOM_RANGE";
export type EvidenceKind = "FACT" | "SOURCE_CLAIM" | "OBSERVATION" | "INFERENCE" | "UNKNOWN";

export interface ResearchBudget {
  maxExternalRequests: number;
  maxPaidProviderRuns: number;
  maxEstimatedCostUsd: number;
  maxResultsPerSource: number;
  allowFallback: boolean;
  allowExperimentalProviders: boolean;
}

export interface ResearchSourcePlan {
  source: "WEB" | "YOUTUBE" | "SOCIAL";
  purpose: string;
  priority: number;
  platform?: ResearchPlatform;
}

export interface ResearchSourceStrategy {
  sources: ResearchSourcePlan[];
  budget: ResearchBudget;
}

export interface SourceCapability { sourceType: ResearchSourceType; platform: ResearchPlatform; capability: ResearchCapability; accessMode: AccessMode; status: CapabilityStatus; limitation?: string; }
export interface ResearchRequest { mode: ResearchMode; topic?: string; query?: string; referenceUrls?: string[]; uploadedMedia?: string[]; platforms?: ResearchPlatform[]; freshness?: FreshnessRequirement; language?: string; region?: string; maxSources?: number; objective?: string; budget?: Partial<ResearchBudget>; }
export interface ResearchEvidence { evidenceId: string; kind: EvidenceKind; sourceType: ResearchSourceType; platform: ResearchPlatform; sourceUrl?: string; canonicalUrl?: string; title?: string; authorOrCreator?: string; publishedAt?: string; retrievedAt: string; description?: string; text?: string; transcript?: string; engagement?: Record<string, number>; mediaMetadata?: Record<string, string | number | boolean | null>; language?: string; region?: string; query?: string; accessMethod: AccessMode; provenance: string; confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; freshness?: FreshnessRequirement; limitations?: string[]; }
export interface OriginalityConstraints { referenceUsage: "STRUCTURAL_INSPIRATION" | "CONTENT_REPLICATION_PROHIBITED"; prohibited: string[]; }
export interface ReferenceContentAnalysis { observed: Record<string, unknown>; inferred: Record<string, unknown>; originality: OriginalityConstraints; multimodalStatus: "AVAILABLE" | "UNAVAILABLE" | "HUMAN_REVIEW_REQUIRED"; }
export interface ContentIntelligenceResult { researchQuestion?: string; mode: ResearchMode; topic?: string; sources: ResearchEvidence[]; keyFacts: ResearchEvidence[]; contentPatterns?: ReferenceContentAnalysis[]; opportunities?: ResearchEvidence[]; unknowns: string[]; freshness?: FreshnessRequirement; confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; limitations: string[]; sourceStrategy?: ResearchSourceStrategy; sourceCoverage?: string[]; missingCapabilities?: string[]; costSummary?: { externalRequests: number; paidProviderRuns: number; estimatedCostUsd?: number }; provenanceSummary?: string[]; trendVerdict?: "NOT_EVALUATED" | "INSUFFICIENT_EVIDENCE" | "CANDIDATE_SIGNALS_ONLY"; }
export type ResearchResult = ContentIntelligenceResult;
export interface YouTubeResearchPort { search(request: { query: string; maxResults?: number; publishedAfter?: string; publishedBefore?: string; language?: string; region?: string }): Promise<{ results: Array<{ videoId: string; canonicalUrl: string; title: string; description: string; channelId?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url: string; width?: number; height?: number }>; durationSeconds?: number; viewCount?: number; likeCount?: number; commentCount?: number; retrievedAt: string; query: string; quotaEstimate: number }>; requestsMade: number; quotaEstimate: number; quotaSource: string; quotaModel?: string; quotaBuckets?: unknown }>; }

export const DEFAULT_RESEARCH_BUDGET: ResearchBudget = { maxExternalRequests: 6, maxPaidProviderRuns: 2, maxEstimatedCostUsd: 0.05, maxResultsPerSource: 3, allowFallback: true, allowExperimentalProviders: false };

const TRACKING_PARAMS = new Set(["fbclid", "gclid", "igshid", "si", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);
export function canonicalizeResearchUrl(raw: string): string {
  const url = new URL(raw); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  return url.toString();
}
export function researchSurfacePlan(mode: ResearchMode, platforms: ResearchPlatform[] = []): ResearchPlatform[] {
  if (platforms.length > 0) return [...new Set(platforms)];
  if (mode === "NEWS_RESEARCH" || mode === "FACT_RESEARCH") return ["GENERIC_WEB"];
  if (mode === "VISUAL_RESEARCH") return ["GENERIC_WEB"];
  if (mode === "TREND_RESEARCH") return ["GENERIC_WEB", "YOUTUBE"];
  if (mode === "CONTENT_DISCOVERY") return ["GENERIC_WEB", "YOUTUBE"];
  if (mode === "HYBRID") return ["GENERIC_WEB", "YOUTUBE"];
  return ["GENERIC_WEB"];
}
export function researchSourceStrategy(request: ResearchRequest): ResearchSourceStrategy {
  const budget = { ...DEFAULT_RESEARCH_BUDGET, ...request.budget, maxResultsPerSource: Math.min(Math.max(Math.trunc(request.maxSources ?? DEFAULT_RESEARCH_BUDGET.maxResultsPerSource), 1), 10) };
  const platforms = researchSurfacePlan(request.mode, request.platforms);
  const sources: ResearchSourcePlan[] = [];
  if (platforms.includes("GENERIC_WEB")) sources.push({ source: "WEB", purpose: request.mode === "NEWS_RESEARCH" ? "FRESH_FACTUAL_CONTEXT" : "FACTUAL_CONTEXT", priority: 1, platform: "GENERIC_WEB" });
  if (platforms.includes("YOUTUBE")) sources.push({ source: "YOUTUBE", purpose: "VIDEO_CONTENT_DISCOVERY", priority: 2, platform: "YOUTUBE" });
  for (const platform of platforms.filter((value): value is "INSTAGRAM" | "TIKTOK" => value === "INSTAGRAM" || value === "TIKTOK")) sources.push({ source: "SOCIAL", purpose: request.referenceUrls?.length ? "REFERENCE_LOOKUP" : "SOCIAL_CONTENT_DISCOVERY", priority: sources.length + 1, platform });
  return { sources, budget };
}
export function normalizeSearchEvidence(input: { evidenceId: string; title: string; url: string; snippet?: string; platform?: ResearchPlatform; sourceType?: ResearchSourceType; query?: string; publishedAt?: string; retrievedAt?: string; freshness?: FreshnessRequirement; authorOrCreator?: string; mediaMetadata?: Record<string, string | number | boolean | null>; }): ResearchEvidence {
  const evidence = normalizeEvidence({ evidenceId: input.evidenceId, sourceType: input.sourceType ?? "WEB", platform: input.platform ?? "GENERIC_WEB", accessMethod: "PUBLIC", retrievedAt: input.retrievedAt ?? new Date().toISOString(), sourceUrl: input.url, title: input.title, authorOrCreator: input.authorOrCreator, mediaMetadata: input.mediaMetadata, description: input.snippet, text: input.snippet, publishedAt: input.publishedAt, query: input.query, freshness: input.freshness, provenance: "search-provider-result", kind: "SOURCE_CLAIM", confidence: "MEDIUM" });
  return evidence;
}
export function newsEvidenceEligible(evidence: ResearchEvidence, freshness: FreshnessRequirement, now = new Date()): boolean {
  return evidence.sourceType === "NEWS" && evidence.publishedAt !== undefined && freshnessSatisfied(evidence.publishedAt, freshness, now);
}
export class ResearchSourceRouter {
  constructor(private readonly youtube?: YouTubeResearchPort, private readonly social?: SocialIntelligencePort) {}
  async execute(request: ResearchRequest): Promise<ContentIntelligenceResult> {
    const sourceStrategy = researchSourceStrategy(request);
    const platforms = researchSurfacePlan(request.mode, request.platforms);
    const socialPlatforms = platforms.filter((p): p is "INSTAGRAM" | "TIKTOK" => p === "INSTAGRAM" || p === "TIKTOK");
    if (socialPlatforms.length > 0 && platforms.includes("YOUTUBE")) {
      if (this.social === undefined || this.youtube === undefined) return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources: [], keyFacts: [], unknowns: ["HYBRID_SOURCE_UNAVAILABLE"], freshness: request.freshness, confidence: "UNKNOWN", limitations: ["HYBRID_RESEARCH_REQUIRES_CONFIGURED_YOUTUBE_AND_SOCIAL_ADAPTERS"], sourceStrategy };
      const socialCapability = request.referenceUrls?.length
        ? (request.referenceUrls[0].toLowerCase().includes("/reel/") ? "SOCIAL_REEL_METADATA" : "SOCIAL_POST_METADATA")
        : request.mode === "CONTENT_DISCOVERY" || request.mode === "HYBRID" ? "SOCIAL_CONTENT_DISCOVERY" : "SOCIAL_DISCOVERY";
      const freshness = request.freshness ?? "EVERGREEN"; const now = new Date(); const since = freshness === "LAST_30_DAYS" ? new Date(now.getTime() - 30 * 86_400_000).toISOString() : freshness === "LAST_7_DAYS" ? new Date(now.getTime() - 7 * 86_400_000).toISOString() : freshness === "LAST_24_HOURS" ? new Date(now.getTime() - 86_400_000).toISOString() : undefined;
      const [socialResponse, youtubeResponse] = await Promise.all([
        this.social.research({ ...request, platforms: socialPlatforms, capability: socialCapability, referenceUrl: request.referenceUrls?.[0], maxResults: sourceStrategy.budget.maxResultsPerSource } as SocialResearchRequest),
        this.youtube.search({ query: request.query ?? request.topic ?? "", maxResults: sourceStrategy.budget.maxResultsPerSource, ...(since === undefined ? {} : { publishedAfter: since }), language: request.language, region: request.region }),
      ]);
      const youtubeSources = youtubeResponse.results.map((r) => normalizeSearchEvidence({ evidenceId: `youtube-${r.videoId}`, title: r.title, url: r.canonicalUrl, snippet: r.description, platform: "YOUTUBE", sourceType: "VIDEO_PLATFORM", query: r.query, publishedAt: r.publishedAt, retrievedAt: r.retrievedAt, freshness, authorOrCreator: r.channelTitle, mediaMetadata: { channelId: r.channelId ?? null, durationSeconds: r.durationSeconds ?? null, viewCount: r.viewCount ?? null, likeCount: r.likeCount ?? null, commentCount: r.commentCount ?? null, thumbnails: r.thumbnails ? JSON.stringify(r.thumbnails) : null } }));
      const acceptedYoutube = youtubeSources.filter((s) => freshness === "EVERGREEN" || freshnessSatisfied(s.publishedAt, freshness, now));
      const sources = [...socialResponse.results, ...acceptedYoutube];
      return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources, keyFacts: sources, unknowns: acceptedYoutube.length === youtubeSources.length ? [] : ["FRESHNESS_REQUIREMENT_NOT_MET"], freshness: request.freshness, confidence: sources.length > 0 ? "MEDIUM" : "UNKNOWN", limitations: [...socialResponse.limitations, "TRANSCRIPT_UNAVAILABLE", "MULTIMODAL_SEMANTIC_ANALYSIS_UNAVAILABLE", `QUOTA_ESTIMATE_${youtubeResponse.quotaEstimate}`], sourceStrategy, sourceCoverage: ["SOCIAL", "YOUTUBE"], missingCapabilities: ["YOUTUBE_TRANSCRIPT", "SOCIAL_TRANSCRIPT", "MULTIMODAL_SEMANTIC_ANALYSIS"], costSummary: { externalRequests: socialResponse.requestsMade + youtubeResponse.requestsMade, paidProviderRuns: socialResponse.requestsMade }, provenanceSummary: sources.map((result) => result.provenance), trendVerdict: "CANDIDATE_SIGNALS_ONLY" };
    }
    if (socialPlatforms.length > 0) {
      if (this.social === undefined) return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources: [], keyFacts: [], unknowns: ["SOCIAL_PROVIDER_UNAVAILABLE"], freshness: request.freshness, confidence: "UNKNOWN", limitations: ["SOCIAL_RESEARCH_REQUIRES_CONFIGURED_ADAPTER", "REFERENCE_ACCESS_BLOCKED_OR_UPLOAD_REQUIRED"] };
      const socialCapability = request.referenceUrls?.length
        ? (request.referenceUrls[0].toLowerCase().includes("/reel/") ? "SOCIAL_REEL_METADATA" : "SOCIAL_POST_METADATA")
        : request.mode === "CONTENT_DISCOVERY" || request.mode === "HYBRID" ? "SOCIAL_CONTENT_DISCOVERY" : "SOCIAL_DISCOVERY";
      const response = await this.social.research({ ...request, platforms: socialPlatforms, capability: socialCapability, referenceUrl: request.referenceUrls?.[0], maxResults: sourceStrategy.budget.maxResultsPerSource } as SocialResearchRequest);
      return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources: response.results, keyFacts: response.results, unknowns: response.results.length === 0 ? ["INSUFFICIENT_EVIDENCE"] : [], freshness: request.freshness, confidence: response.results.length > 0 ? "MEDIUM" : "UNKNOWN", limitations: response.limitations, sourceStrategy, sourceCoverage: ["SOCIAL"], missingCapabilities: response.results.length === 0 ? ["SOCIAL_EVIDENCE"] : [], costSummary: { externalRequests: response.requestsMade, paidProviderRuns: response.requestsMade }, provenanceSummary: response.results.map((result) => result.provenance), trendVerdict: "NOT_EVALUATED" };
    }
    if (platforms.includes("YOUTUBE")) {
      if (this.youtube === undefined) return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources: [], keyFacts: [], unknowns: ["YOUTUBE_RESEARCH_ADAPTER_UNAVAILABLE"], freshness: request.freshness, confidence: "UNKNOWN", limitations: ["YOUTUBE_RESEARCH_REQUIRES_CONFIGURED_ADAPTER"] };
      const freshness = request.freshness ?? "EVERGREEN"; const now = new Date(); const since = freshness === "LAST_30_DAYS" ? new Date(now.getTime() - 30 * 86_400_000).toISOString() : freshness === "LAST_7_DAYS" ? new Date(now.getTime() - 7 * 86_400_000).toISOString() : freshness === "LAST_24_HOURS" ? new Date(now.getTime() - 86_400_000).toISOString() : undefined;
      const response = await this.youtube.search({ query: request.query ?? request.topic ?? "", maxResults: Math.min(request.maxSources ?? 3, 10), ...(since === undefined ? {} : { publishedAfter: since }), language: request.language, region: request.region });
      const sources = response.results.map((r) => normalizeSearchEvidence({ evidenceId: `youtube-${r.videoId}`, title: r.title, url: r.canonicalUrl, snippet: r.description, platform: "YOUTUBE", sourceType: "VIDEO_PLATFORM", query: r.query, publishedAt: r.publishedAt, retrievedAt: r.retrievedAt, freshness, authorOrCreator: r.channelTitle, mediaMetadata: { channelId: r.channelId ?? null, durationSeconds: r.durationSeconds ?? null, viewCount: r.viewCount ?? null, likeCount: r.likeCount ?? null, commentCount: r.commentCount ?? null, thumbnails: r.thumbnails ? JSON.stringify(r.thumbnails) : null } }));
      const accepted = sources.filter((s) => freshness === "EVERGREEN" || freshnessSatisfied(s.publishedAt, freshness, now));
      return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources: accepted, keyFacts: accepted, unknowns: accepted.length === sources.length ? [] : ["FRESHNESS_REQUIREMENT_NOT_MET"], freshness, confidence: accepted.length > 0 ? "MEDIUM" : "UNKNOWN", limitations: ["TRANSCRIPT_UNAVAILABLE", "MULTIMODAL_SEMANTIC_ANALYSIS_UNAVAILABLE", `QUOTA_ESTIMATE_${response.quotaEstimate}`, `REQUESTS_MADE_${response.requestsMade}`], sourceStrategy, sourceCoverage: ["YOUTUBE"], costSummary: { externalRequests: response.requestsMade, paidProviderRuns: 0 }, missingCapabilities: ["YOUTUBE_TRANSCRIPT", "MULTIMODAL_SEMANTIC_ANALYSIS"], trendVerdict: "CANDIDATE_SIGNALS_ONLY" };
    }
    return { researchQuestion: request.objective ?? request.query, mode: request.mode, topic: request.topic, sources: [], keyFacts: [], unknowns: ["NO_IMPLEMENTED_SOURCE_FOR_REQUEST"], freshness: request.freshness, confidence: "UNKNOWN", limitations: ["SOURCE_ROUTER_HAS_NO_CONFIGURED_PROVIDER_FOR_SELECTED_SURFACE"] };
  }
}
export function freshnessSatisfied(publishedAt: string | undefined, requirement: FreshnessRequirement, now = new Date()): boolean {
  if (requirement === "EVERGREEN" || publishedAt === undefined) return requirement === "EVERGREEN";
  const age = now.getTime() - new Date(publishedAt).getTime();
  if (!Number.isFinite(age)) return false;
  const limits: Partial<Record<FreshnessRequirement, number>> = { REALTIME_OR_NEAR_REALTIME: 3_600_000, LAST_24_HOURS: 86_400_000, LAST_7_DAYS: 604_800_000, LAST_30_DAYS: 2_592_000_000 };
  return limits[requirement] === undefined ? true : age >= 0 && age <= limits[requirement]!;
}
export function normalizeEvidence(input: Partial<ResearchEvidence> & Pick<ResearchEvidence, "evidenceId" | "sourceType" | "platform" | "accessMethod" | "retrievedAt">): ResearchEvidence {
  return { kind: "UNKNOWN", confidence: "UNKNOWN", provenance: "unknown", ...input, ...(input.sourceUrl === undefined ? {} : { canonicalUrl: input.canonicalUrl ?? canonicalizeResearchUrl(input.sourceUrl) }) };
}
export function assertProjectLocalPath(projectRoot: string, candidate: string): string {
  const root = resolve(projectRoot); const target = resolve(candidate); const rel = relative(root, target);
  if (!isAbsolute(candidate) || rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) throw new Error("Reference media path must be inside the project");
  return target;
}

type Probe = { streams?: Array<Record<string, string>>; format?: Record<string, string> };
function command(binary: string, args: string[]): Promise<string> { return new Promise((ok, fail) => { const p = spawn(binary, args, { windowsHide: true, shell: false }); let out = ""; let err = ""; p.stdout.on("data", c => { out += c; }); p.stderr.on("data", c => { err += c; }); p.once("error", fail); p.once("close", code => code === 0 ? ok(out) : fail(new Error(`${binary} failed: ${err.slice(0, 400)}`))); }); }
export async function ingestLocalReferenceVideo(input: { projectRoot: string; filePath: string; outputDirectory: string; ffprobeBin?: string; ffmpegBin?: string; }): Promise<{ evidence: ResearchEvidence; metadata: Record<string, unknown>; representativeFrames: string[]; analysis: ReferenceContentAnalysis }> {
  const file = assertProjectLocalPath(input.projectRoot, input.filePath); const out = assertProjectLocalPath(input.projectRoot, input.outputDirectory); const bytes = await readFile(file); if (bytes.length === 0) throw new Error("Reference video is empty");
  const probe = JSON.parse(await command(input.ffprobeBin ?? "ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file])) as Probe;
  const video = probe.streams?.find(s => s.codec_type === "video"); if (video === undefined) throw new Error("Reference video has no video stream");
  await mkdir(out, { recursive: true }); const hash = createHash("sha256").update(bytes).digest("hex").toUpperCase(); const duration = Number(probe.format?.duration ?? 0);
  const frames: string[] = []; for (const [name, time] of [["first", 0], ["middle", Math.max(0, duration / 2)], ["last", Math.max(0, duration - 0.05)] ] as const) { const frame = join(out, `${name}.jpg`); await command(input.ffmpegBin ?? "ffmpeg", ["-y", "-ss", String(time), "-i", file, "-frames:v", "1", frame]); frames.push(frame); }
  const evidence = normalizeEvidence({ evidenceId: `local-video-${hash.slice(0, 16)}`, sourceType: "UPLOADED_MEDIA", platform: "OTHER", accessMethod: "LOCAL_FILE", retrievedAt: new Date().toISOString(), provenance: "project-controlled-local-file", kind: "OBSERVATION", confidence: "HIGH", mediaMetadata: { sha256: hash, bytes: bytes.length, container: probe.format?.format_name ?? null, durationSeconds: duration, width: Number(video.width ?? 0), height: Number(video.height ?? 0), fps: video.avg_frame_rate ?? video.r_frame_rate ?? null, audioPresent: probe.streams?.some(s => s.codec_type === "audio") ?? false }, limitations: ["TRANSCRIPT_UNAVAILABLE", "MULTIMODAL_SEMANTIC_ANALYSIS_UNAVAILABLE"] });
  return { evidence, metadata: evidence.mediaMetadata ?? {}, representativeFrames: frames, analysis: { observed: { durationSeconds: duration, resolution: `${video.width ?? "unknown"}x${video.height ?? "unknown"}`, codec: video.codec_name ?? null }, inferred: {}, originality: { referenceUsage: "STRUCTURAL_INSPIRATION", prohibited: ["exact script", "distinctive phrasing", "logos/watermarks", "creator identity", "exact shot sequence", "copyrighted footage", "music", "protected characters", "unique visual composition"] }, multimodalStatus: "UNAVAILABLE" } };
}
