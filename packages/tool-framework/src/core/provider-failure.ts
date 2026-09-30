import type { ProviderFailureMetadata } from "../capabilities.js";

const SECRET_KEY = /(api[_-]?key|authorization|bearer|password|secret|cookie|token|credential|private[_-]?key|signature)/i;
const MAX_DETAIL = 2000;

function safeString(value: unknown, max = MAX_DETAIL): string | null {
  if (typeof value !== "string") return null;
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/((?:api[_-]?key|password|secret|token|cookie)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .slice(0, max);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

function safeDetail(error: Record<string, unknown>): string | null {
  const candidates = [error.detail, error.message];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const sanitized = redact(candidate);
    return typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized).slice(0, MAX_DETAIL);
  }
  if (error.providerError !== undefined) {
    const sanitized = redact(error.providerError);
    return JSON.stringify(sanitized).slice(0, MAX_DETAIL);
  }
  return null;
}

export function sanitizeProviderFailureMetadata(
  error: unknown,
  context: Partial<ProviderFailureMetadata> = {},
): ProviderFailureMetadata | null {
  if (error === null || typeof error !== "object") return null;
  const source = error as Record<string, unknown>;
  const numberOrNull = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  const stringOrNull = (value: unknown): string | null => safeString(value);
  const metadata: ProviderFailureMetadata = {
    httpStatus: numberOrNull(source.statusCode ?? source.httpStatus ?? context.httpStatus),
    providerErrorCode: stringOrNull(source.providerErrorCode ?? source.errorCode ?? source.code ?? context.providerErrorCode),
    providerErrorType: stringOrNull(source.providerErrorType ?? source.errorType ?? source.type ?? context.providerErrorType),
    detail: safeDetail(source) ?? context.detail ?? null,
    retryable: typeof source.retryable === "boolean" ? source.retryable : context.retryable ?? null,
    classification: stringOrNull(source.category ?? source.classification ?? context.classification),
    provider: stringOrNull(source.providerId ?? context.provider),
    model: stringOrNull(source.model ?? context.model),
    capability: stringOrNull(context.capability),
    executionId: stringOrNull(context.executionId),
    attemptNumber: numberOrNull(context.attemptNumber),
    latencyMs: numberOrNull(context.latencyMs),
    costKind: stringOrNull(context.costKind),
    errorName: stringOrNull(source.name ?? context.errorName),
    safeCauseCode: stringOrNull(source.safeCauseCode ?? context.safeCauseCode),
    transportDiagnostic: stringOrNull(source.transportDiagnostic ?? context.transportDiagnostic),
    transportPhase: stringOrNull(source.transportPhase ?? context.transportPhase),
    providerReceiptStatus: (source.providerReceiptStatus ?? context.providerReceiptStatus) === "UNKNOWN" ? "UNKNOWN" : null,
  };
  const useful = Object.entries(metadata).some(([key, value]) => key !== "detail" && value !== null) || metadata.detail !== null;
  return useful ? metadata : null;
}
