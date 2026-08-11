import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

export const WEB_SEARCH_CAPABILITY_ID = "web.search";

export interface WebSearchRequest {
  query: string;
  maxResults?: number;
  allowedDomains?: readonly string[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  rank: number;
}

export interface WebSearchProviderResponse {
  providerId: string;
  results: readonly WebSearchResult[];
}

export interface WebSearchProvider {
  search(request: WebSearchRequest): Promise<WebSearchProviderResponse>;
}

export interface WebSearchCapabilityInput extends WebSearchRequest {}

export interface WebSearchCapabilityOutput {
  query: string;
  providerId: string;
  results: readonly WebSearchResult[];
}

export interface WebSearchCapabilityPolicy {
  maxResults: number;
  maxQueryLength: number;
}

type WebSearchRequestEnvelope = CapabilityRequest<WebSearchCapabilityInput>;
type WebSearchCapabilityResult = CapabilityResult<WebSearchCapabilityOutput>;

export class WebSearchCapabilityExecutor
  implements CapabilityExecutorPort<WebSearchCapabilityInput, WebSearchCapabilityOutput> {
  private readonly policy: WebSearchCapabilityPolicy;

  constructor(
    private readonly provider: WebSearchProvider,
    private readonly resolver: CapabilityResolver,
    policy: WebSearchCapabilityPolicy,
  ) {
    if (!Number.isSafeInteger(policy.maxResults) || policy.maxResults < 1) {
      throw new Error("maxResults must be a positive safe integer");
    }
    if (!Number.isSafeInteger(policy.maxQueryLength) || policy.maxQueryLength < 1) {
      throw new Error("maxQueryLength must be a positive safe integer");
    }
    this.policy = policy;
  }

  async execute(request: WebSearchRequestEnvelope): Promise<WebSearchCapabilityResult> {
    const input = request.input;
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (request.capabilityId !== WEB_SEARCH_CAPABILITY_ID || descriptor === null || !this.resolver.isAuthorized(request.agentId, request.capabilityId)) {
      return this.blocked(request, "Web search capability is not authorized");
    }
    const validation = this.validateInput(input);
    if (validation !== null) return this.blocked(request, validation);

    const startedAt = Date.now();
    try {
      const providerResponse = await this.provider.search({
        query: input.query.trim(),
        ...(input.maxResults === undefined ? {} : { maxResults: input.maxResults }),
        ...(input.allowedDomains === undefined ? {} : { allowedDomains: [...input.allowedDomains] }),
      });
      if (!this.isValidProviderResponse(providerResponse, input.maxResults)) {
        return this.failed(request, "INVALID_PROVIDER_RESPONSE", "Provider returned malformed search results", startedAt, false);
      }
      const output: WebSearchCapabilityOutput = {
        query: input.query.trim(),
        providerId: providerResponse.providerId,
        results: providerResponse.results,
      };
      return {
        status: "success",
        resultId: this.resultId(request),
        capabilityId: request.capabilityId,
        output,
        evidence: this.evidence(request, providerResponse.providerId, providerResponse.results.length, true, startedAt, true),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Web search provider failed";
      return this.failed(request, "PROVIDER_ERROR", message, startedAt, true);
    }
  }

  private validateInput(input: WebSearchCapabilityInput): string | null {
    if (typeof input?.query !== "string" || input.query.trim().length === 0) return "Search query must not be empty";
    if (input.query.trim().length > this.policy.maxQueryLength) return "Search query exceeds the configured length limit";
    if (input.maxResults !== undefined && (!Number.isSafeInteger(input.maxResults) || input.maxResults < 1 || input.maxResults > this.policy.maxResults)) {
      return "maxResults exceeds the configured limit";
    }
    if (input.allowedDomains !== undefined && (!Array.isArray(input.allowedDomains) || input.allowedDomains.length === 0 || input.allowedDomains.some((domain) => !this.isValidDomain(domain)))) {
      return "allowedDomains contains an invalid domain";
    }
    return null;
  }

  private isValidDomain(value: string): boolean {
    return typeof value === "string" && /^[a-z0-9.-]+$/iu.test(value) && value.includes(".") && !value.startsWith(".") && !value.endsWith(".");
  }

  private isValidProviderResponse(response: WebSearchProviderResponse, requestedMaxResults?: number): boolean {
    if (typeof response.providerId !== "string" || response.providerId.trim().length === 0 || !Array.isArray(response.results)) return false;
    if (requestedMaxResults !== undefined && response.results.length > requestedMaxResults) return false;
    return response.results.every((result) => {
      if (typeof result.title !== "string" || result.title.length === 0 || typeof result.snippet !== "string" || typeof result.source !== "string" || result.source.length === 0 || !Number.isSafeInteger(result.rank) || result.rank < 1 || typeof result.url !== "string") return false;
      try { new URL(result.url); return true; } catch { return false; }
    });
  }

  private blocked(request: WebSearchRequestEnvelope, reason: string): WebSearchCapabilityResult {
    return { status: "blocked", resultId: this.resultId(request), capabilityId: request.capabilityId, reason };
  }

  private failed(request: WebSearchRequestEnvelope, code: string, message: string, startedAt: number, providerInvoked: boolean): WebSearchCapabilityResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: false },
      evidence: this.evidence(request, "", 0, false, startedAt, providerInvoked, { code, message }),
    };
  }

  private evidence(request: WebSearchRequestEnvelope, providerId: string, resultCount: number, succeeded: boolean, startedAt: number, providerInvoked: boolean, error?: { code: string; message: string }): ExecutionEvidence {
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      operation: "search",
      providerId,
      resultCount,
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      executedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      succeeded,
      resultStatus: succeeded ? "success" : "failed",
      ...(error === undefined ? {} : { error }),
    };
  }

  private resultId(request: WebSearchRequestEnvelope): string {
    return `web-search-result-${request.requestId}`;
  }
}
