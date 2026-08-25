/**
 * TTS adapter — Groq Orpheus speech API (POST /openai/v1/audio/speech).
 *
 * Verified contract (official docs, Aug 2026):
 *   POST https://api.groq.com/openai/v1/audio/speech
 *     Authorization: Bearer <key>
 *     { model, input, voice, response_format: "wav" }
 *   -> raw audio bytes (WAV). NOT JSON.
 *
 * Models:
 *   canopylabs/orpheus-arabic-saudi  (language "ar") — voices: abdullah fahad
 *     sultan lulwa noura aisha
 *   canopylabs/orpheus-v1-english    (default)       — voices: autumn diana
 *     hannah austin daniel troy
 *
 * Provider constraint: `input` is limited to 200 characters. This adapter
 * splits longer text at sentence boundaries, synthesizes each chunk, and
 * concatenates the PCM payloads into a single WAV (pure JS, no ffmpeg).
 *
 * Success ONLY when every chunk returns valid non-empty WAV audio. Any
 * provider failure, empty audio, or invalid container is a classified error —
 * never a fabricated success.
 */

import { createHash } from "node:crypto";
import type {
  TTSGenerationProvider,
  TTSGenerationProviderResponse,
  TTSGenerationRequest,
} from "@ai-media-factory/tool-framework";
import { sendHttpWithRetry } from "../core/http.js";
import { providerConfigError, providerValidationError } from "../core/errors.js";
import { assertPositive, envNumber, optionalEnv } from "../core/config.js";
import { isRecord } from "../core/guards.js";
import type { OperationSink } from "../core/observability.js";
import { sinkOf } from "../core/observability.js";

export interface GroqTTSConfig {
  apiKey: string;
  baseUrl?: string;
  englishModel?: string;
  arabicModel?: string;
  defaultEnglishVoice?: string;
  defaultArabicVoice?: string;
  timeoutMs?: number;
  maxRetries?: number;
  onOperation?: OperationSink;
}

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_ENGLISH_MODEL = "canopylabs/orpheus-v1-english";
const DEFAULT_ARABIC_MODEL = "canopylabs/orpheus-arabic-saudi";
const DEFAULT_ENGLISH_VOICE = "troy";
const DEFAULT_ARABIC_VOICE = "fahad";
/** Provider hard limit per request (official docs). */
const MAX_CHUNK_CHARS = 200;

const ENGLISH_VOICES = new Set(["autumn", "diana", "hannah", "austin", "daniel", "troy"]);
const ARABIC_VOICES = new Set(["abdullah", "fahad", "sultan", "lulwa", "noura", "aisha"]);

export class GroqTTSAdapter implements TTSGenerationProvider {
  readonly providerId = "groq";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly englishModel: string;
  private readonly arabicModel: string;
  private readonly defaultEnglishVoice: string;
  private readonly defaultArabicVoice: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly onOperation: OperationSink;

  constructor(config: GroqTTSConfig) {
    if (typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw providerConfigError("groq", "config.apiKey is required. Provide a Groq API key (GROQ_API_KEY).");
    }
    this.apiKey = config.apiKey.trim();
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.englishModel = config.englishModel ?? DEFAULT_ENGLISH_MODEL;
    this.arabicModel = config.arabicModel ?? DEFAULT_ARABIC_MODEL;
    this.defaultEnglishVoice = config.defaultEnglishVoice ?? DEFAULT_ENGLISH_VOICE;
    this.defaultArabicVoice = config.defaultArabicVoice ?? DEFAULT_ARABIC_VOICE;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 1;
    assertPositive("groq", this.timeoutMs, "timeoutMs");
    assertPositive("groq", this.maxRetries + 1, "maxRetries + 1");
    this.onOperation = sinkOf(config.onOperation);
  }

