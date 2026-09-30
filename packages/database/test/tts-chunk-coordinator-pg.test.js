import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPool, migrate, PostgresPersistence } from "../dist/index.js";
import { TTSChunkExecutionCoordinator } from "../../tool-framework/dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

const url = TEST_DATABASE_URL;
const SCRIPT = "Watch this: an unpeeled orange floats, but peel it and it sinks. The peel is full of tiny air pockets, adding lots of volume without much mass. That lowers the orange's average density, so water can support it. Remove the peel, and the fruit becomes denser than water—so it sinks.";
const sha = (b) => createHash("sha256").update(b).digest("hex");

function makeStore(persistence, workflowId) {
  return {
    async findExecution(logicalChunkId) {
      const rows = await persistence.listExecutionProvenance(workflowId);
      const row = rows.slice().reverse().find((r) => r.configuration?.logicalChunkId === logicalChunkId);
      return row ? { ...row.configuration, executionId: row.executionId, status: row.status, artifactId: row.artifactIds[0] ?? null, latencyMs: row.latencyMs, costKind: row.costKind, cost: row.cost, failureMetadata: row.failureMetadata } : null;
    },
    async saveExecution(e) {
      await persistence.saveExecutionProvenance({ executionId: e.executionId, workflowId, correlationId: "corr-tts-chunk-test", agentId: "tts", stage: "tts.chunk", capability: "tts.generate", provider: e.provider, model: e.model, runtime: null, promptVersion: null, configurationFingerprint: e.configurationFingerprint, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: e.latencyMs, status: e.status, usage: null, costKind: e.costKind, cost: e.cost, currency: "USD", artifactIds: e.artifactId ? [e.artifactId] : [], parentExecutionIds: [e.parentExecutionId], attemptNumber: e.chunkIndex + 1, providerRequestId: null, providerJobId: null, errorClassification: e.errorClassification, configuration: { logicalChunkId: e.logicalChunkId, chunkIndex: e.chunkIndex, chunkCount: e.chunkCount, textFingerprint: e.textFingerprint }, failureMetadata: e.failureMetadata });
    },
    async saveArtifact(a) {
      await persistence.saveArtifact({ artifactId: a.artifactId, kind: "narration_artifact", producerAgent: a.provider === "local" ? "tts" : "tts", workflowId, correlationId: "corr-tts-chunk-test", status: "completed", payload: a, contentType: "application/json", schemaVersion: "tts-chunk-v1", createdAt: new Date().toISOString() });
    },
    async findArtifact(id) {
      const a = (await persistence.listArtifacts(workflowId)).find((x) => x.artifactId === id);
      return a?.payload ?? null;
    },
  };
}

function options(store, workflowId, calls, failSecond = false) {
  return { workflowId, correlationId: "corr-tts-chunk-test", parentNarrationId: `${workflowId}-narration`, parentExecutionId: `${workflowId}-parent`, provider: "groq", model: "canopylabs/orpheus-v1-english", voice: "hannah", configurationFingerprint: "cfg-hannah-wav-v1", maxCharacters: 200, store,
    synthesize: async (chunk) => { calls[chunk.index]++; if (failSecond && chunk.index === 1) throw Object.assign(new Error("rate limited; api_key=SECRET_VALUE"), { providerId: "groq", statusCode: 429, providerErrorCode: "rate_limit_exceeded", providerErrorType: "rate_limit", detail: "sanitized test detail; Authorization: Bearer SECRET_VALUE", retryable: true, category: "TRANSIENT" }); const bytes = Buffer.from(`RIFF-${chunk.index}`); return { bytes, format: "wav", sampleRate: 24000, channels: 1, durationMs: 1000, provider: "groq", model: "canopylabs/orpheus-v1-english", voice: "hannah", costKind: "UNKNOWN", cost: null }; },
    validateArtifact: async (a) => { const bytes = Buffer.from(a.path.split(",")[1], "base64"); return bytes.length > 0 && sha(bytes) === a.sha256; },
    assemble: async (chunks) => ({ path: `data:audio/wav;base64,${Buffer.concat(chunks.map((a) => Buffer.from(a.path.split(",")[1], "base64"))).toString("base64")}`, sha256: "assembled-local", format: "wav", sampleRate: 24000, channels: 1, durationMs: chunks.reduce((n, a) => n + a.durationMs, 0) }),
  };
}

test("PostgreSQL restart reuses successful chunk and persists typed failure/lineage", async (t) => {
  assertTestDatabaseIsolation();
  const pool = createPool({ connectionString: url, max: 3 });
  const workflowId = `tts-chunk-coordinator-${Date.now()}`;
  try {
    await migrate(pool); const persistence = new PostgresPersistence(pool); const store = makeStore(persistence, workflowId);
    const calls = [0, 0]; const runA = await new TTSChunkExecutionCoordinator(options(store, workflowId, calls, true)).execute(SCRIPT);
    assert.equal(runA.status, "failed"); assert.deepEqual(calls, [1, 1]); assert.equal(runA.artifacts.length, 1); assert.equal(runA.failedExecution.failureMetadata.httpStatus, 429); assert.equal(runA.failedExecution.failureMetadata.providerErrorCode, "rate_limit_exceeded"); assert.equal(runA.failedExecution.failureMetadata.providerErrorType, "rate_limit"); assert.equal(runA.failedExecution.failureMetadata.retryable, true); assert.equal(JSON.stringify(runA.failedExecution.failureMetadata).includes("SECRET_VALUE"), false);
    const runB = await new TTSChunkExecutionCoordinator(options(store, workflowId, calls, false)).execute(SCRIPT);
    assert.equal(runB.status, "completed"); assert.deepEqual(calls, [1, 2]); assert.equal(runB.artifacts.length, 2); assert.equal(runB.narration.childArtifactIds.length, 2); assert.equal(runB.narration.provider, "local");
    const rows = await persistence.listExecutionProvenance(workflowId); assert.equal(rows.filter((r) => r.configuration?.chunkIndex === 0).length, 1); assert.equal(rows.filter((r) => r.configuration?.chunkIndex === 1).length, 2); assert.equal((await persistence.listArtifacts(workflowId)).filter((a) => a.payload?.kind === "narration_audio_artifact").length, 1);
  } catch (e) { if (["ECONNREFUSED", "28P01", "3D000"].includes(e?.code)) { t.skip(`PostgreSQL unavailable: ${e.code}`); return; } throw e; }
  finally { await pool.query("DELETE FROM execution_provenance WHERE workflow_id = $1", [workflowId]).catch(() => undefined); await pool.query("DELETE FROM artifacts WHERE workflow_id = $1", [workflowId]).catch(() => undefined); await pool.end(); }
});
