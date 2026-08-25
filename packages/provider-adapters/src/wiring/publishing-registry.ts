/**
 * Publishing provider registry / router.
 *
 * The `publish.youtube` capability talks to ONE `PublishingProvider` — this
 * registry. Switching providers is pure configuration:
 *
 *   PUBLISH_PROVIDER=<providerId>  (e.g. youtube)
 *   or simply configure exactly one credential.
 *
 * Current providers:
 *   youtube:  YOUTUBE_ACCESS_TOKEN (+ GOOGLE_API_BASE_URL)
 *             Official YouTube Data API v3 (resumable upload, durable session)
 *
 * The publisher agent never knows which provider publishes: idempotency,
 * byte-cap and evidence semantics are identical behind the registry.
 * A second publisher (e.g. vimeo) would be added as one variable + one case.
 */

import type {
  PublishingProvider,
  PublishingProviderResponse,
  PublishRequest,
} from "@ai-media-factory/tool-framework";
import type { PublishSessionStore } from "@ai-media-factory/database";
import type { OperationSink } from "../core/observability.js";
import { providerConfigError, ProviderConfigurationError } from "../core/errors.js";
import { youTubePublishAdapterFromEnv } from "../adapters/publishing.js";

export type PublishingProviderImplementation = PublishingProvider & { readonly providerId: string };

export const PUBLISH_PROVIDER_ORDER: readonly string[] = ["youtube"];

export const PUBLISH_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  youtube: "youtube",
  yt: "youtube",
};

export function normalizePublishProviderId(input: string): string {
  const lowered = input.trim().toLowerCase();
  if (PUBLISH_PROVIDER_ALIASES[lowered] !== undefined) return PUBLISH_PROVIDER_ALIASES[lowered];
  if ((PUBLISH_PROVIDER_ORDER as readonly string[]).includes(lowered)) return lowered;
  throw providerConfigError(
    "publish.youtube",
    `Unknown PUBLISH_PROVIDER '${input}'. Expected one of: ${PUBLISH_PROVIDER_ORDER.join(", ")}.`,
  );
}

export class PublishingProviderRegistry implements PublishingProvider {
  private readonly providers = new Map<string, PublishingProvider>();
  private activeId: string | null = null;

  register(provider: PublishingProviderImplementation): this {
    this.providers.set(provider.providerId, provider);
    if (this.activeId === null) this.activeId = provider.providerId;
    return this;
  }

  setActive(providerId: string): this {
    if (!this.providers.has(providerId)) {
      throw providerConfigError(
        "publish.youtube",
        `Publishing provider '${providerId}' is not registered (available: ${this.configuredProviderIds.join(", ") || "none"}).`,
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
    return this.activeId ?? "publishing-registry";
  }

  async publish(request: PublishRequest): Promise<PublishingProviderResponse> {
    const id = this.activeId;
    const active = id === null ? null : this.providers.get(id);
    if (active === null || active === undefined) {
      throw providerConfigError(
        "publish.youtube",
        "No publishing provider is active in the registry — configure a publishing provider credential or set PUBLISH_PROVIDER.",
      );
    }
    return active.publish(request);
  }
}

export interface PublishingAdapterEnvOptions {
  preferredId?: string;
  publishSessionStore?: PublishSessionStore;
  onOperation?: OperationSink;
}

function buildPublishingAdapter(
  id: string,
  options: PublishingAdapterEnvOptions,
): PublishingProviderImplementation {
  switch (id) {
    case "youtube":
      return youTubePublishAdapterFromEnv(options.publishSessionStore, options.onOperation);
    default:
      throw providerConfigError("publish.youtube", `Unknown publishing provider id '${id}'.`);
  }
}

export function publishingAdapterFromEnv(options: PublishingAdapterEnvOptions = {}): PublishingProviderRegistry {
  const registry = new PublishingProviderRegistry();
  for (const id of PUBLISH_PROVIDER_ORDER) {
    try {
      registry.register(buildPublishingAdapter(id, options));
    } catch (error) {
      if (!(error instanceof ProviderConfigurationError)) throw error;
    }
  }
  if (registry.configuredProviderIds.length === 0) {
    throw providerConfigError(
      "publish.youtube",
      "No publishing provider is configured. Set YOUTUBE_ACCESS_TOKEN (youtube).",
    );
  }
  const rawPreferred = options.preferredId ?? process.env.PUBLISH_PROVIDER?.trim();
  if (rawPreferred !== undefined && rawPreferred.length > 0) {
    const preferredId = normalizePublishProviderId(rawPreferred);
    if (!registry.configuredProviderIds.includes(preferredId)) {
      throw providerConfigError(
        "publish.youtube",
        `PUBLISH_PROVIDER '${preferredId}' is requested but not configured (configured: ${registry.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    registry.setActive(preferredId);
  }
  return registry;
}
