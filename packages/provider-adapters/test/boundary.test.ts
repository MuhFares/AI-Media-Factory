/**
 * Full boundary integration test: real adapters + mock providers + capability
 * registry + RoutingCapabilityExecutor + RuntimeCapabilityExecutor.
 */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/tool-framework";
import { createProviderCapabilityBoundary } from "@ai-media-factory/provider-adapters";
import { BraveSearchAdapter } from "@ai-media-factory/provider-adapters";
import { OpenAIImagesAdapter } from "@ai-media-factory/provider-adapters";
import { ReplicateVideoAdapter } from "@ai-media-factory/provider-adapters";
import { YouTubePublishAdapter } from "@ai-media-factory/provider-adapters";
import { YouTubeAnalyticsAdapter } from "@ai-media-factory/provider-adapters";
import { InMemoryPublishStore, InMemoryPublishSessionStore } from "./helpers/in-memory-stores.ts";
import {
  createAnalyticsMock,
  createBraveMock,
  createImageMock,
  createMediaMock,
  createReplicateMock,
  createYouTubePublishMock,
} from "./helpers/mock-servers.ts";

function makeRequest(capabilityId: string, agentId: string, input: unknown): CapabilityRequest {
  return {
    requestId: `req-${capabilityId}-${agentId}`,
    capabilityId,
    agentId,
    workflowId: "wf-1",
    correlationId: "corr-1",
    input: input as any,
    requestedAt: new Date().toISOString(),
  };
}

async function assertSuccess<T = { [key: string]: unknown }>(
  result: CapabilityResult,
  capabilityId: string,
  agentId: string,
): Promise<{ output: T; evidence: { [key: string]: unknown } }> {
  strictEqual(result.status, "success", `expected success, got ${JSON.stringify(result)}`);
  const success = result as { status: "success"; output: unknown; evidence?: unknown };
  ok(success.evidence !== undefined, "execution evidence must be present");
  const evidence = success.evidence as { [key: string]: unknown };
  strictEqual(evidence.capabilityId, capabilityId);
  strictEqual(evidence.agentId, agentId);
  return { output: success.output as T, evidence };
}

