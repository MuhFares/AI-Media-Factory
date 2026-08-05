/**
 * Company Memory store (req #18). Permanent, curated truth (the Company Brain).
 * ARCHITECTURE ONLY — declarations, no logic.
 * Owner: CEO (curated). Append/supersede only — delete is refused.
 */

import type { MemoryStore } from "./memory-store.js";
import type { MemoryRecord } from "../core/record.js";

export interface CompanyStore extends MemoryStore {
  /** Curated documents of the Company Brain (mission, values, KPIs, ...). */
  document(key: string): Promise<MemoryRecord | null>;
  /** Supersede a curated document with a reviewed revision (never overwrite). */
  reviseDocument(key: string, next: MemoryRecord): Promise<void>;
}
