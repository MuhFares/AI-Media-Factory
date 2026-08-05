/**
 * Lessons Learned store (req #16). Permanent lessons corpus.
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: CEO + all agents. Append/supersede; linked to evidence in the graph.
 */

import type { MemoryStore } from "./memory-store";
import type { MemoryRecord } from "../core/record";

export interface LessonsStore extends MemoryStore {
  /** Persist a validated lesson (claim + evidence + scope + confidence). */
  promote(lesson: MemoryRecord): Promise<void>;
  /** Lessons applicable to a topic/brand/agent (for retrieval-before-acting). */
  applicable(scope: { topic?: string; brand?: string; agent?: string }): Promise<MemoryRecord[]>;
}
