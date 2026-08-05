/**
 * Local type definitions for @ai-media-factory/memory-engine
 * Used when the package is not yet built.
 */

export type MemoryId = string;
export type MemoryType = "short_term" | "long_term" | "company" | "decision" | "lessons" | "workflow" | "analytics" | "agent";
export type Timestamp = string;

export interface MemoryRecord {
  id: MemoryId;
  type: MemoryType;
  body: unknown;
  confidence: number;
  provenance: {
    source: string;
    agent?: string;
    timestamp: Timestamp;
  };
  version: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface LoadedMemory {
  shortTerm: MemoryRecord[];
  longTerm: MemoryRecord[];
  company: MemoryRecord[];
  workflow: MemoryRecord[];
  lessons: MemoryRecord[];
}

export interface MemoryQuery {
  query: string;
  types?: MemoryType[];
  limit?: number;
  minConfidence?: number;
}

export interface RetrievalResult {
  records: MemoryRecord[];
  totalConfidence: number;
}

export interface WriteResult {
  id: MemoryId;
  version: number;
}

export interface ArchiveReport {
  archived: number;
  movedTo: string;
}

export interface CompressionReport {
  inputRecords: number;
  outputRecords: number;
  ratio: number;
}

export interface ExpirationReport {
  expired: number;
  promoted: number;
}

export interface MemoryPatch {
  body?: unknown;
  confidenceDelta?: number;
  reinforce?: boolean;
  reason: string;
}

export interface MemoryEngine {
  save(scope: MemoryType, record: MemoryRecord): Promise<WriteResult>;
  retrieve(query: MemoryQuery): Promise<RetrievalResult>;
  search(query: MemoryQuery): Promise<RetrievalResult>;
  update(id: MemoryId, patch: MemoryPatch): Promise<WriteResult>;
  delete(scope: MemoryType, id: MemoryId, reason: string): Promise<void>;
  archive(scope: MemoryType, criteria: { olderThan: Timestamp }): Promise<ArchiveReport>;
  compress(scope: MemoryType, criteria: { olderThan: Timestamp }): Promise<CompressionReport>;
  expire(scope: MemoryType, asOf: Timestamp): Promise<ExpirationReport>;
}