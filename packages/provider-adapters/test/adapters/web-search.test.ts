/** Web search adapter tests against the Brave and Tavily mocks. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  BraveSearchAdapter,
  ExaSearchAdapter,
  SerperSearchAdapter,
  TavilySearchAdapter,
} from "@ai-media-factory/provider-adapters";
import { createBraveMock, createExaMock, createSerperMock, createTavilyMock } from "../helpers/mock-servers.ts";
import { isProviderError } from "@ai-media-factory/provider-adapters";

describe("BraveSearchAdapter", () => {
  it("maps provider results into capability results with ranks and sources", async (t) => {
    const mock = await createBraveMock();
    t.after(() => mock.close());
    const adapter = new BraveSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/web/search` });
    const response = await adapter.search({ query: "ai media factory", maxResults: 10 });
    strictEqual(response.providerId, "brave-search");
    strictEqual(response.results.length, 2, "malformed entry is dropped");
    strictEqual(response.results[0].title, "First result");
    strictEqual(response.results[0].rank, 1);
    strictEqual(response.results[0].source, "example.com");
    strictEqual(response.results[1].rank, 2);
    strictEqual(response.results[1].url, "https://example.org/2");
  });

  it("normalizes an authenticated empty result set to empty results", async (t) => {
    const mock = await createBraveMock();
    t.after(() => mock.close());
    mock.state.mode = "empty";
    const adapter = new BraveSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/web/search` });
    const response = await adapter.search({ query: "nothing here" });
    strictEqual(response.providerId, "brave-search");
    strictEqual(response.results.length, 0);
  });

  it("throws a classified authorization error on 401", async (t) => {
    const mock = await createBraveMock();
    t.after(() => mock.close());
    mock.state.authFailure = true;
    const adapter = new BraveSearchAdapter({ apiKey: "bad", baseUrl: `${mock.url}/web/search` });
    try {
      await adapter.search({ query: "secret" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "AUTHORIZATION");
    }
  });

  it("retries a transient 500 and succeeds on the next attempt", async (t) => {
    const mock = await createBraveMock();
    t.after(() => mock.close());
    mock.state.failuresLeft = 1;
    const adapter = new BraveSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/web/search`, maxRetries: 2, timeoutMs: 2000 });
    const response = await adapter.search({ query: "retry me" });
    strictEqual(response.results.length, 2);
    ok(mock.state.requests >= 2, "expected a retry after the 500");
  });

  it("throws a validation error on malformed provider data", async (t) => {
    const mock = await createBraveMock();
    t.after(() => mock.close());
    mock.state.mode = "malformed-web";
    const adapter = new BraveSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/web/search` });
    try {
      await adapter.search({ query: "bad" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });
});

describe("TavilySearchAdapter", () => {
  it("maps provider results into capability results with ranks and sources", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    const adapter = new TavilySearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    const response = await adapter.search({ query: "ai media factory", maxResults: 10 });
    strictEqual(response.providerId, "tavily-search");
    strictEqual(response.results.length, 2, "malformed entry is dropped");
    strictEqual(response.results[0].title, "First result");
    strictEqual(response.results[0].rank, 1);
    strictEqual(response.results[0].source, "example.com");
    strictEqual(response.results[1].rank, 2);
    strictEqual(response.results[1].url, "https://example.org/2");
  });

  it("normalizes an authenticated empty result set to empty results", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    mock.state.mode = "empty";
    const adapter = new TavilySearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    const response = await adapter.search({ query: "nothing here" });
    strictEqual(response.providerId, "tavily-search");
    strictEqual(response.results.length, 0);
  });

  it("throws a classified authorization error on 401", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    mock.state.authFailure = true;
    const adapter = new TavilySearchAdapter({ apiKey: "bad", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "secret" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "AUTHORIZATION");
    }
  });

  it("retries a transient 500 and succeeds on the next attempt", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    mock.state.failuresLeft = 1;
    const adapter = new TavilySearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search`, maxRetries: 2, timeoutMs: 2000 });
    const response = await adapter.search({ query: "retry me" });
    strictEqual(response.results.length, 2);
    ok(mock.state.requests >= 2, "expected a retry after the 500");
  });

  it("throws a validation error on malformed provider data", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    mock.state.mode = "malformed-results";
    const adapter = new TavilySearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "bad" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("throws a validation error on a non-JSON response", async (t) => {
    const mock = await createTavilyMock();
    t.after(() => mock.close());
    mock.state.mode = "non-json";
    const adapter = new TavilySearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "bad" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });
});

describe("SerperSearchAdapter", () => {
  it("maps provider results into capability results with ranks and sources", async (t) => {
    const mock = await createSerperMock();
    t.after(() => mock.close());
    const adapter = new SerperSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    const response = await adapter.search({ query: "ai media factory", maxResults: 10 });
    strictEqual(response.providerId, "serper");
    strictEqual(response.results.length, 2, "malformed entry is dropped");
    strictEqual(response.results[0].title, "First result");
    strictEqual(response.results[0].rank, 1);
    strictEqual(response.results[0].source, "example.com");
    strictEqual(response.results[1].rank, 2);
    strictEqual(response.results[1].url, "https://example.org/2");
  });

  it("normalizes an authenticated empty result set to empty results", async (t) => {
    const mock = await createSerperMock();
    t.after(() => mock.close());
    mock.state.mode = "empty";
    const adapter = new SerperSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    const response = await adapter.search({ query: "nothing here" });
    strictEqual(response.providerId, "serper");
    strictEqual(response.results.length, 0);
  });

  it("throws a classified authorization error on 401", async (t) => {
    const mock = await createSerperMock();
    t.after(() => mock.close());
    mock.state.authFailure = true;
    const adapter = new SerperSearchAdapter({ apiKey: "bad", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "secret" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "AUTHORIZATION");
    }
  });

  it("retries a transient 500 and succeeds on the next attempt", async (t) => {
    const mock = await createSerperMock();
    t.after(() => mock.close());
    mock.state.failuresLeft = 1;
    const adapter = new SerperSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search`, maxRetries: 2, timeoutMs: 2000 });
    const response = await adapter.search({ query: "retry me" });
    strictEqual(response.results.length, 2);
    ok(mock.state.requests >= 2, "expected a retry after the 500");
  });

  it("throws a validation error on malformed provider data", async (t) => {
    const mock = await createSerperMock();
    t.after(() => mock.close());
    mock.state.mode = "malformed-organic";
    const adapter = new SerperSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "bad" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });
});

describe("ExaSearchAdapter", () => {
  it("maps provider results into capability results with ranks and sources", async (t) => {
    const mock = await createExaMock();
    t.after(() => mock.close());
    const adapter = new ExaSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    const response = await adapter.search({ query: "ai media factory", maxResults: 10 });
    strictEqual(response.providerId, "exa");
    strictEqual(response.results.length, 2, "malformed entry is dropped");
    strictEqual(response.results[0].title, "First result");
    strictEqual(response.results[0].rank, 1);
    strictEqual(response.results[0].source, "example.com");
    strictEqual(response.results[1].rank, 2);
    strictEqual(response.results[1].url, "https://example.org/2");
  });

  it("normalizes an authenticated empty result set to empty results", async (t) => {
    const mock = await createExaMock();
    t.after(() => mock.close());
    mock.state.mode = "empty";
    const adapter = new ExaSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    const response = await adapter.search({ query: "nothing here" });
    strictEqual(response.providerId, "exa");
    strictEqual(response.results.length, 0);
  });

  it("throws a classified authorization error on 401", async (t) => {
    const mock = await createExaMock();
    t.after(() => mock.close());
    mock.state.authFailure = true;
    const adapter = new ExaSearchAdapter({ apiKey: "bad", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "secret" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "AUTHORIZATION");
    }
  });

  it("retries a transient 500 and succeeds on the next attempt", async (t) => {
    const mock = await createExaMock();
    t.after(() => mock.close());
    mock.state.failuresLeft = 1;
    const adapter = new ExaSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search`, maxRetries: 2, timeoutMs: 2000 });
    const response = await adapter.search({ query: "retry me" });
    strictEqual(response.results.length, 2);
    ok(mock.state.requests >= 2, "expected a retry after the 500");
  });

  it("throws a validation error on malformed provider data", async (t) => {
    const mock = await createExaMock();
    t.after(() => mock.close());
    mock.state.mode = "malformed-results";
    const adapter = new ExaSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "bad" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("throws a validation error on a non-JSON response", async (t) => {
    const mock = await createExaMock();
    t.after(() => mock.close());
    mock.state.mode = "non-json";
    const adapter = new ExaSearchAdapter({ apiKey: "k", baseUrl: `${mock.url}/search` });
    try {
      await adapter.search({ query: "bad" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });
});