describe("provider capability boundary", () => {
  it("authorizes and executes a web search for the research agent", async (t) => {
    const searchMock = await createBraveMock();
    t.after(() => searchMock.close());
    const { boundary } = createProviderCapabilityBoundary({
      adapters: {
        webSearch: new BraveSearchAdapter({ apiKey: "k", baseUrl: `${searchMock.url}/web/search` }),
        imageGeneration: new OpenAIImagesAdapter({ apiKey: "k" }),
        videoGeneration: new ReplicateVideoAdapter({ apiToken: "t" }),
        publishing: new YouTubePublishAdapter({ accessToken: "t" }),
        analytics: new YouTubeAnalyticsAdapter({ accessToken: "t" }),
      },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability(
      makeRequest("web.search", "research", { query: "hello world", maxResults: 5 }),
    );
    const { output, evidence } = await assertSuccess(result, "web.search", "research");
    strictEqual((output as { providerId: string }).providerId, "brave-search");
    strictEqual((output as { results: unknown[] }).results.length, 2);
    strictEqual(evidence.providerInvoked, true);
    strictEqual(evidence.resultCount, 2);
  });

  it("blocks a capability the agent was not granted", async (t) => {
    const { boundary } = createProviderCapabilityBoundary({
      adapters: {
        webSearch: new BraveSearchAdapter({ apiKey: "k" }),
        imageGeneration: new OpenAIImagesAdapter({ apiKey: "k" }),
        videoGeneration: new ReplicateVideoAdapter({ apiToken: "t" }),
        publishing: new YouTubePublishAdapter({ accessToken: "t" }),
        analytics: new YouTubeAnalyticsAdapter({ accessToken: "t" }),
      },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability(
      makeRequest("web.search", "thumbnail", { query: "x" }),
    );
    strictEqual(result.status, "blocked");
  });

  it("blocks unknown capabilities without executing", async (t) => {
    const { boundary } = createProviderCapabilityBoundary({
      adapters: {
        webSearch: new BraveSearchAdapter({ apiKey: "k" }),
        imageGeneration: new OpenAIImagesAdapter({ apiKey: "k" }),
        videoGeneration: new ReplicateVideoAdapter({ apiToken: "t" }),
        publishing: new YouTubePublishAdapter({ accessToken: "t" }),
        analytics: new YouTubeAnalyticsAdapter({ accessToken: "t" }),
      },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability(
      makeRequest("filesystem.read", "research", {}),
    );
    strictEqual(result.status, "blocked");
  });

  it("executes image generation for the thumbnail agent", async (t) => {
    const imageMock = await createImageMock();
    t.after(() => imageMock.close());
    const { boundary } = createProviderCapabilityBoundary({
      adapters: {
        webSearch: new BraveSearchAdapter({ apiKey: "k" }),
        imageGeneration: new OpenAIImagesAdapter({ apiKey: "k", baseUrl: `${imageMock.url}/v1` }),
        videoGeneration: new ReplicateVideoAdapter({ apiToken: "t" }),
        publishing: new YouTubePublishAdapter({ accessToken: "t" }),
        analytics: new YouTubeAnalyticsAdapter({ accessToken: "t" }),
      },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability(
      makeRequest("image.generate", "thumbnail", { prompt: "a golden retriever", aspectRatio: "16:9" }),
    );
    const { output, evidence } = await assertSuccess(result, "image.generate", "thumbnail");
    strictEqual((output as { providerId: string }).providerId, "openai-image");
    strictEqual(evidence.imageId, "openai-1700000000-0");
  });

  it("executes video generation and reports completion only when confirmed", async (t) => {
    const videoMock = await createReplicateMock();
    t.after(() => videoMock.close());
    const { boundary } = createProviderCapabilityBoundary({
      adapters: {
        webSearch: new BraveSearchAdapter({ apiKey: "k" }),
        imageGeneration: new OpenAIImagesAdapter({ apiKey: "k" }),
        videoGeneration: new ReplicateVideoAdapter({
          apiToken: "t",
          baseUrl: `${videoMock.url}/v1`,
          pollIntervalMs: 5,
          maxWaitMs: 2000,
        }),
        publishing: new YouTubePublishAdapter({ accessToken: "t" }),
        analytics: new YouTubeAnalyticsAdapter({ accessToken: "t" }),
      },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability(
      makeRequest("video.generate", "video", { prompt: "ocean waves" }),
    );
    const { output, evidence } = await assertSuccess(result, "video.generate", "video");
    strictEqual((output as { status: string }).status, "completed");
    strictEqual(evidence.videoStatus, "completed");
    strictEqual(evidence.videoId, (output as { videoId?: string }).videoId);
  });

  it("publishes for the publisher agent and deduplicates the same logical request", async (t) => {
    const publishMock = await createYouTubePublishMock();
    t.after(() => publishMock.close());
    const media = await createMediaMock();
    t.after(() => media.close());
    const publishStore = new InMemoryPublishStore();
    const sessionStore = new InMemoryPublishSessionStore();
    const { boundary } = createProviderCapabilityBoundary({
      adapters: {
        webSearch: new BraveSearchAdapter({ apiKey: "k" }),
        imageGeneration: new OpenAIImagesAdapter({ apiKey: "k" }),
        videoGeneration: new ReplicateVideoAdapter({ apiToken: "t" }),
        publishing: new YouTubePublishAdapter({ accessToken: "t", baseUrl: publishMock.url, publishSessionStore: sessionStore }),
        analytics: new YouTubeAnalyticsAdapter({ accessToken: "t" }),
      },
      publishStore,
    });

    const request = makeRequest("publish.youtube", "publisher", {
      assetId: `${media.url}/video.mp4`,
      title: "Boundary video",
      options: { visibility: "unlisted" },
    });
    const first = await boundary.executeCapability(request);
    const firstResult = await assertSuccess<{ [key: string]: unknown }>(first, "publish.youtube", "publisher");
    strictEqual((firstResult.output as { status: string }).status, "completed");
    strictEqual((firstResult.output as { deduplicated: boolean }).deduplicated, false);

    const second = await boundary.executeCapability(request);
    const secondResult = await assertSuccess<{ [key: string]: unknown }>(second, "publish.youtube", "publisher");
    strictEqual((secondResult.output as { status: string }).status, "completed");
    strictEqual((secondResult.output as { deduplicated: boolean }).deduplicated, true);
    strictEqual(
      (secondResult.output as { publicationId?: string }).publicationId,
      (firstResult.output as { publicationId?: string }).publicationId,
    );
    strictEqual(publishMock.state.uploads, 1, "the second call never reached the provider");
    strictEqual(publishStore.count(), 1, "one persisted outcome per logical request");
  });

  it("fetches analytics for the analytics agent with provider-backed metrics", async (t) => {
    const analyticsMock = await createAnalyticsMock();
    t.after(() => analyticsMock.close());
    const { boundary } = createProviderCapabilityBoundary({
      adapters: {
        webSearch: new BraveSearchAdapter({ apiKey: "k" }),
        imageGeneration: new OpenAIImagesAdapter({ apiKey: "k" }),
        videoGeneration: new ReplicateVideoAdapter({ apiToken: "t" }),
        publishing: new YouTubePublishAdapter({ accessToken: "t" }),
        analytics: new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: analyticsMock.url }),
      },
      publishStore: new InMemoryPublishStore(),
    });
    const result = await boundary.executeCapability(
      makeRequest("analytics.fetch", "analytics", { publicationId: "vid-1", platform: "youtube" }),
    );
    const { output, evidence } = await assertSuccess(result, "analytics.fetch", "analytics");
    strictEqual((output as { providerId: string }).providerId, "youtube-analytics");
    strictEqual((output as { metrics: { views?: number } }).metrics.views, 1234);
    strictEqual(evidence.providerInvoked, true);
  });
});