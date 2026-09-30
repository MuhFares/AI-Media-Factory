/**
 * Publishing adapter — YouTube Data API v3 (resumable upload).
 *
 * Flow (matches the real provider):
 *   1. DERIVE a stable per-logical-publication marker (sha256 of asset+titles).
 *   2. RECOVER: consult the durable PublishSessionStore. A completed marker
 *      returns the provider-confirmed publication (idempotent retry after
 *      a worker crash). A pending marker resumes the exact same resumable
 *      upload session instead of starting a duplicate.
 *   3. (optional safety net) search "my uploads" for an embedded marker line in
 *      the description; when found, recover that existing video id.
 *   4. RESUMABLE UPLOAD:
 *      a. POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *         -> 200 + Location (session URI). Persist the session as pending BEFORE
 *            transferring the body.
 *      b. PUT the asset bytes to the session URI -> video resource JSON.
 *   5. Return completed with the provider-confirmed video id/url/publishedAt.
 *
 * Safety rules:
 *  - The upload POST and PUT are NEVER auto-retried by the transport; recovery
 *    happens through the durable session (same session, same publication).
 *  - The asset body is downloaded with a hard byte cap (maxUploadBytes).
 *  - Completion is only claimed when the provider returns a video id.
 */

import { createHash } from "node:crypto";
import type {
  PublishingProvider,
  PublishingProviderResponse,
  PublishRequest,
} from "@ai-media-factory/tool-framework";
import { mediaTransportFingerprint, preflightMediaTransport, readVerifiedLocalMedia } from "@ai-media-factory/tool-framework";
import type { PublishSessionStore } from "@ai-media-factory/database";
import { sendHttp, sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, assertNonNegative, envNumber, optionalEnv, requiredEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface YouTubePublishConfig {
  accessToken: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxUploadBytes?: number;
  /** Crash-safe resumable session store. When provided, publications recover
   *  after a crash/surge instead of re-uploading. */
  publishSessionStore?: PublishSessionStore;
  /** Best-effort recovery by searching for an embedded marker line. */
  enableMarkerDedup?: boolean;
  /** Embed the marker line in the video description. Default true. */
  embedIdempotencyMarker?: boolean;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://www.googleapis.com";
const DEFAULT_MAX_UPLOAD_BYTES = 256 * 1024 * 1024;

export class YouTubePublishAdapter implements PublishingProvider {
  readonly providerId = "youtube";
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxUploadBytes: number;
  private readonly publishSessionStore?: PublishSessionStore;
  private readonly enableMarkerDedup: boolean;
  private readonly embedIdempotencyMarker: boolean;
  private readonly onOperation: OperationSink;

  constructor(config: YouTubePublishConfig) {
    if (typeof config.accessToken !== "string" || config.accessToken.trim().length === 0) {
      throw providerConfigError(
        "youtube",
        "config.accessToken is required. Provide a YouTube OAuth access token (YOUTUBE_ACCESS_TOKEN).",
      );
    }
    this.accessToken = config.accessToken.trim();
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxUploadBytes = config.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
    this.publishSessionStore = config.publishSessionStore;
    this.enableMarkerDedup = config.enableMarkerDedup ?? false;
    this.embedIdempotencyMarker = config.embedIdempotencyMarker ?? true;
    assertPositive("youtube", this.timeoutMs, "timeoutMs");
    assertNonNegative("youtube", this.maxUploadBytes, "maxUploadBytes");
    this.onOperation = sinkOf(config.onOperation);
  }

  async publish(request: PublishRequest): Promise<PublishingProviderResponse> {
    try { await preflightMediaTransport(request.mediaTransportRef, request.finalMediaSha256); }
    catch (error) { throw providerValidationError(this.providerId, "publish", error instanceof Error ? error.message : "MEDIA_TRANSPORT_PREFLIGHT_FAILED"); }
    const title = assertYouTubeTitle(request.title);
    const visibility = request.options?.visibility ?? "private";
    const marker = markerFor(request.finalMediaArtifactId, request.finalMediaSha256, title, visibility);

    // 1) Durable session recovery: a provider-confirmed publication for this
    //    logical request must be returned as-is (idempotent retry after crash).
    if (this.publishSessionStore !== undefined) {
      const session = await this.publishSessionStore.get(marker);
      if (session !== null && session.status === "completed") {
        return {
          providerId: this.providerId,
          status: "completed",
          publicationId: session.publicationId,
          url: session.url,
          publishedAt: session.publishedAt,
        };
      }
      if (session !== null && session.status === "pending" && session.sessionUri !== undefined) {
        const expectedFingerprint = mediaTransportFingerprint(request.mediaTransportRef);
        if (session.finalMediaArtifactId !== request.finalMediaArtifactId
          || session.finalMediaSha256 !== request.finalMediaSha256
          || session.transportType !== request.mediaTransportRef.type
          || session.transportFingerprint !== expectedFingerprint) {
          throw providerValidationError(this.providerId, "publish", "PUBLISH_SESSION_IDENTITY_MISMATCH");
        }
        const resumed = await this.uploadBytes(session.sessionUri, request.mediaTransportRef, request.finalMediaSha256);
        return this.confirmed(request, resumed, marker);
      }
    }

    // 2) Best-effort marker search (optional): recover an existing upload whose
    //    description already carries this publication's marker line.
    if (this.enableMarkerDedup) {
      const existing = await this.findByMarker(marker);
      if (existing !== null && this.publishSessionStore !== undefined) {
        await this.publishSessionStore.saveCompleted(marker, {
          providerId: this.providerId,
          publicationId: existing.id,
          url: watchUrl(existing.id),
          publishedAt: existing.publishedAt,
        });
        return {
          providerId: this.providerId,
          status: "completed",
          publicationId: existing.id,
          url: watchUrl(existing.id),
          publishedAt: existing.publishedAt,
        };
      }
    }

    // 3) Fresh resumable upload.
    const description = this.buildDescription(request, marker);
    const body = await this.loadMedia(request.mediaTransportRef, request.finalMediaSha256);
    const sessionUri = await this.initUpload(visibility, title, description, body.byteLength, request.tags);
    if (this.publishSessionStore !== undefined) {
      await this.publishSessionStore.savePending(marker, sessionUri, {
        finalMediaArtifactId: request.finalMediaArtifactId,
        finalMediaSha256: request.finalMediaSha256,
        transportType: request.mediaTransportRef.type,
        transportFingerprint: mediaTransportFingerprint(request.mediaTransportRef),
      });
    }
    const video = await this.uploadBytes(sessionUri, request.mediaTransportRef, request.finalMediaSha256, body);
    return this.confirmed(request, video, marker);
  }

  private async confirmed(
    request: PublishRequest,
    video: { id: string; publishedAt: string; url: string },
    marker: string,
  ): Promise<PublishingProviderResponse> {
    if (this.publishSessionStore !== undefined) {
      await this.publishSessionStore.saveCompleted(marker, {
        providerId: this.providerId,
        publicationId: video.id,
        url: video.url,
        publishedAt: video.publishedAt,
      });
    }
    return {
      providerId: this.providerId,
      status: "completed",
      publicationId: video.id,
      url: video.url,
      publishedAt: video.publishedAt,
    };
  }

  private buildDescription(request: PublishRequest, marker: string): string {
    const base = request.description === undefined ? "" : request.description.trim();
    const joined = [base, ""]
      .filter((part) => part.length > 0)
      .join("\n");
    if (!this.embedIdempotencyMarker) return joined;
    const line = joined.length === 0 ? "" : joined + "\n";
    return `${line}[amf-id ${marker}]`;
  }

  private async findByMarker(
    marker: string,
  ): Promise<{ id: string; publishedAt: string } | null> {
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/youtube/v3/search`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("forMine", "true");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "10");
    url.searchParams.set("q", marker);
    const res = await sendHttpWithRetry(
      {
        method: "GET",
        url: url.toString(),
        headers: { Authorization: `Bearer ${this.accessToken}`, Accept: "application/json" },
      },
      {
        providerId: this.providerId,
        operation: "marker-lookup",
        timeoutMs: this.timeoutMs,
        maxRetries: 2,
        onOperation: this.onOperation,
        requestKey: marker,
      },
    );
    const json = await this.readJson(res);
    if (!isRecord(json) || (json.items !== undefined && !Array.isArray(json.items))) {
      throw providerValidationError(this.providerId, "marker-lookup", "Provider returned a malformed search response");
    }
    const items = Array.isArray(json.items) ? json.items : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const id = isRecord(item.id) ? asString(item.id.videoId) : undefined;
      const snippet = isRecord(item.snippet) ? item.snippet : {};
      const description = asString(snippet.description) ?? "";
      if (id !== undefined && description.includes(`[amf-id ${marker}]`)) {
        return { id, publishedAt: asString(snippet.publishedAt) ?? new Date().toISOString() };
      }
    }
    return null;
  }

  private async loadMedia(transport: PublishRequest["mediaTransportRef"], expectedSha256: string): Promise<Uint8Array> {
    if (transport.type === "LOCAL_FILE") {
      try {
        const bytes = await readVerifiedLocalMedia(transport, expectedSha256);
        if (bytes.byteLength > this.maxUploadBytes) throw new Error(`The asset exceeds the configured ${this.maxUploadBytes} byte upload limit`);
        return bytes;
      }
      catch (error) { throw providerValidationError(this.providerId, "media-load", error instanceof Error ? error.message : "LOCAL_FILE_TRANSPORT_FAILED"); }
    }
    if (transport.type === "PROVIDER_MATERIALIZED") {
      throw providerValidationError(this.providerId, "media-load", "PROVIDER_MATERIALIZED_TRANSPORT_UNSUPPORTED");
    }
    const assetUrl = transport.url;
    const res = await sendHttpWithRetry(
      {
        method: "GET",
        url: assetUrl,
        headers: { Accept: "video/*" },
      },
      {
        providerId: this.providerId,
        operation: "download",
        timeoutMs: this.timeoutMs,
        maxRetries: 2,
        onOperation: this.onOperation,
      },
    );
    const bytes = await res.bytes();
    if (bytes.byteLength === 0) {
      throw providerValidationError(this.providerId, "download", "The asset to publish is empty");
    }
    if (bytes.byteLength > this.maxUploadBytes) {
      throw providerValidationError(
        this.providerId,
        "download",
        `The asset exceeds the configured ${this.maxUploadBytes} byte upload limit`,
      );
    }
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      throw providerValidationError(this.providerId, "download", "MEDIA_TRANSPORT_SHA256_MISMATCH");
    }
    return bytes;
  }

  private async initUpload(
    visibility: "public" | "unlisted" | "private",
    title: string,
    description: string,
    totalBytes: number,
    tags: readonly string[] | undefined,
  ): Promise<string> {
    const snippet: Record<string, unknown> = { title, description };
    if (tags !== undefined && tags.length > 0) snippet.tags = [...tags];
    const url = new URL(`${this.baseUrl.replace(/\/$/, "")}/upload/youtube/v3/videos`);
    url.searchParams.set("uploadType", "resumable");
    url.searchParams.set("part", "snippet,status");
    const res = await sendHttp(
      {
        method: "POST",
        url: url.toString(),
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(totalBytes),
          "X-Upload-Content-Type": "video/mp4",
        },
        body: JSON.stringify({
          snippet,
          status: { privacyStatus: visibility },
        }),
      },
      {
        providerId: this.providerId,
        operation: "session-init",
        timeoutMs: this.timeoutMs,
        onOperation: this.onOperation,
      },
    );
    const sessionUri = res.headers.get("location");
    if (sessionUri === null || sessionUri.trim().length === 0) {
      throw providerValidationError(this.providerId, "session-init", "Provider did not return an upload session location");
    }
    return sessionUri;
  }

  private async uploadBytes(
    sessionUri: string,
    transport: PublishRequest["mediaTransportRef"],
    expectedSha256: string,
    preloaded?: Uint8Array,
  ): Promise<{ id: string; publishedAt: string; url: string }> {
    const body = preloaded ?? (await this.loadMedia(transport, expectedSha256));
    const res = await sendHttp(
      {
        method: "PUT",
        url: sessionUri,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "video/mp4",
          "Content-Length": String(body.byteLength),
        },
        body,
      },
      {
        providerId: this.providerId,
        operation: "upload",
        timeoutMs: this.timeoutMs,
        onOperation: this.onOperation,
      },
    );
    const json = await this.readJson(res);
    if (!isRecord(json)) {
      throw providerValidationError(this.providerId, "upload", "Provider returned a non-object upload response");
    }
    const videoId = asString(json.id);
    if (videoId === undefined || videoId.trim().length === 0) {
      throw providerValidationError(this.providerId, "upload", "Provider did not confirm a published video id");
    }
    const snippet = isRecord(json.snippet) ? json.snippet : {};
    return {
      id: videoId,
      publishedAt: asString(snippet.publishedAt) ?? new Date().toISOString(),
      url: watchUrl(videoId),
    };
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "upload", "Provider returned a non-JSON response");
    }
  }
}

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

/** YouTube video title limit (characters), enforced by the provider
 *  (a 103-character validation title was rejected with invalidTitle). */
export const YOUTUBE_TITLE_MAX_LENGTH = 100;

/**
 * Provider-boundary title validation. Fails BEFORE any provider call when
 * the title is missing, empty/whitespace-only, non-string, or over the
 * provider limit. Returns the trimmed title. Never invents, truncates, or
 * substitutes fallback titles: invalid input throws.
 */
export function assertYouTubeTitle(title: unknown): string {
  if (typeof title !== "string") {
    throw providerValidationError("youtube", "publish", "TITLE_REQUIRED");
  }
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw providerValidationError("youtube", "publish", "TITLE_EMPTY");
  }
  if (trimmed.length > YOUTUBE_TITLE_MAX_LENGTH) {
    throw providerValidationError(
      "youtube", "publish",
      `TITLE_TOO_LONG:${trimmed.length}>${YOUTUBE_TITLE_MAX_LENGTH}`,
    );
  }
  return trimmed;
}

/** Stable marker for one logical publication: asset + title + visibility. */
export function markerFor(finalMediaArtifactId: string, finalMediaSha256: string, title: string, visibility: string): string {  const digest = createHash("sha256")
    .update(`artifact=${finalMediaArtifactId}\nsha256=${finalMediaSha256.toLowerCase()}\ntitle=${title}\nvisibility=${visibility}`)
    .digest("hex")
    .slice(0, 16);
  return digest;
}

/**
 * M4 private-visibility hard guard (fail-closed, provider-free).
 * The validation proof may only ever request privacyStatus=private:
 * any other requested visibility — public, unlisted, unset, or
 * malformed — throws BEFORE any provider call. Case-sensitive exact
 * match; the adapter default ("private") passes unchanged.
 */
export function requirePrivateVisibility(visibility: unknown): "private" {
  if (visibility !== "private") {
    throw providerValidationError(
      "youtube",
      "publish",
      `PRIVATE_VISIBILITY_REQUIRED: got ${typeof visibility === "string" && visibility.length > 0 ? `'${visibility}'` : typeof visibility}`,
    );
  }
  return "private";
}

/** Construct a YouTube publishing adapter from environment variables. */
export function youTubePublishAdapterFromEnv(
  publishSessionStore?: PublishSessionStore,
  onOperation?: OperationSink,
): YouTubePublishAdapter {
  return new YouTubePublishAdapter({
    accessToken: requiredEnv("youtube", "YOUTUBE_ACCESS_TOKEN", "YouTube OAuth access token"),
    baseUrl: optionalEnv("GOOGLE_API_BASE_URL", DEFAULT_BASE_URL),
    timeoutMs: envNumber("youtube", "PUBLISH_TIMEOUT_MS", 30_000),
    maxUploadBytes: envNumber("youtube", "PUBLISH_MAX_UPLOAD_BYTES", DEFAULT_MAX_UPLOAD_BYTES),
    publishSessionStore,
    onOperation,
  });
}
