/**
 * Analytics provider registry / router.
 *
 * The `analytics.fetch` capability talks to ONE `AnalyticsProvider` — this
 * registry. Switching providers is pure configuration:
 *
 *   ANALYTICS_PROVIDER=<providerId>  (e.g. youtube-analytics)
 *   or simply configure exactly one credential.
 *
 * Current providers:
 *   youtube-analytics:  YOUTUBE_ACCESS_TOKEN (+ YOUTUBE_ANALYTICS_BASE_URL)
 *                       Official YouTube Analytics API v2 (reports)
 *                       Never fabricates metrics; empty report → empty metrics.
 */

import type {
  AnalyticsProvider,
  AnalyticsProviderResponse,
  AnalyticsFetchRequest,
} from "@ai-media-factory/tool-framework";
import type { OperationSink } from "../core/observability.js";
import { providerConfigError, ProviderConfigurationError } from "../core/errors.js";
import { youTubeAnalyticsAdapterFromEnv } from "../adapters/analytics.js";

export type AnalyticsProviderImplementation = AnalyticsProvider & { readonly providerId: string };

export const ANALYTICS_PROVIDER_ORDER: readonly string[] = ["youtube-analytics"];

export const ANALYTICS_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  youtube: "youtube-analytics",
  "youtube-analytics": "youtube-analytics",
  yt: "youtube-analytics",
};

export function normalizeAnalyticsProviderId(input: string): string {
  const lowered = input.trim().toLowerCase();
  if (ANALYTICS_PROVIDER_ALIASES[lowered] !== undefined) return ANALYTICS_PROVIDER_ALIASES[lowered];
  if ((ANALYTICS_PROVIDER_ORDER as readonly string[]).includes(lowered)) return lowered;
  throw providerConfigError(
    "analytics.fetch",
    `Unknown ANALYTICS_PROVIDER '${input}'. Expected one of: ${ANALYTICS_PROVIDER_ORDER.join(", ")}.`,
  );
}

export class AnalyticsProviderRegistry implements AnalyticsProvider {
  private readonly providers = new Map<string, AnalyticsProvider>();
  private activeId: string | null = null;

  register(provider: AnalyticsProviderImplementation): this {
    this.providers.set(provider.providerId, provider);
    if (this.activeId === null) this.activeId = provider.providerId;
    return this;
  }

  setActive(providerId: string): this {
    if (!this.providers.has(providerId)) {
      throw providerConfigError(
        "analytics.fetch",
        `Analytics provider '${providerId}' is not registered (available: ${this.configuredProviderIds.join(", ") || "none"}).`,
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

  get providerId(): string {
    return this.activeId ?? "analytics-registry";
  }

  async fetch(request: AnalyticsFetchRequest): Promise<AnalyticsProviderResponse> {
    const id = this.activeId;
    const active = id === null ? null : this.providers.get(id);
    if (active === null || active === undefined) {
      throw providerConfigError(
        "analytics.fetch",
        "No analytics provider is active in the registry — configure an analytics provider credential or set ANALYTICS_PROVIDER.",
      );
    }
    return active.fetch(request);
  }
}

export interface AnalyticsAdapterEnvOptions {
  preferredId?: string;
  onOperation?: OperationSink;
}

function buildAnalyticsAdapter(id: string, onOperation?: OperationSink): AnalyticsProviderImplementation {
  switch (id) {
    case "youtube-analytics":
      return youTubeAnalyticsAdapterFromEnv(onOperation);
    default:
      throw providerConfigError("analytics.fetch", `Unknown analytics provider id '${id}'.`);
  }
}

export function analyticsAdapterFromEnv(options: AnalyticsAdapterEnvOptions = {}): AnalyticsProviderRegistry {
  const registry = new AnalyticsProviderRegistry();
  for (const id of ANALYTICS_PROVIDER_ORDER) {
    try {
      registry.register(buildAnalyticsAdapter(id, options.onOperation));
    } catch (error) {
      if (!(error instanceof ProviderConfigurationError)) throw error;
    }
  }
  if (registry.configuredProviderIds.length === 0) {
    throw providerConfigError(
      "analytics.fetch",
      "No analytics provider is configured. Set YOUTUBE_ACCESS_TOKEN (youtube-analytics).",
    );
  }
  const rawPreferred = options.preferredId ?? process.env.ANALYTICS_PROVIDER?.trim();
  if (rawPreferred !== undefined && rawPreferred.length > 0) {
    const preferredId = normalizeAnalyticsProviderId(rawPreferred);
    if (!registry.configuredProviderIds.includes(preferredId)) {
      throw providerConfigError(
        "analytics.fetch",
        `ANALYTICS_PROVIDER '${preferredId}' is requested but not configured (configured: ${registry.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    registry.setActive(preferredId);
  }
  return registry;
}
