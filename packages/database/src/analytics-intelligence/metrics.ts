/**
 * Program 4 — canonical metric registry.
 * Every metric declares unit, kind, aggregation, platform applicability,
 * and business meaning. Providers that do not expose a metric simply
 * never produce it: absent stays absent, never zero.
 */
export type MetricKind = "COUNT" | "DURATION" | "RATE" | "CURRENCY" | "RATIO";
export type MetricAggregation = "sum" | "mean" | "latest";

export interface MetricDefinition {
  readonly name: string;
  readonly providerNativeName: string | null;
  readonly unit: string;
  readonly kind: MetricKind;
  readonly aggregation: MetricAggregation;
  readonly platforms: readonly string[];
  readonly meaning: string;
}

export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  { name: "views", providerNativeName: "views", unit: "views", kind: "COUNT", aggregation: "sum", platforms: ["youtube"], meaning: "playback starts counted by the provider" },
  { name: "likes", providerNativeName: "likes", unit: "likes", kind: "COUNT", aggregation: "sum", platforms: ["youtube"], meaning: "positive ratings counted by the provider" },
  { name: "comments", providerNativeName: "comments", unit: "comments", kind: "COUNT", aggregation: "sum", platforms: ["youtube"], meaning: "comment events counted by the provider" },
  { name: "shares", providerNativeName: "shares", unit: "shares", kind: "COUNT", aggregation: "sum", platforms: ["youtube"], meaning: "share events counted by the provider" },
  { name: "watchTimeSeconds", providerNativeName: "estimatedMinutesWatched", unit: "seconds", kind: "DURATION", aggregation: "sum", platforms: ["youtube"], meaning: "total estimated watch time" },
  { name: "averageViewDuration", providerNativeName: "averageViewDuration", unit: "seconds", kind: "DURATION", aggregation: "mean", platforms: ["youtube"], meaning: "mean watch time per view" },
  { name: "revenue", providerNativeName: "estimatedRevenue", unit: "USD", kind: "CURRENCY", aggregation: "sum", platforms: ["youtube"], meaning: "estimated revenue; requires monetary authorization, excluded from validation proofs" },
  { name: "cost", providerNativeName: null, unit: "USD", kind: "CURRENCY", aggregation: "sum", platforms: ["youtube"], meaning: "authoritative provider cost where metadata exists, else UNKNOWN" },
];

const BY_NAME = new Map(METRIC_DEFINITIONS.map((m) => [m.name, m]));

export function metricDefinition(name: string): MetricDefinition | null {
  return BY_NAME.get(name) ?? null;
}

/** Future metric names may be registered here; unknown names stay unsupported, never assumed. */
export function isSupportedMetric(name: string): boolean {
  return BY_NAME.has(name);
}
