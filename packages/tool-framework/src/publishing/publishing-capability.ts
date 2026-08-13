import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

/**
 * Publishing capability.
 *
 * A single implemented publishing vertical: publish.<platform> as an injected,
 * deterministic-as-possible provider boundary. The PublisherAgent never calls
 * a provider SDK or network directly; it only requests this capability through
 * the `CapabilityExecutionPort`. Publishing is idempotent: the same logical
 * request (stable idempotency key) must not create duplicate publications.
 */

/** Currently implemented publishing platform (single vertical). */
export type PublishingPlatform = "youtube";

export const PUBLISH_CAPABILITY_ID = "publish.youtube";
export const PUBLISH_PLATFORM: PublishingPlatform = "youtube";

/** Truthful publish status from the provider; completion must be provider-confirmed. */
export type PublishStatus = "pending" | "completed" | "failed";

export interface PublishRequest {
  /** Reference to the asset to publish (e.g. the generated video id/url). */
  assetId: string;
  title: string;
  description?: string;
  /** Optional publisher-supplied tags/custom metadata. */
  tags?: readonly string[];
  metadata?: Record<string, string>;
  /** Publish options when justified by the platform (e.g. visibility). */
  options?: {
    visibility?: "public" | "unlisted" | "private";
  };
}

export interface PublishingProviderResponse {
  providerId: string;
  status: PublishStatus;
  /** Provider-confirmed published asset/content identifier. */
  publicationId?: string;
  /** Provider-confirmed published URL/reference. */
  url?: string;
  publishedAt?: string;
  error?: { code: string; message: string };
}

export interface PublishingProvider {
  publish(request: PublishRequest): Promise<PublishingProviderResponse>;
}

export interface PublishingCapabilityInput {
  assetId: string;
  title: string;
  description?: string;
  tags?: readonly string[];
  metadata?: Record<string, string>;
  options?: PublishRequest["options"];
  /** Deterministic idempotency key: workflowId + assetId + platform. */
  idempotencyKey?: string;
}

export interface PublishingCapabilityOutput {
  providerId: string;
  status: PublishStatus;
  publicationId?: string;
  url?: string;
  publishedAt?: string;
  idempotencyKey: string;
  deduplicated: boolean;
}

export interface PublishingCapabilityPolicy {
  maxTitleLength: number;
  maxDescriptionLength: number;
  maxAssetIdLength: number;
  maxTags: number;
  maxTagLength: number;
  allowedVisibility: readonly ("public" | "unlisted" | "private")[];
}

/** Persists provider publish outcomes keyed by stable idempotency key. */
export interface PublishStore {
  get(idempotencyKey: string): Promise<
    | { status: "completed"; providerId: string; publicationId: string; url: string; publishedAt: string }
    | { status: "failed"; providerId: string; error: { code: string; message: string } }
    | null
  >;
  save(
    idempotencyKey: string,
    entry:
      | { status: "completed"; providerId: string; publicationId: string; url: string; publishedAt: string }
      | { status: "failed"; providerId: string; error: { code: string; message: string } },
  ): Promise<void>;
}

/** Deterministic idempotency key derived from stable logical inputs. */
export function idempotencyKeyFor(workflowId: string, assetId: string, platform: string): string {
  const pairs = [["workflowId", workflowId], ["assetId", assetId], ["platform", platform]]
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return `publish:${pairs}`;
}

type PublishingRequestEnvelope = CapabilityRequest<PublishingCapabilityInput>;
type PublishingCapabilityResult = CapabilityResult<PublishingCapabilityOutput>;

const DEFAULT_VISIBILITY: readonly ("public" | "unlisted" | "private")[] = ["public", "unlisted", "private"];

