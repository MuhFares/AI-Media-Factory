export type NormalizedTechnicalQaState = "PASSED" | "FAILED" | "UNKNOWN" | "MALFORMED";

export interface NormalizedTechnicalQa {
  state: NormalizedTechnicalQaState;
  passed: boolean;
  sourceField: "verdict" | "status" | "none" | "conflict";
  sourceValue: string | null;
  reason: string;
}

/** Normalize historical QA payloads without changing their stored form. */
export function normalizeFinalTechnicalQa(payload: unknown): NormalizedTechnicalQa {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return { state: "MALFORMED", passed: false, sourceField: "none", sourceValue: null, reason: "QA payload is not an object" };
  }
  const record = payload as Record<string, unknown>;
  const verdict = typeof record.verdict === "string" ? record.verdict.trim().toUpperCase() : null;
  const status = typeof record.status === "string" ? record.status.trim().toLowerCase() : null;
  const verdictState = verdict === "PASS" ? "PASSED" : verdict === "FAIL" ? "FAILED" : null;
  const statusState = status === "passed" ? "PASSED" : status === "failed" ? "FAILED" : null;

  if (verdictState !== null && statusState !== null && verdictState !== statusState) {
    return { state: "MALFORMED", passed: false, sourceField: "conflict", sourceValue: `${verdict}/${status}`, reason: "QA verdict and status conflict" };
  }
  if (verdictState !== null) {
    return { state: verdictState, passed: verdictState === "PASSED", sourceField: "verdict", sourceValue: verdict, reason: `Normalized legacy verdict ${verdict}` };
  }
  if (statusState !== null) {
    return { state: statusState, passed: statusState === "PASSED", sourceField: "status", sourceValue: status, reason: `Normalized status ${status}` };
  }
  if (record.verdict !== undefined || record.status !== undefined) {
    return { state: "UNKNOWN", passed: false, sourceField: record.verdict !== undefined ? "verdict" : "status", sourceValue: String(record.verdict ?? record.status), reason: "QA result is not a recognized terminal value" };
  }
  return { state: "UNKNOWN", passed: false, sourceField: "none", sourceValue: null, reason: "QA payload has no verdict or status" };
}
