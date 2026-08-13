import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

/**
 * Analytics capability.
 *
 * A single analytics vertical: `analytics.fetch` behind the injected capability
 * boundary. The AnalyticsAgent never calls a provider SDK or network directly;
 * it only requests this capability. A PerformanceReport may only claim metrics
 * that are backed by provider execution evidence — no provider call means no
 * successful fetched-data claim.
 */

/** Currently supported analytics platform (single vertical, aligned with publish.youtube). */
export type AnalyticsPlatform = "youtube";

export const ANALYTICS_CAPABILITY_ID = "analytics.fetch";
export const ANALYTICS_PLATFORM: AnalyticsPlatform = "youtube";

export type AnalyticsStatus = "completed" | "failed";

/** Provider-agnostic but typed set of supported metrics; all fields optional. */
export type PerformanceMetrics = {
  impressions?: number;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  watchTimeSeconds?: number;
  completionRate?: number;
  clickThroughRate?: number;
  conversions?: number;
  revenue?: number;
};

export interface AnalyticsFetchRequest {
  /** Identifier of the published content to fetch analytics for (publicationId). */
  publicationId: string;
  platform: string;
}

export interface AnalyticsProviderResponse {
  providerId: string;
  status: AnalyticsStatus;
  publicationId?: string;
  /** Provider-reported metrics; only fields the provider supports may be present. */
  metrics?: PerformanceMetrics;
  retrievedAt?: string;
  error?: { code: string; message: string };
}

export interface AnalyticsProvider {
  fetch(request: AnalyticsFetchRequest): Promise<AnalyticsProviderResponse>;
}

export interface AnalyticsCapabilityInput {
  publicationId: string;
  platform: string;
}

export interface AnalyticsCapabilityOutput {
  providerId: string;
  status: AnalyticsStatus;
  publicationId: string;
  metrics: PerformanceMetrics;
  retrievedAt: string;
}

export interface AnalyticsCapabilityPolicy {
  maxPublicationIdLength: number;
}

type AnalyticsRequestEnvelope = CapabilityRequest<AnalyticsCapabilityInput>;
type AnalyticsCapabilityResult = CapabilityResult<AnalyticsCapabilityOutput>;

export class AnalyticsCapabilityExecutor
  implements CapabilityExecutorPort<AnalyticsCapabilityInput, AnalyticsCapabilityOutput> {
  private readonly policy: AnalyticsCapabilityPolicy;

  constructor(
    private readonly provider: AnalyticsProvider,
    private readonly resolver: CapabilityResolver,
    policy: AnalyticsCapabilityPolicy,
  ) {
    if (!Number.isSafeInteger(policy.maxPublicationIdLength) || policy.maxPublicationIdLength < 1) {
      throw new Error("maxPublicationIdLength must be a positive safe integer");
    }
    this.policy = policy;
  }

  async execute(request: AnalyticsRequestEnvelope): Promise<AnalyticsCapabilityResult> {
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (
      request.capabilityId !== ANALYTICS_CAPABILITY_ID ||
      descriptor === null ||
      !this.resolver.isAuthorized(request.agentId, request.capabilityId)
    ) {
      return this.blocked(request, "Analytics capability is not authorized");
    }
    const validation = this.validateInput(request.input);
    if (validation !== null) {
      return this.blocked(request, validation);
    }

    const startedAt = Date.now();
    try {
      const providerResponse = await this.provider.fetch({
        publicationId: request.input.publicationId,
        platform: request.input.platform,
      });
      if (!this.isValidProviderResponse(providerResponse)) {
        return this.failed(request, "INVALID_PROVIDER_RESPONSE", "Provider returned a malformed analytics response", startedAt, true, providerResponse.providerId ?? "");
      }
      if (providerResponse.status === "failed" || providerResponse.publicationId === undefined) {
        const code = providerResponse.status === "failed" ? (providerResponse.error?.code ?? "PROVIDER_FAILED") : "ANALYTICS_NOT_AVAILABLE";
        const message = providerResponse.status === "failed" ? (providerResponse.error?.message ?? "Provider reported an analytics failure") : "Analytics are not available for the publication";
        return this.failed(request, code, message, startedAt, true, providerResponse.providerId);
      }
      const metrics: PerformanceMetrics = { ...(providerResponse.metrics ?? {}) };
      const output: AnalyticsCapabilityOutput = {
        providerId: providerResponse.providerId,
        status: "completed",
        publicationId: providerResponse.publicationId,
        metrics,
        retrievedAt: providerResponse.retrievedAt ?? new Date().toISOString(),
      };
      return {
        status: "success",
        resultId: this.resultId(request),
        capabilityId: request.capabilityId,
        output,
        evidence: this.evidence(request, providerResponse.providerId, providerResponse.publicationId, startedAt, true),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Analytics provider failed";
      return this.failed(request, "PROVIDER_ERROR", message, startedAt, true, "");
    }
  }

  private validateInput(input: AnalyticsCapabilityInput): string | null {
    if (typeof input?.publicationId !== "string" || input.publicationId.trim().length === 0) {
      return "publicationId must not be empty";
    }
    if (input.publicationId.trim().length > this.policy.maxPublicationIdLength) {
      return "publicationId exceeds the configured length limit";
    }
    if (input.platform.trim().length === 0) {
      return "platform must not be empty";
    }
    return null;
  }

  private isValidProviderResponse(response: AnalyticsProviderResponse): boolean {
    if (typeof response.providerId !== "string" || response.providerId.trim().length === 0) {
      return false;
    }
    if (response.status !== "completed" && response.status !== "failed") {
      return false;
    }
    if (response.status === "completed" && (typeof response.publicationId !== "string" || response.publicationId.trim().length === 0)) {
      return false;
    }
    if (response.metrics !== undefined && (typeof response.metrics !== "object" || response.metrics === null || Array.isArray(response.metrics))) {
      return false;
    }
    return true;
  }

  private blocked(request: AnalyticsRequestEnvelope, reason: string): AnalyticsCapabilityResult {
    return {
      status: "blocked",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      reason,
    };
  }

  private failed(
    request: AnalyticsRequestEnvelope,
    code: string,
    message: string,
    startedAt: number,
    providerInvoked: boolean,
    providerId: string,
  ): AnalyticsCapabilityResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: false },
      evidence: this.evidence(request, providerId, "", startedAt, providerInvoked),
    };
  }

  private evidence(
    request: AnalyticsRequestEnvelope,
    providerId: string,
    publicationId: string,
    startedAt: number,
    providerInvoked: boolean,
  ): ExecutionEvidence {
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      operation: "fetch",
      platform: request.input.platform,
      providerId,
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      executedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      succeeded: publicationId !== "",
      resultStatus: publicationId !== "" ? "success" : "failed",
      publicationId,
    };
  }

  private resultId(request: AnalyticsRequestEnvelope): string {
    return `analytics-result-${request.requestId}`;
  }
}

export interface CreateAnalyticsCapabilityOptions {
  provider: AnalyticsProvider;
  resolver: CapabilityResolver;
  policy?: Partial<AnalyticsCapabilityPolicy>;
}

const DEFAULT_POLICY: AnalyticsCapabilityPolicy = {
  maxPublicationIdLength: 500,
};

/** Deterministically construct an analytics capability executor from plain configuration. */
export function createAnalyticsCapability(
  options: CreateAnalyticsCapabilityOptions,
): AnalyticsCapabilityExecutor {
  return new AnalyticsCapabilityExecutor(
    options.provider,
    options.resolver,
    { ...DEFAULT_POLICY, ...options.policy },
  );
}