/**
 * PostgreSQL-backed PublishStore for the publishing capability (publish.youtube).
 *
 * Provider publish outcomes are keyed by the capability's deterministic
 * idempotency key. A "completed" entry is terminal and is never downgraded:
 *  - a fresh failed attempt inserts a failed row (retryable),
 *  - a later completed attempt upgrades the row,
 *  - a replayed publish after a worker crash that already has a completed row
 *    returns the provider-confirmed publication without re-publishing.
 */

import type pg from "pg";
import type { PublishStore } from "@ai-media-factory/tool-framework";

type CompletedEntry = {
  status: "completed";
  providerId: string;
  publicationId: string;
  url: string;
  publishedAt: string;
  /** Provider-confirmed visibility (private|unlisted|public). Absent for
   *  pre-visibility rows, which read as NOT_PUBLISHED (fail closed). */
  visibility?: string;
};
type FailedEntry = {
  status: "failed";
  providerId: string;
  error: { code: string; message: string };
};

const NOW = (): string => new Date().toISOString();

export class PostgresPublishStore implements PublishStore {
  private closed = false;
  constructor(private readonly pool: pg.Pool) {}

  async get(idempotencyKey: string): Promise<CompletedEntry | FailedEntry | null> {
    const res = await this.pool.query(
      `SELECT status, provider_id, publication_id, url, published_at, visibility, error_code, error_message
         FROM provider_publications
        WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    if (
      r.status === "completed" &&
      typeof r.publication_id === "string" &&
      typeof r.url === "string" &&
      typeof r.published_at === "string"
    ) {
      return {
        status: "completed",
        providerId: r.provider_id ?? "",
        publicationId: r.publication_id,
        url: r.url,
        publishedAt: r.published_at,
        ...(typeof r.visibility === "string" && r.visibility !== "" ? { visibility: r.visibility } : {}),
      };
    }
    return {
      status: "failed",
      providerId: r.provider_id ?? "",
      error: {
        code: r.error_code ?? "PROVIDER_FAILED",
        message: r.error_message ?? "Provider publish failed",
      },
    };
  }

  async save(idempotencyKey: string, entry: CompletedEntry | FailedEntry): Promise<void> {
    const now = NOW();
    if (entry.status === "completed") {
      await this.pool.query(
        `INSERT INTO provider_publications
           (idempotency_key, status, provider_id, publication_id, url, published_at, visibility, created_at, updated_at)
         VALUES ($1,'completed',$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (idempotency_key) DO UPDATE SET
           status='completed', provider_id=$2, publication_id=$3, url=$4, published_at=$5,
           visibility=COALESCE($6,provider_publications.visibility), updated_at=$8`,
        [idempotencyKey, entry.providerId, entry.publicationId, entry.url, entry.publishedAt, entry.visibility ?? null, now, now]
      );
      return;
    }
    await this.pool.query(
      `INSERT INTO provider_publications
         (idempotency_key, status, provider_id, error_code, error_message, created_at, updated_at)
       VALUES ($1,'failed',$2,$3,$4,$5,$6)
       ON CONFLICT (idempotency_key) DO UPDATE SET
         provider_id=$2, error_code=$3, error_message=$4, updated_at=$6
       WHERE provider_publications.status IS DISTINCT FROM 'completed'`,
      [idempotencyKey, entry.providerId, entry.error.code, entry.error.message, now, now]
    );
  }

  /** Drop the local table. Test/diagnostic helper only. */
  async reset(): Promise<void> {
    await this.pool.query("DELETE FROM provider_publications");
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
