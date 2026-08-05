/**
 * InMemory implementation of BaseMemory.
 * Provides a simple, in-memory storage for testing and development.
 */

import type {
  AgentId,
  MemoryId,
  MemoryType,
  Timestamp,
  Json,
} from "./core/common.js";

import type { MemoryRecord } from "./core/record.js";
import type { MemoryQuery, RetrievalResult, WriteResult, RankedRecord } from "./core/query.js";
import type { MemoryPatch, ArchiveReport, CompressionReport, ExpirationReport } from "./core/engine.js";

import {
  BaseMemory,
  ConversationMemory,
  SessionMemory,
  WorkspaceMemory,
  NamespaceConfig,
  MemoryStats,
  MemoryHealth,
  MemoryEvent,
} from "./memory-layer.js";

/** Simple in-memory storage. */
interface MemoryEntry {
  record: MemoryRecord;
  createdAt: Timestamp;
}

/** InMemory implementation of BaseMemory. */
export class InMemoryMemory extends BaseMemory {
  protected storage = new Map<MemoryId, MemoryEntry>();
  private readonly events: MemoryEvent[] = [];

  constructor(namespace: string, config: NamespaceConfig) {
    super(namespace, config);
  }

  async save(record: MemoryRecord): Promise<WriteResult> {
    const startTime = Date.now();
    try {
      const existing = this.storage.get(record.memory_id);
      const version = existing ? existing.record.version + 1 : 1;
      const newRecord: MemoryRecord = {
        ...record,
        version,
        supersedes: existing?.record.memory_id ?? null,
        superseded_by: null,
      };

      this.storage.set(record.memory_id, { record: newRecord, createdAt: newRecord.created_at });

      // Update superseded_by on old record
      if (existing) {
        existing.record.superseded_by = record.memory_id;
      }

      this.emitEvent("save", record.memory_id, Date.now() - startTime, true);

      return {
        memory_id: record.memory_id,
        version,
        supersededId: existing?.record.memory_id ?? null,
      };
    } catch (error) {
      this.emitEvent("save", record.memory_id, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async retrieve(query: MemoryQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    try {
      const results = this.filterRecords(query);
      const ranked = this.rankResults(results, query);
      this.emitEvent("retrieve", undefined, Date.now() - startTime, true);
      return { records: ranked, suppressed: [] };
    } catch (error) {
      this.emitEvent("retrieve", undefined, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async search(query: MemoryQuery): Promise<RetrievalResult> {
    return this.retrieve({ ...query, mode: "hybrid" });
  }

  async update(id: MemoryId, patch: MemoryPatch): Promise<WriteResult> {
    const startTime = Date.now();
    try {
      const existing = this.storage.get(id);
      if (!existing) {
        throw new Error(`Record not found: ${id}`);
      }

      const updatedRecord: MemoryRecord = {
        ...existing.record,
        body: (patch.body as Json) ?? existing.record.body,
        confidence: patch.confidenceDelta !== undefined
          ? Math.max(0, Math.min(1, existing.record.confidence + patch.confidenceDelta))
          : existing.record.confidence,
        last_reinforced: patch.reinforce ? new Date().toISOString() : existing.record.last_reinforced,
        version: existing.record.version + 1,
        supersedes: existing.record.memory_id,
        superseded_by: null,
      };

      const newId = `${id}-v${updatedRecord.version}`;
      this.storage.set(newId, { record: updatedRecord, createdAt: updatedRecord.created_at });
      existing.record.superseded_by = newId;

      this.emitEvent("update", newId, Date.now() - startTime, true);

      return {
        memory_id: newId,
        version: updatedRecord.version,
        supersededId: id,
      };
    } catch (error) {
      this.emitEvent("update", id, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async delete(id: MemoryId, reason: string): Promise<void> {
    const startTime = Date.now();
    try {
      const existing = this.storage.get(id);
      if (!existing) {
        throw new Error(`Record not found: ${id}`);
      }

      // Check durability
      if (this.config.type === "company" || this.config.type === "decision" || this.config.type === "lessons") {
        throw new Error(`Cannot delete ${this.config.type} records (permanent type)`);
      }

      this.storage.delete(id);
      this.emitEvent("delete", id, Date.now() - startTime, true);
    } catch (error) {
      this.emitEvent("delete", id, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async clear(): Promise<void> {
    const startTime = Date.now();
    try {
      this.storage.clear();
      this.emitEvent("clear", undefined, Date.now() - startTime, true);
    } catch (error) {
      this.emitEvent("clear", undefined, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async get(id: MemoryId): Promise<MemoryRecord | null> {
    const entry = this.storage.get(id);
    return entry ? entry.record : null;
  }

  async has(id: MemoryId): Promise<boolean> {
    return this.storage.has(id);
  }

  async archive(olderThan: Timestamp): Promise<ArchiveReport> {
    const startTime = Date.now();
    try {
      const cutoff = new Date(olderThan).getTime();
      let archived = 0;

      for (const [id, entry] of this.storage.entries()) {
        if (new Date(entry.createdAt).getTime() < cutoff) {
          archived++;
        }
      }

      this.emitEvent("archive", undefined, Date.now() - startTime, true);
      return { archived, movedTo: "cold-storage" };
    } catch (error) {
      this.emitEvent("archive", undefined, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async compress(olderThan: Timestamp): Promise<CompressionReport> {
    const startTime = Date.now();
    try {
      this.emitEvent("compress", undefined, Date.now() - startTime, true);
      return { inputRecords: 0, outputRecords: 0, ratio: 1 };
    } catch (error) {
      this.emitEvent("compress", undefined, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async expire(asOf: Timestamp): Promise<ExpirationReport> {
    const startTime = Date.now();
    try {
      if (this.config.type === "company" || this.config.type === "decision" || this.config.type === "lessons") {
        this.emitEvent("expire", undefined, Date.now() - startTime, true);
        return { expired: 0, promoted: 0 };
      }

      const cutoff = new Date(asOf).getTime();
      let expired = 0;

      for (const [id, entry] of this.storage.entries()) {
        if (new Date(entry.record.created_at).getTime() < cutoff) {
          this.storage.delete(id);
          expired++;
        }
      }

      this.emitEvent("expire", undefined, Date.now() - startTime, true);
      return { expired, promoted: 0 };
    } catch (error) {
      this.emitEvent("expire", undefined, Date.now() - startTime, false, String(error));
      throw error;
    }
  }

  async stats(): Promise<MemoryStats> {
    let totalSize = 0;
    let oldest: Timestamp | undefined;
    let newest: Timestamp | undefined;

    for (const entry of this.storage.values()) {
      totalSize += JSON.stringify(entry.record).length;
      if (!oldest || new Date(entry.createdAt) < new Date(oldest)) {
        oldest = entry.createdAt;
      }
      if (!newest || new Date(entry.createdAt) > new Date(newest)) {
        newest = entry.createdAt;
      }
    }

    return {
      namespace: this.namespace,
      type: this.config.type,
      recordCount: this.storage.size,
      totalSizeBytes: totalSize,
      oldestRecord: oldest,
      newestRecord: newest,
    };
  }

  async health(): Promise<MemoryHealth> {
    return {
      healthy: true,
      lastCheck: new Date().toISOString(),
    };
  }

  private filterRecords(query: MemoryQuery): MemoryRecord[] {
    let results: MemoryRecord[] = [];

    for (const entry of this.storage.values()) {
      const record = entry.record;

      // Filter by type/scope
      if (query.scope && !query.scope.includes(record.type)) {
        continue;
      }

      // Filter by agent
      if (record.agent !== query.agent && record.agent !== null) {
        continue;
      }

      // Filter by brand_id
      const filter = query.filter && typeof query.filter === "object" && !Array.isArray(query.filter)
        ? query.filter as Record<string, Json>
        : {};
      if (filter.brand_id && record.brand_id !== filter.brand_id) {
        continue;
      }

      // Filter by text (simple contains check)
      if (query.text && !JSON.stringify(record.body).toLowerCase().includes(query.text.toLowerCase())) {
        continue;
      }

      // Filter by confidence
      if (query.minConfidence && record.confidence < query.minConfidence) {
        continue;
      }

      results.push(record);
    }

    // Apply limit
    if (query.topK) {
      results = results.slice(0, query.topK);
    }

    return results;
  }

  private rankResults(records: MemoryRecord[], query: MemoryQuery): RankedRecord[] {
    return records.map((record) => ({
      record,
      score: record.confidence,
      signals: {
        relevance: query.text ? 0.8 : 0.5,
        recency: 0.5,
        performance: 0.5,
        confidence: record.confidence,
        conflictPenalty: 0,
      },
    }));
  }

  private emitEvent(type: MemoryEvent["type"], recordId: MemoryId | undefined, durationMs: number, success: boolean, error?: string): void {
    this.events.push({
      type,
      namespace: this.namespace,
      recordId,
      timestamp: new Date().toISOString(),
      durationMs,
      success,
      error,
    });
  }
}

/** InMemory implementation of ConversationMemory. */
export class InMemoryConversationMemory extends InMemoryMemory implements ConversationMemory {
  async addMessage(role: "user" | "assistant" | "system", content: string, metadata?: Json): Promise<WriteResult> {
    const meta = (metadata && typeof metadata === "object" && !Array.isArray(metadata)) ? metadata as Record<string, Json> : {};
    const record: MemoryRecord = {
      memory_id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type: this.config.type,
      agent: (meta.agent as AgentId) ?? null,
      brand_id: (meta.brand_id as string) ?? null,
      body: { role, content, ...meta },
      confidence: 1.0,
      provenance: { sources: [{ type: "conversation", ref: this.namespace }], derived_by: (meta.agent as AgentId) ?? "unknown" },
      created_at: new Date().toISOString(),
      last_reinforced: null,
      supersedes: null,
      superseded_by: null,
      version: 1,
    };
    return this.save(record);
  }

  async getHistory(limit?: number): Promise<MemoryRecord[]> {
    const results = Array.from(this.storage.values())
      .sort((a, b) => new Date(a.record.created_at).getTime() - new Date(b.record.created_at).getTime())
      .map((e) => e.record);

    return limit ? results.slice(-limit) : results;
  }

  async clearHistory(): Promise<void> {
    await this.clear();
  }
}

/** InMemory implementation of SessionMemory. */
export class InMemorySessionMemory extends InMemoryMemory implements SessionMemory {
  async appendToRun(workflowId: string, record: MemoryRecord): Promise<WriteResult> {
    const body = record.body && typeof record.body === "object" && !Array.isArray(record.body)
      ? record.body as Record<string, Json>
      : {};
    const runRecord: MemoryRecord = {
      ...record,
      body: { ...body, workflowId },
    };
    return this.save(runRecord);
  }

  async getRun(workflowId: string): Promise<MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    for (const entry of this.storage.values()) {
      const body = entry.record.body && typeof entry.record.body === "object" && !Array.isArray(entry.record.body)
        ? entry.record.body as Record<string, Json>
        : {};
      if (body.workflowId === workflowId) {
        results.push(entry.record);
      }
    }
    return results.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }

  async distill(workflowId: string): Promise<MemoryRecord[]> {
    const run = await this.getRun(workflowId);
    return run;
  }
}

/** InMemory implementation of WorkspaceMemory. */
export class InMemoryWorkspaceMemory extends InMemoryMemory implements WorkspaceMemory {
  async saveDocument(key: string, content: Json, metadata?: Json): Promise<WriteResult> {
    const meta = (metadata && typeof metadata === "object" && !Array.isArray(metadata)) ? metadata as Record<string, Json> : {};
    const record: MemoryRecord = {
      memory_id: `doc-${key}`,
      type: this.config.type,
      agent: (meta.agent as AgentId) ?? null,
      brand_id: (meta.brand_id as string) ?? null,
      body: { key, content, ...meta },
      confidence: 1.0,
      provenance: { sources: [{ type: "workspace", ref: this.namespace }], derived_by: (meta.agent as AgentId) ?? "unknown" },
      created_at: new Date().toISOString(),
      last_reinforced: null,
      supersedes: null,
      superseded_by: null,
      version: 1,
    };
    return this.save(record);
  }

  async getDocument(key: string): Promise<MemoryRecord | null> {
    return this.get(`doc-${key}`);
  }

  async listDocuments(): Promise<string[]> {
    const keys: string[] = [];
    for (const entry of this.storage.values()) {
      if (entry.record.memory_id.startsWith("doc-")) {
        keys.push(entry.record.memory_id.slice(4));
      }
    }
    return keys;
  }
}