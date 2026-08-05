/**
 * Source attribution (req #14).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * No anonymous memory. Every record carries sources + derived_by; writes
 * without provenance are rejected by the engine. Makes the corpus auditable.
 */

import type { Provenance } from "../core/record";

export interface AttributionTracker {
  /** Reject a write that lacks valid provenance. */
  validate(provenance: Provenance): boolean;
  /** Merge provenance when corroborating memories are combined. */
  merge(a: Provenance, b: Provenance): Provenance;
}
