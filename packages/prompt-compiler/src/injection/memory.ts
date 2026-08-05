/**
 * Dynamic Memory Injection (Req #7).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Injects relevant memory retrieved from the Memory Engine into the prompt.
 * Uses the MemoryEngine.retrieve() results (LoadedMemory).
 */

import type { LoadedMemory } from "../../memory-engine/src/core/record";
import type { MemoryQuery } from "../../memory-engine/src/core/query";

export interface DynamicMemoryInjector {
  /** Inject relevant memory into the prompt. */
  inject(memory: LoadedMemory, options?: InjectionOptions): Promise<string>;
}

export interface InjectionOptions {
  /** Maximum number of memory records to include. */
  maxRecords?: number;
  /** Minimum confidence threshold (0..1). */
  minConfidence?: number;
  /** Format template for each record. */
  format?: "compact" | "detailed" | "raw";
  /** Filter by memory type. */
  types?: string[];
}

export interface MemoryInjectionResult {
  content: string;
  recordsIncluded: number;
  totalAvailable: number;
  tokens: number;
  truncated: boolean;
}