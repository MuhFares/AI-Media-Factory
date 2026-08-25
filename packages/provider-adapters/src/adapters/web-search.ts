/**
 * Web search adapter — Brave Search API (v1 web search).
 *
 * Mapping:
 *  GET {baseUrl}/res/v1/web/search?q=..&count=..
 *  -> { providerId, results: [{ title, url, snippet, source, rank }] }
 *
 * The provider returns fewer results than requested (malformed/duplicate
 * entries are dropped and ranks are renumbered). An authenticated 200 with zero
 * results is normalized to an empty result set — never fabricated.
 */

import type {
  WebSearchProvider,
  WebSearchProviderResponse,
  WebSearchRequest,
  WebSearchResult,
} from "@ai-media-factory/tool-framework";
import { sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv } from "../core/config.js";
import { asString, clamp, hostnameOf, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface BraveSearchConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://api.search.brave.com/res/v1/web/search";

export class BraveSearchAdapter implements WebSearchProvider {
  readonly providerId = "brave-search";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: BraveSearchConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError(
        "brave-search",
        "config.apiKey is required. Provide a Brave Search API key (BRAVE_API_KEY).",
      );
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 2;
    assertPositive("brave-search", this.timeoutMs, "timeoutMs");
    assertPositive("brave-search", this.maxRetries + 1, "maxRetries + 1");
    this.onOperation = sinkOf(config.onOperation);
  }

  async search(request: WebSearchRequest): Promise<WebSearchProviderResponse> {
    const maxResults = clamp(request.maxResults ?? 10, 1, 20);
    const url = new URL(this.baseUrl);
    url.searchParams.set("q", request.query);
    url.searchParams.set("count", String(maxResults));
    url.searchParams.set("safesearch", "moderate");

    const res = await sendHttpWithRetry(
      {
        method: "GET",
        url: url.toString(),
        headers: {
          "X-Subscription-Token": this.apiKey,
          Accept: "application/json",
        },
      },
      {
        providerId: this.providerId,
        operation: "search",
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        onOperation: this.onOperation,
      },
    );

    const json = await this.readJson(res);
    if (!isRecord(json)) {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-object response");
    }
    if (isRecord(json.error)) {
      throw providerValidationError(this.providerId, "search", "Provider returned an error result");
    }
    if (json.web !== undefined && !isRecord(json.web)) {
      throw providerValidationError(this.providerId, "search", "Provider response has a malformed web section");
    }
    const web = isRecord(json.web) ? json.web : {};
    if (web.results !== undefined && !Array.isArray(web.results)) {
      throw providerValidationError(this.providerId, "search", "Provider response has malformed web results");
    }
    const rows = Array.isArray(web.results) ? web.results : [];
    const cleaned: Array<WebSearchResult | null> = rows
      .slice(0, maxResults)
      .map((item) => {
        if (!isRecord(item)) return null;
        const url = asString(item.url);
        const source = url === undefined ? "" : hostnameOf(url);
        if (url === undefined || url.trim().length === 0 || source.length === 0) return null;
        return {
          title: asString(item.title) ?? "",
          url,
          snippet: asString(item.description) ?? "",
          source,
          rank: 0,
        };
      });
    const results: WebSearchResult[] = cleaned
      .filter((result): result is WebSearchResult => result !== null)
      .map((result, index) => ({ ...result, rank: index + 1 }));
    return { providerId: this.providerId, results };
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-JSON response");
    }
  }
}

/**
 * Construct a Brave search adapter from environment variables.
 *
 * Reads the documented credential name `BRAVE_SEARCH_API_KEY`, falling back to
 * the legacy alias `BRAVE_API_KEY` so existing environments keep working.
 */
export function braveSearchAdapterFromEnv(onOperation?: OperationSink): BraveSearchAdapter {
  const apiKey = process.env.SEARCH_API_BRAVE?.trim() || process.env.BRAVE_SEARCH_API_KEY?.trim() || process.env.BRAVE_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw providerConfigError(
      "brave-search",
      "Missing required environment variable 'BRAVE_SEARCH_API_KEY' (alias: SEARCH_API_BRAVE). Set it before constructing the brave-search adapter.",
    );
  }
  return new BraveSearchAdapter({
    apiKey,
    baseUrl: optionalEnv("BRAVE_BASE_URL", DEFAULT_BASE_URL),
    timeoutMs: envNumber("brave-search", "WEB_SEARCH_TIMEOUT_MS", 10_000),
    maxRetries: envNumber("brave-search", "WEB_SEARCH_MAX_RETRIES", 2),
    onOperation,
  });
}

/**
 * Tavily web search adapter (POST https://api.tavily.com/search).
 *
 * Mapping:
 *  POST {baseUrl} { api_key, query, max_results, search_depth }
 *  -> { providerId, results: [{ title, url, snippet, source, rank }] }
 *
 * The credential is read from `SEARCH_API` (the `.env` name used by this repo),
 * falling back to the conventional `TAVILY_API_KEY`.
 */

