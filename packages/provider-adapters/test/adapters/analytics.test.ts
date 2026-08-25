/** Analytics adapter tests against the YouTube Analytics mock. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { YouTubeAnalyticsAdapter } from "@ai-media-factory/provider-adapters";
import { createAnalyticsMock } from "../helpers/mock-servers.ts";
import { isProviderError } from "@ai-media-factory/provider-adapters";

describe("YouTubeAnalyticsAdapter", () => {
  it("maps provider metrics into the typed PerformanceMetrics contract", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: mock.url, windowDays: 30 });
    const response = await adapter.fetch({ publicationId: "vid-1", platform: "youtube" });
    strictEqual(response.providerId, "youtube-analytics");
    strictEqual(response.status, "completed");
    strictEqual(response.publicationId, "vid-1");
    strictEqual(response.metrics.views, 1234);
    strictEqual(response.metrics.likes, 42);
    strictEqual(response.metrics.comments, 7);
    strictEqual(response.metrics.shares, 3);
    strictEqual(response.metrics.revenue, 12.34);
    strictEqual(response.metrics.watchTimeSeconds, 56.5 * 60, "minutes are converted to seconds");
  });

  it("normalizes a provider-confirmed empty report to empty metrics", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    mock.state.mode = "empty";
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: mock.url });
    const response = await adapter.fetch({ publicationId: "vid-empty", platform: "youtube" });
    strictEqual(response.status, "completed");
    strictEqual(Object.keys(response.metrics).length, 0);
  });

  it("classifies an unauthorized provider response", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    mock.state.mode = "unauthorized";
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "bad", baseUrl: mock.url });
    try {
      await adapter.fetch({ publicationId: "vid-1", platform: "youtube" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "AUTHORIZATION");
    }
  });

  it("fails on a provider error body even with a 200 status", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    mock.state.mode = "provider-error";
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: mock.url });
    try {
      await adapter.fetch({ publicationId: "vid-1", platform: "youtube" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("rejects malformed analytics rows", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    mock.state.mode = "malformed-rows";
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: mock.url });
    try {
      await adapter.fetch({ publicationId: "vid-1", platform: "youtube" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("rejects an unsupported platform", async (t) => {
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t" });
    try {
      await adapter.fetch({ publicationId: "vid-1", platform: "tiktok" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("queries the provider with the configured analytics window", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: mock.url, windowDays: 7 });
    await adapter.fetch({ publicationId: "vid-1", platform: "youtube" });
    const url = new URL(mock.state.lastUrl, "http://x");
    const start = new Date(`${url.searchParams.get("startDate")}T00:00:00.000Z`);
    const end = new Date(`${url.searchParams.get("endDate")}T00:00:00.000Z`);
    strictEqual(end.getTime() - start.getTime(), 6 * 86_400_000);
    strictEqual(url.searchParams.get("filters"), "video==vid-1");
  });
});