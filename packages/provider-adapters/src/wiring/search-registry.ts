/**
 * Search provider registry / router.
 *
 * The `web.search` capability talks to ONE `WebSearchProvider` — this
 * registry. It holds every *configured* search provider adapter (Tavily,
 * Serper, Exa, Brave) and routes each search to a single active provider,
 * so switching providers is pure configuration:
 *
 *   SEARCH_PROVIDER=<providerId>  (e.g. serper | exa | brave | tavily; short
 *     aliases accepted, or the canonical id brave-search | tavily-search)
 *   or simply configure exactly one credential.
 *
 * Credential names (any alias works; SEARCH_API_<PROVIDER> is the friendly
 * scheme, so adding a new provider is one variable):
 *   tavily-search: SEARCH_API | SEARCH_API_TAVILY | TAVILY_API_KEY
 *   serper:        SEARCH_API_SERPER | SERPER_API_KEY
 *   exa:           SEARCH_API_EXA  | EXA_API_KEY
 *   brave-search:  SEARCH_API_BRAVE | BRAVE_SEARCH_API_KEY | BRAVE_API_KEY
 *
 * The Research agent (and the entire capability tier) never knows or cares
 * which concrete provider is active: it just calls web.search. Each provider's
 * `providerId` travels inside its own response, so evidence + research reports
 * always record which provider actually served the query.
 *
 * Selection rules (deterministic):
 *   1. `SEARCH_PROVIDER` env (or explicit `preferredId`) — must be a
 *      configured provider, otherwise it is a hard configuration error.
 *   2. Otherwise the first configured provider in the order
 *      tavily -> serper -> exa -> brave.
 * When no provider has a credential, this throws a ProviderConfigurationError
 * so the worker substitutes its blocked provider (same as any other capability).
 */

import type { WebSearchProvider, WebSearchProviderResponse, WebSearchRequest } from "@ai-media-factory/tool-framework";
import type { OperationSink } from "../core/observability.js";
import { providerConfigError, ProviderConfigurationError } from "../core/errors.js";
import {
  braveSearchAdapterFromEnv,
  exaSearchAdapterFromEnv,
  serperSearchAdapterFromEnv,
  tavilySearchAdapterFromEnv,
} from "../adapters/web-search.js";

/** A named, concrete search adapter (exposes its own providerId). */
export type SearchProviderImplementation = WebSearchProvider & { readonly providerId: string };

/** Deterministic probe order used when SEARCH_PROVIDER is not set. */
export const SEARCH_PROVIDER_ORDER: readonly string[] = ["tavily-search", "serper", "exa", "brave-search"];

/** Short aliases accepted in SEARCH_PROVIDER (canonical adapter providerId). */
export const SEARCH_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  tavily: "tavily-search",
  brave: "brave-search",
  serper: "serper",
  exa: "exa",
};

/** Normalize a SEARCH_PROVIDER value to a canonical providerId (aliases + ids). */
export function normalizeSearchProviderId(input: string): string {
  const lowered = input.trim().toLowerCase();
  if (SEARCH_PROVIDER_ALIASES[lowered] !== undefined) return SEARCH_PROVIDER_ALIASES[lowered];
  if ((SEARCH_PROVIDER_ORDER as readonly string[]).includes(lowered)) return lowered;
  throw providerConfigError(
    "web.search",
    `Unknown SEARCH_PROVIDER '${input}'. Expected one of: ${SEARCH_PROVIDER_ORDER.join(", ")} (short aliases: ${Object.keys(SEARCH_PROVIDER_ALIASES).join(", ")}).`,
  );
}

export class SearchProviderRegistry implements WebSearchProvider {
  private readonly providers = new Map<string, WebSearchProvider>();
  private activeId: string | null = null;

  register(provider: SearchProviderImplementation): this {
    this.providers.set(provider.providerId, provider);
    if (this.activeId === null) this.activeId = provider.providerId;
    return this;
  }

  /** Force a specific (already registered) provider as active. */
  setActive(providerId: string): this {
    if (!this.providers.has(providerId)) {
      throw providerConfigError(
        "web.search",
        `Search provider '${providerId}' is not registered (available: ${this.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    this.activeId = providerId;
    return this;
  }

  get activeProviderId(): string | null {
    return this.activeId;
  }

  get configuredProviderIds(): readonly string[] {
    return [...this.providers.keys()];
  }

  async search(request: WebSearchRequest): Promise<WebSearchProviderResponse> {
    const id = this.activeId;
    const active = id === null ? null : this.providers.get(id);
    if (active === null || active === undefined) {
      throw providerConfigError(
        "web.search",
        "No search provider is active in the registry — configure a search provider credential or set SEARCH_PROVIDER.",
      );
    }
    return active.search(request);
  }
}

export interface SearchAdapterEnvOptions {
  /** Explicit provider selection; defaults to the SEARCH_PROVIDER env var. */
  preferredId?: string;
  onOperation?: OperationSink;
}

function buildAdapter(id: string, onOperation?: OperationSink): SearchProviderImplementation {
  switch (id) {
    case "tavily-search":
      return tavilySearchAdapterFromEnv(onOperation);
    case "serper":
      return serperSearchAdapterFromEnv(onOperation);
    case "exa":
      return exaSearchAdapterFromEnv(onOperation);
    case "brave-search":
      return braveSearchAdapterFromEnv(onOperation);
    default:
      throw providerConfigError("web.search", `Unknown search provider id '${id}'.`);
  }
}

/**
 * Build a routed search adapter from the environment.
 *
 * Registers every provider whose credential is present, then activates the one
 * selected by `SEARCH_PROVIDER` (or `preferredId`), or the first configured in
 * SEARCH_PROVIDER_ORDER. Throws a ProviderConfigurationError when none is
 * configured, so the worker boundary can substitute a blocked provider.
 */
export function searchAdapterFromEnv(options: SearchAdapterEnvOptions = {}): SearchProviderRegistry {
  const registry = new SearchProviderRegistry();

  for (const id of SEARCH_PROVIDER_ORDER) {
    try {
      registry.register(buildAdapter(id, options.onOperation));
    } catch (error) {
      if (!(error instanceof ProviderConfigurationError)) throw error;
    }
  }

  if (registry.configuredProviderIds.length === 0) {
    throw providerConfigError(
      "web.search",
      "No search provider is configured. Set one of: SEARCH_API (tavily), SEARCH_API_SERPER (serper), SEARCH_API_EXA (exa) or SEARCH_API_BRAVE (brave).",
    );
  }

  const rawPreferred = options.preferredId ?? process.env.SEARCH_PROVIDER?.trim();
  if (rawPreferred !== undefined && rawPreferred.length > 0) {
    const preferredId = normalizeSearchProviderId(rawPreferred);
    if (!registry.configuredProviderIds.includes(preferredId)) {
      throw providerConfigError(
        "web.search",
        `SEARCH_PROVIDER '${preferredId}' is requested but not configured (configured: ${registry.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    registry.setActive(preferredId);
  }

  return registry;
}