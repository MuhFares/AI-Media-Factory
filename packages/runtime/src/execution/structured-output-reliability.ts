/**
 * Structured-output reliability layer (Sprint 8.28).
 *
 * A reusable, agent-agnostic middleware that improves reliability between an
 * LLM provider's raw output and a typed agent contract WITHOUT touching agent
 * contracts:
 *
 *   provider output → validate → targeted correction retry → validate → SUCCESS
 *                                                    ↘ exhausted → FAILED/BLOCKED
 *
 * Design rules:
 *  - NEVER coerces, repairs, or fabricates model output. A malformed response
 *    is either corrected by asking the model to fix it (bounded, via a targeted
 *    instruction derived from validation errors) or yields FAILED/BLOCKED. It
 *    never produces fake success.
 *  - Schemas are never relaxed. Validation is strictly against the request's
 *    `responseSchema`; an optional stronger `contractValidator` may be supplied.
 *  - Provider failures are classified (429/5xx/timeout/404/…), retried within a
 *    bounded budget, and routed to fallback models. A 404 model is never
 *    repeatedly retried.
 *  - Retry/recovery is NOT capability-execution evidence. Recovery events are
 *    reported via `onEvent` for observability/cost and remain distinct from
 *    decision evidence and capability-execution evidence.
 *
 * The middleware only calls the injected `underlying` executor (the existing
 * model-execution boundary); it never talks to a provider itself.
 */

import type { Json } from "../interfaces/common.js";
import type { ExecutionContext } from "../interfaces/context.js";
import type { ExecutionRequest, ExecutionResponse, Usage } from "../interfaces/execution.js";
import type { CancellationToken } from "../interfaces/resilience.js";
import type { JsonSchema, SchemaValidator, ValidationError, ValidationResult } from "../interfaces/validation.js";

/* ------------------------------------------------------------------ */
/* Failure taxonomy                                                    */
/* ------------------------------------------------------------------ */

export type OutputReliabilityFailureKind =
  | "provider_unavailable"
  | "provider_transient"
  | "model_unavailable"
  | "malformed_output"
  | "schema_validation_failure"
  | "valid";

/** One recorded attempt inside the reliability loop (observability/cost). */
export interface OutputReliabilityEvent {
  attempt: number;
  model: string;
  provider: string;
  fallbackCount: number;
  latencyMs: number;
  usage: Usage;
  failureKind: OutputReliabilityFailureKind | null;
  validationErrors: readonly ValidationError[];
  correctionApplied: boolean;
  terminal: boolean;
}

/** Classification of a provider/executor error. */
export interface ClassifiedProviderError {
  kind: OutputReliabilityFailureKind;
  httpStatus?: number;
  /** True when retrying the SAME model with backoff may help. */
  retryable: boolean;
  /** True when advancing to a fallback model is permitted. */
  fallbackAllowed: boolean;
}

/**
 * Classifies an error thrown by the underlying executor. Recognizes explicit
 * HTTP status codes embedded in provider error messages (e.g. the OpenRouter
 * adapter throws "OpenRouter request failed (429): …") plus an optional status
 * field, and maps network failures to a retryable transient class.
 */