export class PublishingCapabilityExecutor
  implements CapabilityExecutorPort<PublishingCapabilityInput, PublishingCapabilityOutput> {
  private readonly policy: PublishingCapabilityPolicy;

  constructor(
    private readonly provider: PublishingProvider,
    private readonly store: PublishStore,
    private readonly resolver: CapabilityResolver,
    policy: PublishingCapabilityPolicy,
  ) {
    if (!Number.isSafeInteger(policy.maxTitleLength) || policy.maxTitleLength < 1) {
      throw new Error("maxTitleLength must be a positive safe integer");
    }
    if (!Number.isSafeInteger(policy.maxDescriptionLength) || policy.maxDescriptionLength < 0) {
      throw new Error("maxDescriptionLength must be a non-negative safe integer");
    }
    if (!Number.isSafeInteger(policy.maxAssetIdLength) || policy.maxAssetIdLength < 1) {
      throw new Error("maxAssetIdLength must be a positive safe integer");
    }
    if (!Array.isArray(policy.allowedVisibility) || policy.allowedVisibility.length === 0) {
      throw new Error("allowedVisibility must be a non-empty array");
    }
    this.policy = policy;
  }

  async execute(request: PublishingRequestEnvelope): Promise<PublishingCapabilityResult> {
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (
      request.capabilityId !== PUBLISH_CAPABILITY_ID ||
      descriptor === null ||
      !this.resolver.isAuthorized(request.agentId, request.capabilityId)
    ) {
      return this.blocked(request, "Publishing capability is not authorized");
    }
    const idempotencyKey = this.idempotencyKey(request);
    const validation = this.validateInput(request.input, idempotencyKey);
    if (validation !== null) {
      return this.blocked(request, validation);
    }

    // Idempotency: an existing failed outcome may be retried; an existing
    // successful publication must be returned without re-publishing.
    const existing = await this.store.get(idempotencyKey);
    if (existing !== null && existing.status === "completed") {
      const output: PublishingCapabilityOutput = {
        providerId: existing.providerId,
        status: "completed",
        publicationId: existing.publicationId,
        url: existing.url,
        publishedAt: existing.publishedAt,
        idempotencyKey,
        deduplicated: true,
      };
      return {
        status: "success",
        resultId: this.resultId(request),
        capabilityId: request.capabilityId,
        output,
        evidence: this.evidence(request, "completed", existing.providerId, existing.publicationId, existing.url, existing.publishedAt, idempotencyKey, true, true),
      };
    }

    const startedAt = Date.now();
    // A previously failed attempt has no persisted successful outcome; retry.
    let published: { publicationId: string; url: string; publishedAt: string };
    let providerId = "";
    try {
      const providerRequest: PublishRequest = {
        assetId: request.input.assetId,
        title: request.input.title.trim(),
        ...(request.input.description === undefined ? {} : { description: request.input.description.trim() }),
        ...(request.input.tags === undefined ? {} : { tags: [...request.input.tags] }),
        ...(request.input.metadata === undefined ? {} : { metadata: { ...request.input.metadata } }),
        ...(request.input.options === undefined ? {} : { options: { ...request.input.options } }),
      };
      const providerResponse = await this.provider.publish(providerRequest);
      providerId = providerResponse.providerId;
      if (!this.isValidProviderResponse(providerResponse)) {
        const failed = { status: "failed" as const, providerId, error: { code: "INVALID_PROVIDER_RESPONSE", message: "Provider returned a malformed publish response" } };
        await this.store.save(idempotencyKey, failed);
        return this.failed(request, "INVALID_PROVIDER_RESPONSE", "Provider returned a malformed publish response", startedAt, true, idempotencyKey, providerId);
      }
      if (providerResponse.status === "failed") {
        const error = { code: providerResponse.error?.code ?? "PROVIDER_FAILED", message: providerResponse.error?.message ?? "Provider reported a publish failure" };
        await this.store.save(idempotencyKey, { status: "failed", providerId, error });
        return this.failed(request, error.code, error.message, startedAt, true, idempotencyKey, providerId);
      }
      if (providerResponse.status !== "completed" || providerResponse.publicationId === undefined || providerResponse.url === undefined) {
        const error = { code: "PUBLISH_NOT_COMPLETED", message: "Publish job is not complete" };
        await this.store.save(idempotencyKey, { status: "failed", providerId, error });
        return this.failed(request, "PUBLISH_NOT_COMPLETED", "Publish job is not complete", startedAt, true, idempotencyKey, providerId);
      }
      published = {
        publicationId: providerResponse.publicationId,
        url: providerResponse.url,
        publishedAt: providerResponse.publishedAt ?? new Date().toISOString(),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Publishing provider failed";
      const providerError = { code: "PROVIDER_ERROR", message };
      await this.store.save(idempotencyKey, { status: "failed", providerId, error: providerError });
      return this.failed(request, "PROVIDER_ERROR", message, startedAt, true, idempotencyKey, providerId);
    }

    await this.store.save(idempotencyKey, {
      status: "completed",
      providerId,
      publicationId: published.publicationId,
      url: published.url,
      publishedAt: published.publishedAt,
    });

    const output: PublishingCapabilityOutput = {
      providerId,
      status: "completed",
      publicationId: published.publicationId,
      url: published.url,
      publishedAt: published.publishedAt,
      idempotencyKey,
      deduplicated: false,
    };
    return {
      status: "success",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      output,
      evidence: this.evidence(request, "completed", providerId, published.publicationId, published.url, published.publishedAt, idempotencyKey, true, false),
    };
  }

  private validateInput(input: PublishingCapabilityInput, idempotencyKey: string): string | null {
    if (typeof input?.assetId !== "string" || input.assetId.trim().length === 0) {
      return "assetId must not be empty";
    }
    if (input.assetId.trim().length > this.policy.maxAssetIdLength) {
      return "assetId exceeds the configured length limit";
    }
    if (typeof input.title !== "string" || input.title.trim().length === 0) {
      return "title must not be empty";
    }
    if (input.title.trim().length > this.policy.maxTitleLength) {
      return "title exceeds the configured length limit";
    }
    if (input.description !== undefined && input.description.trim().length > this.policy.maxDescriptionLength) {
      return "description exceeds the configured length limit";
    }
    if (input.idempotencyKey !== undefined && input.idempotencyKey !== idempotencyKey) {
      return "idempotencyKey does not match the derived deterministic key";
    }
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.some((t) => typeof t !== "string" || t.length > this.policy.maxTagLength))) {
      return "tags exceed the configured limits";
    }
    if (input.options?.visibility !== undefined && !this.policy.allowedVisibility.includes(input.options.visibility)) {
      return "visibility is not in the configured allowed set";
    }
    return null;
  }

  private isValidProviderResponse(response: PublishingProviderResponse): boolean {
    if (typeof response.providerId !== "string" || response.providerId.trim().length === 0) {
      return false;
    }
    if (response.status !== "completed" && response.status !== "failed" && response.status !== "pending") {
      return false;
    }
    if (response.status === "failed" && (response.error === undefined || typeof response.error.code !== "string")) {
      return false;
    }
    if (response.status === "completed") {
      if (typeof response.publicationId !== "string" || response.publicationId.trim().length === 0) {
        return false;
      }
      if (typeof response.url !== "string" || response.url.trim().length === 0) {
        return false;
      }
      try {
        new URL(response.url);
      } catch {
        return false;
      }
    }
    return true;
  }

  private idempotencyKey(request: PublishingRequestEnvelope): string {
    return idempotencyKeyFor(request.workflowId, request.input.assetId, PUBLISH_PLATFORM);
  }

  private blocked(request: PublishingRequestEnvelope, reason: string): PublishingCapabilityResult {
    return {
      status: "blocked",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      reason,
    };
  }

  private failed(
    request: PublishingRequestEnvelope,
    code: string,
    message: string,
    startedAt: number,
    providerInvoked: boolean,
    idempotencyKey: string,
    providerId: string,
  ): PublishingCapabilityResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: true },
      evidence: this.evidence(request, "failed", providerId, "", "", "", idempotencyKey, providerInvoked, false),
    };
  }

  private evidence(
    request: PublishingRequestEnvelope,
    status: PublishStatus,
    providerId: string,
    publicationId: string,
    url: string,
    publishedAt: string,
    idempotencyKey: string,
    providerInvoked: boolean,
    deduplicated: boolean,
  ): ExecutionEvidence {
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      operation: "publish",
      platform: PUBLISH_PLATFORM,
      providerId,
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      idempotencyKey,
      executedAt: new Date().toISOString(),
      durationMs: 0,
      succeeded: status === "completed",
      resultStatus: status === "completed" ? "success" : "failed",
      publicationId,
      publishedUrl: url,
      publishedAt,
      deduplicated,
      ...(status === "failed" ? { error: { code: "PUBLISH_NOT_COMPLETED", message: "Publish did not complete" } } : {}),
    };
  }

  private resultId(request: PublishingRequestEnvelope): string {
    return `publish-result-${request.requestId}`;
  }
}

export interface CreatePublishingCapabilityOptions {
  provider: PublishingProvider;
  store: PublishStore;
  resolver: CapabilityResolver;
  policy?: Partial<PublishingCapabilityPolicy>;
}

const DEFAULT_POLICY: PublishingCapabilityPolicy = {
  maxTitleLength: 200,
  maxDescriptionLength: 1000,
  maxAssetIdLength: 500,
  maxTags: 30,
  maxTagLength: 30,
  allowedVisibility: DEFAULT_VISIBILITY,
};

/** Deterministically construct a publishing capability executor from plain configuration. */
export function createPublishingCapability(
  options: CreatePublishingCapabilityOptions,
): PublishingCapabilityExecutor {
  return new PublishingCapabilityExecutor(
    options.provider,
    options.store,
    options.resolver,
    { ...DEFAULT_POLICY, ...options.policy },
  );
}