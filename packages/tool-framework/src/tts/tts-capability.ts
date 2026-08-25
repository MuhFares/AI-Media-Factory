import type {
  CapabilityExecutorPort,
  CapabilityRequest,
  CapabilityResolver,
  CapabilityResult,
  ExecutionEvidence,
} from "../capabilities.js";

export const TTS_GENERATION_CAPABILITY_ID = "tts.generate";

export interface TTSGenerationRequest {
  text: string;
  /** BCP-47-ish hint, e.g. "ar" | "en". Provider maps to model/voice defaults. */
  language?: string;
  /** Provider voice id. When omitted the provider picks a language default. */
  voice?: string;
  /** Output container format. Providers may support a subset. */
  format?: "wav" | "mp3";
  /** Optional speed hint. Providers without speed support ignore it. */
  speed?: number;
}

export interface TTSGenerationProviderResponse {
  providerId: string;
  /** Provider-confirmed identifier for the generated audio. */
  audioId: string;
  /** data:audio/<fmt>;base64,... reference to the rendered audio. */
  url: string;
  /** Actual container format of the returned audio ("wav" | "mp3"). */
  format: "wav" | "mp3";
  /** Provider-confirmed voice actually used. */
  voice?: string;
  /** Provider model actually used. */
  model?: string;
  /** Duration in seconds when measurable. */
  durationSeconds?: number;
}

export interface TTSGenerationProvider {
  generate(request: TTSGenerationRequest): Promise<TTSGenerationProviderResponse>;
}

export interface TTSGenerationCapabilityInput extends TTSGenerationRequest {}

export interface TTSGenerationCapabilityOutput {
  providerId: string;
  audioId: string;
  url: string;
  format: "wav" | "mp3";
  voice?: string;
  model?: string;
  durationSeconds?: number;
}

export interface TTSGenerationCapabilityPolicy {
  maxTextLength: number;
  allowedFormats: readonly ("wav" | "mp3")[];
  maxSpeed: number;
  minSpeed: number;
}

type TTSGenerationRequestEnvelope = CapabilityRequest<TTSGenerationCapabilityInput>;
type TTSGenerationCapabilityResult = CapabilityResult<TTSGenerationCapabilityOutput>;

