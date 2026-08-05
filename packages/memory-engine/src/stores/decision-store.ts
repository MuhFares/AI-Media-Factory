/**
 * Decision Memory store (req #21). Permanent, append-only decision ledger.
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: CEO. Delete refused; a decision's Result is filled in later (supersede).
 */

import type { MemoryStore } from "./memory-store.js";
import type { MemoryRecord } from "../core/record.js";
import type { MemoryId } from "../core/common.js";

export interface DecisionStore extends MemoryStore {
  /** Record a one-way-door decision (context, gates, RICE, decision). */
  recordDecision(decision: MemoryRecord): Promise<void>;
  /** Fill in the measured Result later (turns a decision into a lesson). */
  attachResult(decisionId: MemoryId, result: MemoryRecord): Promise<void>;
  /** Retrieve prior decisions for comparison/audit. */
  ledger(filter: { subject?: string }): Promise<MemoryRecord[]>;
}
