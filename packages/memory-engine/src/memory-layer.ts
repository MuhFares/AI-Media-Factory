/**
 * BaseMemory abstraction — the unified interface for all memory implementations.
 * Provides a simplified, provider-agnostic interface for memory operations.
 */

import type {
  AgentId,
  MemoryId,
  MemoryType,
  Timestamp,
  Json,
} from "./core/common.js";

import type { MemoryRecord } from "./core/record.js";
import type { MemoryQuery, RetrievalResult, WriteResult } from "./core/query.js";
import type { MemoryPatch, ArchiveReport, CompressionReport, ExpirationReport } from "./core/engine.js";

/** Configuration for a memory namespace. */
export interface NamespaceConfig {
  type: MemoryType;
  ttlDays?: number;
  maxRecords?: number;
  enableCompression?: boolean;
}

/** Memory event for observability. */
export interface MemoryEvent {
  type: "save" | "retrieve" | "update" | "delete" | "clear" | "search" | "archive" | "compress" | "expire";
  namespace: string;
  recordId?: MemoryId;
  timestamp: Timestamp;
  durationMs: number;
  success: boolean;
  error?: string;
}

/** BaseMemory abstract class — all memory implementations extend this. */
export abstract class BaseMemory {
  protected readonly namespace: string;
  protected readonly config: NamespaceConfig;

  constructor(namespace: string, config: NamespaceConfig) {
    this.namespace = namespace;
    this.config = config;
  }

  /** Get the namespace this memory operates in. */
  getNamespace(): string {
    return this.namespace;
  }

  /** Get the memory type for this namespace. */
  getType(): MemoryType {
    return this.config.type;
  }

  /** Store a record. */
  abstract save(record: MemoryRecord): Promise<WriteResult>;

  /** Retrieve records matching a query. */
  abstract retrieve(query: MemoryQuery): Promise<RetrievalResult>;

  /** Search records (alias for retrieve with hybrid mode). */
  abstract search(query: MemoryQuery): Promise<RetrievalResult>;

  /** Update a record by superseding it. */
  abstract update(id: MemoryId, patch: MemoryPatch): Promise<WriteResult>;

  /** Delete a record. */
  abstract delete(id: MemoryId, reason: string): Promise<void>;

  /** Clear all records in this namespace. */
  abstract clear(): Promise<void>;

  /** Get a single record by ID. */
  abstract get(id: MemoryId): Promise<MemoryRecord | null>;

  /** Check if a record exists. */
  abstract has(id: MemoryId): Promise<boolean>;

  /** Archive aged records. */
  abstract archive(olderThan: Timestamp): Promise<ArchiveReport>;

  /** Compress records. */
  abstract compress(olderThan: Timestamp): Promise<CompressionReport>;

  /** Expire records. */
  abstract expire(asOf: Timestamp): Promise<ExpirationReport>;

  /** Get statistics for this namespace. */
  abstract stats(): Promise<MemoryStats>;

  /** Health check. */
  abstract health(): Promise<MemoryHealth>;
}

/** Memory statistics. */
export interface MemoryStats {
  namespace: string;
  type: MemoryType;
  recordCount: number;
  totalSizeBytes: number;
  oldestRecord?: Timestamp;
  newestRecord?: Timestamp;
}

/** Memory health status. */
export interface MemoryHealth {
  healthy: boolean;
  details?: string;
  lastCheck: Timestamp;
}

/** Conversation Memory — per-turn, ephemeral. */
export interface ConversationMemory extends BaseMemory {
  /** Add a message to the conversation. */
  addMessage(role: "user" | "assistant" | "system", content: string, metadata?: Json): Promise<WriteResult>;

  /** Get conversation history. */
  getHistory(limit?: number): Promise<MemoryRecord[]>;

  /** Clear conversation history. */
  clearHistory(): Promise<void>;
}

/** Session Memory — per-workflow, ephemeral with distillation. */
export interface SessionMemory extends BaseMemory {
  /** Append a record to a workflow run. */
  appendToRun(workflowId: string, record: MemoryRecord): Promise<WriteResult>;

  /** Get all records for a workflow run. */
  getRun(workflowId: string): Promise<MemoryRecord[]>;

  /** Distill a run into durable takeaways. */
  distill(workflowId: string): Promise<MemoryRecord[]>;
}

/** Workspace Memory — shared across agents, durable. */
export interface WorkspaceMemory extends BaseMemory {
  /** Save a workspace document. */
  saveDocument(key: string, content: Json, metadata?: Json): Promise<WriteResult>;

  /** Get a workspace document. */
  getDocument(key: string): Promise<MemoryRecord | null>;

  /** List workspace documents. */
  listDocuments(): Promise<string[]>;
}

/** Memory Factory — creates and manages memory instances. */
export interface MemoryFactory {
  /** Create a conversation memory. */
  createConversation(namespace: string, config?: Partial<NamespaceConfig>): ConversationMemory;

  /** Create a session memory. */
  createSession(namespace: string, config?: Partial<NamespaceConfig>): SessionMemory;

  /** Create a workspace memory. */
  createWorkspace(namespace: string, config?: Partial<NamespaceConfig>): WorkspaceMemory;

  /** Create a generic memory. */
  create(namespace: string, config: NamespaceConfig): BaseMemory;

  /** Get or create a memory instance. */
  get(namespace: string): BaseMemory | undefined;

  /** Register a custom memory implementation. */
  register(type: string, factory: () => BaseMemory): void;

  /** List all registered memory types. */
  listTypes(): string[];

  /** Shutdown all memory instances. */
  shutdown(): Promise<void>;
}