export class TTSGenerationCapabilityExecutor
  implements CapabilityExecutorPort<TTSGenerationCapabilityInput, TTSGenerationCapabilityOutput> {
  private readonly policy: TTSGenerationCapabilityPolicy;

  constructor(
    private readonly provider: TTSGenerationProvider,
    private readonly resolver: CapabilityResolver,
    policy: TTSGenerationCapabilityPolicy,
  ) {
    if (!Number.isSafeInteger(policy.maxTextLength) || policy.maxTextLength < 1) {
      throw new Error("maxTextLength must be a positive safe integer");
    }
    if (!Array.isArray(policy.allowedFormats) || policy.allowedFormats.length === 0) {
      throw new Error("allowedFormats must be a non-empty array");
    }
    if (!Number.isFinite(policy.maxSpeed) || policy.maxSpeed <= 0) {
      throw new Error("maxSpeed must be a positive number");
    }
    if (!Number.isFinite(policy.minSpeed) || policy.minSpeed <= 0) {
      throw new Error("minSpeed must be a positive number");
    }
    if (policy.minSpeed > policy.maxSpeed) {
      throw new Error("minSpeed must not exceed maxSpeed");
    }
    this.policy = policy;
  }

  async execute(request: TTSGenerationRequestEnvelope): Promise<TTSGenerationCapabilityResult> {
    const input = request.input;
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (
      request.capabilityId !== TTS_GENERATION_CAPABILITY_ID ||
      descriptor === null ||
      !this.resolver.isAuthorized(request.agentId, request.capabilityId)
    ) {
      return this.blocked(request, "TTS generation capability is not authorized");
    }
    const validation = this.validateInput(input);
    if (validation !== null) {
      return this.blocked(request, validation);
    }

    const startedAt = Date.now();
    try {
      const providerRequest: TTSGenerationRequest = {
        text: input.text.trim(),
        ...(input.language === undefined ? {} : { language: input.language.trim() }),
        ...(input.voice === undefined ? {} : { voice: input.voice.trim() }),
        ...(input.format === undefined ? {} : { format: input.format }),
        ...(input.speed === undefined ? {} : { speed: input.speed }),
      };
      const providerResponse = await this.provider.generate(providerRequest);
      if (!this.isValidProviderResponse(providerResponse)) {
        return this.failed(
          request,
          "INVALID_PROVIDER_RESPONSE",
          "Provider returned a malformed TTS response",
          startedAt,
          true,
        );
      }
      const output: TTSGenerationCapabilityOutput = {
        providerId: providerResponse.providerId,
        audioId: providerResponse.audioId,
        url: providerResponse.url,
        format: providerResponse.format,
        ...(providerResponse.voice === undefined ? {} : { voice: providerResponse.voice }),
        ...(providerResponse.model === undefined ? {} : { model: providerResponse.model }),
        ...(providerResponse.durationSeconds === undefined ? {} : { durationSeconds: providerResponse.durationSeconds }),
      };
      return {
        status: "success",
        resultId: this.resultId(request),
        capabilityId: request.capabilityId,
        output,
        evidence: this.evidence(request, providerResponse.providerId, providerResponse.audioId, true, startedAt, true),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "TTS provider failed";
      return this.failed(request, "PROVIDER_ERROR", message, startedAt, true);
    }
  }

  private validateInput(input: TTSGenerationCapabilityInput): string | null {
    if (typeof input?.text !== "string" || input.text.trim().length === 0) {
      return "TTS text must not be empty";
    }
    if (input.text.trim().length > this.policy.maxTextLength) {
      return "TTS text exceeds the configured length limit";
    }
    if (input.format !== undefined && !this.policy.allowedFormats.includes(input.format)) {
      return "format is not in the configured allowed set";
    }
    if (input.speed !== undefined && (!Number.isFinite(input.speed) || input.speed < this.policy.minSpeed || input.speed > this.policy.maxSpeed)) {
      return "speed is outside the configured range";
    }
    if (input.language !== undefined && (typeof input.language !== "string" || input.language.trim().length === 0 || input.language.trim().length > 16)) {
      return "language must be a short non-empty string";
    }
    if (input.voice !== undefined && (typeof input.voice !== "string" || input.voice.trim().length === 0 || input.voice.trim().length > 64)) {
      return "voice must be a short non-empty string";
    }
    return null;
  }

  private isValidProviderResponse(response: TTSGenerationProviderResponse): boolean {
    if (
      typeof response.providerId !== "string" ||
      response.providerId.trim().length === 0 ||
      typeof response.audioId !== "string" ||
      response.audioId.trim().length === 0 ||
      typeof response.url !== "string" ||
      response.url.trim().length === 0 ||
      (response.format !== "wav" && response.format !== "mp3")
    ) {
      return false;
    }
    try {
      const url = new URL(response.url);
      if (url.protocol !== "data:") return false;
      if (!url.pathname.startsWith(`audio/${response.format};base64,`)) return false;
    } catch {
      return false;
    }
    // base64 payload must be substantial enough to be real audio
    const b64 = response.url.split(",")[1] ?? "";
    if (b64.length < 100) return false;
    return true;
  }

  private blocked(request: TTSGenerationRequestEnvelope, reason: string): TTSGenerationCapabilityResult {
    return {
      status: "blocked",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      reason,
    };
  }

  private failed(
    request: TTSGenerationRequestEnvelope,
    code: string,
    message: string,
    startedAt: number,
    providerInvoked: boolean,
  ): TTSGenerationCapabilityResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: false },
      evidence: this.evidence(request, "", "", false, startedAt, providerInvoked, { code, message }),
    };
  }

  private evidence(
    request: TTSGenerationRequestEnvelope,
    providerId: string,
    audioId: string,
    succeeded: boolean,
    startedAt: number,
    providerInvoked: boolean,
    error?: { code: string; message: string },
  ): ExecutionEvidence {
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      operation: "generate",
      providerId,
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      executedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      succeeded,
      resultStatus: succeeded ? "success" : "failed",
      ...(audioId === "" ? {} : { audioId }),
      requestedPath: request.input.text.trim().slice(0, 200),
      ...(error === undefined ? {} : { error }),
    };
  }

  private resultId(request: TTSGenerationRequestEnvelope): string {
    return `tts-generation-result-${request.requestId}`;
  }
}

export interface CreateTTSGenerationCapabilityOptions {
  provider: TTSGenerationProvider;
  resolver: CapabilityResolver;
  policy?: Partial<TTSGenerationCapabilityPolicy>;
}

const DEFAULT_POLICY: TTSGenerationCapabilityPolicy = {
  maxTextLength: 2000,
  allowedFormats: ["wav", "mp3"],
  maxSpeed: 2.0,
  minSpeed: 0.5,
};

export function createTTSGenerationCapability(
  options: CreateTTSGenerationCapabilityOptions,
): TTSGenerationCapabilityExecutor {
  return new TTSGenerationCapabilityExecutor(options.provider, options.resolver, {
    ...DEFAULT_POLICY,
    ...options.policy,
  });
}
