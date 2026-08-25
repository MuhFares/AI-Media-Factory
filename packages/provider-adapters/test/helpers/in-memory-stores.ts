/**
 * In-memory implementations of the durable store contracts for tests.
 */

import type { PublishStore } from "@ai-media-factory/tool-framework";
import type { PublishSessionRecord, PublishSessionStore } from "@ai-media-factory/database";

export class InMemoryPublishStore implements PublishStore {
  private readonly entries = new Map<string, PublishStoreEntry>();

  async get(
    idempotencyKey: string,
  ): Promise<{ status: "completed"; providerId: string; publicationId: string; url: string; publishedAt: string } | { status: "failed"; providerId: string; error: { code: string; message: string } } | null> {
    return this.entries.get(idempotencyKey) ?? null;
  }

  async save(
    idempotencyKey: string,
    entry: PublishStoreEntry,
  ): Promise<void> {
    this.entries.set(idempotencyKey, entry);
  }

  /** Total number of saved outcomes (for dedup assertions). */
  count(): number {
    return this.entries.size;
  }
}

type PublishStoreEntry =
  | { status: "completed"; providerId: string; publicationId: string; url: string; publishedAt: string }
  | { status: "failed"; providerId: string; error: { code: string; message: string } };

export class InMemoryPublishSessionStore implements PublishSessionStore {
  private readonly sessions = new Map<string, PublishSessionRecord>();

  async get(marker: string): Promise<PublishSessionRecord | null> {
    return this.sessions.get(marker) ?? null;
  }

  async savePending(marker: string, sessionUri?: string): Promise<void> {
    const existing = this.sessions.get(marker);
    if (existing?.status === "completed") return;
    this.sessions.set(marker, { marker, status: "pending", sessionUri });
  }

  async saveCompleted(
    marker: string,
    entry: { providerId: string; publicationId: string; url: string; publishedAt: string },
  ): Promise<void> {
    this.sessions.set(marker, { marker, status: "completed", ...entry });
  }

  async saveFailed(marker: string): Promise<void> {
    const existing = this.sessions.get(marker);
    if (existing?.status === "completed") return;
    this.sessions.set(marker, { marker, status: "failed" });
  }

  count(): number {
    return this.sessions.size;
  }
}