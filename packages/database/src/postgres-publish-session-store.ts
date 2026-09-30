/**
 * PostgreSQL-backed PublishSessionStore (provider_upload_sessions).
 *
 * Keyed by the stable per-logical-publication marker derived by the publishing
 * adapter. A "completed" entry is terminal and never downgraded; a "pending"
 * entry carries the resumable-upload session URI so a retried publication after
 * a crash resumes the exact same provider upload instead of starting another.
 */

import type pg from "pg";
import type { PublishSessionRecord, PublishSessionStore } from "./publish-session-store.js";

const NOW = (): string => new Date().toISOString();

export class PostgresPublishSessionStore implements PublishSessionStore {
  private closed = false;
  constructor(private readonly pool: pg.Pool) {}

  async get(marker: string): Promise<PublishSessionRecord | null> {
    const res = await this.pool.query(
      `SELECT status, provider_id, session_uri, publication_id, url, published_at,
              final_media_artifact_id, final_media_sha256, transport_type, transport_fingerprint
         FROM provider_upload_sessions WHERE marker = $1`,
      [marker]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    if (r.status === "completed" && typeof r.publication_id === "string" && typeof r.url === "string") {
      return {
        marker,
        status: "completed",
        providerId: r.provider_id ?? "",
        publicationId: r.publication_id,
        url: r.url,
        publishedAt: r.published_at ?? new Date().toISOString(),
      };
    }
    if (r.status === "pending") {
      return { marker, status: "pending", sessionUri: r.session_uri ?? undefined,
        finalMediaArtifactId: r.final_media_artifact_id ?? undefined, finalMediaSha256: r.final_media_sha256 ?? undefined,
        transportType: r.transport_type ?? undefined, transportFingerprint: r.transport_fingerprint ?? undefined };
    }
    return { marker, status: "failed" };
  }

  async savePending(marker: string, sessionUri?: string, identity?: { finalMediaArtifactId: string; finalMediaSha256: string; transportType: string; transportFingerprint: string }): Promise<void> {
    const now = NOW();
    await this.pool.query(
      `INSERT INTO provider_upload_sessions (marker, status, session_uri, final_media_artifact_id, final_media_sha256, transport_type, transport_fingerprint, created_at, updated_at)
       VALUES ($1,'pending',$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (marker) DO UPDATE SET
         status='pending', session_uri=$2, final_media_artifact_id=$3, final_media_sha256=$4,
         transport_type=$5, transport_fingerprint=$6, updated_at=$8
         WHERE provider_upload_sessions.status IS DISTINCT FROM 'completed'`,
      [marker, sessionUri ?? null, identity?.finalMediaArtifactId ?? null, identity?.finalMediaSha256 ?? null,
       identity?.transportType ?? null, identity?.transportFingerprint ?? null, now, now]
    );
  }

  async saveCompleted(
    marker: string,
    entry: { providerId: string; publicationId: string; url: string; publishedAt: string },
  ): Promise<void> {
    const now = NOW();
    await this.pool.query(
      `INSERT INTO provider_upload_sessions (marker, status, provider_id, publication_id, url, published_at, created_at, updated_at)
       VALUES ($1,'completed',$2,$3,$4,$5,$6,$7)
       ON CONFLICT (marker) DO UPDATE SET
         status='completed', provider_id=$2, publication_id=$3, url=$4, published_at=$5, updated_at=$7`,
      [marker, entry.providerId, entry.publicationId, entry.url, entry.publishedAt, now, now]
    );
  }

  async saveFailed(marker: string): Promise<void> {
    const now = NOW();
    await this.pool.query(
      `INSERT INTO provider_upload_sessions (marker, status, created_at, updated_at)
       VALUES ($1,'failed',$2,$3)
       ON CONFLICT (marker) DO UPDATE SET
         status='failed', updated_at=$3
         WHERE provider_upload_sessions.status IS DISTINCT FROM 'completed'`,
      [marker, now, now]
    );
  }

  async reset(): Promise<void> {
    await this.pool.query("DELETE FROM provider_upload_sessions");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
