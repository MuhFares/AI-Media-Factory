/**
 * Governed structured-output policy (provider-free, deterministic).
 *
 * RCA provenance: two Visual Director executions failed with HTTP 200 /
 * finish_reason=length / empty visible content on reasoning-capable free
 * models. Durable evidence shows every certified structured success in this
 * repository streams SSE with `reasoning:{effort:"none"}` and accumulates
 * `delta.content`, while the failed path used non-streaming whole-response
 * `generate()` with no reasoning control and near-zero response observability.
 *
 * This module is pure: response summarization (presence booleans only — never
 * reasoning text, never secrets), visible-text extraction, deterministic
 * per-mode request builders, and stream accumulation. No network, no secrets.
 */

import type { GenerateRequest } from './core/request.js';

/** Sanitized raw-response metadata. Presence booleans only — never payloads. */
export interface RawResponseMeta {
  readonly responseId: string | null;
  readonly actualModel: string | null;
  readonly upstreamProvider: string | null;
  readonly finishReason: string | null;
  readonly nativeFinishReason: string | null;
  readonly httpStatus: number | null;
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly costReported: number | null;
  readonly visibleBytes: number;
  readonly reasoningPresent: boolean;
  readonly toolCallsPresent: boolean;
  readonly refusalPresent: boolean;
  readonly fieldPresence: Readonly<Record<string, 'present' | 'absent'>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Summarize a chat-completions response document. Total function: malformed
 * input yields an all-absent/UNKNOWN meta, never throws. Records presence of
 * reasoning/tool/refusal signals WITHOUT their text.
 */
export function summarizeChatCompletionResponse(document: unknown, httpStatus: number | null = null): RawResponseMeta {
  const absent: RawResponseMeta = {
    responseId: null, actualModel: null, upstreamProvider: null, finishReason: null,
    nativeFinishReason: null, httpStatus, promptTokens: null, completionTokens: null,
    totalTokens: null, reasoningTokens: null, costReported: null, visibleBytes: 0,
    reasoningPresent: false, toolCallsPresent: false, refusalPresent: false, fieldPresence: {},
  };
  if (!isRecord(document)) return absent;
  const choices = Array.isArray(document.choices) ? document.choices : [];
  const first = choices.length > 0 && isRecord(choices[0]) ? (choices[0] as Record<string, unknown>) : null;
  const message = first !== null && isRecord(first.message) ? (first.message as Record<string, unknown>) : null;
  const content = message?.content;
  let visibleBytes = 0;
  if (typeof content === 'string') visibleBytes = Buffer.byteLength(content, 'utf8');
  else if (Array.isArray(content)) {
    for (const part of content) {
      if (isRecord(part) && typeof part.text === 'string' && (part.type === 'text' || part.kind === 'text' || part.type === undefined)) {
        visibleBytes += Buffer.byteLength(part.text, 'utf8');
      }
    }
  }
  const reasoningPresent = message !== null && (
    message.reasoning !== undefined || message.reasoning_content !== undefined || message.reasoning_details !== undefined);
  const toolCallsPresent = first !== null && Array.isArray(first.tool_calls) && first.tool_calls.length > 0;
  const refusalPresent = message !== null && typeof message.refusal === 'string' && message.refusal.length > 0;
  const usage = isRecord(document.usage) ? (document.usage as Record<string, unknown>) : null;
  const details = usage !== null && isRecord(usage.completion_tokens_details)
    ? (usage.completion_tokens_details as Record<string, unknown>) : null;
  const reasoningTokens = details !== null ? asNumber(details.reasoning_tokens) : asNumber(usage?.reasoning_tokens);
  const fieldPresence: Record<string, 'present' | 'absent'> = {
    'choices[0].message.content': message !== null && message.content !== undefined && message.content !== null ? 'present' : 'absent',
    'choices[0].message.reasoning': message !== null && message.reasoning !== undefined ? 'present' : 'absent',
    'choices[0].message.reasoning_content': message !== null && message.reasoning_content !== undefined ? 'present' : 'absent',
    'choices[0].reasoning': first !== null && first.reasoning !== undefined ? 'present' : 'absent',
    'choices[0].text': first !== null && first.text !== undefined ? 'present' : 'absent',
    tool_calls: toolCallsPresent ? 'present' : 'absent',
    refusal: refusalPresent ? 'present' : 'absent',
    finish_reason: first !== null && first.finish_reason !== undefined && first.finish_reason !== null ? 'present' : 'absent',
    usage: usage !== null ? 'present' : 'absent',
    'usage.reasoning_tokens': reasoningTokens !== null ? 'present' : 'absent',
  };
  return {
    responseId: asString(document.id) ?? null,
    actualModel: asString(document.model) ?? null,
    upstreamProvider: asString(document.provider) ?? null,
    finishReason: asString(first?.finish_reason) ?? null,
    nativeFinishReason: asString(first?.native_finish_reason) ?? null,
    httpStatus,
    promptTokens: asNumber(usage?.prompt_tokens),
    completionTokens: asNumber(usage?.completion_tokens),
    totalTokens: asNumber(usage?.total_tokens),
    reasoningTokens,
    costReported: asNumber(usage?.cost),
    visibleBytes,
    reasoningPresent,
    toolCallsPresent,
    refusalPresent,
    fieldPresence,
  };
}

export class ChatCompletionContentError extends Error {
  readonly code: 'EMPTY_VISIBLE_CONTENT' | 'REFUSAL_PRESENT' | 'MALFORMED_ENVELOPE' | 'NO_CHOICES';
  readonly ignoredNonTextParts: number;
  constructor(code: ChatCompletionContentError['code'], message: string, ignoredNonTextParts = 0) {
    super(message);
    this.code = code;
    this.ignoredNonTextParts = ignoredNonTextParts;
  }
}

/**
 * Extract visible business text from a chat message envelope. Rules:
 * - string content passes through (may be empty → caller decides);
 * - content-part arrays assemble text parts; non-text parts are counted and
 *   ignored (never consumed as business output);
 * - refusal present → REFUSAL_PRESENT (distinct from empty);
 * - reasoning/tool-call fields are NEVER read as business output.
 */
export function extractVisibleText(message: unknown): { text: string; ignoredNonTextParts: number } {
  if (!isRecord(message)) throw new ChatCompletionContentError('MALFORMED_ENVELOPE', 'Chat message is not an object');
  if (typeof message.refusal === 'string' && message.refusal.length > 0) {
    throw new ChatCompletionContentError('REFUSAL_PRESENT', 'Provider refused the request');
  }
  const content = message.content;
  if (typeof content === 'string') return { text: content, ignoredNonTextParts: 0 };
  if (Array.isArray(content)) {
    let text = '';
    let ignored = 0;
    for (const part of content) {
      if (isRecord(part) && typeof part.text === 'string' && (part.type === 'text' || part.kind === 'text' || part.type === undefined)) {
        text += part.text;
      } else {
        ignored += 1;
      }
    }
    return { text, ignoredNonTextParts: ignored };
  }
  throw new ChatCompletionContentError('MALFORMED_ENVELOPE', 'Chat message content is neither text nor parts');
}

/** Parse a whole chat-completions document to visible text (throws coded errors). */
export function parseChatCompletionResponse(document: unknown): { text: string; ignoredNonTextParts: number } {
  if (!isRecord(document)) throw new ChatCompletionContentError('MALFORMED_ENVELOPE', 'Response is not an object');
  const choices = document.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw new ChatCompletionContentError('NO_CHOICES', 'Response has no choices');
  const first = choices[0];
  if (!isRecord(first) || !isRecord(first.message)) throw new ChatCompletionContentError('MALFORMED_ENVELOPE', 'First choice has no message');
  const { text, ignoredNonTextParts } = extractVisibleText(first.message);
  if (text.length === 0) throw new ChatCompletionContentError('EMPTY_VISIBLE_CONTENT', 'Visible content is empty');
  return { text, ignoredNonTextParts };
}

/** Governed structured-output modes. Selected explicitly per task; never global, never fallback. */
export const STRUCTURED_OUTPUT_MODES = ['STRICT_JSON_OBJECT', 'VISIBLE_TEXT_JSON', 'STREAMED_VISIBLE_TEXT_JSON'] as const;
export type StructuredOutputMode = typeof STRUCTURED_OUTPUT_MODES[number];

export interface StructuredRequestInput {
  readonly model: string;
  readonly system: string;
  readonly user: string;
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

/**
 * Build a governed structured request for an explicit mode. The mode is
 * returned alongside (never silently changed, never embedded for the
 * provider to reinterpret):
 * - STRICT_JSON_OBJECT: response_format json_object, non-streaming;
 * - VISIBLE_TEXT_JSON: NO response_format key at all (prompt must demand one JSON object);
 * - STREAMED_VISIBLE_TEXT_JSON: stream:true, NO response_format (accumulate visible, parse at terminal).
 */
export function buildStructuredRequest(mode: StructuredOutputMode, input: StructuredRequestInput): { request: GenerateRequest; mode: StructuredOutputMode } {
  const base = {
    model: input.model,
    messages: [
      { role: 'system' as const, content: [{ kind: 'text' as const, text: input.system }] },
      { role: 'user' as const, content: [{ kind: 'text' as const, text: input.user }] },
    ],
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
  };
  if (mode === 'STRICT_JSON_OBJECT') {
    return { request: { ...base, stream: false, responseFormat: { kind: 'json' } }, mode };
  }
  if (mode === 'VISIBLE_TEXT_JSON') {
    return { request: { ...base, stream: false }, mode };
  }
  return { request: { ...base, stream: true }, mode };
}

export interface StreamDelta {
  readonly content?: unknown;
  readonly reasoning?: unknown;
  readonly reasoning_content?: unknown;
  readonly reasoning_details?: unknown;
  readonly finish?: string | null;
}

/**
 * Accumulate streamed deltas deterministically. Visible content only;
 * reasoning presence is counted, never consumed. Truncation (no terminal
 * finish) is reported for the caller to fail closed.
 */
export function accumulateStreamDeltas(deltas: readonly StreamDelta[]): {
  visibleText: string; textChunks: number; reasoningPresent: boolean; sawFinish: boolean; finishReason: string | null;
} {
  let visibleText = '';
  let textChunks = 0;
  let reasoningPresent = false;
  let sawFinish = false;
  let finishReason: string | null = null;
  for (const delta of deltas) {
    if (delta.reasoning !== undefined || delta.reasoning_content !== undefined || delta.reasoning_details !== undefined) {
      reasoningPresent = true;
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
      visibleText += delta.content;
      textChunks += 1;
    }
    if (typeof delta.finish === 'string' && delta.finish.length > 0) {
      sawFinish = true;
      finishReason = delta.finish;
    }
  }
  return { visibleText, textChunks, reasoningPresent, sawFinish, finishReason };
}
