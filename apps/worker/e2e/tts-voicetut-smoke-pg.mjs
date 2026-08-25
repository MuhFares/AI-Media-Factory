/**
 * Real VoiceTuT (Egyptian) TTS smoke — opt-in only.
 *
 * Requires:
 *   RUN_REAL_PROVIDER_TESTS=true
 *   TTS_PROVIDER=voicetut
 *   RUNPOD_API_KEY
 *   VOICETUT_TTS_ENDPOINT_ID  (deployed from ghcr.io/muhfares/voicetut-tts:latest)
 *   DATABASE_URL
 *
 * Run:
 *   RUN_REAL_PROVIDER_TESTS=true TTS_PROVIDER=voicetut node --env-file=.env \
 *     apps/worker/e2e/tts-voicetut-smoke-pg.mjs [short|technical|social|long]
 *
 * Exit codes: 0 PASS/SKIP, 42 BLOCKED (Postgres), 1 failure.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPool, migrate, PostgresPersistence } from "@ai-media-factory/database";
import {
  TTSProviderRegistry,
  voicetutTTSAdapterFromEnv,
  RoutingCapabilityExecutor,
  DEFAULT_PROVIDER_GRANTS,
  PROVIDER_CAPABILITIES,
} from "@ai-media-factory/provider-adapters";
import { createTTSAgent } from "@ai-media-factory/tts-agent";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { createCapabilityRegistry, createTTSGenerationCapability } from "@ai-media-factory/tool-framework";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) { console.log("tts-voicetut-smoke-pg: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true)"); process.exit(0); }

const apiKey = (process.env.RUNPOD_API_KEY ?? "").trim();
const endpointId = (process.env.VOICETUT_TTS_ENDPOINT_ID ?? "").trim();
if (apiKey.length === 0 || endpointId.length === 0) {
  console.log("tts-voicetut-smoke-pg: SKIPPED (missing RUNPOD_API_KEY or VOICETUT_TTS_ENDPOINT_ID)");
  console.log("  Deploy ghcr.io/muhfares/voicetut-tts:latest first (see docker/voicetut-tts/README.md)");
  process.exit(0);
}

const SCRIPTS = {
  short:
    "بص يا سيدي، الموضوع أبسط بكتير ما الناس متخيلة. النهارده الذكاء الاصطناعي بقى يقدر يساعدنا في كتابة المحتوى وتحليل البيانات وعمل الصور والفيديوهات كمان.",
  technical:
    "باستخدام Python وSQL وPower BI، نقدر نعمل Data Pipeline كاملة ونحوّل البيانات الخام لمعلومات تساعدنا ناخد قرارات أحسن.",
  social:
    "تخيل إنك تقدر تعمل فيديو كامل، من أول الفكرة والسكريبت لحد الصورة والصوت والنشر، والسيستم كله يشتغل لوحده.",
  long:
    "تخيل معايا إن عندك فكرة لفيديو، وتقعد تتمنى إنها تتنفذ لوحدها. النهارده الحلم ده بقى حقيقة. فيه أنظمة ذكاء اصطناعي بتكتب السكريبت بتاعك، وبتعمل الصورة اللي في خيالك، وبتحول الصورة لفيديو متحرك، وبعدين بتضيف صوت بيقرا الكلام كأنه مذيع حقيقي. وكله بيحصل أوتوماتيك، من غير مونتاج، ومن غير كاميرا، ومن غير فريق. اللي كان بياخد أسبوع شغل، بقى بيتعمل في دقايق. دي مش قصة من فيلم، دي أدوات موجودة دلوقتي ومجانية، وأي حد يقدر يبني بيها مصنع محتوى كامل. في الفيديو الجاي هوريك إزاي تبدأ خطوة بخطوة. تابعنا.",
};
const scriptKey = process.argv[2] ?? "short";
const text = SCRIPTS[scriptKey];
if (text === undefined) { console.error(`unknown script key: ${scriptKey}`); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const WORKFLOW_ID = `wf-tts-voicetut-${Date.now()}`;
const CORRELATION_ID = `corr-tts-voicetut-${Date.now()}`;
const REQUEST_ID = `req-tts-voicetut-${Date.now()}`;

const pool = createPool({ connectionString: DATABASE_URL });
try { await pool.query("SELECT 1"); } catch (e) {
  console.log("tts-voicetut-smoke-pg: BLOCKED — Postgres unreachable:", e?.message ?? String(e));
  await pool.end().catch(() => {});
  process.exit(42);
}

try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);

  const registry = new TTSProviderRegistry();
  registry.register(voicetutTTSAdapterFromEnv());
  const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS });
  const routing = new RoutingCapabilityExecutor();
  routing.register("tts.generate", createTTSGenerationCapability({ provider: registry, resolver, policy: {} }));
  const boundary = new RuntimeCapabilityExecutor({ resolver, executor: routing });

  const agent = createTTSAgent({
    execute: async () => { throw new Error("LLM must not be used by the TTS agent"); },
    capabilityExecution: boundary,
    config: { model: "deterministic", maxTextLength: 2000, defaultLanguage: "ar", systemPrompt: "" },
  });

  console.log(`tts-voicetut-smoke-pg: generating [${scriptKey}] (${text.length} chars) via ${endpointId.slice(0, 8)}…`);
  const t0 = Date.now();
  const outcome = await agent.execute(
    {
      context: { turnId: REQUEST_ID },
      input: {
        requestId: REQUEST_ID,
        objective: `VoiceTuT Egyptian smoke — ${scriptKey}`,
        text,
        language: "ar",
        format: "wav",
        taskDescription: `VoiceTuT Egyptian TTS smoke — ${scriptKey}`,
        workflowId: WORKFLOW_ID,
        correlationId: CORRELATION_ID,
      },
    },
    { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} },
  );
  const wallS = Math.round((Date.now() - t0) / 100) / 10;

  const report = outcome.output;
  console.log(`tts-voicetut-smoke-pg: tts_report status=${report.status} (${wallS}s wall)`);

  const executions = Array.isArray(report.capabilityExecutions) ? report.capabilityExecutions : [];
  const execution = executions[0];
  assert.ok(execution, "capability execution must be present");
  if (execution.status !== "success") {
    console.log(`tts-voicetut-smoke-pg: FAILED — ${execution.error?.message ?? report.summary}`);
    assert.equal(execution.evidence?.succeeded, false, "no fabricated success");
    process.exit(1);
  }

  assert.equal(execution.evidence.providerInvoked, true);
  assert.equal(execution.evidence.succeeded, true);
  assert.equal(execution.evidence.providerId, "voicetut");
  assert.equal(execution.evidence.capabilityId, "tts.generate");
  assert.equal(execution.evidence.agentId, "tts");
  assert.equal(execution.evidence.workflowId, WORKFLOW_ID);
  assert.equal(execution.evidence.correlationId, CORRELATION_ID);
  assert.ok(report.audioUrl?.startsWith("data:audio/wav;base64,"));

  await persistence.saveCapabilityExecution({
    resultId: String(execution.resultId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "tts.generate", agentId: "tts", status: "success",
    evidenceId: String(execution.evidence.evidenceId), idempotencyKey: String(execution.resultId),
    executedAt: String(execution.evidence.executedAt), payload: execution,
  });
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "tts.generate", agentId: "tts", executedAt: String(execution.evidence.executedAt),
    succeeded: true, idempotencyKey: String(execution.evidence.evidenceId), payload: execution,
  });

  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const evidenceRows = await readPersistence.listExecutionEvidence(WORKFLOW_ID);
  const evRow = evidenceRows.find((e) => e.capabilityId === "tts.generate");
  assert.ok(evRow, "execution_evidence must be durable");
  assert.equal(evRow.succeeded, true);
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "tts.generate", agentId: "tts", executedAt: String(execution.evidence.executedAt),
    succeeded: true, idempotencyKey: String(execution.evidence.evidenceId), payload: execution,
  });
  const evidenceAfter = await readPersistence.listExecutionEvidence(WORKFLOW_ID);
  assert.equal(evidenceAfter.filter((e) => e.capabilityId === "tts.generate").length, 1, "no duplicates");
  await reloadPool.end();
  console.log("tts-voicetut-smoke-pg: evidence durable + idempotent (fresh pool reload)");

  const b64 = report.audioUrl.split(",")[1] ?? "";
  const buf = Buffer.from(b64, "base64");
  assert.ok(buf.length > 1000, "audio must be substantial");
  assert.equal(buf.slice(0, 4).toString(), "RIFF");
  assert.equal(buf.slice(8, 12).toString(), "WAVE");
  const outDir = path.resolve("./output/tts-benchmark");
  fs.mkdirSync(outDir, { recursive: true });
  const audioPath = path.join(outDir, `voicetut-${scriptKey}.wav`);
  fs.writeFileSync(audioPath, buf);
  const durationSeconds = Math.round((buf.length - 44) / 2 / 24000 * 10) / 10;

  fs.writeFileSync(
    path.join(outDir, `voicetut-${scriptKey}-result.json`),
    JSON.stringify({
      provider: "voicetut", model: "voicetut-tts", voice: execution.output?.voice ?? "Mohamed",
      language: "ar", inputType: scriptKey, requestLatencyMs: execution.evidence.durationMs,
      audioDurationSeconds: durationSeconds, audioBytes: buf.length, format: "wav",
      success: true, timestamp: new Date().toISOString(),
      naturalness: null, egyptianAuthenticity: null, codeSwitching: null,
      pacing: null, overallListenability: null,
    }, null, 2),
  );

  console.log(`tts-voicetut-smoke-pg: PASS — real VoiceTuT Egyptian audio (${buf.length} bytes, ~${durationSeconds}s)`);
  console.log(`  audio: ${audioPath}`);
  console.log(`  workflowId: ${WORKFLOW_ID}`);
  console.log(`  evidenceId: ${execution.evidence.evidenceId}`);
} finally {
  await pool.end().catch(() => {});
}
