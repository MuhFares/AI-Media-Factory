/**
 * Provider error taxonomy.
 *
 * Every provider failure thrown by an adapter carries a stable classified
 * category so tests (and future retry/observability layers) can assert the
 * exact failure class instead of string-matching messages.
 */

export type ProviderFailureCategory =
  | "CONFIGURATION"
  | "AUTHORIZATION"
  | "VALIDATION"
  | "TRANSIENT"
  | "TIMEOUT"
  | "PROVIDER";

export interface ProviderErrorOptions {
  providerId: string;
  operation?: string;
  category?: ProviderFailureCategory;
  statusCode?: number;
  retryable?: boolean;
  cause?: unknown;
  /** Provider/HTTP error body snippet, when available. */
  detail?: string;
  /** Provider-native error identifiers when the adapter can recover them. */
  providerErrorCode?: string;
  providerErrorType?: string;
  transportDiagnostic?: string;
  transportPhase?: string;
  safeCauseCode?: string;
  providerReceiptStatus?: "UNKNOWN";
}

export class ProviderError extends Error {
  readonly providerId: string;
  readonly operation?: string;
  readonly category: ProviderFailureCategory;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly detail?: string;
  readonly providerErrorCode?: string;
  readonly providerErrorType?: string;
  readonly transportDiagnostic?: string;
  readonly transportPhase?: string;
  readonly safeCauseCode?: string;
  readonly providerReceiptStatus?: "UNKNOWN";

  constructor(message: string, opts: ProviderErrorOptions) {
    super(message);
    this.name = "ProviderError";
    this.providerId = opts.providerId;
    this.operation = opts.operation;
    this.category = opts.category ?? "PROVIDER";
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable ?? opts.category === "TRANSIENT";
    this.detail = opts.detail;
    this.providerErrorCode = opts.providerErrorCode;
    this.providerErrorType = opts.providerErrorType;
    this.transportDiagnostic = opts.transportDiagnostic;
    this.transportPhase = opts.transportPhase;
    this.safeCauseCode = opts.safeCauseCode;
    this.providerReceiptStatus = opts.providerReceiptStatus;
    if (opts.cause !== undefined) this.cause = opts.cause;
  }
}

/** Config missing/malformed at adapter construction time. */
export class ProviderConfigurationError extends ProviderError {
  constructor(providerId: string, message: string, opts: Omit<ProviderErrorOptions, "providerId" | "category"> = {}) {
    super(message, { ...opts, providerId, category: "CONFIGURATION", retryable: false });
    this.name = "ProviderConfigurationError";
  }
}

/** Provider rejected our credentials (401/403). */
export class ProviderAuthorizationError extends ProviderError {
  constructor(providerId: string, operation: string, message: string, statusCode?: number) {
    super(message, { providerId, operation, category: "AUTHORIZATION", statusCode, retryable: false });
    this.name = "ProviderAuthorizationError";
  }
}

/** Provider returned data that does not conform to the expected contract. */
export class ProviderValidationError extends ProviderError {
  constructor(providerId: string, operation: string, message: string, statusCode?: number, detail?: string) {
    super(message, { providerId, operation, category: "VALIDATION", statusCode, retryable: false, detail });
    this.name = "ProviderValidationError";
  }
}

/** Rate limit / 5xx / network failure — safe to retry. */
export class ProviderTransientError extends ProviderError {
  constructor(providerId: string, operation: string, message: string, statusCode?: number) {
    super(message, { providerId, operation, category: "TRANSIENT", statusCode, retryable: true });
    this.name = "ProviderTransientError";
  }
}

/** The provider did not respond within the configured timeout. */
export class ProviderTimeoutError extends ProviderError {
  constructor(providerId: string, operation: string, message: string) {
    super(message, { providerId, operation, category: "TIMEOUT", retryable: true });
    this.name = "ProviderTimeoutError";
  }
}

/**
 * The side-effecting submission may have reached the provider, but the client
 * timed out before receiving an acknowledgement/job id. This is deliberately
 * not retryable: a fresh POST could create a duplicate paid job.
 */
export class SubmissionOutcomeUnknownError extends ProviderError {
  readonly reconciliationRequired = true;
  readonly providerAccepted = "unknown" as const;

