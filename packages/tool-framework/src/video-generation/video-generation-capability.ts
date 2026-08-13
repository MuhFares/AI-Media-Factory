import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

export const VIDEO_GENERATION_CAPABILITY_ID = "video.generate";

/** Truthful long-running provider status; completion must be provider-confirmed. */
export type VideoGenerationStatus = "submitted" | "running" | "completed" | "failed";

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  /** Optional source/reference assets (e.g. a generated thumbnail) to guide the video. */
  sourceAssetIds?: readonly string[];
  /** Optional provider/model selection. */
  model?: string;
}

export interface VideoGenerationProviderResponse {
  providerId: string;
  status: VideoGenerationStatus;
  jobId?: string;
  /** Present only when the provider confirms completion with a renderable asset. */
  videoId?: string;
  url?: string;
  title?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  model?: string;
  error?: { code: string; message: string };
}

export interface VideoGenerationProvider {
  generate(
    request: VideoGenerationRequest,
  ): Promise<VideoGenerationProviderResponse>;
}

export interface VideoGenerationCapabilityInput extends VideoGenerationRequest {}

export interface VideoGenerationCapabilityOutput {
  providerId: string;
  status: VideoGenerationStatus;
  jobId?: string;
  videoId?: string;
  url?: string;
  title?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  model?: string;
}

export interface VideoGenerationCapabilityPolicy {
  maxPromptLength: number;
  maxNegativePromptLength: number;
  maxDurationSeconds: number;
  allowedAspectRatios: readonly string[];
  maxSourceAssets: number;
}

type VideoGenerationRequestEnvelope = CapabilityRequest<VideoGenerationCapabilityInput>;
type VideoGenerationCapabilityResult = CapabilityResult<VideoGenerationCapabilityOutput>;

const DEFAULT_ASPECT_RATIOS: readonly string[] = ["16:9", "9:16", "4:3", "3:4", "1:1"];

