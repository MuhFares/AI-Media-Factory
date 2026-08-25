/**
 * TTS adapter — VoiceTuT-TTS on RunPod Serverless (Egyptian Arabic).
 *
 * Flow (identical to the Wan video adapter pattern):
 *   POST {baseUrl}/{endpointId}/run   { input: { text, voice, format } }
 *     -> { id, status: IN_QUEUE }
 *   GET  {baseUrl}/{endpointId}/status/{jobId}  (poll)
 *     -> { status: COMPLETED|FAILED|..., output: { audio: "<base64 WAV>", ... } }
 *
 * Success ONLY when the handler returns valid non-empty WAV audio.
 * The submit POST is retried only on connection-level failures via the
 * transport's transient classification; job-level failures are terminal.
 */

import { createHash } from "node:crypto";
import type {
  TTSGenerationProvider,
  TTSGenerationProviderResponse,
  TTSGenerationRequest,
} from "@ai-media-factory/tool-framework";
import { sendHttp, sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv } from "../core/config.js";
import { asString, isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface VoicetutTTSConfig {
  apiKey: string;
  endpointId: string;
  baseUrl?: string;
  defaultSpeaker?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxWaitMs?: number;
  pollRetries?: number;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://api.runpod.ai/v2";
const TERMINAL_FAILED = new Set(["FAILED", "CANCELLED", "TIMED_OUT"]);

export class VoicetutTTSAdapter implements TTSGenerationProvider {
  readonly providerId = "voicetut";
  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly baseUrl: string;
  private readonly defaultSpeaker: string;
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxWaitMs: number;
  private readonly pollRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: VoicetutTTSConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError("voicetut", "config.apiKey is required. Provide the RunPod API key (RUNPOD_API_KEY).");
    }
    if (typeof config.endpointId !== "string" || config.endpointId.trim().length === 0) {
      throw providerConfigError("voicetut", "config.endpointId is required. Provide the RunPod endpoint ID (VOICETUT_TTS_ENDPOINT_ID).");
    }
    this.apiKey = config.apiKey.trim();
    this.endpointId = config.endpointId.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.defaultSpeaker = config.defaultSpeaker ?? "Mohamed";
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 3_000;
    this.maxWaitMs = config.maxWaitMs ?? 300_000;
    this.pollRetries = config.pollRetries ?? 2;
    assertPositive("voicetut", this.timeoutMs, "timeoutMs");
    assertPositive("voicetut", this.pollIntervalMs, "pollIntervalMs");
    assertPositive("voicetut", this.maxWaitMs, "maxWaitMs");
    this.onOperation = sinkOf(config.onOperation);
  }

  async generate(request: TTSGenerationRequest): Promise<TTSGenerationProviderResponse> {
    const text = request.text.trim();
    if (text.length === 0) {
      throw providerValidationError(this.providerId, "generate", "TTS text must not be empty");
    }
    if (request.format !== undefined && request.format !== "wav") {
      throw providerValidationError(
        this.providerId,
        "generate",
        `Provider supports only wav output (requested: ${request.format})`,
      );
    }
    const voice = request.voice?.trim() || this.defaultSpeaker;

    const submitRes = await sendHttp(
      {
        method: "POST",
        url: `${this.baseUrl}/${this.endpointId}/run`,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: { text, voice, format: "wav" } }),
      },
      {
        providerId: this.providerId,
        operation: "submit",
        timeoutMs: this.timeoutMs,
        onOperation: this.onOperation,
      },
    );

    const submitJson = await this.readJson(submitRes, "submit");
    const jobId = asString(submitJson.id) ?? asString((submitJson as Record<string, unknown>).jobId);
    if (jobId === undefined || jobId.trim().length === 0) {
      throw providerValidationError(this.providerId, "submit", "Provider did not return a job id");
    }
    const immediateStatus = asString(submitJson.status);
    if (immediateStatus === "COMPLETED") {
      return this.extractResult(submitJson, jobId, voice);
    }
    if (immediateStatus !== undefined && TERMINAL_FAILED.has(immediateStatus)) {
      throw providerValidationError(this.providerId, "generate", `Provider job ${immediateStatus}: ${this.readError(submitJson)}`);
    }

    const deadline = Date.now() + this.maxWaitMs;
    while (true) {
      if (Date.now() >= deadline) {
        throw providerValidationError(this.providerId, "generate", "Provider job timed out before completion");
      }
      await this.sleep(this.pollIntervalMs);
      const pollRes = await sendHttpWithRetry(
        {
          method: "GET",
          url: `${this.baseUrl}/${this.endpointId}/status/${encodeURIComponent(jobId)}`,
          headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
        },
        {
          providerId: this.providerId,
          operation: "poll",
          timeoutMs: this.timeoutMs,
          maxRetries: this.pollRetries,
          onOperation: this.onOperation,
          requestKey: jobId,
        },
      );
      const pollJson = await this.readJson(pollRes, "poll");
      const status = asString(pollJson.status);
      if (status === "COMPLETED") {
        return this.extractResult(pollJson, jobId, voice);
      }
      if (status !== undefined && TERMINAL_FAILED.has(status)) {
        throw providerValidationError(this.providerId, "generate", `Provider job ${status}: ${this.readError(pollJson)}`);
      }
    }
  }

  private extractResult(
    json: Record<string, unknown>,
    jobId: string,
    voice: string,
  ): TTSGenerationProviderResponse {
    const output = isRecord(json.output) ? json.output : null;
    if (output === null) {
      throw providerValidationError(this.providerId, "generate", "Provider confirmed completion without audio output");
    }
    const handlerError = asString(output.error);
    if (handlerError !== undefined) {
      throw providerValidationError(this.providerId, "generate", `Provider handler error: ${handlerError}`);
    }
    const audioB64 = asString(output.audio);
    if (audioB64 === undefined || audioB64.trim().length === 0) {
      throw providerValidationError(this.providerId, "generate", "Provider confirmed completion without audio data");
    }
    const clean = audioB64.trim();
    if (!/^[A-Za-z0-9+/=]+$/.test(clean.slice(0, 100)) || clean.length < 200) {
      throw providerValidationError(this.providerId, "generate", "Provider audio data is not valid base64");
    }
    const buf = Buffer.from(clean, "base64");
    if (buf.length < 100 || buf.slice(0, 4).toString() !== "RIFF" || buf.slice(8, 12).toString() !== "WAVE") {
      throw providerValidationError(this.providerId, "generate", "Provider audio is not a valid WAV container");
    }
    const durationSecondsRaw = output.duration_seconds;
    const durationSeconds = typeof durationSecondsRaw === "number" && Number.isFinite(durationSecondsRaw)
      ? durationSecondsRaw
      : undefined;
    const audioId = `voicetut-${createHash("sha256").update(buf).digest("hex").slice(0, 16)}`;
    return {
      providerId: this.providerId,
      audioId,
      url: `data:audio/wav;base64,${clean}`,
      format: "wav",
      voice: asString(output.voice) ?? voice,
      model: "voicetut-tts",
      ...(durationSeconds === undefined ? {} : { durationSeconds }),
    };
  }

  private readError(json: unknown): string {
    if (!isRecord(json)) return "unknown provider error";
    const err = json.error ?? (isRecord(json.output) ? (json.output as Record<string, unknown>).error : undefined);
    if (typeof err === "string" && err.trim().length > 0) return err.trim();
    if (isRecord(err)) {
      const m = asString(err.message) ?? asString(err.error);
      if (m !== undefined) return m;
    }
    return "provider reported failure";
  }

  private async readJson(res: { json(): Promise<unknown> }, op: string): Promise<Record<string, unknown>> {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw providerValidationError(this.providerId, op, "Provider returned a non-JSON response");
    }
    if (!isRecord(json)) throw providerValidationError(this.providerId, op, "Provider returned a non-object response");
    return json;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Construct a VoiceTuT adapter from environment variables. */