  async generate(request: TTSGenerationRequest): Promise<TTSGenerationProviderResponse> {
    const text = request.text.trim();
    if (text.length === 0) {
      throw providerValidationError(this.providerId, "generate", "TTS text must not be empty");
    }

    const isArabic = this.isArabic(request.language, text);
    const model = isArabic ? this.arabicModel : this.englishModel;
    const voice = this.resolveVoice(request.voice, isArabic);
    if (request.format !== undefined && request.format !== "wav") {
      throw providerValidationError(
        this.providerId,
        "generate",
        `Provider supports only wav output (requested: ${request.format})`,
      );
    }

    const chunks = chunkText(text, MAX_CHUNK_CHARS);
    const buffers: Uint8Array[] = [];
    let fmt: WavFmt | null = null;
    for (let i = 0; i < chunks.length; i += 1) {
      const wav = await this.synthesizeChunk(chunks[i], model, voice, i, chunks.length);
      const parsed = parseWav(wav);
      if (parsed === null) {
        throw providerValidationError(this.providerId, "generate", "Provider returned invalid WAV audio");
      }
      if (fmt === null) {
        fmt = parsed.fmt;
      } else if (
        parsed.fmt.audioFormat !== fmt.audioFormat ||
        parsed.fmt.channels !== fmt.channels ||
        parsed.fmt.sampleRate !== fmt.sampleRate
      ) {
        throw providerValidationError(this.providerId, "generate", "Provider returned inconsistent WAV formats across chunks");
      }
      buffers.push(parsed.data);
    }

    const merged = buildWav(fmt!, buffers);
    if (merged.length < 100) {
      throw providerValidationError(this.providerId, "generate", "Provider returned empty audio");
    }
    const audioId = `groq-${createHash("sha256").update(`${text}\n${voice}\n${model}`).digest("hex").slice(0, 16)}`;
    return {
      providerId: this.providerId,
      audioId,
      url: `data:audio/wav;base64,${Buffer.from(merged).toString("base64")}`,
      format: "wav",
      voice,
      model,
    };
  }

  private isArabic(language: string | undefined, text: string): boolean {
    if (language !== undefined) {
      const lowered = language.trim().toLowerCase();
      if (lowered.startsWith("ar")) return true;
      if (lowered.length > 0) return false;
    }
    // Fallback: Arabic script detection when no language hint is provided
    return /[\u0600-\u06FF]/.test(text);
  }

  private resolveVoice(voice: string | undefined, isArabic: boolean): string {
    if (voice === undefined || voice.trim().length === 0) {
      return isArabic ? this.defaultArabicVoice : this.defaultEnglishVoice;
    }
    const v = voice.trim().toLowerCase();
    const known = isArabic ? ARABIC_VOICES : ENGLISH_VOICES;
    if (!known.has(v)) {
      throw providerValidationError(
        this.providerId,
        "generate",
        `Unknown voice '${voice}' for ${isArabic ? "arabic" : "english"} model (supported: ${[...known].join(", ")})`,
      );
    }
    return v;
  }

  private async synthesizeChunk(
    chunk: string,
    model: string,
    voice: string,
    index: number,
    total: number,
  ): Promise<Uint8Array> {
    const res = await sendHttpWithRetry(
      {
        method: "POST",
        url: `${this.baseUrl}/audio/speech`,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "audio/wav",
        },
        body: JSON.stringify({ model, input: chunk, voice, response_format: "wav" }),
      },
      {
        providerId: this.providerId,
        operation: `speech[${index + 1}/${total}]`,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        onOperation: this.onOperation,
        requestKey: `${model}:${voice}:${index}`,
      },
    );
    const bytes = await res.bytes();
    if (bytes.byteLength === 0) {
      throw providerValidationError(this.providerId, "generate", "Provider returned empty audio");
    }
    // Some error paths return JSON with 200 — detect and fail truthfully.
    if (bytes.length < 44 || bytes[0] !== 0x52 /* R */ || bytes[1] !== 0x49 /* I */) {
      let detail = "";
      try {
        const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (isRecord(parsed) && parsed.error !== undefined) detail = JSON.stringify(parsed.error).slice(0, 200);
      } catch {
        /* not JSON — fall through */
      }
      throw providerValidationError(
        this.providerId,
        "generate",
        `Provider returned a non-WAV payload${detail ? `: ${detail}` : ""}`,
      );
    }
    return bytes;
  }
}

