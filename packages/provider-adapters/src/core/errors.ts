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
}

export class ProviderError extends Error {
  readonly providerId: string;
  readonly operation?: string;
  readonly category: ProviderFailureCategory;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly detail?: string;

  constructor(message: string, opts: ProviderErrorOptions) {
    super(message);
    this.name = "ProviderError";
    this.providerId = opts.providerId;
    this.operation = opts.operation;
    this.category = opts.category ?? "PROVIDER";
    this.statusCode = opts.statusCode;
    this.retryable = opts.retryable ?? opts.category === "TRANSIENT";
    this.detail = opts.detail;
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
  constructor(providerId: string, operation: string, message: string, statusCode?: number) {
    super(message, { providerId, operation, category: "VALIDATION", statusCode, retryable: false });
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

export function providerValidationError(providerId: string, operation: string, message: string, statusCode?: number): ProviderValidationError {
  return new ProviderValidationError(providerId, operation, message, statusCode);
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