export function classifyExecutionError(error: unknown): ClassifiedProviderError {
  let httpStatus: number | undefined;
  if (error instanceof Error) {
    const statusMatch = error.message.match(/\(\s*(\d{3})\s*\)/);
    if (statusMatch) httpStatus = Number(statusMatch[1]);
    const plainMatch = error.message.match(/\bHTTP\s+(\d{3})\b/i);
    if (httpStatus === undefined && plainMatch) httpStatus = Number(plainMatch[1]);
  }
  const maybe = error as { status?: number | string };
  if (httpStatus === undefined && maybe.status !== undefined) {
    const parsed = Number(maybe.status);
    if (Number.isFinite(parsed)) httpStatus = parsed;
  }

  if (httpStatus !== undefined) {
    if (httpStatus === 429 || httpStatus === 408 || httpStatus === 425) {
      return { kind: "provider_transient", httpStatus, retryable: true, fallbackAllowed: true };
    }
    if (httpStatus >= 500 && httpStatus <= 599) {
      return { kind: "provider_transient", httpStatus, retryable: true, fallbackAllowed: true };
    }
    if (httpStatus === 404) {
      return { kind: "model_unavailable", httpStatus, retryable: false, fallbackAllowed: true };
    }
    if (httpStatus === 401 || httpStatus === 403) {
      return { kind: "provider_unavailable", httpStatus, retryable: false, fallbackAllowed: false };
    }
    if (httpStatus === 400) {
      return { kind: "model_unavailable", httpStatus, retryable: false, fallbackAllowed: true };
    }
    return { kind: "provider_transient", httpStatus, retryable: true, fallbackAllowed: true };
  }

  return { kind: "provider_transient", retryable: true, fallbackAllowed: true };
}

/* ------------------------------------------------------------------ */
/* Minimal JSON Schema (draft-07 subset) validator                     */
/* ------------------------------------------------------------------ */

function jsonTypeOf(value: Json): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function formatPath(prefix: string, key: string | number): string {
  return typeof key === "number" ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : String(key);
}

/**
 * Implements the existing `SchemaValidator` contract for the JSON Schema
 * subset used by agent response schemas (draft-07: type, properties, required,
 * items, minItems, maximum, minimum). Unknown keywords are ignored and `format`
 * is informational (matching agent parsers). Never mutates data, never relaxes
 * a schema.
 */
export class StructuredOutputSchemaValidator implements SchemaValidator {
  validate(schema: JsonSchema, data: Json): ValidationResult {
    const errors: ValidationError[] = [];
    this.walk(schema, data, "", errors);
    return { valid: errors.length === 0, errors };
  }

  private walk(
    schema: JsonSchema,
    data: Json,
    path: string,
    errors: ValidationError[],
  ): void {
    const type = typeof schema.type === "string" ? schema.type : undefined;
    if (type !== undefined && jsonTypeOf(data) !== type) {
      errors.push({ path, message: `expected type ${type}, received ${jsonTypeOf(data)}`, keyword: "type" });
      return;
    }

    if (type === "object" || (type === undefined && data !== null && typeof data === "object" && !Array.isArray(data))) {
      const record = data as { [key: string]: Json };
      if (Array.isArray(schema.required)) {
        for (const key of schema.required) {
          if (typeof key === "string" && !(key in record)) {
            errors.push({ path: formatPath(path, key), message: `missing required property '${key}'`, keyword: "required" });
          }
        }
      }
      const properties = schema.properties;
      if (properties !== null && typeof properties === "object" && !Array.isArray(properties)) {
        for (const [key, subschema] of Object.entries(properties as { [k: string]: JsonSchema })) {
          if (key in record) {
            this.walk(subschema, record[key], formatPath(path, key), errors);
          }
        }
      }
      return;
    }

    if (type === "array") {
      const arr = data as Json[];
      const minItems = typeof schema.minItems === "number" ? schema.minItems : undefined;
      const maxItems = typeof schema.maxItems === "number" ? schema.maxItems : undefined;
      if (minItems !== undefined && arr.length < minItems) {
        errors.push({ path, message: `expected at least ${minItems} items, received ${arr.length}`, keyword: "minItems" });
      }
      if (maxItems !== undefined && arr.length > maxItems) {
        errors.push({ path, message: `expected at most ${maxItems} items, received ${arr.length}`, keyword: "maxItems" });
      }
      if (schema.items !== undefined && schema.items !== null && typeof schema.items === "object") {
        const items = schema.items as JsonSchema;
        arr.forEach((item, index) => this.walk(items, item, formatPath(path, index), errors));
      }
      return;
    }

    if (type === "number") {
      const value = data as number;
      if (typeof schema.minimum === "number" && value < schema.minimum) {
        errors.push({ path, message: `expected >= ${schema.minimum}, received ${value}`, keyword: "minimum" });
      }
      if (typeof schema.maximum === "number" && value > schema.maximum) {
        errors.push({ path, message: `expected <= ${schema.maximum}, received ${value}`, keyword: "maximum" });
      }
    }
  }
}

