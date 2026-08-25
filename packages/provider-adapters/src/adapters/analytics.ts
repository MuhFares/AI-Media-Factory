/**
 * Analytics adapter — YouTube Analytics API v2 (reports).
 *
 * Mapping:
 *  GET {baseUrl}/v2/reports?ids=channel==MINE&metrics=..&dimensions=video&
 *      filters=video=={publicationId}&startDate=..&endDate=..&maxResults=1
 *  -> { providerId, status, publicationId, metrics, retrievedAt }
 *
 * Metrics are only reported for fields the provider actually returns (an
 * authenticated 200 with a valid but empty report is normalized to an empty
 * metrics object — nothing is fabricated, and a missing/absent publication
 * report is NOT turned into a successful claim).
 */

import type {
  AnalyticsFetchRequest,
  AnalyticsProvider,
  AnalyticsProviderResponse,
  PerformanceMetrics,
} from "@ai-media-factory/tool-framework";
import { sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv, requiredEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface YouTubeAnalyticsConfig {
  accessToken: string;
  /** YouTube Analytics API base url (may point at a placeholder for mocks). */
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Analytics window: number of days ending today. Must be >= 1. */
  windowDays?: number;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://youtubeanalytics.googleapis.com";
const SUPPORTED_METRICS =
  "views,averageViewDuration,estimatedMinutesWatched,likes,comments,shares,estimatedRevenue";

const KNOWN_METRIC_KEYS: Record<string, keyof PerformanceMetrics | undefined> = {
  views: "views",
  estimatedMinutesWatched: "watchTimeSeconds",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  estimatedRevenue: "revenue",
};

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export class YouTubeAnalyticsAdapter implements AnalyticsProvider {
  readonly providerId = "youtube-analytics";
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly windowDays: number;
  private readonly onOperation: OperationSink;

  constructor(config: YouTubeAnalyticsConfig) {
    if (typeof config.accessToken !== "string" || config.accessToken.trim().length === 0) {
      throw providerConfigError(
        "youtube-analytics",
        "config.accessToken is required. Provide a YouTube OAuth access token (YOUTUBE_ACCESS_TOKEN).",
      );
    }
    this.accessToken = config.accessToken.trim();
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.windowDays = config.windowDays ?? 30;
    assertPositive("youtube-analytics", this.timeoutMs, "timeoutMs");
    assertPositive("youtube-analytics", this.windowDays, "windowDays");
    this.onOperation = sinkOf(config.onOperation);
  }

  async fetch(request: AnalyticsFetchRequest): Promise<AnalyticsProviderResponse> {
    if (request.platform !== "youtube") {
      throw providerValidationError(
        this.providerId,
        "fetch",
        `Unsupported analytics platform '${request.platform}' (only 'youtube' is implemented)`,
      );
    }
    const end = new Date();
    const start = new Date(end.getTime() - (this.windowDays - 1) * 86_400_000);
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/v2/reports`);
    url.searchParams.set("ids", "channel==MINE");
    url.searchParams.set("metrics", SUPPORTED_METRICS);
    url.searchParams.set("dimensions", "video");
    url.searchParams.set("filters", `video==${request.publicationId}`);
    url.searchParams.set("startDate", toYmd(start));
    url.searchParams.set("endDate", toYmd(end));
    url.searchParams.set("maxResults", "1");

    const res = await sendHttpWithRetry(
      {
        method: "GET",
        url: url.toString(),
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
      },
      {
        providerId: this.providerId,
        operation: "fetch",
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        onOperation: this.onOperation,
        requestKey: request.publicationId,
      },
    );

    const json = await this.readJson(res);
    if (!isRecord(json)) {
      throw providerValidationError(this.providerId, "fetch", "Provider returned a non-object response");
    }
    if (isRecord(json.error)) {
      const code = asString(json.error.code) ?? "ANALYTICS_ERROR";
      const message = asString(json.error.message) ?? "Provider reported an analytics error";
      throw providerValidationError(this.providerId, "fetch", `Provider error ${code}: ${message}`);
    }
    if (json.rows !== undefined && !Array.isArray(json.rows)) {
      throw providerValidationError(this.providerId, "fetch", "Provider reported malformed analytics rows");
    }
    if (
      (json.rows === undefined || json.rows.length === 0) &&
      json.columnHeaders !== undefined &&
      !Array.isArray(json.columnHeaders)
    ) {
      throw providerValidationError(this.providerId, "fetch", "Provider reported malformed analytics headers");
    }

    const rows = Array.isArray(json.rows) ? json.rows : [];
    const headers = Array.isArray(json.columnHeaders) ? json.columnHeaders : [];
    const metrics: PerformanceMetrics = {};
    if (rows.length > 0) {
      if (!Array.isArray(rows[0])) {
        throw providerValidationError(this.providerId, "fetch", "Provider reported a malformed analytics row");
      }
      const row = rows[0] as readonly unknown[];
      for (let i = 0; i < headers.length; i += 1) {
        const header = headers[i];
        if (!isRecord(header)) continue;
        const name = asString(header.name);
        if (name === undefined || name === "video") continue;
        const target = KNOWN_METRIC_KEYS[name];
        if (target === undefined) continue;
        const value = row[i];
        if (typeof value !== "number" || !Number.isFinite(value)) continue;
        if (name === "estimatedMinutesWatched") {
          const seconds = value * 60;
          if (Number.isFinite(seconds)) metrics.watchTimeSeconds = seconds;
        } else {
          metrics[target] = value;
        }
      }
    }

    return {
      providerId: this.providerId,
      status: "completed",
      publicationId: asString(json.publicationId) ?? request.publicationId,
      metrics,
      retrievedAt: new Date().toISOString(),
    };
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "fetch", "Provider returned a non-JSON response");
    }
  }
}

/** Construct a YouTube Analytics adapter from environment variables. */
export function youTubeAnalyticsAdapterFromEnv(onOperation?: OperationSink): YouTubeAnalyticsAdapter {
  return new YouTubeAnalyticsAdapter({
    accessToken: requiredEnv("youtube-analytics", "YOUTUBE_ACCESS_TOKEN", "YouTube OAuth access token"),
    baseUrl: optionalEnv("YOUTUBE_ANALYTICS_BASE_URL", DEFAULT_BASE_URL),
    timeoutMs: envNumber("youtube-analytics", "ANALYTICS_TIMEOUT_MS", 15_000),
    maxRetries: envNumber("youtube-analytics", "ANALYTICS_MAX_RETRIES", 2),
    windowDays: envNumber("youtube-analytics", "ANALYTICS_WINDOW_DAYS", 30),
    onOperation,
  });
}