/**
 * Runtime <-> memory-engine binding.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The canonical memory contracts live in `@ai-media-factory/memory-engine`.
 * The runtime does NOT redefine them (that duplication has been removed). This
 * module re-exports the canonical types the runtime uses and names the memory
 * access surface the runtime binds to.
 *
 * Agents never touch memory directly — the runtime obtains LoadedMemory for a
 * turn via the MemoryEngine.retrieve() and persists takeaways via save().
 */

import type { MemoryEngine } from "@ai-media-factory/memory-engine";

/** Canonical memory contracts, re-exported for the runtime's internal use. */
export type {
  MemoryRecord,
  LoadedMemory,
  MemoryType,
  MemoryEngine,
  MemoryQuery,
  RetrievalResult,
  WriteResult,
} from "@ai-media-factory/memory-engine";

/**
 * The runtime's memory access is the MemoryEngine facade itself — there is no
 * separate runtime "MemoryStore". This alias documents that binding: wherever
 * the runtime pipeline needs memory, it uses the engine.
 */
export type MemoryAccess = MemoryEngine;
