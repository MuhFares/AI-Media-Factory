/**
 * Agent Memory store (req #19). Per-agent long-term (durable) + short-term (ephemeral).
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: each agent (single-writer). Short-term clears at turn end.
 */

import type { MemoryStore } from "./memory-store.js";
import type { MemoryRecord } from "../core/record.js";
import type { AgentId, Uuid } from "../core/common.js";

export interface AgentStore extends MemoryStore {
  /** Durable takeaways for an agent (append/supersede). */
  saveLongTerm(agent: AgentId, records: MemoryRecord[]): Promise<void>;
  longTerm(agent: AgentId): Promise<MemoryRecord[]>;
  /** Open/close per-turn scratch memory. */
  openShortTerm(agent: AgentId, turnId: Uuid): Promise<void>;
  clearShortTerm(agent: AgentId, turnId: Uuid): Promise<void>;
}
