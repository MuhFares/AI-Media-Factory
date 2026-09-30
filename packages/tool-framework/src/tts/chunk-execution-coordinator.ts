import { createHash, randomUUID } from "node:crypto";
import type { TTSChunk } from "./chunking.js";
import { chunkNarration, reconstructNarration } from "./chunking.js";
import { sanitizeProviderFailureMetadata } from "../core/provider-failure.js";

export interface TTSChunkProviderResult { bytes: Uint8Array; format: string; sampleRate: number; channels: number; durationMs: number; provider: string; model: string; voice: string; costKind: string; cost: number | null; }
export interface TTSChunkExecution { executionId: string; parentExecutionId: string; logicalChunkId: string; chunkIndex: number; chunkCount: number; textFingerprint: string; provider: string; model: string; voice: string; configurationFingerprint: string; status: "success" | "failed"; latencyMs: number; costKind: string; cost: number | null; artifactId: string | null; errorClassification: string | null; failureMetadata: unknown; }
export interface TTSChunkArtifact { artifactId: string; kind: "chunk_audio_artifact" | "narration_audio_artifact"; parentNarrationId: string; logicalChunkId?: string; chunkIndex?: number; chunkCount?: number; textFingerprint?: string; producingExecutionId?: string; childArtifactIds?: string[]; provider: string; model: string; voice: string; configurationFingerprint: string; path: string; sha256: string; format: string; sampleRate: number; channels: number; durationMs: number; status: "completed"; }
export interface TTSChunkCoordinatorStore {
  findExecution(logicalChunkId: string): Promise<TTSChunkExecution | null>;
  saveExecution(execution: TTSChunkExecution): Promise<void>;
  saveArtifact(artifact: TTSChunkArtifact): Promise<void>;
  findArtifact(artifactId: string): Promise<TTSChunkArtifact | null>;
}
export interface TTSChunkCoordinatorOptions {
  workflowId: string; correlationId: string; parentNarrationId: string; parentExecutionId: string; provider: string; model: string; voice: string; configurationFingerprint: string; maxCharacters: number; store: TTSChunkCoordinatorStore;
  synthesize(chunk: TTSChunk, logicalSubmissionId: string): Promise<TTSChunkProviderResult>;
  validateArtifact(artifact: TTSChunkArtifact): Promise<boolean>;
  assemble(chunks: readonly TTSChunkArtifact[]): Promise<{ path: string; sha256: string; format: string; sampleRate: number; channels: number; durationMs: number }>;
}

function logicalId(o: TTSChunkCoordinatorOptions, chunk: TTSChunk): string {
  return `tts-logical-chunk-${createHash("sha256").update(JSON.stringify({ workflowId: o.workflowId, correlationId: o.correlationId, parentNarrationId: o.parentNarrationId, index: chunk.index, count: chunk.count, textFingerprint: chunk.textFingerprint, provider: o.provider, model: o.model, voice: o.voice, configurationFingerprint: o.configurationFingerprint })).digest("hex").slice(0, 24)}`;
}
function sha(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

export class TTSChunkExecutionCoordinator {
  constructor(private readonly options: TTSChunkCoordinatorOptions) {}

  plan(text: string): TTSChunk[] { return chunkNarration(text, this.options.maxCharacters); }

  async execute(text: string): Promise<{ status: "completed" | "failed"; chunks: TTSChunk[]; artifacts: TTSChunkArtifact[]; narration?: TTSChunkArtifact; failedExecution?: TTSChunkExecution }> {
    const chunks = this.plan(text);
    if (reconstructNarration(chunks) !== text.trim()) throw new Error("NARRATION_TEXT_PRESERVATION_FAILED");
    const artifacts: TTSChunkArtifact[] = [];
    for (const chunk of chunks) {
      const id = logicalId(this.options, chunk);
      const existing = await this.options.store.findExecution(id);
      if (existing?.status === "success" && existing.artifactId) {
        const artifact = await this.options.store.findArtifact(existing.artifactId);
        if (artifact && artifact.logicalChunkId === id && artifact.textFingerprint === chunk.textFingerprint && artifact.configurationFingerprint === this.options.configurationFingerprint && await this.options.validateArtifact(artifact)) { artifacts.push(artifact); continue; }
      }
      const existingFailure = existing?.failureMetadata as { providerReceiptStatus?: unknown } | null;
      if (existing?.status === "failed" && existingFailure?.providerReceiptStatus === "UNKNOWN") {
        return { status: "failed", chunks, artifacts, failedExecution: existing };
      }
      const executionId = `exec-${this.options.parentExecutionId}-${chunk.index + 1}-${randomUUID()}`;
      const started = Date.now();
      try {
        const result = await this.options.synthesize(chunk, id);
        const artifactId = `art-${this.options.parentNarrationId}-${chunk.index + 1}-${id.slice(-12)}`;
        const artifact: TTSChunkArtifact = { artifactId, kind: "chunk_audio_artifact", parentNarrationId: this.options.parentNarrationId, logicalChunkId: id, chunkIndex: chunk.index, chunkCount: chunk.count, textFingerprint: chunk.textFingerprint, producingExecutionId: executionId, provider: result.provider, model: result.model, voice: result.voice, configurationFingerprint: this.options.configurationFingerprint, path: `data:audio/${result.format};base64,${Buffer.from(result.bytes).toString("base64")}`, sha256: sha(result.bytes), format: result.format, sampleRate: result.sampleRate, channels: result.channels, durationMs: result.durationMs, status: "completed" };
        const execution: TTSChunkExecution = { executionId, parentExecutionId: this.options.parentExecutionId, logicalChunkId: id, chunkIndex: chunk.index, chunkCount: chunk.count, textFingerprint: chunk.textFingerprint, provider: result.provider, model: result.model, voice: result.voice, configurationFingerprint: this.options.configurationFingerprint, status: "success", latencyMs: Date.now() - started, costKind: result.costKind, cost: result.cost, artifactId, errorClassification: null, failureMetadata: null };
        await this.options.store.saveExecution(execution); await this.options.store.saveArtifact(artifact); artifacts.push(artifact);
      } catch (error) {
        const execution: TTSChunkExecution = { executionId, parentExecutionId: this.options.parentExecutionId, logicalChunkId: id, chunkIndex: chunk.index, chunkCount: chunk.count, textFingerprint: chunk.textFingerprint, provider: this.options.provider, model: this.options.model, voice: this.options.voice, configurationFingerprint: this.options.configurationFingerprint, status: "failed", latencyMs: Date.now() - started, costKind: "UNKNOWN", cost: null, artifactId: null, errorClassification: "PROVIDER_ERROR", failureMetadata: sanitizeProviderFailureMetadata(error, { provider: this.options.provider, model: this.options.model, capability: "tts.generate" }) };
        await this.options.store.saveExecution(execution); return { status: "failed", chunks, artifacts, failedExecution: execution };
      }
    }
    const assembled = await this.options.assemble(artifacts);
    const narration: TTSChunkArtifact = { artifactId: this.options.parentNarrationId, kind: "narration_audio_artifact", parentNarrationId: this.options.parentNarrationId, childArtifactIds: artifacts.map((a) => a.artifactId), provider: "local", model: "deterministic-audio-assembly", voice: this.options.voice, configurationFingerprint: this.options.configurationFingerprint, ...assembled, status: "completed" };
    await this.options.store.saveArtifact(narration);
    return { status: "completed", chunks, artifacts, narration };
  }
}
