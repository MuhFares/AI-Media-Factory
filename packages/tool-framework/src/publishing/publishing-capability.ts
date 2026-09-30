import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";
import {
  PUBLIC_PUBLISH_SCOPE,
  PRIVATE_VALIDATION_SCOPE,
  publicationIdentityV2,
  sha256Canonical,
  type PublicationAuthority,
} from "./publication-validation.js";
import { preflightMediaTransport, type MediaTransportRef } from "./media-transport.js";

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
  /** Immutable AMF identity. Never interpreted as a path or URL. */
  finalMediaArtifactId: string;
  finalMediaSha256: string;
  /** Provider-readable transport, independently verified against the canonical hash. */
  mediaTransportRef: MediaTransportRef;
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
  projectId?: string;
  finalMediaArtifactId: string;
  finalMediaSha256?: string;
  mediaTransportRef: MediaTransportRef;
  targetAccountId?: string;
  title: string;
  description?: string;
  tags?: readonly string[];
  metadata?: Record<string, string>;
  options?: PublishRequest["options"];
  /** Prospective v2 identity. Legacy keys remain readable in the store but cannot authorize a new publish. */
  idempotencyKey?: string;
  /** Exact PUBLIC_PUBLISH authority required immediately before provider invocation. */
  publicationAuthority?: PublicationAuthority;
}

export interface PublishingCapabilityOutput {
  providerId: string;
  status: PublishStatus;
  publicationId?: string;
  url?: string;
  publishedAt?: string;
  idempotencyKey: string;
  deduplicated: boolean;
  finalMediaArtifactId: string;
  finalMediaSha256: string;
  mediaTransportType: MediaTransportRef["type"];
  mediaTransportFingerprint: string;
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
    const validation = await this.validateInput(request.input, idempotencyKey, request.workflowId);
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
        finalMediaArtifactId: request.input.finalMediaArtifactId,
        finalMediaSha256: request.input.finalMediaSha256!,
        mediaTransportType: request.input.mediaTransportRef.type,
        mediaTransportFingerprint: (await preflightMediaTransport(request.input.mediaTransportRef, request.input.finalMediaSha256!)).fingerprint,
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
        finalMediaArtifactId: request.input.finalMediaArtifactId,
        finalMediaSha256: request.input.finalMediaSha256!,
        mediaTransportRef: request.input.mediaTransportRef,
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
      finalMediaArtifactId: request.input.finalMediaArtifactId,
      finalMediaSha256: request.input.finalMediaSha256!,
      mediaTransportType: request.input.mediaTransportRef.type,
      mediaTransportFingerprint: (await preflightMediaTransport(request.input.mediaTransportRef, request.input.finalMediaSha256!)).fingerprint,
    };
    return {
      status: "success",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      output,
      evidence: this.evidence(request, "completed", providerId, published.publicationId, published.url, published.publishedAt, idempotencyKey, true, false),
    };
  }

  private async validateInput(input: PublishingCapabilityInput, idempotencyKey: string, workflowId: string): Promise<string | null> {
    if (typeof input?.finalMediaArtifactId !== "string" || input.finalMediaArtifactId.trim().length === 0) {
      return "finalMediaArtifactId must not be empty";
    }
    if (input.finalMediaArtifactId.trim().length > this.policy.maxAssetIdLength) {
      return "finalMediaArtifactId exceeds the configured length limit";
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
    if (input.tags !== undefined && (!Array.isArray(input.tags) || input.tags.length > this.policy.maxTags || input.tags.some((t) => typeof t !== "string" || t.length > this.policy.maxTagLength))) {
      return "tags exceed the configured limits";
    }
    if (input.options?.visibility !== undefined && !this.policy.allowedVisibility.includes(input.options.visibility)) {
      return "visibility is not in the configured allowed set";
    }
    const authority = input.publicationAuthority;
    const visibility = input.options?.visibility;
    const requiredScope = visibility === "private" ? PRIVATE_VALIDATION_SCOPE : PUBLIC_PUBLISH_SCOPE;
    if (authority === undefined || authority.decision !== "approved" || authority.scope !== requiredScope) {
      return `compatible explicit ${requiredScope} authority is required`;
    }
    const payloadHash = sha256Canonical({
      assetId: input.finalMediaArtifactId,
      title: input.title.trim(),
      ...(input.description === undefined ? {} : { description: input.description.trim() }),
      ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
      ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
      ...(input.options === undefined ? {} : { options: { ...input.options } }),
    });
    if (input.projectId === undefined || input.finalMediaSha256 === undefined || input.targetAccountId === undefined) {
      return "projectId, finalMediaSha256, and targetAccountId are required for publication identity v2";
    }
    if (authority.projectId !== input.projectId || authority.workflowId !== workflowId || authority.finalMediaArtifactId !== input.finalMediaArtifactId
      || authority.finalMediaSha256 !== input.finalMediaSha256 || authority.targetPlatform !== PUBLISH_PLATFORM
      || authority.targetAccountId !== input.targetAccountId || authority.publicationPayloadHash !== payloadHash
      || authority.publicationIdentity !== idempotencyKey) {
      return "PUBLIC_PUBLISH authority binding does not match the exact publication identity";
    }
    if (input.mediaTransportRef === undefined) return "mediaTransportRef is required";
    try { await preflightMediaTransport(input.mediaTransportRef, input.finalMediaSha256); }
    catch (error) { return error instanceof Error ? error.message : "MEDIA_TRANSPORT_PREFLIGHT_FAILED"; }
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
    const input = request.input;
    if (input.projectId !== undefined && input.finalMediaSha256 !== undefined && input.targetAccountId !== undefined) {
      const publicationPayloadHash = sha256Canonical({
        assetId: input.finalMediaArtifactId,
        title: input.title.trim(),
        ...(input.description === undefined ? {} : { description: input.description.trim() }),
        ...(input.tags === undefined ? {} : { tags: [...input.tags] }),
        ...(input.metadata === undefined ? {} : { metadata: { ...input.metadata } }),
        ...(input.options === undefined ? {} : { options: { ...input.options } }),
      });
      return publicationIdentityV2({
        projectId: input.projectId,
        workflowId: request.workflowId,
        finalMediaSha256: input.finalMediaSha256,
        targetPlatform: PUBLISH_PLATFORM,
        targetAccountId: input.targetAccountId,
        publicationPayloadHash,
      });
    }
    return idempotencyKeyFor(request.workflowId, input.finalMediaArtifactId, PUBLISH_PLATFORM);
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