export interface TavilySearchConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  onOperation?: OperationSink;
}

const TAVILY_DEFAULT_BASE_URL = "https://api.tavily.com/search";

export class TavilySearchAdapter implements WebSearchProvider {
  readonly providerId = "tavily-search";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: TavilySearchConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError(
        "tavily-search",
        "config.apiKey is required. Provide a Tavily Search API key (SEARCH_API / TAVILY_API_KEY).",
      );
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl ?? TAVILY_DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 2;
    assertPositive("tavily-search", this.timeoutMs, "timeoutMs");
    assertPositive("tavily-search", this.maxRetries + 1, "maxRetries + 1");
    this.onOperation = sinkOf(config.onOperation);
  }

  async search(request: WebSearchRequest): Promise<WebSearchProviderResponse> {
    const maxResults = clamp(request.maxResults ?? 10, 1, 20);
    const res = await sendHttpWithRetry(
      {
        method: "POST",
        url: this.baseUrl,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: request.query,
          max_results: maxResults,
          search_depth: "advanced",
        }),
      },
      {
        providerId: this.providerId,
        operation: "search",
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        onOperation: this.onOperation,
      },
    );

    const json = await this.readJson(res);
    if (!isRecord(json)) {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-object response");
    }
    if (json.results !== undefined && !Array.isArray(json.results)) {
      throw providerValidationError(this.providerId, "search", "Provider response has malformed results");
    }
    const rows = Array.isArray(json.results) ? json.results : [];
    const cleaned: Array<WebSearchResult | null> = rows
      .slice(0, maxResults)
      .map((item) => {
        if (!isRecord(item)) return null;
        const url = asString(item.url);
        const source = url === undefined ? "" : hostnameOf(url);
        if (url === undefined || url.trim().length === 0 || source.length === 0) return null;
        return {
          title: asString(item.title) ?? "",
          url,
          snippet: asString(item.content) ?? "",
          source,
          rank: 0,
        };
      });
    const results: WebSearchResult[] = cleaned
      .filter((result): result is WebSearchResult => result !== null)
      .map((result, index) => ({ ...result, rank: index + 1 }));
    return { providerId: this.providerId, results };
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-JSON response");
    }
  }
}

export function tavilySearchAdapterFromEnv(onOperation?: OperationSink): TavilySearchAdapter {
  const apiKey = process.env.SEARCH_API?.trim() || process.env.SEARCH_API_TAVILY?.trim() || process.env.TAVILY_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw providerConfigError(
      "tavily-search",
      "Missing required environment variable 'SEARCH_API' (or SEARCH_API_TAVILY / TAVILY_API_KEY). Set it before constructing the tavily-search adapter.",
    );
  }
  return new TavilySearchAdapter({
    apiKey,
    baseUrl: optionalEnv("TAVILY_BASE_URL", TAVILY_DEFAULT_BASE_URL),
    timeoutMs: envNumber("tavily-search", "WEB_SEARCH_TIMEOUT_MS", 10_000),
    maxRetries: envNumber("tavily-search", "WEB_SEARCH_MAX_RETRIES", 2),
    onOperation,
  });
}

/**
 * Serper.dev web search adapter (POST https://google.serper.dev/search).
 *
 * Mapping:
 *  POST {baseUrl} { "q": ..., "num": ... }  Bearer <key>
 *  -> { providerId, results: [{ title, url, snippet, source, rank }] }
 *
 * The credential is read from `SERPER_API_KEY`.
 */
export interface SerperSearchConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  onOperation?: OperationSink;
}

const SERPER_DEFAULT_BASE_URL = "https://google.serper.dev/search";

export class SerperSearchAdapter implements WebSearchProvider {
  readonly providerId = "serper";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: SerperSearchConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError(
        "serper",
        "config.apiKey is required. Provide a Serper API key (SERPER_API_KEY).",
      );
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl ?? SERPER_DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 2;
    assertPositive("serper", this.timeoutMs, "timeoutMs");
    assertPositive("serper", this.maxRetries + 1, "maxRetries + 1");
    this.onOperation = sinkOf(config.onOperation);
  }

  async search(request: WebSearchRequest): Promise<WebSearchProviderResponse> {
    const maxResults = clamp(request.maxResults ?? 10, 1, 20);
    const res = await sendHttpWithRetry(
      {
        method: "POST",
        url: this.baseUrl,
        headers: {
          "X-API-KEY": this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ q: request.query, num: maxResults }),
      },
      {
        providerId: this.providerId,
        operation: "search",
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        onOperation: this.onOperation,
      },
    );

    const json = await this.readJson(res);
    if (!isRecord(json)) {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-object response");
    }
    if (json.organic !== undefined && !Array.isArray(json.organic)) {
      throw providerValidationError(this.providerId, "search", "Provider response has malformed organic results");
    }
    const rows = Array.isArray(json.organic) ? json.organic : [];
    const cleaned: Array<WebSearchResult | null> = rows
      .slice(0, maxResults)
      .map((item) => {
        if (!isRecord(item)) return null;
        const url = asString(item.link);
        const source = url === undefined ? "" : hostnameOf(url);
        if (url === undefined || url.trim().length === 0 || source.length === 0) return null;
        return {
          title: asString(item.title) ?? "",
          url,
          snippet: asString(item.snippet) ?? "",
          source,
          rank: 0,
        };
      });
    const results: WebSearchResult[] = cleaned
      .filter((result): result is WebSearchResult => result !== null)
      .map((result, index) => ({ ...result, rank: index + 1 }));
    return { providerId: this.providerId, results };
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-JSON response");
    }
  }
}

