/**
 * Real Groq TTS smoke — opt-in only.
 *
 * Proves: TTSAgent → tts.generate → TTSProviderRegistry → GroqTTSAdapter
 *   → Groq Orpheus API → real WAV audio → ExecutionEvidence → PostgreSQL.
 *
 * Run:
 *   RUN_REAL_PROVIDER_TESTS=true TTS_PROVIDER=groq node --env-file=.env \
 *     apps/worker/e2e/tts-groq-smoke-pg.mjs [scriptKey]
 *
 * scriptKey: msa (default) | egyptian | mixed | english | long
 * Exit codes: 0 PASS/SKIP, 42 BLOCKED (Postgres unreachable), 1 failure.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence } from "@ai-media-factory/database";
import {
  createProviderCapabilityBoundaryFromEnv,
  TTSProviderRegistry,
  groqTTSAdapterFromEnv,
  RoutingCapabilityExecutor,
  DEFAULT_PROVIDER_GRANTS,
  PROVIDER_CAPABILITIES,
} from "@ai-media-factory/provider-adapters";
import { createTTSAgent, BENCHMARK_SCRIPTS } from "@ai-media-factory/tts-agent";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { createCapabilityRegistry, createTTSGenerationCapability } from "@ai-media-factory/tool-framework";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) { console.log("tts-groq-smoke-pg: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true)"); process.exit(0); }

const apiKey = (process.env.GROQ_API_KEY ?? process.env.GROQ_TTS_API_KEY ?? process.env.TTS_API_KEY ?? "").trim();
if (apiKey.length === 0) { console.log("tts-groq-smoke-pg: SKIPPED (missing GROQ_API_KEY/TTS_API_KEY)"); process.exit(0); }

const scriptKey = process.argv[2] ?? "msa";
const SCRIPTS = {
  msa: { text: BENCHMARK_SCRIPTS.arabicMsa, language: "ar", voice: "fahad", file: "groq-msa.wav" },
  egyptian: { text: BENCHMARK_SCRIPTS.arabicEgyptian, language: "ar", voice: "noura", file: "groq-egyptian.wav" },
  mixed: { text: BENCHMARK_SCRIPTS.mixedArabicEnglish, language: "ar", voice: "fahad", file: "groq-mixed.wav" },
  english: { text: BENCHMARK_SCRIPTS.english, language: "en", voice: "troy", file: "groq-english.wav" },
  long: { text: BENCHMARK_SCRIPTS.longFormArabic, language: "ar", voice: "fahad", file: "groq-long-ar.wav" },
};
const selected = SCRIPTS[scriptKey];
if (selected === undefined) { console.error(`unknown script key: ${scriptKey}`); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const WORKFLOW_ID = `wf-tts-smoke-${Date.now()}`;
const CORRELATION_ID = `corr-tts-smoke-${Date.now()}`;
const REQUEST_ID = `req-tts-smoke-${Date.now()}`;

const pool = createPool({ connectionString: DATABASE_URL });
try { await pool.query("SELECT 1"); } catch (e) {
  console.log("tts-groq-smoke-pg: BLOCKED — Postgres unreachable:", e?.message ?? String(e));
  await pool.end().catch(() => {});
  process.exit(42);
}

try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);

  // Build the boundary with ONLY the TTS capability enabled (isolated proof).
  const registry = new TTSProviderRegistry();
  registry.register(groqTTSAdapterFromEnv());
  const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS });
  const routing = new RoutingCapabilityExecutor();
  routing.register(
    "tts.generate",
    createTTSGenerationCapability({ provider: registry, resolver, policy: {} }),
  );
  const boundary = new RuntimeCapabilityExecutor({ resolver, executor: routing });

  const agent = createTTSAgent({
    execute: async () => { throw new Error("LLM must not be used by the TTS agent"); },
    capabilityExecution: boundary,
    config: { model: "deterministic", maxTextLength: 2000, defaultLanguage: "ar", systemPrompt: "" },
  });

  console.log(`tts-groq-smoke-pg: generating [${scriptKey}] (${selected.text.length} chars, voice=${selected.voice})`);
  const t0 = Date.now();
  const outcome = await agent.execute(
    {
      context: { turnId: REQUEST_ID },
      input: {
        requestId: REQUEST_ID,
        objective: `TTS smoke [${scriptKey}]`,
        text: selected.text,
        language: selected.language,
        voice: selected.voice,
        format: "wav",
        taskDescription: `Groq TTS smoke — ${scriptKey}`,
        workflowId: WORKFLOW_ID,
        correlationId: CORRELATION_ID,
      },
    },
    { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} },
  );
  const wallS = Math.round((Date.now() - t0) / 100) / 10;

  const report = outcome.output;
  console.log(`tts-groq-smoke-pg: tts_report status=${report.status} (${wallS}s wall)`);

  // --- Truth gates ---
  const executions = Array.isArray(report.capabilityExecutions) ? report.capabilityExecutions : [];
  const execution = executions[0];
  assert.ok(execution, "capability execution must be present");
  assert.equal(execution.status, "success", "capability must succeed");
  assert.equal(execution.evidence?.providerInvoked, true, "provider must have been invoked");
  assert.equal(execution.evidence?.succeeded, true);
  assert.equal(execution.evidence?.providerId, "groq", "providerId must be groq");
  assert.equal(execution.evidence?.capabilityId, "tts.generate");
  assert.equal(execution.evidence?.agentId, "tts");
  assert.equal(execution.evidence?.workflowId, WORKFLOW_ID);
  assert.equal(execution.evidence?.correlationId, CORRELATION_ID);
  assert.ok(report.audioUrl?.startsWith("data:audio/wav;base64,"), "audio must be wav data URL");

  // --- Persist evidence (same idempotency keys as production executor) ---
  await persistence.saveCapabilityExecution({
    resultId: String(execution.resultId),
    workflowId: WORKFLOW_ID,
    correlationId: CORRELATION_ID,
    capabilityId: "tts.generate",
    agentId: "tts",
    status: "success",
    evidenceId: String(execution.evidence.evidenceId),
    idempotencyKey: String(execution.resultId),
    executedAt: String(execution.evidence.executedAt),
    payload: execution,
  });
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId),
    workflowId: WORKFLOW_ID,
    correlationId: CORRELATION_ID,
    capabilityId: "tts.generate",
    agentId: "tts",
    executedAt: String(execution.evidence.executedAt),
    succeeded: true,
    idempotencyKey: String(execution.evidence.evidenceId),
    payload: execution,
  });

  // --- Reload from a FRESH pool (durability proof) ---
  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const evidenceRows = await readPersistence.listExecutionEvidence(WORKFLOW_ID);
  const executionRows = await readPersistence.listCapabilityExecutions(WORKFLOW_ID);
  const evRow = evidenceRows.find((e) => e.capabilityId === "tts.generate");
  assert.ok(evRow, "execution_evidence row must be durable");
  assert.equal(evRow.succeeded, true);
  assert.equal(evRow.agentId, "tts");
  assert.equal(evRow.workflowId, WORKFLOW_ID);
  assert.equal(evRow.correlationId, CORRELATION_ID);
  const execRow = executionRows.find((e) => e.capabilityId === "tts.generate");
  assert.ok(execRow, "capability_executions row must be durable");
  assert.equal(execRow.status, "success");
  console.log("tts-groq-smoke-pg: evidence durable in PostgreSQL (fresh pool reload)");
  await reloadPool.end();

  // --- Idempotency: re-persist same ids must not duplicate ---
  await persistence.saveCapabilityExecution({
    resultId: String(execution.resultId),
    workflowId: WORKFLOW_ID,
    correlationId: CORRELATION_ID,
    capabilityId: "tts.generate",
    agentId: "tts",
    status: "success",
    evidenceId: String(execution.evidence.evidenceId),
    idempotencyKey: String(execution.resultId),
    executedAt: String(execution.evidence.executedAt),
    payload: execution,
  });
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId),
    workflowId: WORKFLOW_ID,
    correlationId: CORRELATION_ID,
    capabilityId: "tts.generate",
    agentId: "tts",
    executedAt: String(execution.evidence.executedAt),
    succeeded: true,
    idempotencyKey: String(execution.evidence.evidenceId),
    payload: execution,
  });
  const reloadPool2 = createPool({ connectionString: DATABASE_URL });
  const recheck = new PostgresPersistence(reloadPool2);
  const evidenceAfter = await recheck.listExecutionEvidence(WORKFLOW_ID);
  assert.equal(evidenceAfter.filter((e) => e.capabilityId === "tts.generate").length, 1, "no duplicate evidence on retry");
  await reloadPool2.end();
  console.log("tts-groq-smoke-pg: idempotent re-persist (no duplicates)");

  // --- Save audio locally for human listening ---
  const b64 = report.audioUrl.split(",")[1] ?? "";
  const buf = Buffer.from(b64, "base64");
  assert.ok(buf.length > 1000, "audio must be substantial");
  assert.equal(buf.slice(0, 4).toString(), "RIFF", "WAV header must be RIFF");
  assert.equal(buf.slice(8, 12).toString(), "WAVE", "WAV header must be WAVE");
  const outDir = path.resolve("./output/tts-benchmark");
  fs.mkdirSync(outDir, { recursive: true });
  const audioPath = path.join(outDir, selected.file);
  fs.writeFileSync(audioPath, buf);

  const durationSeconds = Math.round((buf.length - 44) / 2 / 24000 * 10) / 10; // 16-bit mono 24kHz
  const result = {
    provider: "groq",
    model: execution.output?.model ?? "unknown",
    voice: execution.output?.voice ?? selected.voice,
    language: selected.language,
    inputType: scriptKey,
    requestLatencyMs: execution.evidence?.durationMs ?? null,
    audioDurationSeconds: durationSeconds,
    audioBytes: buf.length,
    format: "wav",
    success: true,
    timestamp: new Date().toISOString(),
    naturalness: null,
    arabicPronunciation: null,
    egyptianPronunciation: null,
    codeSwitching: null,
    emotion: null,
    longFormStability: null,
  };
  fs.writeFileSync(path.join(outDir, `groq-${scriptKey}-result.json`), JSON.stringify(result, null, 2));

  console.log(`tts-groq-smoke-pg: PASS — real Groq audio proven (${buf.length} bytes, ~${durationSeconds}s, evidence durable)`);
  console.log(`  audio: ${audioPath}`);
  console.log(`  workflowId: ${WORKFLOW_ID}`);
  console.log(`  evidenceId: ${execution.evidence.evidenceId}`);
} finally {
  await pool.end().catch(() => {});
}
