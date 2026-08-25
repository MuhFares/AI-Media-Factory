/**
 * HTTP transport shared by all provider adapters.
 *
 * - Every attempt enforces a per-request timeout (AbortController).
 * - Non-2xx responses are classified through an injectable classifier and
 *   thrown as typed ProviderErrors with the response body kept as `detail`.
 * - `sendHttpWithRetry` retries only failures that are safe to retry: GETs and
 *   read operations where a transient failure cannot have produced a lasting
 *   side effect. Side-effecting calls (publishing uploads, video submission)
 *   must NOT be auto-retried by the transport; the adapter decides explicitly.
 */

import {
  ProviderError,
  providerAuthError,
  providerTransientError,
  providerTimeoutError,
  providerValidationError,
  providerError,
} from "./errors.js";
import type { OperationSink } from "./observability.js";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface OutgoingHttpRequest {
  method: HttpMethod;
  url: string;
  headers?: Record<string, string>;
  /** Serialized JSON, raw text, or bytes. */
  body?: string | Uint8Array;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  text(): Promise<string>;
  json(): Promise<unknown>;
  bytes(): Promise<Uint8Array>;
}

export type HttpStatusClassifier = (status: number, providerId: string, operation: string, detail: string) => ProviderError;

export interface HttpSenderOptions {
  providerId: string;
  operation: string;
  timeoutMs: number;
  /** Per-request headers merged over the request's own headers. */
  headers?: Record<string, string>;
  classify?: HttpStatusClassifier;
  onOperation?: OperationSink;
  requestKey?: string;
  /** Include the response body snippet in `detail` — safe for non-2xx only. */
}

export interface HttpRetryOptions extends HttpSenderOptions {
  maxRetries?: number;
  retryDelayBaseMs?: number;
}

const DEFAULT_CLASSIFY: HttpStatusClassifier = (status, providerId, operation, detail) => {
  if (status === 401 || status === 403) {
    return providerAuthError(providerId, operation, `Provider rejected the request credentials (HTTP ${status})`, status);
  }
  if (status === 429) {
    return providerTransientError(providerId, operation, `Provider rate limited the request (HTTP 429)`, status);
  }
  if (status >= 500) {
    return providerTransientError(providerId, operation, `Provider returned a transient server error (HTTP ${status})`, status);
  }
  if (status >= 400 && status < 500) {
    return providerValidationError(providerId, operation, `Provider rejected the request (HTTP ${status})`, status);
  }
  return providerError(providerId, operation, `Provider returned an unexpected status (HTTP ${status})`, { statusCode: status });
};

export function isRetryable(error: unknown): boolean {
  return error instanceof ProviderError && error.retryable;
}

export async function sendHttp(req: OutgoingHttpRequest, opts: HttpSenderOptions): Promise<HttpResponse> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const headers = new Headers(req.headers ?? {});
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === "string" && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
    }
    const response = await fetch(req.url, {
      method: req.method,
      headers,
      body: req.body === undefined ? undefined : (req.body as any),
      signal: controller.signal,
      redirect: "follow",
    });
    if (response.status >= 200 && response.status < 300) {
      opts.onOperation?.({
        providerId: opts.providerId,
        operation: opts.operation,
        outcome: "success",
        latencyMs: Date.now() - startedAt,
        retryCount: 0,
        statusCode: response.status,
        requestKey: opts.requestKey,
      });
      return {
        status: response.status,
        headers: response.headers,
        text: () => response.text(),
        json: () => response.json(),
        bytes: () => response.arrayBuffer().then((b) => new Uint8Array(b)),
      };
    }
    const detailText = await response.text().catch(() => "");
    const classify = opts.classify ?? DEFAULT_CLASSIFY;
    const error = classify(response.status, opts.providerId, opts.operation, detailText);
    if (detailText.trim().length > 0 && error.detail === undefined) {
      (error as { detail?: string }).detail = detailText.slice(0, 1000);
    }
    opts.onOperation?.({
      providerId: opts.providerId,
      operation: opts.operation,
      outcome: "failure",
      latencyMs: Date.now() - startedAt,
      retryCount: 0,
      category: error.category,
      statusCode: response.status,
      requestKey: opts.requestKey,
    });
    throw error;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (controller.signal.aborted) {
      opts.onOperation?.({
        providerId: opts.providerId,
        operation: opts.operation,
        outcome: "failure",
        latencyMs: Date.now() - startedAt,
        retryCount: 0,
        category: "TIMEOUT",
        requestKey: opts.requestKey,
      });
      throw providerTimeoutError(opts.providerId, opts.operation, `Provider request timed out after ${opts.timeoutMs}ms`);
    }
    opts.onOperation?.({
      providerId: opts.providerId,
      operation: opts.operation,
      outcome: "failure",
      latencyMs: Date.now() - startedAt,
      retryCount: 0,
      category: "TRANSIENT",
      requestKey: opts.requestKey,
    });
    throw providerTransientError(
      opts.providerId,
      opts.operation,
      `Network error contacting provider: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function sendHttpWithRetry(
  req: OutgoingHttpRequest,
  opts: HttpRetryOptions,
): Promise<HttpResponse> {
  const maxRetries = opts.maxRetries ?? 0;
  let attempt = 0;
  while (true) {
    try {
      return await sendHttp(req, opts);
    } catch (error) {
      if (!isRetryable(error) || attempt >= maxRetries) throw error;
      attempt += 1;
      const base = opts.retryDelayBaseMs ?? 250;
      const backoff = Math.min(base * 2 ** (attempt - 1), 2000) + Math.floor(Math.random() * Math.min(100, base));
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}