  constructor(providerId: string, operation: string, message: string, opts: Pick<ProviderErrorOptions, "cause" | "transportDiagnostic" | "transportPhase" | "safeCauseCode"> = {}) {
    super(message, { ...opts, providerId, operation, category: "TIMEOUT", retryable: false, providerReceiptStatus: "UNKNOWN" });
    this.name = "SubmissionOutcomeUnknownError";
  }
}

/** Catch-all provider failure (non-classified). */
export function providerError(
  providerId: string,
  operation: string,
  message: string,
  opts: Omit<ProviderErrorOptions, "providerId" | "operation"> = {},
): ProviderError {
  return new ProviderError(message, { ...opts, providerId, operation });
}

export function providerConfigError(providerId: string, message: string): ProviderConfigurationError {
  return new ProviderConfigurationError(providerId, message);
}

export function providerAuthError(providerId: string, operation: string, message: string, statusCode?: number): ProviderAuthorizationError {
  return new ProviderAuthorizationError(providerId, operation, message, statusCode);
}

export function providerValidationError(providerId: string, operation: string, message: string, statusCode?: number, detail?: string): ProviderValidationError {
  return new ProviderValidationError(providerId, operation, message, statusCode, detail);
}

export function providerTransientError(providerId: string, operation: string, message: string, statusCode?: number): ProviderTransientError {
  return new ProviderTransientError(providerId, operation, message, statusCode);
}

export function providerTimeoutError(providerId: string, operation: string, message: string): ProviderTimeoutError {
  return new ProviderTimeoutError(providerId, operation, message);
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/** Structured Google-style error cause ({error:{code,message,errors[]}}). */
export interface GoogleErrorCause {
  readonly code?: number;
  readonly message?: string;
  readonly reason?: string;
  readonly domain?: string;
}

/**
 * Bounded secret redaction for provider error text. Replaces token-like
 * material with [REDACTED]; everything else passes through untouched.
 */
export function redactSecretText(text: string): string {
  return String(text)
    .replace(/ya29\.[\w\-.~]*/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/=]+/g, "Bearer [REDACTED]")
    .replace(/"(access_token|refresh_token|client_secret|id_token)"\s*:\s*"[^"]*"/g, '"$1":"[REDACTED]"')
    .replace(/(refresh_token|client_secret|access_token)\s*=\s*[^\s&;]+/g, "$1=[REDACTED]");
}

/** Extract a Google-style error cause from a response body, if present. */
export function parseGoogleErrorCause(bodyText: string): GoogleErrorCause | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(bodyText));
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
  const err = (parsed as Record<string, unknown>).error;
  if (typeof err !== "object" || err === null || Array.isArray(err)) return undefined;
  const rec = err as Record<string, unknown>;
  const first = Array.isArray(rec.errors) && rec.errors.length > 0 &&
    typeof rec.errors[0] === "object" && rec.errors[0] !== null
    ? (rec.errors[0] as Record<string, unknown>)
    : null;
  const cause: { code?: number; message?: string; reason?: string; domain?: string } = {};
  if (typeof rec.code === "number") cause.code = rec.code;
  if (typeof rec.message === "string") cause.message = rec.message;
  if (first !== null) {
    if (typeof first.reason === "string") cause.reason = first.reason;
    if (typeof first.domain === "string") cause.domain = first.domain;
    if (typeof first.message === "string" && cause.message === undefined) cause.message = first.message;
  }
  if (cause.code === undefined && cause.message === undefined && cause.reason === undefined && cause.domain === undefined) {
    return undefined;
  }
  return cause;
}

/**
 * Attach a sanitized Google error cause to an already-classified provider
 * error. Classification, category, and retryability are NEVER changed here:
 * diagnostics only. Secrets are redacted before anything is stored.
 */
export function attachGoogleCause(error: ProviderError, bodyText: string): ProviderError {
  const cause = parseGoogleErrorCause(bodyText);
  if (!cause) return error;
  const mutable = error as { -readonly [K in "providerErrorCode" | "providerErrorType" | "detail"]?: string };
  if (cause.reason !== undefined) mutable.providerErrorCode = cause.reason.slice(0, 120);
  if (cause.domain !== undefined) mutable.providerErrorType = cause.domain.slice(0, 120);
  const summary = redactSecretText(
    [cause.reason, cause.message].filter((s): s is string => typeof s === "string" && s.length > 0).join(": "),
  ).slice(0, 500);
  if (summary.length > 0 && mutable.detail === undefined) mutable.detail = summary;
  return error;
}
