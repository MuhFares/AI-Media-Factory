/**
 * Base store contract that every memory-type store implements.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The MemoryEngine facade routes each scoped operation to the matching store.
 * Per-type stores add only what their type needs; the base defines the shared
 * persistence surface and the durability rules the engine enforces.
 */

import type { Durability, MemoryId, MemoryType, Timestamp } from "../core/common";
import type { MemoryRecord } from "../core/record";
import type { Json } from "../core/common";

export interface MemoryStore {
  readonly type: MemoryType;
  readonly durability: Durability;

  put(record: MemoryRecord): Promise<void>;
  get(id: MemoryId): Promise<MemoryRecord | null>;
  /** Structured/filtered fetch (semantic/vector/graph live in retrieval/). */
  query(filter: Json, limit: number): Promise<MemoryRecord[]>;

  /** Supersede a record with a new version (append-only history). */
  supersede(oldId: MemoryId, next: MemoryRecord): Promise<void>;

  /** Policy-gated: permanent stores reject this. */
  remove(id: MemoryId, reason: string): Promise<void>;

  /** Expire ephemeral/rolling records as of a cutoff (permanent stores no-op). */
  expireBefore(cutoff: Timestamp): Promise<number>;
}
