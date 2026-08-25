/** Unit tests: adapter construction and env-driven config validation. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { BraveSearchAdapter } from "@ai-media-factory/provider-adapters";
import { braveSearchAdapterFromEnv } from "@ai-media-factory/provider-adapters";
import { TavilySearchAdapter } from "@ai-media-factory/provider-adapters";
import { tavilySearchAdapterFromEnv } from "@ai-media-factory/provider-adapters";
import { OpenAIImagesAdapter } from "@ai-media-factory/provider-adapters";
import { ReplicateVideoAdapter } from "@ai-media-factory/provider-adapters";
import { YouTubePublishAdapter } from "@ai-media-factory/provider-adapters";
import { YouTubeAnalyticsAdapter } from "@ai-media-factory/provider-adapters";
import { ProviderConfigurationError, isProviderError } from "@ai-media-factory/provider-adapters";

const MOCK = "https://127.0.0.1/mock";

describe("provider adapter configuration validation", () => {
  it("throws a classified CONFIGURATION error when a credential is missing", () => {
    const cases: Array<[string, () => unknown]> = [
      ["brave-search", () => new BraveSearchAdapter({ apiKey: "" })],
      ["tavily-search", () => new TavilySearchAdapter({ apiKey: "  " })],
      ["openai-image", () => new OpenAIImagesAdapter({ apiKey: "  " })],
      ["replicate", () => new ReplicateVideoAdapter({ apiToken: "" })],
      ["youtube", () => new YouTubePublishAdapter({ accessToken: "" })],
      ["youtube-analytics", () => new YouTubeAnalyticsAdapter({ accessToken: "" })],
    ];
    for (const [providerId, build] of cases) {
      try {
        build();
        ok(false, `expected ${providerId} construction to throw`);
      } catch (error) {
        ok(isProviderError(error), `${providerId}: expected ProviderError`);
        strictEqual((error as ProviderConfigurationError).category, "CONFIGURATION");
        strictEqual((error as ProviderConfigurationError).providerId, providerId);
      }
    }
  });

  it("accepts valid config with defaults", () => {
    const search = new BraveSearchAdapter({ apiKey: "k", baseUrl: MOCK });
    strictEqual(search.providerId, "brave-search");
    const tavily = new TavilySearchAdapter({ apiKey: "k", baseUrl: MOCK });
    strictEqual(tavily.providerId, "tavily-search");
    const image = new OpenAIImagesAdapter({ apiKey: "k", baseUrl: MOCK });
    strictEqual(image.providerId, "openai-image");
    const video = new ReplicateVideoAdapter({ apiToken: "t", baseUrl: MOCK });
    strictEqual(video.providerId, "replicate");
    const publish = new YouTubePublishAdapter({ accessToken: "t", baseUrl: MOCK });
    strictEqual(publish.providerId, "youtube");
    const analytics = new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: MOCK });
    strictEqual(analytics.providerId, "youtube-analytics");
  });

  it("fromEnv factories name exactly which variable is missing", () => {
    const backup = { ...process.env };
    try {
      delete process.env.BRAVE_SEARCH_API_KEY;
      delete process.env.BRAVE_API_KEY;
      delete process.env.SEARCH_API;
      delete process.env.TAVILY_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.REPLICATE_API_TOKEN;
      delete process.env.YOUTUBE_ACCESS_TOKEN;
      try {
        braveSearchAdapterFromEnv();
        ok(false, "expected throw");
      } catch (error) {
        ok(error instanceof ProviderConfigurationError);
        ok(
          String((error as Error).message).includes("BRAVE_SEARCH_API_KEY") ||
            String((error as Error).message).includes("BRAVE_API_KEY"),
        );
      }
      try {
        tavilySearchAdapterFromEnv();
        ok(false, "expected throw");
      } catch (error) {
        ok(error instanceof ProviderConfigurationError);
        ok(
          String((error as Error).message).includes("SEARCH_API") ||
            String((error as Error).message).includes("TAVILY_API_KEY"),
        );
      }
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("rejects non-numeric env numbers deterministically", () => {
    const backup = { ...process.env };
    try {
      process.env.BRAVE_API_KEY = "k";
      process.env.WEB_SEARCH_TIMEOUT_MS = "nope";
      try {
        braveSearchAdapterFromEnv();
        ok(false, "expected throw");
      } catch (error) {
        ok(error instanceof ProviderConfigurationError);
        ok(String((error as Error).message).includes("WEB_SEARCH_TIMEOUT_MS"));
      }
    } finally {
      Object.assign(process.env, backup);
    }
  });
});