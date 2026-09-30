export type VisualCostConfidence = "EXACT" | "PROVIDER_REPORTED" | "COMPUTE_DERIVED" | "ESTIMATED_FROM_ACTIVE_RUNTIME" | "ESTIMATED_FROM_REQUEST_LATENCY" | "UNKNOWN";

export interface VisualCostInput {
  usdPerGpuHour: number;
  billableGpuSeconds?: number;
  activeRuntimeSeconds?: number;
  requestLatencySeconds?: number;
  providerReportedCostUsd?: number;
}

export interface VisualCostResult {
  amountUsd: number | null;
  confidence: VisualCostConfidence;
  source: string;
  durationSeconds: number | null;
  durationType: "billable_gpu_seconds" | "worker_active_seconds" | "request_latency_seconds" | "none";
  formula: string | null;
}

/** Prefer provider/billing evidence; wall-clock latency is explicitly only an estimate. */
export function calculateVisualCost(input: VisualCostInput): VisualCostResult {
  if (typeof input.providerReportedCostUsd === "number" && Number.isFinite(input.providerReportedCostUsd) && input.providerReportedCostUsd >= 0) {
    return { amountUsd: input.providerReportedCostUsd, confidence: "PROVIDER_REPORTED", source: "provider_response", durationSeconds: null, durationType: "none", formula: null };
  }
  if (!Number.isFinite(input.usdPerGpuHour) || input.usdPerGpuHour < 0) return { amountUsd: null, confidence: "UNKNOWN", source: "invalid_rate", durationSeconds: null, durationType: "none", formula: null };
  const candidates: readonly [number | undefined, VisualCostConfidence, VisualCostResult["durationType"]][] = [
    [input.billableGpuSeconds, "COMPUTE_DERIVED", "billable_gpu_seconds"],
    [input.activeRuntimeSeconds, "ESTIMATED_FROM_ACTIVE_RUNTIME", "worker_active_seconds"],
    [input.requestLatencySeconds, "ESTIMATED_FROM_REQUEST_LATENCY", "request_latency_seconds"],
  ];
  for (const [seconds, confidence, durationType] of candidates) {
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) return { amountUsd: seconds * input.usdPerGpuHour / 3600, confidence, source: durationType, durationSeconds: seconds, durationType, formula: "billable_gpu_seconds × usd_per_gpu_hour / 3600 (duration proxy is explicitly labeled)" };
  }
  return { amountUsd: null, confidence: "UNKNOWN", source: "no defensible duration or provider cost", durationSeconds: null, durationType: "none", formula: null };
}
