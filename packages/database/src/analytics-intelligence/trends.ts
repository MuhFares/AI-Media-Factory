/**
 * Program 4 — deterministic trend detection with documented rules.
 * Rule: split the series into first-half and second-half means; a shift
 * of at least 10% sustained across at least 3 points is UP/DOWN, else
 * FLAT. Fewer than 3 finite points is INSUFFICIENT_DATA. No hidden
 * heuristics; the rule travels with every verdict.
 */
export type TrendState = "UP" | "DOWN" | "FLAT" | "INSUFFICIENT_DATA";

export interface TrendResult {
  readonly state: TrendState;
  readonly rule: string;
  readonly detail: string;
}

export const TREND_RULE =
  "first-half mean vs second-half mean; >=10% shift over >=3 points is UP/DOWN, else FLAT";

export function trendOf(values: readonly unknown[]): TrendResult {
  const finite = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (finite.length < 3) {
    return { state: "INSUFFICIENT_DATA", rule: TREND_RULE, detail: `only ${finite.length} finite point(s), need 3` };
  }
  const half = Math.floor(finite.length / 2);
  const first = finite.slice(0, half);
  const second = finite.slice(half);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = mean(first);
  const b = mean(second);
  if (a === 0) {
    return { state: "INSUFFICIENT_DATA", rule: TREND_RULE, detail: "zero baseline cannot anchor a trend" };
  }
  const shift = (b - a) / Math.abs(a);
  if (shift >= 0.10) return { state: "UP", rule: TREND_RULE, detail: `+${(shift * 100).toFixed(1)}% second-half shift` };
  if (shift <= -0.10) return { state: "DOWN", rule: TREND_RULE, detail: `${(shift * 100).toFixed(1)}% second-half shift` };
  return { state: "FLAT", rule: TREND_RULE, detail: `${(shift * 100).toFixed(1)}% shift within band` };
}
