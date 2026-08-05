/**
 * Vector search (req #11).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { MemoryId } from "../core/common";

export type Embedding = number[];

export interface VectorHit {
  memory_id: MemoryId;
  similarity: number; // 0..1 cosine
}

/** Embeds text and finds semantically nearest memory records. */
export interface VectorIndex {
  embed(text: string): Promise<Embedding>;
  /** Nearest-neighbour search over stored memory embeddings. */
  nearest(vector: Embedding, topK: number, filter?: Record<string, string>): Promise<VectorHit[]>;
  upsert(memoryId: MemoryId, vector: Embedding): Promise<void>;
  remove(memoryId: MemoryId): Promise<void>;
}