export function voicetutTTSAdapterFromEnv(onOperation?: OperationSink): VoicetutTTSAdapter {
  const apiKey = process.env.RUNPOD_API_KEY?.trim();
  const endpointId = process.env.VOICETUT_TTS_ENDPOINT_ID?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw providerConfigError("voicetut", "Missing required environment variable 'RUNPOD_API_KEY'.");
  }
  if (endpointId === undefined || endpointId.length === 0) {
    throw providerConfigError("voicetut", "Missing required environment variable 'VOICETUT_TTS_ENDPOINT_ID'.");
  }
  return new VoicetutTTSAdapter({
    apiKey,
    endpointId,
    baseUrl: optionalEnv("RUNPOD_BASE_URL", DEFAULT_BASE_URL),
    defaultSpeaker: optionalEnv("VOICETUT_DEFAULT_SPEAKER", "Mohamed"),
    timeoutMs: envNumber("voicetut", "TTS_TIMEOUT_MS", 30_000),
    pollIntervalMs: envNumber("voicetut", "TTS_POLL_INTERVAL_MS", 3_000),
    maxWaitMs: envNumber("voicetut", "TTS_MAX_WAIT_MS", 300_000),
    pollRetries: envNumber("voicetut", "TTS_POLL_RETRIES", 2),
    onOperation,
  });
}
