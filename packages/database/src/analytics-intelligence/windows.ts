/**
 * Program 4 — measurement windows as first-class values.
 * Comparisons require explicitly compatible windows; anything else is
 * labeled, never silently merged.
 */
export interface MeasurementWindow {
  readonly label: string;
  readonly windowDays: number | null;
  readonly windowStart: string | null;
  readonly windowEnd: string | null;
  readonly provenance: string | null;
  readonly platform: string | null;
}

export type WindowCompatibility =
  | "COMPATIBLE"
  | "INCOMPATIBLE_WINDOW"
  | "INCOMPATIBLE_PROVENANCE"
  | "INCOMPATIBLE_PLATFORM"
  | "UNKNOWN";

/** Windows compare iff same day-count, same provenance class, same platform. */
export function windowsCompatible(a: MeasurementWindow, b: MeasurementWindow): WindowCompatibility {
  if (a.windowDays === null || b.windowDays === null) return "UNKNOWN";
  if (a.platform !== null && b.platform !== null && a.platform !== b.platform) return "INCOMPATIBLE_PLATFORM";
  if (a.provenance !== null && b.provenance !== null && a.provenance !== b.provenance) {
    return "INCOMPATIBLE_PROVENANCE";
  }
  if (a.windowDays !== b.windowDays) return "INCOMPATIBLE_WINDOW";
  return "COMPATIBLE";
}

/** Canonical schedule labels stay advisory; measurement evidence decides. */
export const KNOWN_SCHEDULES: readonly string[] = ["T+24h", "T+72h", "T+7d", "T+30d", "custom"];
