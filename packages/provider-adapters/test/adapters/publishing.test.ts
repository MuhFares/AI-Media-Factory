/** Publishing adapter tests against the YouTube mock (real HTTP end to end). */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { YouTubePublishAdapter, markerFor } from "@ai-media-factory/provider-adapters";
import { createYouTubePublishMock, createMediaMock } from "../helpers/mock-servers.ts";
import { InMemoryPublishSessionStore } from "../helpers/in-memory-stores.ts";
import { isProviderError } from "@ai-media-factory/provider-adapters";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function localMedia(t: { after(fn: () => unknown): void }, size = 4096) {
  const dir = await mkdtemp(join(tmpdir(), "amf-youtube-adapter-"));
  const path = join(dir, "video.mp4");
  const bytes = Buffer.alloc(size, 0x42);
  await writeFile(path, bytes);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { path, sha256: createHash("sha256").update(bytes).digest("hex"), bytes };
}
const requestFor = (media: { path: string; sha256: string }, title: string, visibility: "private" | "unlisted" | "public" = "private") => ({
  finalMediaArtifactId: "art-final-media-test", finalMediaSha256: media.sha256,
  mediaTransportRef: { type: "LOCAL_FILE" as const, path: media.path, expectedSha256: media.sha256, mimeType: "video/mp4" },
  title, options: { visibility },
});

describe("YouTubePublishAdapter", () => {
  it("publishes an asset through the resumable upload flow", async (t) => {
    const mock = await createYouTubePublishMock();
    t.after(() => mock.close());
    const media = await localMedia(t);
    const store = new InMemoryPublishSessionStore();
    const adapter = new YouTubePublishAdapter({ accessToken: "t", baseUrl: mock.url, publishSessionStore: store });

    const response = await adapter.publish({
      ...requestFor(media, "My video"),
      description: "desc",
    });

    strictEqual(response.status, "completed");
    strictEqual(response.providerId, "youtube");
    ok(response.publicationId !== undefined && response.publicationId.startsWith("vid-"));
    ok(response.url.startsWith("https://www.youtube.com/watch?v="));
    strictEqual(mock.state.inits, 1);
    strictEqual(mock.state.uploads, 1);
    ok(store.count() === 1, "provider-confirmed publication must be persisted");
  });

  it("recovers the same publication for a retry after a crash mid-upload", async (t) => {
    const mock = await createYouTubePublishMock();
    t.after(() => mock.close());
    const media = await localMedia(t);
    const store = new InMemoryPublishSessionStore();
    const adapter = new YouTubePublishAdapter({ accessToken: "t", baseUrl: mock.url, publishSessionStore: store });

    const request = requestFor(media, "Crash-safe video");
    mock.state.mode = "fail-upload-once";
    let firstId: string | undefined;
    try {
      await adapter.publish(request);
      ok(false, "expected the first upload attempt to fail");
    } catch (error) {
      ok(isProviderError(error), "transient upload failure is classified");
    }

    mock.state.mode = "ok";
    const recovered = await adapter.publish(request);
    strictEqual(recovered.status, "completed");
    ok(recovered.publicationId !== undefined);
    if (firstId !== undefined) strictEqual(recovered.publicationId, firstId);
    ok(mock.state.uploads === 2, "the retry resumed the same session (two body transfers)");
    ok(mock.state.markerVideos.size === 1, "exactly one video exists on the provider");
  });

  it("does not create a duplicate when the same logical request is republished", async (t) => {
    const mock = await createYouTubePublishMock();
    t.after(() => mock.close());
    const media = await localMedia(t);
    const store = new InMemoryPublishSessionStore();
    const adapter = new YouTubePublishAdapter({ accessToken: "t", baseUrl: mock.url, publishSessionStore: store });

    const request = requestFor(media, "Dedup video", "unlisted");
    const first = await adapter.publish(request);
    const second = await adapter.publish(request);
    strictEqual(second.publicationId, first.publicationId, "same provider publication id");
    strictEqual(mock.state.inits, 1, "only one resumable session created");
    strictEqual(mock.state.uploads, 1, "only one body transfer");
  });

  it("rejects a missing local transport file", async (t) => {
    const adapter = new YouTubePublishAdapter({ accessToken: "t" });
    try {
      const sha256 = "a".repeat(64);
      await adapter.publish({ finalMediaArtifactId: "art", finalMediaSha256: sha256, mediaTransportRef: { type: "LOCAL_FILE", path: "C:\\missing\\file.mp4", expectedSha256: sha256 }, title: "x" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("classifies an unauthorized provider response", async (t) => {
    const mock = await createYouTubePublishMock();
    t.after(() => mock.close());
    const media = await localMedia(t);
    mock.state.mode = "unauthorized";
    const adapter = new YouTubePublishAdapter({ accessToken: "bad", baseUrl: mock.url });
    try {
      await adapter.publish(requestFor(media, "x"));
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "AUTHORIZATION");
    }
  });

  it("classifies an oversized asset as validation", async (t) => {
    const mock = await createYouTubePublishMock();
    t.after(() => mock.close());
    const media = await localMedia(t);
    const adapter = new YouTubePublishAdapter({
      accessToken: "t",
      baseUrl: mock.url,
      maxUploadBytes: 1024,
      timeoutMs: 2000,
    });
    try {
      await adapter.publish(requestFor(media, "x"));
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("recovers a previously published video via the marker search", async (t) => {
    const mock = await createYouTubePublishMock();
    t.after(() => mock.close());
    const media = await localMedia(t);
    const store = new InMemoryPublishSessionStore();
    const adapter = new YouTubePublishAdapter({
      accessToken: "t",
      baseUrl: mock.url,
      publishSessionStore: store,
      enableMarkerDedup: true,
    });
    const request = requestFor(media, "Marker dedup", "public");
    const first = await adapter.publish(request);
    strictEqual(mock.state.inits, 1);

    // Simulate a fresh process: a new store (no local record) + a provider that
    // already has the video. The marker search must recover the same id.
    const freshStore = new InMemoryPublishSessionStore();
    const freshAdapter = new YouTubePublishAdapter({
      accessToken: "t",
      baseUrl: mock.url,
      publishSessionStore: freshStore,
      enableMarkerDedup: true,
    });
    const recovered = await freshAdapter.publish(request);
    strictEqual(recovered.publicationId, first.publicationId, "marker search recovers the existing upload");
    strictEqual(mock.state.inits, 1, "no second upload was initiated");
  });

  it("derives a stable marker from asset, title and visibility", () => {
    strictEqual(
      markerFor("a", "b".repeat(64), "t", "private"),
      markerFor("a", "b".repeat(64), "t", "private"),
      "same inputs -> same marker",
    );
    ok(markerFor("a", "b".repeat(64), "t", "private") !== markerFor("a", "b".repeat(64), "t", "public"), "different visibility -> different marker");
  });
});
