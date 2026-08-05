/**
 * Analytics Memory store (req #20). Rolling (hot) + archived (cold).
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: Analytics. Raw expires (90-day hot window); aggregates persist.
 */

import type { MemoryStore } from "./memory-store.js";
import type { MemoryRecord } from "../core/record.js";
import type { Timestamp } from "../core/common.js";

export interface AnalyticsStore extends MemoryStore {
  /** Append attributed performance/metric memory. */
  record(entry: MemoryRecord): Promise<void>;
  /** Rolling aggregates over a window (persist beyond raw expiry). */
  aggregate(metric: string, window: { from: Timestamp; to: Timestamp }): Promise<MemoryRecord[]>;
  /** Compact raw records into aggregates before they expire. */
  compactRaw(cutoff: Timestamp): Promise<number>;
}
