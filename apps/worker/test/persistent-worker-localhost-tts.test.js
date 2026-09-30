/**
 * Operational persistent-worker localhost TTS end-to-end (isolated test DB, zero external network).
 *
 * Proves the operational path under a PERSISTENT worker runtime:
 *   worker persistence → TTS coordinator → VoiceTut adapter → localhost /run
 *   → durable job-ID capture (execution_provenance) → localhost /status →
 *   WAV artifact fixture,
 * with voice Mohamed, provider voicetut, no Groq metadata, exactly one /run,
 * durable job ID before first poll, and recovery with zero duplicate /run.
 *
 * Loopback only: global fetch throws for any non-127.0.0.1 target.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { createPool, migrate } from "@ai-media-factory/database";
import { VoicetutTTSAdapter } from "@ai-media-factory/provider-adapters";
import { TTSChunkExecutionCoordinator } from "@ai-media-factory/tool-framework";
import { createProductionWorker, executionProvenance } from "../dist/index.js";
import { truncateAll, TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

const realFetch = globalThis.fetch;

function buildWav(samples = 2205, sampleRate = 24000) {
  const dataLength = samples * 2;
  const buf = Buffer.alloc(44 + dataLength);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLength, 40);
  for (let i = 0; i < samples; i += 1) buf.writeInt16LE(((i % 100) - 50) * 100, 44 + i * 2);
  return buf;
}

function startVoicetutMock() {
  const wav = buildWav();
  const state = { submissions: 0, polls: 0, lastRunBody: null, lastRunHeaders: {}, lastVoice: null };
  let counter = 0;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (req.method === "POST" && url.pathname.endsWith("/run")) {
      state.submissions += 1;
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        state.lastRunBody = JSON.parse(body);
        state.lastRunHeaders = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
        state.lastVoice = state.lastRunBody?.input?.voice ?? null;
        counter += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: `vt-job-${counter}`, status: "IN_QUEUE" }));
      });
      return;
    }
    const match = /\/status\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && match !== null) {
      state.polls += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        id: match[1],
        status: "COMPLETED",
        output: { audio: wav.toString("base64"), format: "wav", voice: "Mohamed", duration_seconds: 2.5 },
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, server, state, close: () => new Promise((r) => server.close(() => r(undefined))) });
    });
  });
}

let pool;

before(async () => {
  globalThis.fetch = async (input, init) => {
    const target = String(typeof input === "string" ? input : input.url);
    if (target.startsWith("http://127.0.0.1:") || target.startsWith("http://localhost:")) return realFetch(input, init);
    throw new Error(`NETWORK_FORBIDDEN_IN_LOCALHOST_FIXTURE:${new URL(target).hostname}`);
  };
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
});

after(async () => {
  globalThis.fetch = realFetch;
  await pool.end();
});

test("operational persistent worker executes localhost TTS with durable ack and zero duplicate runs", async () => {
  const mock = await startVoicetutMock();
  try {
    const runtime = await createProductionWorker({
      pool,
      pollMs: 10,
      runtimeMode: "PERSISTENT_PRODUCTION_WORKER",
      launcher: "persistent-worker-localhost-tts-fixture",
    });
    try {
      assert.equal(runtime.identity.runtimeMode, "PERSISTENT_PRODUCTION_WORKER");
      const persistence = runtime.persistence;
      const workflowId = `wf-op-tts-${Date.now().toString(36)}`;
      const phases = [];
      const submissionIdFor = (logicalId) => `exec-tts-submission-${logicalId}`;
      const nowIso = () => new Date().toISOString();
      const lifecycle = {
        findAcknowledged: async (identity) => {
          const rows = await persistence.listExecutionProvenance(workflowId);
          const row = rows.find((r) => r.executionId === submissionIdFor(identity.logicalSubmissionId));
          return row?.providerJobId ? { providerJobId: row.providerJobId } : null;
        },
        persistIntent: async (identity) => {
          phases.push("SUBMISSION_INTENT");
          await persistence.saveExecutionProvenance(executionProvenance({
            executionId: submissionIdFor(identity.logicalSubmissionId), workflowId, correlationId: null,
            agentId: "tts-chunk-coordinator", stage: "tts-submit", capability: "tts.generate",
            provider: "voicetut", model: "UNKNOWN", runtime: "runpod-queue", promptVersion: null,
            startedAt: nowIso(), completedAt: nowIso(), latencyMs: 0, status: "blocked",
            usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [],
            parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null,
            errorClassification: null,
            configuration: { logicalSubmissionId: identity.logicalSubmissionId, voice: identity.voice, lifecycleState: "SUBMISSION_INTENT" },
          }));
        },
        persistPhase: async (identity, phase, providerJobId, providerStatus) => {
          phases.push(phase);
          const rows = await persistence.listExecutionProvenance(workflowId);
          const existing = rows.find((r) => r.executionId === submissionIdFor(identity.logicalSubmissionId));
          await persistence.saveExecutionProvenance(executionProvenance({
            executionId: submissionIdFor(identity.logicalSubmissionId), workflowId, correlationId: null,
            agentId: "tts-chunk-coordinator", stage: "tts-submit", capability: "tts.generate",
            provider: "voicetut", model: "UNKNOWN", runtime: "runpod-queue", promptVersion: null,
            startedAt: existing?.startedAt ?? nowIso(), completedAt: nowIso(), latencyMs: 0, status: "blocked",
            usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [],
            parentExecutionIds: [], attemptNumber: 1, providerRequestId: null,
            providerJobId: providerJobId ?? existing?.providerJobId ?? null, errorClassification: null,
            configuration: { logicalSubmissionId: identity.logicalSubmissionId, voice: identity.voice, lifecycleState: phase, providerStatus: providerStatus ?? null },
          }));
        },
        persistAcknowledged: async (identity, providerJobId) => {
          phases.push("PROVIDER_JOB_ID_CAPTURED_DURABLY");
          assert.equal(mock.state.polls, 0, "job ID must be durable before the first status poll");
          await lifecycle.persistPhase(identity, "PROVIDER_JOB_ID_CAPTURED_DURABLY", providerJobId);
        },
      };

      const adapter = () => new VoicetutTTSAdapter({
        apiKey: "present-not-used",
        endpointId: "present-not-used",
        baseUrl: mock.url,
        timeoutMs: 5000,
        pollIntervalMs: 25,
        maxWaitMs: 15000,
        pollRetries: 0,
        submissionLifecycle: lifecycle,
      });

      const executions = new Map();
      const artifacts = new Map();
      const store = {
        findExecution: async (id) => executions.get(id) ?? null,
        saveExecution: async (e) => { executions.set(e.logicalChunkId, e); },
        saveArtifact: async (a) => { artifacts.set(a.artifactId, a); },
        findArtifact: async (id) => artifacts.get(id) ?? null,
      };
      let synthesizeCalls = 0;
      const text = "أهلاً بيك، ده اختبار صوت قصير.";
      const configurationFingerprint = createHash("sha256").update("op-tts-fixture-v1").digest("hex");
      const coordinator = new TTSChunkExecutionCoordinator({
        workflowId, correlationId: `corr-${workflowId}`, parentNarrationId: `narration-${workflowId}`,
        parentExecutionId: `parent-${workflowId}`, provider: "voicetut", model: "voicetut-tts",
        voice: "Mohamed", configurationFingerprint, maxCharacters: 200, store,
        synthesize: async (chunk, logicalSubmissionId) => {
          synthesizeCalls += 1;
          const res = await adapter().generate({
            text: chunk.text, language: "ar", voice: "Mohamed",
            logicalSubmissionId, workflowId,
            textFingerprint: chunk.textFingerprint, configurationFingerprint,
          });
          assert.equal(res.providerId, "voicetut");
          assert.equal(res.voice, "Mohamed");
          const bytes = Buffer.from(res.url.split(",")[1] ?? "", "base64");
          return {
            bytes, format: "wav", sampleRate: 24000, channels: 1,
            durationMs: Math.round((bytes.length - 44) / 2 / 24), provider: "voicetut",
            model: "voicetut-tts", voice: "Mohamed", costKind: "UNKNOWN", cost: null,
          };
        },
        validateArtifact: async (artifact) => {
          const bytes = Buffer.from(artifact.path.split(",")[1] ?? "", "base64");
          return bytes.slice(0, 4).toString() === "RIFF" && bytes.slice(8, 12).toString() === "WAVE";
        },
        assemble: async (chunks) => {
          const parts = chunks.map((c) => Buffer.from(c.path.split(",")[1] ?? "", "base64"));
          const bytes = Buffer.concat(parts);
          return { path: `data:audio/wav;base64,${bytes.toString("base64")}`, sha256: createHash("sha256").update(bytes).digest("hex"), format: "wav", sampleRate: 24000, channels: 1, durationMs: 2500 };
        },
      });

      const outcome = await coordinator.execute(text);
      assert.equal(outcome.status, "completed");
      assert.equal(outcome.chunks.length, 1, "single-chunk fixture → exactly one logical submission");
      assert.equal(mock.state.submissions, 1, "exactly one /run submission");
      assert.ok(mock.state.polls >= 1, "status reconciliation polled");
      assert.ok(phases.includes("SUBMISSION_INTENT"));
      assert.ok(phases.indexOf("PROVIDER_JOB_ID_CAPTURED_DURABLY") < phases.indexOf("PROVIDER_JOB_STATUS"));

      // Request contract: RunPod-shaped body, Bearer structurally present, voice Mohamed, no Groq metadata.
      assert.equal(mock.state.lastVoice, "Mohamed");
      assert.equal(mock.state.lastRunHeaders.authorization, "Bearer present-not-used");
      assert.ok(!JSON.stringify(mock.state.lastRunBody).toLowerCase().includes("groq"), "no Groq metadata");

      // WAV artifact fixture validity.
      const narration = outcome.narration;
      assert.ok(narration.path.startsWith("data:audio/wav;base64,"));
      const wavBytes = Buffer.from(narration.path.split(",")[1], "base64");
      assert.equal(wavBytes.slice(0, 4).toString(), "RIFF");
      assert.equal(wavBytes.slice(8, 12).toString(), "WAVE");
      assert.equal(narration.voice, "Mohamed");
      assert.equal(narration.provider, "local");

      // Durable job-ID capture in the operational worker's own persistence.
      const rows = await persistence.listExecutionProvenance(workflowId);
      const ack = rows.find((r) => r.executionId.startsWith("exec-tts-submission-") && r.providerJobId);
      assert.ok(ack, "provider job ID durable in execution_provenance");
      assert.match(ack.providerJobId, /^vt-job-\d+$/);

      // Recovery 1: same coordinator store re-run reuses the artifact — zero new synthesis.
      const rerun = await coordinator.execute(text);
      assert.equal(rerun.status, "completed");
      assert.equal(synthesizeCalls, 1, "no duplicate synthesis on recovery");
      assert.equal(mock.state.submissions, 1, "no duplicate /run on recovery");

      // Recovery 2: fresh adapter with the same durable identity reconciles by status only.
      const chunk = outcome.chunks[0];
      const [durableLogicalId] = [...executions.keys()];
      const pollsBefore = mock.state.polls;
      const recovered = await adapter().generate({
        text: chunk.text, language: "ar", voice: "Mohamed",
        logicalSubmissionId: durableLogicalId,
        workflowId, textFingerprint: chunk.textFingerprint, configurationFingerprint,
      });
      assert.equal(recovered.providerId, "voicetut");
      assert.equal(mock.state.submissions, 1, "stored job ID reused — zero additional /run submissions");
      assert.ok(mock.state.polls > pollsBefore, "recovery reconciles through the status path");
      runtime.worker.stop();
    } finally {
      runtime.worker.stop();
    }
  } finally {
    await mock.close();
  }
});
