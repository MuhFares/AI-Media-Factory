/**
 * Expiration policy (req #9).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * By type: Session ~30d (after distillation), raw Analytics ~90d hot window,
 * Trend fast decay, Short-term at turn end. Permanent types (Company/Decision/
 * Lessons) NEVER expire — marked/superseded, retained for audit.
 */

import type { Durability, MemoryType, Timestamp } from "../core/common.js";

export interface RetentionRule {
  type: MemoryType;
  durability: Durability;
  /** Days to retain in the hot store; null = never expires. */
  hotRetentionDays: number | null;
  /** Must durable residue be promoted before expiry? */
  promoteBeforeExpire: boolean;
}

export interface ExpirationPolicy {
  ruleFor(type: MemoryType): RetentionRule;
  /** Records eligible to expire as of a cutoff (permanent types return none). */
  isExpired(type: MemoryType, createdAt: Timestamp, asOf: Timestamp): boolean;
}
