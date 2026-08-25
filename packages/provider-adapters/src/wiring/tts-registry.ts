/**
 * TTS provider registry / router.
 *
 * The `tts.generate` capability talks to ONE `TTSGenerationProvider` — this
 * registry. Switching providers is pure configuration:
 *
 *   TTS_PROVIDER=groq
 *   or simply configure exactly one credential.
 *
 * Current providers:
 *   groq:     GROQ_API_KEY (+ GROQ_BASE_URL, GROQ_TTS_* model/voice overrides)
 *             Groq Orpheus speech API — English + Arabic (Saudi) models
 *   voicetut: RUNPOD_API_KEY + VOICETUT_TTS_ENDPOINT_ID
 *             VoiceTuT-TTS on RunPod Serverless — authentic Egyptian Arabic
 *             + code-switching (self-hosted, Apache-2.0)
 *
 * Future providers (chatterbox, kokoro, google, azure) plug in as one case
 * + one credential variable — the agent never changes.
 */

import type {
  TTSGenerationProvider,
  TTSGenerationProviderResponse,
  TTSGenerationRequest,
} from "@ai-media-factory/tool-framework";
import type { OperationSink } from "../core/observability.js";
import { providerConfigError, ProviderConfigurationError } from "../core/errors.js";
import { groqTTSAdapterFromEnv } from "../adapters/groq-tts.js";
import { voicetutTTSAdapterFromEnv } from "../adapters/voicetut-tts.js";

export type TTSProviderImplementation = TTSGenerationProvider & { readonly providerId: string };

export const TTS_PROVIDER_ORDER: readonly string[] = ["groq", "voicetut"];

export const TTS_PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  groq: "groq",
  voicetut: "voicetut",
  "voicetut-tts": "voicetut",
};

export function normalizeTTSProviderId(input: string): string {
  const lowered = input.trim().toLowerCase();
  if (TTS_PROVIDER_ALIASES[lowered] !== undefined) return TTS_PROVIDER_ALIASES[lowered];
  if ((TTS_PROVIDER_ORDER as readonly string[]).includes(lowered)) return lowered;
  throw providerConfigError(
    "tts.generate",
    `Unknown TTS_PROVIDER '${input}'. Expected one of: ${TTS_PROVIDER_ORDER.join(", ")}.`,
  );
}

export class TTSProviderRegistry implements TTSGenerationProvider {
  private readonly providers = new Map<string, TTSGenerationProvider>();
  private activeId: string | null = null;

  register(provider: TTSProviderImplementation): this {
    this.providers.set(provider.providerId, provider);
    if (this.activeId === null) this.activeId = provider.providerId;
    return this;
  }

  setActive(providerId: string): this {
    if (!this.providers.has(providerId)) {
      throw providerConfigError(
        "tts.generate",
        `TTS provider '${providerId}' is not registered (available: ${this.configuredProviderIds.join(", ") || "none"}).`,
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
    return this.activeId ?? "tts-registry";
  }

  async generate(request: TTSGenerationRequest): Promise<TTSGenerationProviderResponse> {
    const id = this.activeId;
    const active = id === null ? null : this.providers.get(id);
    if (active === null || active === undefined) {
      throw providerConfigError(
        "tts.generate",
        "No TTS provider is active in the registry — configure a TTS provider credential or set TTS_PROVIDER.",
      );
    }
    return active.generate(request);
  }
}

export interface TTSAdapterEnvOptions {
  preferredId?: string;
  onOperation?: OperationSink;
}

function buildTTSAdapter(id: string, onOperation?: OperationSink): TTSProviderImplementation {
  switch (id) {
    case "groq":
      return groqTTSAdapterFromEnv(onOperation);
    case "voicetut":
      return voicetutTTSAdapterFromEnv(onOperation);
    default:
      throw providerConfigError("tts.generate", `Unknown TTS provider id '${id}'.`);
  }
}

export function ttsAdapterFromEnv(options: TTSAdapterEnvOptions = {}): TTSProviderRegistry {
  const registry = new TTSProviderRegistry();
  for (const id of TTS_PROVIDER_ORDER) {
    try {
      registry.register(buildTTSAdapter(id, options.onOperation));
    } catch (error) {
      if (!(error instanceof ProviderConfigurationError)) throw error;
    }
  }
  if (registry.configuredProviderIds.length === 0) {
    throw providerConfigError(
      "tts.generate",
      "No TTS provider is configured. Set GROQ_API_KEY (groq) or RUNPOD_API_KEY + VOICETUT_TTS_ENDPOINT_ID (voicetut).",
    );
  }
  const rawPreferred = options.preferredId ?? process.env.TTS_PROVIDER?.trim();
  if (rawPreferred !== undefined && rawPreferred.length > 0) {
    const preferredId = normalizeTTSProviderId(rawPreferred);
    if (!registry.configuredProviderIds.includes(preferredId)) {
      throw providerConfigError(
        "tts.generate",
        `TTS_PROVIDER '${preferredId}' is requested but not configured (configured: ${registry.configuredProviderIds.join(", ") || "none"}).`,
      );
    }
    registry.setActive(preferredId);
  }
  return registry;
}
