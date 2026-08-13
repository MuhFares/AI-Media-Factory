import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

export const IMAGE_GENERATION_CAPABILITY_ID = "image.generate";

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
}

export interface ImageGenerationProviderResponse {
  providerId: string;
  /** Identifier of the generated image asset produced by the provider. */
  imageId: string;
  /** Human-readable label of the generated image. */
  title: string;
  /** Absolute or provider-local reference to the rendered image. */
  url: string;
  /** Generation parameters echoed back by the provider. */
  parameters?: ImageGenerationRequest;
}

export interface ImageGenerationProvider {
  generate(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationProviderResponse>;
}

export interface ImageGenerationCapabilityInput extends ImageGenerationRequest {}

export interface ImageGenerationCapabilityOutput {
  providerId: string;
  imageId: string;
  title: string;
  url: string;
  parameters?: ImageGenerationRequest;
}

export interface ImageGenerationCapabilityPolicy {
  maxPromptLength: number;
  maxNegativePromptLength: number;
  maxWidth: number;
  maxHeight: number;
  allowedAspectRatios: readonly string[];
}

type ImageGenerationRequestEnvelope = CapabilityRequest<ImageGenerationCapabilityInput>;
type ImageGenerationCapabilityResult = CapabilityResult<ImageGenerationCapabilityOutput>;

const DEFAULT_ASPECT_RATIOS: readonly string[] = ["16:9", "9:16", "4:3", "3:4", "1:1"];

export class ImageGenerationCapabilityExecutor
  implements CapabilityExecutorPort<ImageGenerationCapabilityInput, ImageGenerationCapabilityOutput> {
  private readonly policy: ImageGenerationCapabilityPolicy;

  constructor(
    private readonly provider: ImageGenerationProvider,
    private readonly resolver: CapabilityResolver,
    policy: ImageGenerationCapabilityPolicy,
  ) {
    if (
      !Number.isSafeInteger(policy.maxPromptLength) ||
      policy.maxPromptLength < 1
    ) {
      throw new Error("maxPromptLength must be a positive safe integer");
    }
    if (policy.maxNegativePromptLength !== undefined &&
      (!Number.isSafeInteger(policy.maxNegativePromptLength) ||
        policy.maxNegativePromptLength < 0)) {
      throw new Error("maxNegativePromptLength must be a non-negative safe integer");
    }
    if (
      !Number.isSafeInteger(policy.maxWidth) ||
      policy.maxWidth < 1
    ) {
      throw new Error("maxWidth must be a positive safe integer");
    }
    if (
      !Number.isSafeInteger(policy.maxHeight) ||
      policy.maxHeight < 1
    ) {
      throw new Error("maxHeight must be a positive safe integer");
    }
    if (
      !Array.isArray(policy.allowedAspectRatios) ||
      policy.allowedAspectRatios.length === 0
    ) {
      throw new Error("allowedAspectRatios must be a non-empty array");
    }
    this.policy = policy;
  }

  async execute(request: ImageGenerationRequestEnvelope): Promise<ImageGenerationCapabilityResult> {
    const input = request.input;
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (
      request.capabilityId !== IMAGE_GENERATION_CAPABILITY_ID ||
      descriptor === null ||
      !this.resolver.isAuthorized(request.agentId, request.capabilityId)
    ) {
      return this.blocked(request, "Image generation capability is not authorized");
    }
    const validation = this.validateInput(input);
    if (validation !== null) {
      return this.blocked(request, validation);
    }

    const startedAt = Date.now();
    try {
      const providerRequest: ImageGenerationRequest = {
        prompt: input.prompt.trim(),
        ...(input.negativePrompt === undefined
          ? {}
          : { negativePrompt: input.negativePrompt.trim() }),
        ...(input.width === undefined ? {} : { width: input.width }),
        ...(input.height === undefined ? {} : { height: input.height }),
        ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
      };
      const providerResponse = await this.provider.generate(providerRequest);
      if (!this.isValidProviderResponse(providerResponse)) {
        return this.failed(
          request,
          "INVALID_PROVIDER_RESPONSE",
          "Provider returned malformed image generation response",
          startedAt,
          true,
        );
      }
      const output: ImageGenerationCapabilityOutput = {
        providerId: providerResponse.providerId,
        imageId: providerResponse.imageId,
        title: providerResponse.title,
        url: providerResponse.url,
        ...(providerResponse.parameters === undefined
          ? {}
          : { parameters: providerResponse.parameters }),
      };
      return {
        status: "success",
        resultId: this.resultId(request),
        capabilityId: request.capabilityId,
        output,
        evidence: this.evidence(
          request,
          providerResponse.providerId,
          providerResponse.imageId,
          true,
          startedAt,
          true,
        ),
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Image generation provider failed";
      return this.failed(request, "PROVIDER_ERROR", message, startedAt, true);
    }
  }

  private validateInput(input: ImageGenerationCapabilityInput): string | null {
    if (typeof input?.prompt !== "string" || input.prompt.trim().length === 0) {
      return "Image prompt must not be empty";
    }
    if (input.prompt.trim().length > this.policy.maxPromptLength) {
      return "Image prompt exceeds the configured length limit";
    }
    if (
      input.negativePrompt !== undefined &&
      (typeof input.negativePrompt !== "string" ||
        input.negativePrompt.trim().length > this.policy.maxNegativePromptLength)
    ) {
      return "negativePrompt exceeds the configured length limit";
    }
    if (
      input.width !== undefined &&
      (!Number.isSafeInteger(input.width) ||
        input.width < 1 ||
        input.width > this.policy.maxWidth)
    ) {
      return "width exceeds the configured limit";
    }
    if (
      input.height !== undefined &&
      (!Number.isSafeInteger(input.height) ||
        input.height < 1 ||
        input.height > this.policy.maxHeight)
    ) {
      return "height exceeds the configured limit";
    }
    if (
      input.aspectRatio !== undefined &&
      (!this.policy.allowedAspectRatios.includes(input.aspectRatio))
    ) {
      return "aspectRatio is not in the configured allowed set";
    }
    return null;
  }

  private isValidProviderResponse(
    response: ImageGenerationProviderResponse,
  ): boolean {
    if (
      typeof response.providerId !== "string" ||
      response.providerId.trim().length === 0 ||
      typeof response.imageId !== "string" ||
      response.imageId.trim().length === 0 ||
      typeof response.title !== "string" ||
      response.title.trim().length === 0 ||
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
    if (response.parameters !== undefined && !this.isValidParameters(response.parameters)) {
      return false;
    }
    return true;
  }

  private isValidParameters(parameters: ImageGenerationRequest): boolean {
    if (typeof parameters.prompt !== "string" || parameters.prompt.trim().length === 0) {
      return false;
    }
    if (
      parameters.negativePrompt !== undefined &&
      typeof parameters.negativePrompt !== "string"
    ) {
      return false;
    }
    if (
      parameters.width !== undefined &&
      (!Number.isSafeInteger(parameters.width) || parameters.width < 1)
    ) {
      return false;
    }
    if (
      parameters.height !== undefined &&
      (!Number.isSafeInteger(parameters.height) || parameters.height < 1)
    ) {
      return false;
    }
    if (
      parameters.aspectRatio !== undefined &&
      typeof parameters.aspectRatio !== "string"
    ) {
      return false;
    }
    return true;
  }

  private blocked(
    request: ImageGenerationRequestEnvelope,
    reason: string,
  ): ImageGenerationCapabilityResult {
    return {
      status: "blocked",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      reason,
    };
  }

  private failed(
    request: ImageGenerationRequestEnvelope,
    code: string,
    message: string,
    startedAt: number,
    providerInvoked: boolean,
  ): ImageGenerationCapabilityResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: false },
      evidence: this.evidence(
        request,
        "",
        "",
        false,
        startedAt,
        providerInvoked,
        { code, message },
      ),
    };
  }