/** Split text into <=maxChars chunks at sentence boundaries (Arabic-aware). */
export function chunkText(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return [trimmed];
  const sentences = trimmed.split(/(?<=[.!?؟؛…])\s+/);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (piece.length === 0) continue;
    if (piece.length > maxChars) {
      // Hard-split an over-long sentence at word boundaries
      if (current.length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      let remainder = piece;
      while (remainder.length > maxChars) {
        let cut = remainder.lastIndexOf(" ", maxChars);
        if (cut <= 0) cut = maxChars;
        chunks.push(remainder.slice(0, cut).trim());
        remainder = remainder.slice(cut).trim();
      }
      if (remainder.length > 0) current = remainder + " ";
      continue;
    }
    if ((current + " " + piece).trim().length > maxChars) {
      chunks.push(current.trim());
      current = piece + " ";
    } else {
      current = (current + " " + piece).trim() + " ";
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks.filter((c) => c.length > 0);
}

interface WavFmt {
  audioFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/** Minimal RIFF/WAVE parser: returns fmt + concatenated data chunk bytes. */
function parseWav(bytes: Uint8Array): { fmt: WavFmt; data: Uint8Array } | null {
  if (bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number): string => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let offset = 12;
  let fmt: WavFmt | null = null;
  const dataParts: Uint8Array[] = [];
  while (offset + 8 <= bytes.length) {
    const chunkId = tag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = bytes.subarray(offset + 8, Math.min(offset + 8 + chunkSize, bytes.length));
    if (chunkId === "fmt " && body.length >= 16) {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        channels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (chunkId === "data") {
      dataParts.push(body);
    }
    offset += 8 + chunkSize + (chunkSize % 2);
  }
  if (fmt === null || dataParts.length === 0) return null;
  const total = dataParts.reduce((sum, part) => sum + part.length, 0);
  const data = new Uint8Array(total);
  let cursor = 0;
  for (const part of dataParts) {
    data.set(part, cursor);
    cursor += part.length;
  }
  return { fmt, data };
}

/** Build a single canonical PCM WAV from fmt + raw data parts. */
function buildWav(fmt: WavFmt, dataParts: Uint8Array[]): Uint8Array {
  const dataLength = dataParts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(44 + dataLength);
  const view = new DataView(out.buffer);
  const writeTag = (offset: number, s: string): void => {
    for (let i = 0; i < 4; i += 1) out[offset + i] = s.charCodeAt(i);
  };
  const blockAlign = (fmt.channels * fmt.bitsPerSample) / 8;
  const byteRate = (fmt.sampleRate * fmt.channels * fmt.bitsPerSample) / 8;
  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, fmt.audioFormat, true);
  view.setUint16(22, fmt.channels, true);
  view.setUint32(24, fmt.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, fmt.bitsPerSample, true);
  writeTag(36, "data");
  view.setUint32(40, dataLength, true);
  let cursor = 44;
  for (const part of dataParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/** Construct a Groq TTS adapter from environment variables. */
export function groqTTSAdapterFromEnv(onOperation?: OperationSink): GroqTTSAdapter {
  const apiKey =
    process.env.GROQ_API_KEY?.trim() ??
    process.env.GROQ_TTS_API_KEY?.trim() ??
    process.env.TTS_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw providerConfigError(
      "groq",
      "Missing required environment variable 'GROQ_API_KEY' (aliases: GROQ_TTS_API_KEY, TTS_API_KEY).",
    );
  }
  return new GroqTTSAdapter({
    apiKey,
    baseUrl: optionalEnv("GROQ_BASE_URL", DEFAULT_BASE_URL),
    englishModel: optionalEnv("GROQ_TTS_ENGLISH_MODEL", DEFAULT_ENGLISH_MODEL),
    arabicModel: optionalEnv("GROQ_TTS_ARABIC_MODEL", DEFAULT_ARABIC_MODEL),
    defaultEnglishVoice: optionalEnv("GROQ_TTS_ENGLISH_VOICE", DEFAULT_ENGLISH_VOICE),
    defaultArabicVoice: optionalEnv("GROQ_TTS_ARABIC_VOICE", DEFAULT_ARABIC_VOICE),
    timeoutMs: envNumber("groq", "TTS_TIMEOUT_MS", 30_000),
    maxRetries: envNumber("groq", "TTS_MAX_RETRIES", 1),
    onOperation,
  });
}