const schemaValidatorSingleton = new StructuredOutputSchemaValidator();

/** Validate `data` against a JSON Schema (minimal draft-07 subset). */
export function validateAgainstSchema(schema: JsonSchema, data: Json): ValidationResult {
  return schemaValidatorSingleton.validate(schema, data);
}

/* ------------------------------------------------------------------ */
/* Model compatibility tracker                                         */
/* ------------------------------------------------------------------ */

export type ModelCompatStatus = "supported" | "unsupported" | "temporarily_unavailable" | "unknown";

interface CompatRecord {
  ok: boolean;
  errorKind: OutputReliabilityFailureKind | null;
  validationErrorCount: number;
  at: number;
}

/**
 * Records per-model reliability outcomes so a model can be identified as
 * supported / unsupported / temporarily unavailable WITHOUT a permanent
 * blacklist: status reflects recent evidence and a later success restores
 * `supported`. A model is only `supported` after contract-valid output —
 * emitting parseable JSON alone is not enough.
 */
export class ModelCompatibilityTracker {
  private readonly history = new Map<string, CompatRecord[]>();

  record(model: string, entry: CompatRecord): void {
    const list = this.history.get(model) ?? [];
    list.push(entry);
    if (list.length > 10) list.shift();
    this.history.set(model, list);
  }

  status(model: string): ModelCompatStatus {
    const entries = this.history.get(model) ?? [];
    if (entries.length === 0) return "unknown";
    const last = entries[entries.length - 1];
    if (last.ok) return "supported";
    if (last.errorKind === "provider_transient" || last.errorKind === "provider_unavailable") {
      return "temporarily_unavailable";
    }
    return "unsupported";
  }

  isSupported(model: string): boolean {
    return this.status(model) === "supported";
  }
}

/* ------------------------------------------------------------------ */
/* Reliability policy                                                  */
/* ------------------------------------------------------------------ */

export interface OutputRetryPolicy {
  /** Max contract-retries (malformed/schema-invalid) per model candidate. */
  maxValidationAttempts: number;
  /** Max provider-transient retries per model candidate. */
  transientRetries: number;
  /** Base backoff (ms) for transient provider errors. */
  transientBackoffMs: number;
  /** Exponential backoff factor applied between transient retries. */
  transientBackoffFactor: number;
}

const DEFAULT_RETRY_POLICY: OutputRetryPolicy = {
  maxValidationAttempts: 2,
  transientRetries: 1,
  transientBackoffMs: 50,
  transientBackoffFactor: 2,
};

/* ------------------------------------------------------------------ */
/* The reliable executor                                               */
/* ------------------------------------------------------------------ */

export interface StructuredOutputReliabilityOptions {
  primaryModel: string;
  fallbackModels?: readonly string[];
  retryPolicy?: Partial<OutputRetryPolicy>;
  /** Extra contract validation beyond the JSON schema (optional). */
  contractValidator?: (output: Json, request: ExecutionRequest) => ValidationError[];
  /** Observability hook — aggregation is the caller's responsibility. */
  onEvent?: (event: OutputReliabilityEvent) => void;
}

/** Thrown when the bounded reliability budget is exhausted — never SUCCESS. */
export class StructuredOutputExhaustedError extends Error {
  readonly attempts: readonly OutputReliabilityEvent[];
  readonly reason: "validation" | "provider";
  constructor(reason: "validation" | "provider", message: string, attempts: readonly OutputReliabilityEvent[]) {
    super(message);
    this.name = "StructuredOutputExhaustedError";
    this.reason = reason;
    this.attempts = attempts;
  }
}

