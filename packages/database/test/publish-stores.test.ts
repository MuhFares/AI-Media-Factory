/**
 * Postgres-backed PublishStore / PublishSessionStore tests.
 *
 * These run only against the canonical isolated TEST_DATABASE_URL resolved by
 * the shared integration-test guard. They verify idempotency semantics: completed is terminal and
 * never downgraded, and resumable sessions persist across process restarts.
 */

import { describe, it, before, after } from "node:test";
import { strictEqual, ok } from "node:assert";
import type pg from "pg";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";
import {
  createPool,
  migrate,
  PostgresPublishStore,
  PostgresPublishSessionStore,
} from "@ai-media-factory/database";

const connectionString = TEST_DATABASE_URL;

let pool: pg.Pool;
let store: PostgresPublishStore;
let sessionStore: PostgresPublishSessionStore;

describe("Postgres publish stores", () => {
  before(async () => {
    assertTestDatabaseIsolation();
    pool = createPool({ connectionString });
    await migrate(pool);
    store = new PostgresPublishStore(pool);
    sessionStore = new PostgresPublishSessionStore(pool);
    await pool.query("TRUNCATE provider_publications, provider_upload_sessions");
  });

  after(async () => {
    await pool.end();
  });

  it("returns null for an unknown idempotency key", async () => {
    strictEqual(await store.get("publish:does-not-exist"), null);
    strictEqual(await sessionStore.get("unknown-marker"), null);
  });

  it("persists a completed publication and reads it back", async () => {
    await store.save("publish:k1", {
      status: "completed",
      providerId: "youtube",
      publicationId: "vid-1",
      url: "https://www.youtube.com/watch?v=vid-1",
      publishedAt: "2026-01-02T03:04:05.000Z",
    });
    const entry = await store.get("publish:k1");
    ok(entry !== null && entry.status === "completed");
    if (entry?.status === "completed") {
      strictEqual(entry.publicationId, "vid-1");
      strictEqual(entry.url, "https://www.youtube.com/watch?v=vid-1");
    }
  });

  it("upgrades a failed outcome to completed", async () => {
    await store.save("publish:k2", {
      status: "failed",
      providerId: "youtube",
      error: { code: "PROVIDER_ERROR", message: "first attempt failed" },
    });
    await store.save("publish:k2", {
      status: "completed",
      providerId: "youtube",
      publicationId: "vid-2",
      url: "https://www.youtube.com/watch?v=vid-2",
      publishedAt: "2026-01-02T03:04:05.000Z",
    });
    const entry = await store.get("publish:k2");
    ok(entry !== null && entry.status === "completed");
    if (entry?.status === "completed") strictEqual(entry.publicationId, "vid-2");
  });

  it("never downgrades a completed publication", async () => {
    await store.save("publish:k3", {
      status: "completed",
      providerId: "youtube",
      publicationId: "vid-3",
      url: "https://www.youtube.com/watch?v=vid-3",
      publishedAt: "2026-01-02T03:04:05.000Z",
    });
    await store.save("publish:k3", {
      status: "failed",
      providerId: "youtube",
      error: { code: "PROVIDER_ERROR", message: "late failure" },
    });
    const entry = await store.get("publish:k3");
    ok(entry !== null && entry.status === "completed");
  });

  it("persists a pending upload session and resumes it after a crash", async () => {
    await sessionStore.savePending("marker-session-1", "http://localhost/resumable/session-1");
    const pending = await sessionStore.get("marker-session-1");
    ok(pending !== null && pending.status === "pending");
    if (pending?.status === "pending") {
      strictEqual(pending.sessionUri, "http://localhost/resumable/session-1");
    }
  });

  it("marks a completed session as terminal (no downgrade by pending/failed)", async () => {
    await sessionStore.savePending("marker-terminal", "http://localhost/resumable/session-2");
    await sessionStore.saveCompleted("marker-terminal", {
      providerId: "youtube",
      publicationId: "vid-9",
      url: "https://www.youtube.com/watch?v=vid-9",
      publishedAt: "2026-01-02T03:04:05.000Z",
    });
    await sessionStore.savePending("marker-terminal", "http://localhost/evil");
    await sessionStore.saveFailed("marker-terminal");
    const entry = await sessionStore.get("marker-terminal");
    ok(entry !== null && entry.status === "completed");
    if (entry?.status === "completed") {
      strictEqual(entry.publicationId, "vid-9");
      strictEqual(entry.url, "https://www.youtube.com/watch?v=vid-9");
    }
  });

  it("recovers the provider publication id after a simulated crash", async () => {
    const marker = "marker-crash-recovery";
    await sessionStore.saveCompleted(marker, {
      providerId: "youtube",
      publicationId: "vid-crash",
      url: "https://www.youtube.com/watch?v=vid-crash",
      publishedAt: "2026-01-02T03:04:05.000Z",
    });
    const entry = await sessionStore.get(marker);
    ok(entry !== null && entry.status === "completed");
    if (entry?.status === "completed") strictEqual(entry.publicationId, "vid-crash");
  });
});
