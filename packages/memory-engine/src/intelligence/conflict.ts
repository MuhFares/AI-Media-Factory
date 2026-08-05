/**
 * Conflict resolution (req #15).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Different scope → both valid (scoped). Same scope → prefer newer/higher
 * confidence, mark loser superseded_by. High-stakes ties → escalate + experiment.
 * Never a silent overwrite.
 */

import type { MemoryRecord } from "../core/record.js";

export type ConflictResolution =
  | { kind: "not_conflict"; reason: "different_scope" }
  | { kind: "supersede"; winner: string; loser: string }
  | { kind: "escalate"; reason: string }; // to CEO + run an experiment

export interface ConflictResolver {
  /** Do two records conflict, and if so how is it resolved? */
  resolve(a: MemoryRecord, b: MemoryRecord): ConflictResolution;
}