function isJsonRecord(value: Json): value is { [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

interface AttemptMeta {
  latencyMs: number;
  usage: Usage;
  provider: string;
}

/**
 * Wraps an agent's model-execution boundary (`execute`) with bounded
 * validate → targeted-correction → re-validate recovery plus provider
 * classification, backoff, and model fallback. Reusable across agents; agents
 * never duplicate this logic and never talk to a provider directly.
 */
export class StructuredOutputReliableExecutor {
  private readonly underlying: (
    context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken,
  ) => Promise<ExecutionResponse>;
  private readonly options: StructuredOutputReliabilityOptions;
  private readonly retryPolicy: OutputRetryPolicy;
  readonly compatibility = new ModelCompatibilityTracker();

  constructor(
    underlying: (
      context: ExecutionContext,
      request: ExecutionRequest,
      signal: CancellationToken,
    ) => Promise<ExecutionResponse>,
    options: StructuredOutputReliabilityOptions,
  ) {
    this.underlying = underlying;
    this.options = options;
    this.retryPolicy = { ...DEFAULT_RETRY_POLICY, ...options.retryPolicy };
  }

  async execute(context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken): Promise<ExecutionResponse> {
    const candidates = [this.options.primaryModel, ...(this.options.fallbackModels ?? [])];
    const attempts: OutputReliabilityEvent[] = [];
    let correction: string | null = null;
    let lastMeta: AttemptMeta = { latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }, provider: "unknown" };

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const model = candidates[candidateIndex];
      if (model === undefined) continue;

      let transientBudget = this.retryPolicy.transientRetries;
      let validationAttempts = 0;

      for (;;) {
        signal?.throwIfCancelled();
        const attemptNumber = attempts.length + 1;
        const requestForAttempt = correction === null
          ? { ...request, model }
          : { ...request, model, messages: this.appendCorrectionMessages(request, correction) };

        try {
          const response = await this.underlying(context, requestForAttempt, signal);
          lastMeta = { latencyMs: response.latencyMs, usage: response.usage, provider: response.provider };
          const { failureKind, validationErrors } = this.inspect(response, requestForAttempt);

          if (failureKind === "valid") {
            const event = this.eventFor(model, candidateIndex, attemptNumber, lastMeta, "valid", [], correction !== null, true);
            attempts.push(event);
            this.compatibility.record(model, { ok: true, errorKind: null, validationErrorCount: 0, at: Date.now() });
            this.options.onEvent?.(event);
            return response;
          }

          this.compatibility.record(model, { ok: false, errorKind: failureKind, validationErrorCount: validationErrors.length, at: Date.now() });
          validationAttempts += 1;
          const modelExhausted = validationAttempts >= this.retryPolicy.maxValidationAttempts;
          const event = this.eventFor(model, candidateIndex, attemptNumber, lastMeta, failureKind, validationErrors, correction !== null, modelExhausted);
          attempts.push(event);
          this.options.onEvent?.(event);
          if (modelExhausted) {
            correction = null;
            break;
          }
          correction = this.buildCorrection(failureKind, validationErrors);
        } catch (error) {
          const classification = classifyExecutionError(error);
          const event = this.eventFor(model, candidateIndex, attemptNumber, lastMeta, classification.kind, [], correction !== null, false);
          attempts.push(event);
          this.compatibility.record(model, { ok: false, errorKind: classification.kind, validationErrorCount: 0, at: Date.now() });
          this.options.onEvent?.(event);

          if (!classification.retryable) {
            if (!classification.fallbackAllowed) {
              throw new StructuredOutputExhaustedError(
                "provider",
                `Provider error is terminal (${classification.kind}): ${error instanceof Error ? error.message : String(error)}`,
                attempts,
              );
            }
            correction = null;
            break; // never re-retry an unavailable/terminal model — advance to fallback
          }
          if (transientBudget > 0) {
            transientBudget -= 1;
            await this.backoff(this.retryPolicy.transientRetries - transientBudget);
            continue; // transient retry on the same model
          }
          correction = null;
          break; // transient budget spent on this model — advance to fallback
        }
      }
    }

    const hadValidationFailure = attempts.some((a) => a.failureKind === "malformed_output" || a.failureKind === "schema_validation_failure");
    const lastErrors = attempts.flatMap((a) => a.validationErrors).slice(-5);
    throw new StructuredOutputExhaustedError(
      hadValidationFailure ? "validation" : "provider",
      `Structured output reliability budget exhausted after ${attempts.length} attempt(s); last failures: ${lastErrors.map((e) => `${e.path || "(root)"}: ${e.message}`).join("; ") || "provider failure"}`,
      attempts,
    );
  }

  private inspect(response: ExecutionResponse, request: ExecutionRequest): {
    failureKind: OutputReliabilityFailureKind;
    validationErrors: ValidationError[];
  } {
    let output = response.output;
    if (typeof output === "string") {
      const trimmed = output.trim();
      try {
        output = JSON.parse(trimmed) as Json;
      } catch {
        return { failureKind: "malformed_output", validationErrors: [{ path: "(root)", message: "output is not parseable JSON", keyword: "parse" }] };
      }
    }
    if (!isJsonRecord(output)) {
      return { failureKind: "malformed_output", validationErrors: [{ path: "(root)", message: "output is not a single JSON object", keyword: "object" }] };
    }
    if (request.responseSchema) {
      const schemaResult = validateAgainstSchema(request.responseSchema, output);
      if (!schemaResult.valid) {
        return { failureKind: "schema_validation_failure", validationErrors: schemaResult.errors };
      }
    }
    const contractErrors = this.options.contractValidator?.(output, request) ?? [];
    if (contractErrors.length > 0) {
      return { failureKind: "schema_validation_failure", validationErrors: contractErrors };
    }
    return { failureKind: "valid", validationErrors: [] };
  }

  private eventFor(
    model: string,
    candidateIndex: number,
    attemptNumber: number,
    meta: AttemptMeta,
    failureKind: OutputReliabilityFailureKind | null,
    validationErrors: readonly ValidationError[],
    correctionApplied: boolean,
    terminal: boolean,
  ): OutputReliabilityEvent {
    return {
      attempt: attemptNumber,
      model,
      provider: meta.provider,
      fallbackCount: candidateIndex,
      latencyMs: meta.latencyMs,
      usage: meta.usage,
      failureKind,
      validationErrors,
      correctionApplied,
      terminal,
    };
  }

  private appendCorrectionMessages(request: ExecutionRequest, correction: string): ExecutionRequest["messages"] {
    return [...request.messages, { role: "user", content: correction }];
  }

  private buildCorrection(kind: OutputReliabilityFailureKind, errors: readonly ValidationError[]): string {
    if (kind === "malformed_output") {
      return `Your previous response was not valid structured output: ${errors.map((e) => e.message).join("; ")}. Respond again with ONLY a single JSON object matching the provided output schema exactly. Do not add explanatory text, markdown, or code fences.`;
    }
    const lines = errors.map((e) => `- ${e.path || "(root)"}: ${e.message}`).join("\n");
    return `Your previous response did not pass structured-output validation:\n${lines}\nCorrect ONLY the reported problems and respond again with a single JSON object that matches the provided output schema exactly (same field names, types, and required fields). Do not add explanatory text.`;
  }

  private async backoff(attempt: number): Promise<void> {
    const delay = this.retryPolicy.transientBackoffMs * this.retryPolicy.transientBackoffFactor ** Math.max(0, attempt - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Factory: wraps an existing executor with the reliability layer. The returned
 * function matches the agent `execute` boundary and can be injected at agent
 * construction.
 */
export function withStructuredOutputReliability(
  execute: (
    context: ExecutionContext,
    request: ExecutionRequest,
    signal: CancellationToken,
  ) => Promise<ExecutionResponse>,
  options: StructuredOutputReliabilityOptions,
): (context: ExecutionContext, request: ExecutionRequest, signal: CancellationToken) => Promise<ExecutionResponse> {
  const executor = new StructuredOutputReliableExecutor(execute, options);
  return (context, request, signal) => executor.execute(context, request, signal);
}