export function serperSearchAdapterFromEnv(onOperation?: OperationSink): SerperSearchAdapter {
  const apiKey = process.env.SEARCH_API_SERPER?.trim() || process.env.SERPER_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw providerConfigError(
      "serper",
      "Missing required environment variable 'SERPER_API_KEY' (alias: SEARCH_API_SERPER). Set it before constructing the serper adapter.",
    );
  }
  return new SerperSearchAdapter({
    apiKey,
    baseUrl: optionalEnv("SERPER_BASE_URL", SERPER_DEFAULT_BASE_URL),
    timeoutMs: envNumber("serper", "WEB_SEARCH_TIMEOUT_MS", 10_000),
    maxRetries: envNumber("serper", "WEB_SEARCH_MAX_RETRIES", 2),
    onOperation,
  });
}

/**
 * Exa (exa.ai) neural web search adapter (POST https://api.exa.ai/search).
 *
 * Mapping:
 *  POST {baseUrl} { "query": ..., "numResults": ... }  x-api-key: <key>
 *  -> { providerId, results: [{ title, url, snippet, source, rank }] }
 *
 * The credential is read from `EXA_API_KEY`.
 */
export interface ExaSearchConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  onOperation?: OperationSink;
}

const EXA_DEFAULT_BASE_URL = "https://api.exa.ai/search";

export class ExaSearchAdapter implements WebSearchProvider {
  readonly providerId = "exa";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: ExaSearchConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError(
        "exa",
        "config.apiKey is required. Provide an Exa API key (EXA_API_KEY).",
      );
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = config.baseUrl ?? EXA_DEFAULT_BASE_URL;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 2;
    assertPositive("exa", this.timeoutMs, "timeoutMs");
    assertPositive("exa", this.maxRetries + 1, "maxRetries + 1");
    this.onOperation = sinkOf(config.onOperation);
  }

  async search(request: WebSearchRequest): Promise<WebSearchProviderResponse> {
    const maxResults = clamp(request.maxResults ?? 10, 1, 20);
    const res = await sendHttpWithRetry(
      {
        method: "POST",
        url: this.baseUrl,
        headers: {
          "x-api-key": this.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({ query: request.query, numResults: maxResults, contents: { text: true } }),
      },
      {
        providerId: this.providerId,
        operation: "search",
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        onOperation: this.onOperation,
      },
    );

    const json = await this.readJson(res);
    if (!isRecord(json)) {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-object response");
    }
    if (json.results !== undefined && !Array.isArray(json.results)) {
      throw providerValidationError(this.providerId, "search", "Provider response has malformed results");
    }
    const rows = Array.isArray(json.results) ? json.results : [];
    const cleaned: Array<WebSearchResult | null> = rows
      .slice(0, maxResults)
      .map((item) => {
        if (!isRecord(item)) return null;
        const url = asString(item.url);
        const source = url === undefined ? "" : hostnameOf(url);
        if (url === undefined || url.trim().length === 0 || source.length === 0) return null;
        return {
          title: asString(item.title) ?? "",
          url,
          snippet: asString(item.text) ?? "",
          source,
          rank: 0,
        };
      });
    const results: WebSearchResult[] = cleaned
      .filter((result): result is WebSearchResult => result !== null)
      .map((result, index) => ({ ...result, rank: index + 1 }));
    return { providerId: this.providerId, results };
  }

  private async readJson(res: { json(): Promise<unknown> }): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw providerValidationError(this.providerId, "search", "Provider returned a non-JSON response");
    }
  }
}

export function exaSearchAdapterFromEnv(onOperation?: OperationSink): ExaSearchAdapter {
  const apiKey = process.env.SEARCH_API_EXA?.trim() || process.env.EXA_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw providerConfigError(
      "exa",
      "Missing required environment variable 'EXA_API_KEY' (alias: SEARCH_API_EXA). Set it before constructing the exa adapter.",
    );
  }
  return new ExaSearchAdapter({
    apiKey,
    baseUrl: optionalEnv("EXA_BASE_URL", EXA_DEFAULT_BASE_URL),
    timeoutMs: envNumber("exa", "WEB_SEARCH_TIMEOUT_MS", 10_000),
    maxRetries: envNumber("exa", "WEB_SEARCH_MAX_RETRIES", 2),
    onOperation,
  });
}