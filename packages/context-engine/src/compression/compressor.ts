/**
 * Context Compression (Req #3).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { MemoryRecord } from "../selection/selector";

export interface Summary {
  sourceIds: string[];
  summary: string;
  tokens: number;
  confidence: number;
}

export interface CompressionResult {
  compressedPackage: any;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  compressedSections: string[];
  summariesGenerated: Summary[];
}

export interface ContextCompressor {
  compress(pkg: any, budget: TokenBudget): Promise<CompressionResult>;
}

export interface CompressionOptions {
  strategy: "deduplicate" | "summarize" | "trim_examples" | "trim_memory" | "truncate_context";
  targetReduction: number; // 0..1
  preserveSections: string[];
}

export interface Summary {
  sourceIds: string[];
  summary: string;
  tokens: number;
  confidence: number;
}