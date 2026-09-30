/**
 * Program 4 — reusable comparison semantics with evidence quality.
 * Every comparison explains WHY it holds or fails; incompatible evidence
 * never produces a winner.
 */
import { windowsCompatible, type MeasurementWindow } from "./windows.js";

export type ComparisonQuality =
  | "COMPARABLE"
  | "PARTIALLY_COMPARABLE"
  | "INSUFFICIENT_DATA"
  | "INCOMPATIBLE"
  | "NOT_APPLICABLE";

export interface ComparisonInput {
  readonly labelA: string;
  readonly labelB: string;
  readonly metricA: unknown;
  readonly metricB: unknown;
  readonly windowA: MeasurementWindow | null;
  readonly windowB: MeasurementWindow | null;
}

export interface ComparisonResult {
  readonly quality: ComparisonQuality;
  readonly delta: number | null;
  readonly leader: "A" | "B" | "TIE" | null;
  readonly reason: string;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Compare two measured values under explicit window compatibility. */
export function compareEntities(input: ComparisonInput): ComparisonResult {
  if (!finite(input.metricA) || !finite(input.metricB)) {
    return {
      quality: "INSUFFICIENT_DATA", delta: null, leader: null,
      reason: `missing metric: ${!finite(input.metricA) ? input.labelA : input.labelB} has no value`,
    };
  }
  if (input.windowA && input.windowB) {
    const compat = windowsCompatible(input.windowA, input.windowB);
    if (compat === "INCOMPATIBLE_PLATFORM" || compat === "INCOMPATIBLE_PROVENANCE") {
      return {
        quality: "INCOMPATIBLE", delta: null, leader: null,
        reason: compat === "INCOMPATIBLE_PLATFORM"
          ? "different platforms cannot compare"
          : "LIVE and non-LIVE evidence are never equivalent",
      };
    }
    if (compat === "INCOMPATIBLE_WINDOW") {
      return {
        quality: "PARTIALLY_COMPARABLE", delta: input.metricB - input.metricA,
        leader: input.metricA === input.metricB ? "TIE" : input.metricA > input.metricB ? "A" : "B",
        reason: `different windows (${input.windowA.windowDays}d vs ${input.windowB.windowDays}d): direction only, magnitudes not equivalent`,
      };
    }
    if (compat === "UNKNOWN") {
      return {
        quality: "PARTIALLY_COMPARABLE", delta: input.metricB - input.metricA,
        leader: input.metricA === input.metricB ? "TIE" : input.metricA > input.metricB ? "A" : "B",
        reason: "window compatibility unknown: direction only",
      };
    }
  }
  if (input.metricA === input.metricB) {
    return { quality: "COMPARABLE", delta: 0, leader: "TIE", reason: "equal values on compatible evidence" };
  }
  return {
    quality: "COMPARABLE", delta: input.metricB - input.metricA,
    leader: input.metricA > input.metricB ? "A" : "B",
    reason: "both values present on compatible windows",
  };
}
