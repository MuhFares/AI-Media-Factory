/**
 * Program 4 — deterministic KPI engine.
 * Every KPI returns either a value or an explicit status; missing inputs
 * never fabricate output. Division by zero yields INSUFFICIENT_DATA, never
 * infinity or zero.
 */
export type KpiState = "OK" | "INSUFFICIENT_DATA" | "NOT_APPLICABLE" | "NOT_YET_AVAILABLE" | "INCOMPATIBLE_WINDOW" | "UNSUPPORTED_METRIC";

export interface KpiResult {
  readonly name: string;
  readonly state: KpiState;
  readonly value: number | null;
  readonly reason: string;
}

const num = (v: unknown): number | null =>
  (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface KpiInputs {
  readonly views?: unknown;
  readonly likes?: unknown;
  readonly comments?: unknown;
  readonly shares?: unknown;
  readonly watchTimeSeconds?: unknown;
  readonly averageViewDuration?: unknown;
  readonly contentDurationMs?: unknown;
  readonly windowDays?: unknown;
}

function need(value: number | null, metric: string): { ok: true; value: number } | { ok: false; result: KpiResult } {
  if (value === null) {
    return { ok: false, result: { name: "", state: "INSUFFICIENT_DATA", value: null, reason: `metric ${metric} missing` } };
  }
  return { ok: true, value };
}

/** likes + comments + shares. All three required; none defaulted. */
export function engagementInteractions(m: KpiInputs): KpiResult {
  const parts = [need(num(m.likes), "likes"), need(num(m.comments), "comments"), need(num(m.shares), "shares")];
  for (const p of parts) {
    if (!p.ok) return { ...p.result, name: "engagementInteractions" };
  }
  const values = parts.filter((p): p is { ok: true; value: number } => p.ok).map((p) => p.value);
  return { name: "engagementInteractions", state: "OK", value: values.reduce((a, b) => a + b, 0), reason: "likes + comments + shares" };
}

/** engagement interactions / views. Views of zero with nonzero engagement is data-incoherent: INSUFFICIENT_DATA. */
export function engagementRate(m: KpiInputs): KpiResult {
  const views = num(m.views);
  if (views === null) return { name: "engagementRate", state: "INSUFFICIENT_DATA", value: null, reason: "metric views missing" };
  if (views === 0) {
    const inter = engagementInteractions(m);
    if (inter.state === "OK" && (inter.value ?? 0) > 0) {
      return { name: "engagementRate", state: "INSUFFICIENT_DATA", value: null, reason: "views=0 with nonzero engagement is incoherent provider data" };
    }
    return { name: "engagementRate", state: "OK", value: 0, reason: "no views and no engagement" };
  }
  const inter = engagementInteractions(m);
  if (inter.state !== "OK") return { ...inter, name: "engagementRate" };
  return { name: "engagementRate", state: "OK", value: (inter.value ?? 0) / views, reason: "engagement interactions / views" };
}

/** averageViewDuration / content duration. Requires a known content duration. */
export function averageWatchPercentage(m: KpiInputs): KpiResult {
  const avg = num(m.averageViewDuration);
  const durMs = num(m.contentDurationMs);
  if (avg === null) return { name: "averageWatchPercentage", state: "INSUFFICIENT_DATA", value: null, reason: "metric averageViewDuration missing" };
  if (durMs === null || durMs <= 0) {
    return { name: "averageWatchPercentage", state: "NOT_APPLICABLE", value: null, reason: "content duration unknown" };
  }
  return { name: "averageWatchPercentage", state: "OK", value: avg / (durMs / 1000), reason: "averageViewDuration / content duration" };
}

/** views per day over a compatible window. Requires windowDays > 0. */
export function viewsPerDay(m: KpiInputs): KpiResult {
  const views = num(m.views);
  const days = num(m.windowDays);
  if (views === null) return { name: "viewsPerDay", state: "INSUFFICIENT_DATA", value: null, reason: "metric views missing" };
  if (days === null || days <= 0) {
    return { name: "viewsPerDay", state: "INCOMPATIBLE_WINDOW", value: null, reason: "windowDays missing or non-positive" };
  }
  return { name: "viewsPerDay", state: "OK", value: views / days, reason: `views / ${days}d window` };
}

/** Relative growth between two comparable windowed values. */
export function windowGrowth(earlier: unknown, later: unknown): KpiResult {
  const a = num(earlier);
  const b = num(later);
  if (a === null || b === null) {
    return { name: "windowGrowth", state: "INSUFFICIENT_DATA", value: null, reason: "one or both window values missing" };
  }
  if (a === 0) {
    return { name: "windowGrowth", state: "INSUFFICIENT_DATA", value: null, reason: "zero baseline cannot anchor growth" };
  }
  return { name: "windowGrowth", state: "OK", value: (b - a) / a, reason: "(later - earlier) / earlier" };
}

/** Compute the standard KPI set; every entry always present with a state. */
export function computeKpis(m: KpiInputs): KpiResult[] {
  return [engagementInteractions(m), engagementRate(m), averageWatchPercentage(m), viewsPerDay(m)];
}
