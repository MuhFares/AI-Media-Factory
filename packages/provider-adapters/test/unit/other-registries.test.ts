/** Unit tests: image / video / publishing / analytics registries. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  ImageProviderRegistry,
  imageAdapterFromEnv,
  VideoProviderRegistry,
  videoAdapterFromEnv,
  PublishingProviderRegistry,
  publishingAdapterFromEnv,
  AnalyticsProviderRegistry,
  analyticsAdapterFromEnv,
  ProviderConfigurationError,
  isProviderError,
} from "@ai-media-factory/provider-adapters";
import type {
  ImageProviderImplementation,
  VideoProviderImplementation,
  PublishingProviderImplementation,
  AnalyticsProviderImplementation,
} from "@ai-media-factory/provider-adapters";
import { createImageMock, createReplicateMock, createYouTubePublishMock, createMediaMock, createAnalyticsMock, createRunPodMock, createRunPodVideoMock } from "../helpers/mock-servers.ts";

function fakeImage(id: string): ImageProviderImplementation {
  return {
    providerId: id,
    generate: async () => ({ providerId: id, imageId: `${id}-img`, title: id, url: `https://${id}.example/img.png`, parameters: { prompt: id } }),
  } as unknown as ImageProviderImplementation;
}
function fakeVideo(id: string): VideoProviderImplementation {
  return {
    providerId: id,
    generate: async () => ({ providerId: id, status: "completed", jobId: "j", videoId: "v", url: "https://cdn.example/v.mp4" }),
  } as unknown as VideoProviderImplementation;
}
function fakePublish(id: string): PublishingProviderImplementation {
  return {
    providerId: id,
    publish: async () => ({ providerId: id, status: "completed", publicationId: "pub", url: "https://youtube.example/watch?v=pub", publishedAt: new Date().toISOString() }),
  } as unknown as PublishingProviderImplementation;
}
function fakeAnalytics(id: string): AnalyticsProviderImplementation {
  return {
    providerId: id,
    fetch: async () => ({ providerId: id, status: "completed", publicationId: "pub", metrics: { views: 1 }, retrievedAt: new Date().toISOString() }),
  } as unknown as AnalyticsProviderImplementation;
}

// -- Image registry ----------------------------------------------------------

describe("ImageProviderRegistry", () => {
  it("routes to the first registered provider by default", async () => {
    const r = new ImageProviderRegistry();
    r.register(fakeImage("openai-image")).register(fakeImage("self-hosted-image"));
    strictEqual(r.activeProviderId, "openai-image");
    strictEqual((await r.generate({ prompt: "p" })).providerId, "openai-image");
  });
  it("routes to explicitly selected provider", async () => {
    const r = new ImageProviderRegistry();
    r.register(fakeImage("openai-image")).register(fakeImage("self-hosted-image"));
    r.setActive("self-hosted-image");
    strictEqual((await r.generate({ prompt: "p" })).providerId, "self-hosted-image");
  });
  it("rejects unknown provider", () => {
    const r = new ImageProviderRegistry();
    r.register(fakeImage("openai-image"));
    try { r.setActive("missing"); ok(false); } catch (e) { ok(isProviderError(e)); strictEqual((e as ProviderConfigurationError).category, "CONFIGURATION"); }
  });
});

describe("imageAdapterFromEnv", () => {
  const backup = { ...process.env };
  function withEnv(c: Record<string, string | undefined>) { for (const [k,v] of Object.entries(c)) { if (v===undefined) delete process.env[k]; else process.env[k]=v; } }
  function clear() { withEnv({ IMAGE_PROVIDER: undefined, OPENAI_API_KEY: undefined, OPENAI_BASE_URL: undefined, RUNPOD_API_KEY: undefined, RUNPOD_IMAGE_API_KEY: undefined, RUNPOD_IMAGE_ENDPOINT_ID: undefined, RUNPOD_ENDPOINT_ID: undefined, RUNPOD_BASE_URL: undefined, SELF_HOSTED_IMAGE_API_KEY: undefined, SELF_HOSTED_IMAGE_BASE_URL: undefined, SELF_HOSTED_IMAGE_ENDPOINT_ID: undefined, IMAGE_SELF_HOSTED_API_KEY: undefined, IMAGE_SELF_HOSTED_BASE_URL: undefined }); }

  it("routes the only configured provider through a real adapter", async (t) => {
    const mock = await createImageMock();
    t.after(() => mock.close());
    try { clear(); withEnv({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: `${mock.url}` }); const r = imageAdapterFromEnv(); strictEqual(r.activeProviderId, "openai-image"); strictEqual((await r.generate({ prompt: "hello" })).providerId, "openai-image"); } finally { Object.assign(process.env, backup); }
  });

  it("accepts alias and self-hosted RunPod credential together", async (t) => {
    const mock = await createRunPodMock();
    t.after(() => mock.close());
    try {
      clear();
      withEnv({ IMAGE_PROVIDER: "self-hosted-image", RUNPOD_API_KEY: "k2", RUNPOD_IMAGE_ENDPOINT_ID: "ep-test", RUNPOD_BASE_URL: `${mock.url}`, OPENAI_API_KEY: "k", OPENAI_BASE_URL: `${mock.url}` });
      const r = imageAdapterFromEnv();
      strictEqual(r.activeProviderId, "self-hosted-image");
      strictEqual((await r.generate({ prompt: "hi" })).providerId, "self-hosted-image");
    } finally { Object.assign(process.env, backup); }
  });

  it("throws when no provider configured", () => {
    try { clear(); try { imageAdapterFromEnv(); ok(false); } catch (e) { ok(isProviderError(e)); } } finally { Object.assign(process.env, backup); }
  });

  it("throws when IMAGE_PROVIDER not configured", () => {
    try { clear(); withEnv({ IMAGE_PROVIDER: "self-hosted-image", OPENAI_API_KEY: "k" }); try { imageAdapterFromEnv(); ok(false); } catch (e) { ok(String((e as Error).message).includes("IMAGE_PROVIDER")); } } finally { Object.assign(process.env, backup); }
  });
});

// -- Video registry ----------------------------------------------------------

describe("VideoProviderRegistry", () => {
  it("routes to first registered", async () => {
    const r = new VideoProviderRegistry();
    r.register(fakeVideo("replicate")).register(fakeVideo("self-hosted-video"));
    strictEqual((await r.generate({ prompt: "p" })).providerId, "replicate");
  });
  it("rejects unknown", () => {
    const r = new VideoProviderRegistry();
    r.register(fakeVideo("replicate"));
    try { r.setActive("missing"); ok(false); } catch (e) { ok(isProviderError(e)); }
  });
});

describe("videoAdapterFromEnv", () => {
  const backup = { ...process.env };
  function withEnv(c: Record<string, string | undefined>) { for (const [k,v] of Object.entries(c)) { if (v===undefined) delete process.env[k]; else process.env[k]=v; } }
  function clear() { withEnv({ VIDEO_PROVIDER: undefined, REPLICATE_API_TOKEN: undefined, REPLICATE_BASE_URL: undefined, RUNPOD_API_KEY: undefined, RUNPOD_VIDEO_ENDPOINT_ID: undefined, RUNPOD_BASE_URL: undefined, SELF_HOSTED_VIDEO_API_KEY: undefined, SELF_HOSTED_VIDEO_BASE_URL: undefined, VIDEO_SELF_HOSTED_API_KEY: undefined, VIDEO_SELF_HOSTED_BASE_URL: undefined }); }

  it("routes the only configured provider through a real adapter", async (t) => {
    const mock = await createReplicateMock();
    t.after(() => mock.close());
    try { clear(); withEnv({ REPLICATE_API_TOKEN: "tok", REPLICATE_BASE_URL: `${mock.url}/v1` }); const r = videoAdapterFromEnv(); strictEqual(r.activeProviderId, "replicate"); strictEqual((await r.generate({ prompt: "hi" })).providerId, "replicate"); } finally { Object.assign(process.env, backup); }
  });

  it("accepts wan alias for self-hosted-video via RunPod", async (t) => {
    const mock = await createRunPodVideoMock();
    t.after(() => mock.close());
    try {
      clear();
      withEnv({ VIDEO_PROVIDER: "wan", RUNPOD_API_KEY: "k2", RUNPOD_VIDEO_ENDPOINT_ID: "ep-test", RUNPOD_BASE_URL: `${mock.url}`, REPLICATE_API_TOKEN: "tok", REPLICATE_BASE_URL: `${mock.url}/v1` });
      const r = videoAdapterFromEnv();
      strictEqual(r.activeProviderId, "self-hosted-video");
      const res = await r.generate({ prompt: "hi", imageBase64: Buffer.alloc(64).toString("base64").padEnd(600, "A") });
      strictEqual(res.providerId, "self-hosted-video");
    } finally { Object.assign(process.env, backup); }
  });

  it("throws when none configured", () => {
    try { clear(); try { videoAdapterFromEnv(); ok(false); } catch (e) { ok(isProviderError(e)); } } finally { Object.assign(process.env, backup); }
  });
});

// -- Publishing registry -----------------------------------------------------

describe("PublishingProviderRegistry", () => {
  it("routes to youtube", async () => {
    const r = new PublishingProviderRegistry();
    r.register(fakePublish("youtube"));
    strictEqual((await r.publish({ assetId: "https://cdn.example/v.mp4", title: "t" })).providerId, "youtube");
  });
  it("rejects unknown", () => {
    const r = new PublishingProviderRegistry();
    r.register(fakePublish("youtube"));
    try { r.setActive("vimeo"); ok(false); } catch (e) { ok(isProviderError(e)); }
  });
});

describe("publishingAdapterFromEnv", () => {
  const backup = { ...process.env };
  function withEnv(c: Record<string, string | undefined>) { for (const [k,v] of Object.entries(c)) { if (v===undefined) delete process.env[k]; else process.env[k]=v; } }
  function clear() { withEnv({ PUBLISH_PROVIDER: undefined, YOUTUBE_ACCESS_TOKEN: undefined, GOOGLE_API_BASE_URL: undefined }); }

  it("routes through a real adapter (mocked YouTube flow)", async (t) => {
    const media = await createMediaMock();
    const yt = await createYouTubePublishMock();
    t.after(() => media.close()); t.after(() => yt.close());
    try {
      clear();
      withEnv({ YOUTUBE_ACCESS_TOKEN: "tok", GOOGLE_API_BASE_URL: yt.url });
      const r = publishingAdapterFromEnv({});
      strictEqual(r.activeProviderId, "youtube");
      const res = await r.publish({ assetId: `${media.url}/asset.mp4`, title: "t" });
      strictEqual(res.providerId, "youtube");
      strictEqual(res.status, "completed");
    } finally { Object.assign(process.env, backup); }
  });

  it("throws when none configured", () => {
    try { clear(); try { publishingAdapterFromEnv({}); ok(false); } catch (e) { ok(isProviderError(e)); } } finally { Object.assign(process.env, backup); }
  });
});

// -- Analytics registry ------------------------------------------------------

describe("AnalyticsProviderRegistry", () => {
  it("routes to youtube-analytics", async () => {
    const r = new AnalyticsProviderRegistry();
    r.register(fakeAnalytics("youtube-analytics"));
    strictEqual((await r.fetch({ publicationId: "pub", platform: "youtube" })).providerId, "youtube-analytics");
  });
});

describe("analyticsAdapterFromEnv", () => {
  const backup = { ...process.env };
  function withEnv(c: Record<string, string | undefined>) { for (const [k,v] of Object.entries(c)) { if (v===undefined) delete process.env[k]; else process.env[k]=v; } }
  function clear() { withEnv({ ANALYTICS_PROVIDER: undefined, YOUTUBE_ACCESS_TOKEN: undefined, YOUTUBE_ANALYTICS_BASE_URL: undefined }); }

  it("routes through a real adapter (mocked analytics)", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    try {
      clear();
      withEnv({ YOUTUBE_ACCESS_TOKEN: "tok", YOUTUBE_ANALYTICS_BASE_URL: mock.url });
      const r = analyticsAdapterFromEnv({});
      strictEqual(r.activeProviderId, "youtube-analytics");
      const res = await r.fetch({ publicationId: "vid-1", platform: "youtube" });
      strictEqual(res.providerId, "youtube-analytics");
    } finally { Object.assign(process.env, backup); }
  });

  it("accepts youtube alias", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    try {
      clear();
      withEnv({ ANALYTICS_PROVIDER: "youtube", YOUTUBE_ACCESS_TOKEN: "tok", YOUTUBE_ANALYTICS_BASE_URL: mock.url });
      const r = analyticsAdapterFromEnv({});
      strictEqual(r.activeProviderId, "youtube-analytics");
    } finally { Object.assign(process.env, backup); }
  });

  it("throws when none configured", () => {
    try { clear(); try { analyticsAdapterFromEnv({}); ok(false); } catch (e) { ok(isProviderError(e)); } } finally { Object.assign(process.env, backup); }
  });
});
