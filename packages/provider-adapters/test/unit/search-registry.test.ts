/** Unit tests: search provider registry / router selection + delegation. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  SearchProviderRegistry,
  searchAdapterFromEnv,
  ProviderConfigurationError,
  isProviderError,
} from "@ai-media-factory/provider-adapters";
import type { SearchProviderImplementation } from "@ai-media-factory/provider-adapters";
import { createExaMock, createSerperMock, createTavilyMock } from "../helpers/mock-servers.ts";

function fakeProvider(id: string): SearchProviderImplementation {
  return {
    providerId: id,
    search: async () => ({ providerId: id, results: [{ title: id, url: `https://${id}.example/a`, snippet: "", source: `${id}.example`, rank: 1 }] }),
  };
}

describe("SearchProviderRegistry", () => {
  it("routes to the first registered provider by default", async () => {
    const registry = new SearchProviderRegistry();
    registry.register(fakeProvider("tavily-search")).register(fakeProvider("serper"));
    strictEqual(registry.activeProviderId, "tavily-search");
    const response = await registry.search({ query: "q" });
    strictEqual(response.providerId, "tavily-search");
  });

  it("routes to the explicitly selected provider regardless of registration order", async () => {
    const registry = new SearchProviderRegistry();
    registry.register(fakeProvider("tavily-search")).register(fakeProvider("serper")).register(fakeProvider("exa"));
    registry.setActive("exa");
    strictEqual(registry.activeProviderId, "exa");
    const response = await registry.search({ query: "q" });
    strictEqual(response.providerId, "exa");
    strictEqual(response.results[0].title, "exa");
  });

  it("reports every configured provider while exposing a single router to the caller", async () => {
    const registry = new SearchProviderRegistry();
    registry.register(fakeProvider("brave-search"));
    registry.register(fakeProvider("tavily-search"));
    strictEqual(registry.configuredProviderIds.join(","), "brave-search,tavily-search");
    strictEqual(registry.activeProviderId, "brave-search");
  });

  it("rejects selecting a provider that was never registered", () => {
    const registry = new SearchProviderRegistry();
    registry.register(fakeProvider("serper"));
    try {
      registry.setActive("exa");
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as ProviderConfigurationError).category, "CONFIGURATION");
    }
  });

  it("throws a classified CONFIGURATION error when no provider is active", async () => {
    const registry = new SearchProviderRegistry();
    try {
      await registry.search({ query: "q" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as ProviderConfigurationError).category, "CONFIGURATION");
    }
  });
});

describe("searchAdapterFromEnv", () => {
  const backup = { ...process.env };

  function withEnv(changes: Record<string, string | undefined>) {
    for (const [key, value] of Object.entries(changes)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  function clearSearchEnv() {
    withEnv({
      SEARCH_PROVIDER: undefined,
      SEARCH_API: undefined,
      SEARCH_API_TAVILY: undefined,
      SEARCH_API_SERPER: undefined,
      SEARCH_API_EXA: undefined,
      SEARCH_API_BRAVE: undefined,
      TAVILY_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      EXA_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      BRAVE_API_KEY: undefined,
      TAVILY_BASE_URL: undefined,
      SERPER_BASE_URL: undefined,
      EXA_BASE_URL: undefined,
      BRAVE_BASE_URL: undefined,
    });
  }

  it("routes the only configured provider through a real adapter call", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    try {
      clearSearchEnv();
      withEnv({ SEARCH_API: "k", TAVILY_BASE_URL: `${mock.url}/search` });
      const registry = searchAdapterFromEnv();
      strictEqual(registry.activeProviderId, "tavily-search");
      const response = await registry.search({ query: "q" });
      strictEqual(response.providerId, "tavily-search");
      strictEqual(response.results.length, 2, "real adapter normalized the provider payload");
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("routes to the SEARCH_PROVIDER requested even when others are configured", async (t) => {
    const tavily = await createTavilyMock();
    const serper = await createSerperMock();
    t.after(() => tavily.close());
    t.after(() => serper.close());
    try {
      clearSearchEnv();
      withEnv({
        SEARCH_PROVIDER: "serper",
        SEARCH_API: "k",
        TAVILY_BASE_URL: `${tavily.url}/search`,
        SERPER_API_KEY: "s",
        SERPER_BASE_URL: `${serper.url}/search`,
      });
      const registry = searchAdapterFromEnv();
      strictEqual(registry.activeProviderId, "serper");
      strictEqual(registry.configuredProviderIds.includes("tavily-search"), true, "tavily stays registered");
      const response = await registry.search({ query: "q" });
      strictEqual(response.providerId, "serper");
      ok(serper.state.requests >= 1, "serper mock must have been hit");
      strictEqual(tavily.state.requests, 0, "tavily mock must not have been hit");
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("switching credentials alone switches the provider (agent-facing call unchanged)", async (t) => {
    const tavily = await createTavilyMock();
    const exa = await createExaMock();
    t.after(() => tavily.close());
    t.after(() => exa.close());
    try {
      clearSearchEnv();
      withEnv({ SEARCH_API: "k", TAVILY_BASE_URL: `${tavily.url}/search` });
      const registry = searchAdapterFromEnv();
      strictEqual(registry.activeProviderId, "tavily-search");
      strictEqual((await registry.search({ query: "q" })).providerId, "tavily-search");

      withEnv({ SEARCH_API: undefined, SERPER_API_KEY: undefined, EXA_API_KEY: "e", EXA_BASE_URL: `${exa.url}/search` });
      const switched = searchAdapterFromEnv();
      strictEqual(switched.activeProviderId, "exa");
      strictEqual((await switched.search({ query: "q" })).providerId, "exa");
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("accepts the short SEARCH_PROVIDER alias (tavily -> tavily-search)", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    try {
      clearSearchEnv();
      withEnv({ SEARCH_PROVIDER: "tavily", SEARCH_API: "k", TAVILY_BASE_URL: `${mock.url}/search` });
      const registry = searchAdapterFromEnv();
      strictEqual(registry.activeProviderId, "tavily-search");
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("accepts the SHORT alias AND the friendly SEARCH_API_<PROVIDER> credential together", async (t) => {
    const serper = await createSerperMock();
    t.after(() => serper.close());
    try {
      clearSearchEnv();
      withEnv({ SEARCH_PROVIDER: "serper", SEARCH_API_SERPER: "s", SERPER_BASE_URL: `${serper.url}/search` });
      const registry = searchAdapterFromEnv();
      strictEqual(registry.activeProviderId, "serper");
      strictEqual((await registry.search({ query: "q" })).providerId, "serper");
      ok(serper.state.requests >= 1);
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("recognizes the SEARCH_API_TAVILY friendly alias as the tavily credential", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    try {
      clearSearchEnv();
      withEnv({ SEARCH_API_TAVILY: "k", TAVILY_BASE_URL: `${mock.url}/search` });
      const registry = searchAdapterFromEnv();
      strictEqual(registry.activeProviderId, "tavily-search");
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("throws a hard configuration error when SEARCH_PROVIDER is not configured", () => {
    try {
      clearSearchEnv();
      withEnv({ SEARCH_PROVIDER: "serper", SEARCH_API: "k" });
      try {
        searchAdapterFromEnv();
        ok(false, "expected throw");
      } catch (error) {
        ok(isProviderError(error));
        strictEqual((error as ProviderConfigurationError).category, "CONFIGURATION");
        ok(String((error as Error).message).includes("SEARCH_PROVIDER"));
      }
    } finally {
      Object.assign(process.env, backup);
    }
  });

  it("throws a classified CONFIGURATION error when no provider is configured", () => {
    try {
      clearSearchEnv();
      try {
        searchAdapterFromEnv();
        ok(false, "expected throw");
      } catch (error) {
        ok(isProviderError(error));
        strictEqual((error as ProviderConfigurationError).category, "CONFIGURATION");
      }
    } finally {
      Object.assign(process.env, backup);
    }
  });
});