  private evidence(
    request: ImageGenerationRequestEnvelope,
    providerId: string,
    imageId: string,
    succeeded: boolean,
    startedAt: number,
    providerInvoked: boolean,
    error?: { code: string; message: string },
  ): ExecutionEvidence {
    const operation = "generate";
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      operation,
      providerId,
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      executedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      succeeded,
      resultStatus: succeeded ? "success" : "failed",
      ...(imageId === "" ? {} : { imageId }),
      requestedPath: request.input.prompt.trim(),
      ...(error === undefined ? {} : { error }),
    };
  }

  private resultId(request: ImageGenerationRequestEnvelope): string {
    return `image-generation-result-${request.requestId}`;
  }
}

export interface CreateImageGenerationCapabilityOptions {
  provider: ImageGenerationProvider;
  resolver: CapabilityResolver;
  policy?: Partial<ImageGenerationCapabilityPolicy>;
}

const DEFAULT_POLICY: ImageGenerationCapabilityPolicy = {
  maxPromptLength: 500,
  maxNegativePromptLength: 500,
  maxWidth: 4096,
  maxHeight: 4096,
  allowedAspectRatios: DEFAULT_ASPECT_RATIOS,
};

/**
 * Deterministically construct an image generation capability executor from
 * plain configuration. Missing policy fields fall back to safe defaults.
 */
export function createImageGenerationCapability(
  options: CreateImageGenerationCapabilityOptions,
): ImageGenerationCapabilityExecutor {
  return new ImageGenerationCapabilityExecutor(
    options.provider,
    options.resolver,
    { ...DEFAULT_POLICY, ...options.policy },
  );
}