/**
 * Durable publishing session store for the YouTube publishing adapter.
 *
 * The publish adapter persists its resumable-upload session URI AND the
 * provider-confirmed publication BEFORE local acknowledgement, keyed by a stable
 * per-logical-publication marker. This closes the crash window between "the
 * provider accepted the upload" and "we acknowledged": a replayed publication
 * resumes the same upload session and recovers the same provider publication id
 * instead of creating a duplicate.
 */

export type PublishSessionRecord =
  | {
      marker: string;
      status: "completed";
      providerId: string;
      publicationId: string;
      url: string;
      publishedAt: string;
    }
  | { marker: string; status: "pending"; sessionUri?: string; finalMediaArtifactId?: string; finalMediaSha256?: string; transportType?: string; transportFingerprint?: string }
  | { marker: string; status: "failed" };

export interface PublishSessionStore {
  get(marker: string): Promise<PublishSessionRecord | null>;
  /** Persist the in-flight upload session before the body is transferred. */
  savePending(marker: string, sessionUri?: string, identity?: { finalMediaArtifactId: string; finalMediaSha256: string; transportType: string; transportFingerprint: string }): Promise<void>;
  /** Persist the provider-confirmed publication; terminal and never downgraded. */
  saveCompleted(
    marker: string,
    entry: { providerId: string; publicationId: string; url: string; publishedAt: string },
  ): Promise<void>;
  saveFailed(marker: string): Promise<void>;
}