export class VideoGenerationCapabilityExecutor
  implements CapabilityExecutorPort<VideoGenerationCapabilityInput, VideoGenerationCapabilityOutput> {
  private readonly policy: VideoGenerationCapabilityPolicy;

  constructor(
    private readonly provider: VideoGenerationProvider,
    private readonly resolver: CapabilityResolver,
    policy: VideoGenerationCapabilityPolicy,
  ) {
    if (
      !Number.isSafeInteger(policy.maxPromptLength) ||
      policy.maxPromptLength < 1
    ) {
      throw new Error("maxPromptLength must be a positive safe integer");
    }
    if (
      policy.maxNegativePromptLength !== undefined &&
      (!Number.isSafeInteger(policy.maxNegativePromptLength) ||
        policy.maxNegativePromptLength < 0)
    ) {
      throw new Error("maxNegativePromptLength must be a non-negative safe integer");
    }
    if (
      !Number.isSafeInteger(policy.maxDurationSeconds) ||
      policy.maxDurationSeconds < 1
    ) {
      throw new Error("maxDurationSeconds must be a positive safe integer");
    }
    if (
      !Array.isArray(policy.allowedAspectRatios) ||
      policy.allowedAspectRatios.length === 0
    ) {
      throw new Error("allowedAspectRatios must be a non-empty array");
    }
    if (
      !Number.isSafeInteger(policy.maxSourceAssets) ||
      policy.maxSourceAssets < 0
    ) {
      throw new Error("maxSourceAssets must be a non-negative safe integer");
    }
    this.policy = policy;
  }

  async execute(request: VideoGenerationRequestEnvelope): Promise<VideoGenerationCapabilityResult> {
    const input = request.input;
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (
      request.capabilityId !== VIDEO_GENERATION_CAPABILITY_ID ||
      descriptor === null ||
      !this.resolver.isAuthorized(request.agentId, request.capabilityId)
    ) {
      return this.blocked(request, "Video generation capability is not authorized");
    }
    const validation = this.validateInput(input);
    if (validation !== null) {
      return this.blocked(request, validation);
    }

    const startedAt = Date.now();
    try {
      const providerRequest: VideoGenerationRequest = {
        model: input.model,
        prompt: input.prompt.trim(),
        ...(input.negativePrompt === undefined
          ? {}
          : { negativePrompt: input.negativePrompt.trim() }),
        ...(input.durationSeconds === undefined
          ? {}
          : { durationSeconds: input.durationSeconds }),
        ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
        ...(input.sourceAssetIds === undefined
          ? {}
          : { sourceAssetIds: [...input.sourceAssetIds] }),
      };
      const providerResponse = await this.provider.generate(providerRequest);
      if (!this.isValidProviderResponse(providerResponse)) {
        return this.failed(
          request,
          "INVALID_PROVIDER_RESPONSE",
          "Provider returned a malformed video generation response",
          startedAt,
          true,
        );
      }
      if (providerResponse.status === "failed") {
        return this.failed(
          request,
          providerResponse.error?.code ?? "PROVIDER_FAILED",
          providerResponse.error?.message ?? "Provider reported a video generation failure",
          startedAt,
          true,
          providerResponse,
        );
      }
      if (providerResponse.status !== "completed") {
        // submitted / running: the job is not complete. NEVER claim completion.
        return this.notCompleted(
          request,
          providerResponse,
          startedAt,
        );
      }

      const output: VideoGenerationCapabilityOutput = {
        providerId: providerResponse.providerId,
        status: "completed",
        ...(providerResponse.jobId === undefined ? {} : { jobId: providerResponse.jobId }),
        ...(providerResponse.videoId === undefined ? {} : { videoId: providerResponse.videoId }),
        ...(providerResponse.url === undefined ? {} : { url: providerResponse.url }),
        ...(providerResponse.title === undefined ? {} : { title: providerResponse.title }),
        ...(providerResponse.durationSeconds === undefined ? {} : { durationSeconds: providerResponse.durationSeconds }),
        ...(providerResponse.width === undefined ? {} : { width: providerResponse.width }),
        ...(providerResponse.height === undefined ? {} : { height: providerResponse.height }),
        ...(providerResponse.model === undefined ? {} : { model: providerResponse.model }),
      };
      return {
        status: "success",
        resultId: this.resultId(request),
        capabilityId: request.capabilityId,
        output,
        evidence: this.evidence(request, "completed", providerResponse, startedAt, true),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Video generation provider failed";
      return this.failed(request, "PROVIDER_ERROR", message, startedAt, true);
    }
  }

  private validateInput(input: VideoGenerationCapabilityInput): string | null {
    if (typeof input?.prompt !== "string" || input.prompt.trim().length === 0) {
      return "Video prompt must not be empty";
    }
    if (input.prompt.trim().length > this.policy.maxPromptLength) {
      return "Video prompt exceeds the configured length limit";
    }
    if (
      input.negativePrompt !== undefined &&
      (typeof input.negativePrompt !== "string" ||
        input.negativePrompt.trim().length > this.policy.maxNegativePromptLength)
    ) {
      return "negativePrompt exceeds the configured length limit";
    }
    if (
      input.durationSeconds !== undefined &&
      (!Number.isFinite(input.durationSeconds) ||
        input.durationSeconds <= 0 ||
        input.durationSeconds > this.policy.maxDurationSeconds)
    ) {
      return "durationSeconds exceeds the configured limit";
    }
    if (
      input.aspectRatio !== undefined &&
      (!this.policy.allowedAspectRatios.includes(input.aspectRatio))
    ) {
      return "aspectRatio is not in the configured allowed set";
    }
    if (
      input.sourceAssetIds !== undefined &&
      (!Array.isArray(input.sourceAssetIds) ||
        input.sourceAssetIds.length > this.policy.maxSourceAssets ||
        input.sourceAssetIds.some((id) => typeof id !== "string" || id.trim().length === 0))
    ) {
      return "sourceAssetIds exceeds the configured limit";
    }
    return null;
  }

  private isValidProviderResponse(response: VideoGenerationProviderResponse): boolean {
    if (
      typeof response.providerId !== "string" ||
      response.providerId.trim().length === 0 ||
      (response.status !== "submitted" &&
        response.status !== "running" &&
        response.status !== "completed" &&
        response.status !== "failed")
    ) {
      return false;
    }
    if (response.jobId !== undefined && typeof response.jobId !== "string") {
      return false;
    }
    if (response.status === "completed") {
      if (
        typeof response.videoId !== "string" ||
        response.videoId.trim().length === 0 ||
        typeof response.url !== "string" ||
        response.url.trim().length === 0
      ) {
        return false;
      }
      try {
        new URL(response.url);
      } catch {
        return false;
      }
    }
    if (response.status === "submitted" || response.status === "running") {
      if (typeof response.videoId === "string" && response.videoId.trim().length > 0) {
        return false;
      }
    }
    return true;
  }

  private blocked(
    request: VideoGenerationRequestEnvelope,
    reason: string,
  ): VideoGenerationCapabilityResult {
    return {
      status: "blocked",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      reason,
    };
  }

  private failed(
    request: VideoGenerationRequestEnvelope,
    code: string,
    message: string,
    startedAt: number,
    providerInvoked: boolean,
    providerResponse?: VideoGenerationProviderResponse,
  ): VideoGenerationCapabilityResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: false },
      evidence: this.evidence(
        request,
        "failed",
        providerResponse ?? {
          providerId: "",
          status: "failed",
        },
        startedAt,
        providerInvoked,
        { code, message },
      ),
    };
  }

  private notCompleted(
    request: VideoGenerationRequestEnvelope,
    providerResponse: VideoGenerationProviderResponse,
    startedAt: number,
  ): VideoGenerationCapabilityResult {
    const status = providerResponse.status as "submitted" | "running";
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: {
        code: "VIDEO_NOT_COMPLETED",
        message: `Video generation job is ${status} and not yet complete`,
        retryable: true,
      },
      evidence: this.evidence(request, status, providerResponse, startedAt, true),
    };
  }

  private evidence(
    request: VideoGenerationRequestEnvelope,
    status: VideoGenerationStatus,
    providerResponse: VideoGenerationProviderResponse,
    startedAt: number,
    providerInvoked: boolean,
    error?: { code: string; message: string },
  ): ExecutionEvidence {
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      operation: "generate",
      providerId: providerResponse.providerId,
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      executedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      succeeded: status === "completed",
      resultStatus: status === "completed" ? "success" : "failed",
      videoStatus: status,
      ...(providerResponse.jobId === undefined ? {} : { jobId: providerResponse.jobId }),
      ...(providerResponse.videoId === undefined ? {} : { videoId: providerResponse.videoId }),
      ...(providerResponse.durationSeconds === undefined ? {} : { durationSeconds: providerResponse.durationSeconds }),
      ...(providerResponse.width === undefined ? {} : { width: providerResponse.width }),
      ...(providerResponse.height === undefined ? {} : { height: providerResponse.height }),
      requestedPath: request.input.prompt.trim(),
      ...(error === undefined ? {} : { error }),
    };
  }

  private resultId(request: VideoGenerationRequestEnvelope): string {
    return `video-generation-result-${request.requestId}`;
  }
}

export interface CreateVideoGenerationCapabilityOptions {
  provider: VideoGenerationProvider;
  resolver: CapabilityResolver;
  policy?: Partial<VideoGenerationCapabilityPolicy>;
}

const DEFAULT_POLICY: VideoGenerationCapabilityPolicy = {
  maxPromptLength: 500,
  maxNegativePromptLength: 500,
  maxDurationSeconds: 600,
  allowedAspectRatios: DEFAULT_ASPECT_RATIOS,
  maxSourceAssets: 8,
};

/**
 * Deterministically construct a video generation capability executor from
 * plain configuration. Missing policy fields fall back to safe defaults.
 */
export function createVideoGenerationCapability(
  options: CreateVideoGenerationCapabilityOptions,
): VideoGenerationCapabilityExecutor {
  return new VideoGenerationCapabilityExecutor(
    options.provider,
    options.resolver,
    { ...DEFAULT_POLICY, ...options.policy },
  );
}