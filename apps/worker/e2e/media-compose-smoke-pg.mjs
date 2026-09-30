/**
 * Real Media Compose smoke — LOCAL FFmpeg, zero external cost.
 *
 * Reuses:
 *   REAL Wan2.2 MP4 already in output/  (wan-latest.mp4 or first output/*.mp4)
 *   REAL VoiceTuT WAV: output/tts-benchmark/voicetut-short.wav
 *
 * Path:
 *   Media Agent → media.compose → authorization → capability executor
 *   → FFmpeg adapter (ffprobe + ffmpeg) → real ffmpeg → final MP4
 *   → evidence → PostgreSQL → output/media-compose/<mediaId>.mp4
 *
 * Does NOT call FLUX / Wan / VoiceTuT / any RunPod endpoint.
 *
 * Run:
 *   node --env-file=.env apps/worker/e2e/media-compose-smoke-pg.mjs [shortest|trim|pad]
 *
 * Exit: 0 PASS/SKIP, 42 BLOCKED (DB/ffprobe/ffmpeg), 1 failure.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createPool, migrate, PostgresPersistence } from "@ai-media-factory/database";
import { createCapabilityRegistry, createMediaComposeCapability } from "@ai-media-factory/tool-framework";
import { createMediaAgent } from "@ai-media-factory/media-agent";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { RoutingCapabilityExecutor, PROVIDER_CAPABILITIES, DEFAULT_PROVIDER_GRANTS } from "@ai-media-factory/provider-adapters";

// --- ffprobe helper for human-readable reporting (not the capability's internal probe) ---
function ffprobeJson(file) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file], { shell: false, windowsHide: true });
    const chunks = []; const errs = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("ffprobe timeout")); }, 10000);
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => errs.push(c));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffprobe exit ${code}: ${Buffer.concat(errs).toString().slice(0,300)}`));
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); }
    });
  });
}

const strategy = process.argv[2] ?? "shortest";
if (!["shortest", "trim", "pad"].includes(strategy)) { console.error(`unknown strategy: ${strategy} (use shortest|trim|pad)`); process.exit(1); }

// --- Discover real artifacts ---
const candidates = [
  path.resolve("output/wan-latest.mp4"),
  path.resolve("output/animated-cat-manual.mp4"),
];
let videoPath = candidates.find((p) => fs.existsSync(p));
if (!videoPath) {
  const mp4s = fs.readdirSync(path.resolve("output")).filter((f) => f.endsWith(".mp4")).map((f) => path.resolve("output", f));
  videoPath = mp4s[0] ?? null;
}
const audioPath = path.resolve("output/tts-benchmark/voicetut-short.wav");

if (!videoPath || !fs.existsSync(videoPath)) { console.log("media-compose-smoke-pg: BLOCKED — no real Wan MP4 found in output/"); process.exit(42); }
if (!fs.existsSync(audioPath)) { console.log("media-compose-smoke-pg: BLOCKED — missing output/tts-benchmark/voicetut-short.wav (run tts-voicetut smoke first)"); process.exit(42); }

// --- Check ffmpeg/ffprobe ---
try {
  await new Promise((res, rej) => {
    const c = spawn("ffmpeg", ["-version"], { shell: false, windowsHide: true });
    c.on("error", rej); c.on("close", (code) => code === 0 ? res() : rej(new Error(`ffmpeg exit ${code}`)));
    setTimeout(() => { c.kill(); rej(new Error("ffmpeg timeout")); }, 5000);
  });
  await new Promise((res, rej) => {
    const c = spawn("ffprobe", ["-version"], { shell: false, windowsHide: true });
    c.on("error", rej); c.on("close", (code) => code === 0 ? res() : rej(new Error(`ffprobe exit ${code}`)));
    setTimeout(() => { c.kill(); rej(new Error("ffprobe timeout")); }, 5000);
  });
} catch (e) {
  console.log(`media-compose-smoke-pg: BLOCKED — ffmpeg/ffprobe not available: ${e.message}`);
  process.exit(42);
}

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const WORKFLOW_ID = `wf-media-compose-${Date.now()}`;
const CORRELATION_ID = `corr-media-compose-${Date.now()}`;
const REQUEST_ID = `req-media-compose-${Date.now()}`;

const pool = createPool({ connectionString: DATABASE_URL });
try { await pool.query("SELECT 1"); } catch (e) {
  console.log("media-compose-smoke-pg: BLOCKED — Postgres unreachable:", e?.message ?? String(e));
  await pool.end().catch(() => {});
  process.exit(42);
}

let finalArtifactPath = null;
try {
  await migrate(pool);
  const persistence = new PostgresPersistence(pool);

  // Probe inputs for reporting
  const vProbe = await ffprobeJson(videoPath);
  const aProbe = await ffprobeJson(audioPath);
  const vStream = vProbe.streams.find((s) => s.codec_type === "video");
  const aStream = aProbe.streams.find((s) => s.codec_type === "audio");
  const videoDurationMs = Math.round(Number(vStream.duration ?? vProbe.format.duration) * 1000);
  const audioDurationMs = Math.round(Number(aStream.duration ?? aProbe.format.duration) * 1000);
  const vBytes = fs.statSync(videoPath).size;
  const aBytes = fs.statSync(audioPath).size;
  const vHash = createHash("sha256").update(fs.readFileSync(videoPath)).digest("hex").slice(0, 16);
  const aHash = createHash("sha256").update(fs.readFileSync(audioPath)).digest("hex").slice(0, 16);
  console.log(`media-compose-smoke-pg: inputs:`);
  console.log(`  video: ${path.basename(videoPath)}  ${vBytes} bytes  ${vStream.codec_name} ${vStream.width}x${vStream.height}  ${videoDurationMs}ms  hash=${vHash}`);
  console.log(`  audio: ${path.basename(audioPath)}  ${aBytes} bytes  ${aStream.codec_name} ${aStream.sample_rate}Hz  ${audioDurationMs}ms  hash=${aHash}`);
  console.log(`  strategy: ${strategy}`);
  console.log(`  gap: audio - video = ${audioDurationMs - videoDurationMs}ms  (timeline discovery)`);

  // Wire capability exactly like production boundary
  const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS });
  const routing = new RoutingCapabilityExecutor();
  routing.register("media.compose", createMediaComposeCapability({ resolver }));
  const boundary = new RuntimeCapabilityExecutor({ resolver, executor: routing });

  const agent = createMediaAgent({
    execute: async () => { throw new Error("LLM must not be used by media agent"); },
    capabilityExecution: boundary,
    config: { model: "deterministic", systemPrompt: "" },
  });

  console.log(`media-compose-smoke-pg: composing via media.compose [${strategy}]…`);
  const t0 = Date.now();
  const outcome = await agent.execute(
    {
      context: { turnId: REQUEST_ID },
      input: {
        requestId: REQUEST_ID,
        objective: `Media compose smoke — ${strategy}`,
        video: videoPath,
        audio: audioPath,
        audioStrategy: strategy,
        workflowId: WORKFLOW_ID,
        correlationId: CORRELATION_ID,
      },
    },
    { isCancelled: false, onCancelled: () => {}, throwIfCancelled: () => {} },
  );
  const wallMs = Date.now() - t0;
  const report = outcome.output;
  console.log(`media-compose-smoke-pg: media_report status=${report.status} (${wallMs}ms wall)`);

  const executions = Array.isArray(report.capabilityExecutions) ? report.capabilityExecutions : [];
  const execution = executions[0];
  assert.ok(execution, "capability execution must be present");

  if (execution.status !== "success") {
    console.log(`media-compose-smoke-pg: FAILED — ${execution.error?.message ?? execution.reason ?? report.summary}`);
    assert.equal(execution.evidence?.succeeded, false, "no fabricated success");
    process.exit(1);
  }

  // Verify evidence matches request
  assert.equal(execution.evidence.providerInvoked, true);
  assert.equal(execution.evidence.succeeded, true);
  assert.equal(execution.evidence.providerId, "ffmpeg");
  assert.equal(execution.evidence.capabilityId, "media.compose");
  assert.equal(execution.evidence.agentId, "composer");
  assert.equal(execution.evidence.workflowId, WORKFLOW_ID);
  assert.equal(execution.evidence.correlationId, CORRELATION_ID);

  // Persist evidence (same path as production-executor)
  await persistence.saveCapabilityExecution({
    resultId: String(execution.resultId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "media.compose", agentId: "composer", status: "success",
    evidenceId: String(execution.evidence.evidenceId), idempotencyKey: String(execution.resultId),
    executedAt: String(execution.evidence.executedAt), payload: execution,
  });
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "media.compose", agentId: "composer", executedAt: String(execution.evidence.executedAt),
    succeeded: true, idempotencyKey: String(execution.evidence.evidenceId), payload: execution,
  });

  // Fresh pool reload + idempotency
  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const evidenceRows = await readPersistence.listExecutionEvidence(WORKFLOW_ID);
  const evRow = evidenceRows.find((e) => e.capabilityId === "media.compose");
  assert.ok(evRow, "execution_evidence must be durable");
  assert.equal(evRow.succeeded, true);
  await persistence.saveExecutionEvidence({
    evidenceId: String(execution.evidence.evidenceId), workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID,
    capabilityId: "media.compose", agentId: "composer", executedAt: String(execution.evidence.executedAt),
    succeeded: true, idempotencyKey: String(execution.evidence.evidenceId), payload: execution,
  });
  const evidenceAfter = await readPersistence.listExecutionEvidence(WORKFLOW_ID);
  assert.equal(evidenceAfter.filter((e) => e.capabilityId === "media.compose").length, 1, "no duplicates");
  await reloadPool.end();
  console.log("media-compose-smoke-pg: evidence durable + idempotent (fresh pool reload)");

  // Validate output artifact
  const output = execution.output;
  finalArtifactPath = String(output.output?.path ?? report.outputPath);
  assert.ok(fs.existsSync(finalArtifactPath), `final MP4 must exist: ${finalArtifactPath}`);
  const outStat = fs.statSync(finalArtifactPath);
  assert.ok(outStat.size > 0, "final MP4 bytes > 0");

  const outProbe = await ffprobeJson(finalArtifactPath);
  const outVStream = outProbe.streams.find((s) => s.codec_type === "video");
  const outAStream = outProbe.streams.find((s) => s.codec_type === "audio");
  assert.ok(outVStream, "final MP4 must contain video stream");
  assert.ok(outAStream, "final MP4 must contain audio stream");
  assert.equal(Number(outVStream.width), Number(vStream.width), "video width must be preserved");
  assert.equal(Number(outVStream.height), Number(vStream.height), "video height must be preserved");

  const outHash = createHash("sha256").update(fs.readFileSync(finalArtifactPath)).digest("hex");
  const outDurationMs = Math.round(Number(outVStream.duration ?? outAStream.duration ?? outProbe.format.duration) * 1000);

  // Determinism: mediaId must be deterministic
  assert.match(String(output.mediaId), /^media-[a-f0-9]{12}$/, "mediaId must be deterministic media-xxx");

  console.log(`media-compose-smoke-pg: PASS — real composed MP4`);
  console.log(`  video: ${path.basename(finalArtifactPath)}  ${outStat.size} bytes  sha256=${outHash.slice(0,16)}…`);
  console.log(`  mediaId: ${output.mediaId}`);
  console.log(`  final: ${outVStream.codec_name}/${outAStream.codec_name} ${outVStream.width}x${outVStream.height}  ${outDurationMs}ms`);
  console.log(`  strategy: ${output.composition?.strategy}  videoCopied=${output.composition?.videoCopied} audioEncoded=${output.composition?.audioEncoded}`);
  console.log(`  input: video ${videoDurationMs}ms  audio ${audioDurationMs}ms  gap ${audioDurationMs - videoDurationMs}ms`);
  console.log(`  timings: probe ${output.timings?.probeInputMs}ms  compose ${output.timings?.composeMs}ms  probeOut ${output.timings?.probeOutputMs}ms  total ${output.timings?.totalMs}ms`);
  console.log(`  workflowId: ${WORKFLOW_ID}`);
  console.log(`  evidenceId: ${execution.evidence.evidenceId}`);
  console.log(`\n  Manual check: open ${finalArtifactPath} — verify video plays and narration is audible.`);
} finally {
  await pool.end().catch(() => {});
}
