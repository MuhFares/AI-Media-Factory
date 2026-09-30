#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ffprobeStatic from "ffprobe-static";
import { createPool } from "@ai-media-factory/database";
import {
  MediaComposeCapabilityExecutor,
  assertCanonicalFinalMedia,
  evaluateCaptionVerification,
  layoutCaption,
} from "@ai-media-factory/tool-framework";

const CONFIRMATION = "program-04-phase-4-local-composition-and-qa-canary-v1";
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split("=");
  return [key, rest.join("=")];
}));
if (!args.has("--apply") || args.get("--confirm-production") !== CONFIRMATION) {
  throw new Error(`PHASE_4_CONFIRMATION_REQUIRED:--apply --confirm-production=${CONFIRMATION}`);
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL_REQUIRED");

const ROOT = process.cwd();
// The active node_modules/ffmpeg-static binary in this checkout is an invalid
// Windows image. The repository's preserved Windows package is the validated
// canonical local binary used by prior Arabic-caption composition gates.
const FFMPEG_BIN = process.env.FFMPEG_PATH?.trim() || resolve(ROOT, "node_modules/.ignored/ffmpeg-static/ffmpeg.exe");
const OUTPUT_DIR = resolve(ROOT, "output/program-04-live-canary/phase-4");
const AUDIO_PATH = resolve(ROOT, "output/program-04-live-canary/phase-1/tts-quality-sample-48feac9ac7e900efe35f8b3b.wav");
const AUDIO_METADATA_PATH = resolve(ROOT, "output/program-04-live-canary/phase-1/tts-quality-sample-48feac9ac7e900efe35f8b3b.json");
const VIDEO_PATH = resolve(ROOT, "output/program-04-live-canary/phase-3/owner-recovered-output-video.mp4");
const CAPTION_PATH = resolve(OUTPUT_DIR, "captions-ar-EG.ass");
const EVIDENCE_PATH = resolve(OUTPUT_DIR, "phase-4-evidence.json");
const REVIEW_PATH = resolve(OUTPUT_DIR, "OWNER-REVIEW.md");

const IDS = Object.freeze({
  projectId: "morroway",
  contentId: "content-mulk44ho-kih3gg",
  workflowId: "wf-p4-canary-2b0da0ba762b65477107",
  correlationId: "corr-p4-canary-91a7723e93f4253c0309",
  sceneId: "scene-001",
  narrationArtifactId: "tts-quality-sample-artifact-48feac9ac7e900efe35f8b3b",
  narrationExecutionId: "tts-quality-sample-48feac9ac7e900efe35f8b3b",
  videoArtifactId: "art-scene-video-import-e46409193d5f74e14829258c",
  sourceVisualArtifactId: "art-scene-visual-b6796e3e71f4d8f7ce473bdf",
  compositionExecutionId: "composition-canary-e46409193d5f74e14829258c",
  timelineArtifactId: "art-timeline-canary-e46409193d5f74e14829258c",
  finalMediaArtifactId: "art-final-media-canary-e46409193d5f74e14829258c",
});
const EXPECTED = Object.freeze({
  audioSha256: "84ef7d955eae99d976e16d3eecf539b65990f91e38c592c2800020968abf6dac",
  videoSha256: "aa0ca49a4e1fe6aa95add50532ea38b71534e7b5e024b463902a3bec03d63f3d",
  narrationText: "في قلب القاهرة، كل شارع بيحكي حكاية. بين التاريخ والخيال، لحظة واحدة ممكن تفتح باب لعالم كامل. دي مورواي... رحلة عبر الزمن والخيال.",
  ttsConfigurationFingerprint: "bb5dc22ded09cf2a437c4ed129b552b2964464de028158943f8f7ad08c4d694a",
});
const TAIL_POLICY = Object.freeze({
  policyId: "program-04-phase-4-canary-last-frame-hold-v1",
  classification: "PLATFORM_VALIDATION_ONLY",
  enabled: true,
  mode: "LAST_FRAME_HOLD",
  maximumExtensionMs: 6000,
  maximumExtensionRatio: 1.2,
  safetyTailMs: 300,
  measurementToleranceMs: 40,
});

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const assTime = (ms) => {
  const cs = Math.max(0, Math.round(ms / 10));
  const hours = Math.floor(cs / 360000);
  const minutes = Math.floor((cs % 360000) / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const assEscape = (text) => text.replace(/\\/gu, "\\\\").replace(/\{/gu, "\\{").replace(/\}/gu, "\\}");

function run(bin, runArgs) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(bin, runArgs, { shell: false, windowsHide: true, env: process.env });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", rejectPromise);
    child.once("close", (code) => code === 0
      ? resolvePromise({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })
      : rejectPromise(new Error(`${bin} exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(-1600)}`)));
  });
}

async function probe(path) {
  const result = await run(ffprobeStatic.path, ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]);
  return JSON.parse(result.stdout);
}

function mediaMetadata(probed) {
  const video = probed.streams.find((stream) => stream.codec_type === "video");
  const audio = probed.streams.find((stream) => stream.codec_type === "audio");
  const durationMs = Math.round(Number(probed.format?.duration) * 1000);
  return { video, audio, durationMs };
}

await mkdir(OUTPUT_DIR, { recursive: true });
for (const path of [AUDIO_PATH, AUDIO_METADATA_PATH, VIDEO_PATH]) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) throw new Error(`PHASE_4_INPUT_FILE_INVALID:${path}`);
}
const [audioBytes, videoBytes, audioMetadataRaw] = await Promise.all([
  readFile(AUDIO_PATH), readFile(VIDEO_PATH), readFile(AUDIO_METADATA_PATH, "utf8"),
]);
if (sha256(audioBytes) !== EXPECTED.audioSha256) throw new Error("PHASE_4_NARRATION_HASH_MISMATCH");
if (sha256(videoBytes) !== EXPECTED.videoSha256) throw new Error("PHASE_4_VIDEO_HASH_MISMATCH");
const audioMetadata = JSON.parse(audioMetadataRaw);
if (audioMetadata.artifactId !== IDS.narrationArtifactId || audioMetadata.sampleExecutionId !== IDS.narrationExecutionId || audioMetadata.inputText !== EXPECTED.narrationText || audioMetadata.configurationFingerprint !== EXPECTED.ttsConfigurationFingerprint || audioMetadata.technicalValidation !== "PASS") {
  throw new Error("PHASE_4_NARRATION_ARTIFACT_MISMATCH");
}

const [audioProbe, videoProbe] = await Promise.all([probe(AUDIO_PATH), probe(VIDEO_PATH)]);
const audioInfo = mediaMetadata(audioProbe);
const videoInfo = mediaMetadata(videoProbe);
if (!audioInfo.audio || audioInfo.durationMs <= 0) throw new Error("PHASE_4_NARRATION_STREAM_INVALID");
if (!videoInfo.video || videoInfo.video.width !== 480 || videoInfo.video.height !== 832 || videoInfo.durationMs <= 0) throw new Error("PHASE_4_VIDEO_STREAM_INVALID");

const segments = [
  { startMs: 0, endMs: 3500, text: "في قلب القاهرة، كل شارع بيحكي حكاية." },
  { startMs: 3500, endMs: 7500, text: "بين التاريخ والخيال، لحظة واحدة ممكن تفتح باب لعالم كامل." },
  { startMs: 7500, endMs: audioInfo.durationMs, text: "دي مورواي... رحلة عبر الزمن والخيال." },
];
if (segments.map((item) => item.text).join(" ") !== EXPECTED.narrationText || segments[0].startMs !== 0 || segments.at(-1).endMs !== audioInfo.durationMs || segments.some((item, index) => item.endMs <= item.startMs || (index > 0 && item.startMs !== segments[index - 1].endMs))) {
  throw new Error("PHASE_4_CAPTION_TIMELINE_INVALID");
}
const captionLayouts = segments.map((item) => ({ ...item, layout: layoutCaption(item.text) }));
if (captionLayouts.some((item) => item.layout.verdict !== "PASS")) throw new Error("PHASE_4_CAPTION_LAYOUT_INVALID");
const assEvents = captionLayouts.map((item) => {
  const rendered = item.layout.lines.map(assEscape).join("\\N");
  return `Dialogue: 0,${assTime(item.startMs)},${assTime(item.endMs)},ArabicSafe,,0,0,,{\\an2}${rendered}`;
}).join("\n");
const ass = `[Script Info]\nScriptType: v4.00+\nPlayResX: 480\nPlayResY: 832\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: ArabicSafe,Arial,24,&H00FFFFFF,&H00FFFFFF,&H00101010,&H99000000,0,0,0,0,100,100,0,0,1,2,1,2,36,36,112,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, Effect, Text\n${assEvents}\n`;
await writeFile(CAPTION_PATH, ass, "utf8");
const captionSha256 = sha256(await readFile(CAPTION_PATH));
process.env.FONTCONFIG_FILE = resolve(ROOT, "configs/media/fontconfig-arabic.conf");

const pool = createPool({ connectionString: process.env.DATABASE_URL, max: 1 });
let source;
try {
  const queue = await pool.query("SELECT status,count(*)::int AS count FROM workflow_jobs WHERE status IN ('queued','running') GROUP BY status");
  if (queue.rowCount) throw new Error("PHASE_4_QUEUE_CONFLICT");
  const rows = await pool.query("SELECT artifact_id,workflow_id,correlation_id,payload FROM artifacts WHERE artifact_id=$1 AND kind='scene_video_clip'", [IDS.videoArtifactId]);
  if (rows.rowCount !== 1) throw new Error("PHASE_4_VIDEO_ARTIFACT_MISSING");
  source = rows.rows[0];
  const payload = source.payload;
  if (source.workflow_id !== IDS.workflowId || source.correlation_id !== IDS.correlationId || payload.projectId !== IDS.projectId || payload.contentId !== IDS.contentId || payload.sceneId !== IDS.sceneId || payload.videoSha256 !== EXPECTED.videoSha256 || payload.sourceVisualArtifactId !== IDS.sourceVisualArtifactId || payload.technicalValidation?.status !== "PASS") {
    throw new Error("PHASE_4_VIDEO_LINEAGE_MISMATCH");
  }
  const existing = await pool.query("SELECT artifact_id,payload FROM artifacts WHERE artifact_id=$1 OR (kind='final_media_artifact' AND workflow_id=$2)", [IDS.finalMediaArtifactId, IDS.workflowId]);
  if (existing.rowCount) {
    if (existing.rowCount !== 1 || existing.rows[0].artifact_id !== IDS.finalMediaArtifactId || existing.rows[0].payload?.sourceVideoSha256 !== EXPECTED.videoSha256 || existing.rows[0].payload?.sourceNarrationSha256 !== EXPECTED.audioSha256) throw new Error("PHASE_4_FINAL_MEDIA_CONFLICT");
    console.log(JSON.stringify({ outcome: "ALREADY_COMPOSED", artifact: existing.rows[0] }, null, 2));
    process.exitCode = 0;
  } else {
    const resolver = {
      resolve: (id) => id === "media.compose" ? { capabilityId: id } : null,
      isAuthorized: (agent, id) => agent === "composer" && id === "media.compose",
    };
    const composer = new MediaComposeCapabilityExecutor({
      allowedRoots: [resolve(ROOT, "output")],
      outputDir: OUTPUT_DIR,
      ffmpegBin: FFMPEG_BIN,
      ffprobeBin: ffprobeStatic.path,
      probeTimeoutMs: 30_000,
      composeTimeoutMs: 180_000,
    }, resolver);
    const result = await composer.execute({
      requestId: IDS.compositionExecutionId,
      capabilityId: "media.compose",
      agentId: "composer",
      workflowId: IDS.workflowId,
      correlationId: IDS.correlationId,
      requestedAt: new Date().toISOString(),
      input: {
        video: VIDEO_PATH,
        audio: AUDIO_PATH,
        outputFormat: "mp4",
        audioStrategy: "pad",
        preserveVideoAudio: false,
        editing: { captionsPath: CAPTION_PATH },
        productionComposition: {
          workflowId: IDS.workflowId,
          timelineArtifactId: IDS.timelineArtifactId,
          narrationArtifactId: IDS.narrationArtifactId,
          sceneIds: [IDS.sceneId],
          clipArtifactIds: [IDS.videoArtifactId],
          clipPaths: [VIDEO_PATH],
          narrationIdentity: IDS.narrationExecutionId,
          videoTailPadPolicy: TAIL_POLICY,
        },
      },
    });
    if (result.status !== "success") throw new Error(`PHASE_4_COMPOSITION_FAILED:${JSON.stringify(result)}`);
    const output = result.output;
    const reconciliation = output.durationReconciliation;
    if (!reconciliation || reconciliation.initialDecision.fitStatus !== "VIDEO_TAIL_PAD_REQUIRED" || reconciliation.padMode !== "LAST_FRAME_HOLD" || reconciliation.padExecutions !== 1 || reconciliation.postPadDecision?.fitStatus !== "PASS") throw new Error("PHASE_4_DURATION_RECONCILIATION_INVALID");
    const finalInfo = mediaMetadata(await probe(output.output.path));
    if (!finalInfo.video || !finalInfo.audio || finalInfo.video.width !== 480 || finalInfo.video.height !== 832 || finalInfo.durationMs + 40 < audioInfo.durationMs) throw new Error("PHASE_4_FINAL_TECHNICAL_QA_FAILED");
    const outputBytes = await readFile(output.output.path);
    if (sha256(outputBytes) !== output.output.sha256 || outputBytes.length !== output.output.bytes) throw new Error("PHASE_4_FINAL_OUTPUT_IDENTITY_MISMATCH");
    const captionMode = evaluateCaptionVerification({
      required: true,
      sidecarPresent: true,
      rendererBurnInReceipt: { outputSha256: output.output.sha256, captionTrackSha256: captionSha256 },
      pixelSemanticReview: "UNAVAILABLE",
    });
    if (captionMode !== "HUMAN_REVIEW_REQUIRED") throw new Error("PHASE_4_CAPTION_HONESTY_INVALID");
    assertCanonicalFinalMedia({
      artifactId: IDS.finalMediaArtifactId,
      projectId: IDS.projectId,
      contentId: IDS.contentId,
      workflowId: IDS.workflowId,
      storageReference: output.output.path,
      bytes: output.output.bytes,
      sha256: output.output.sha256,
      durationMs: finalInfo.durationMs,
      width: finalInfo.video.width,
      height: finalInfo.video.height,
      videoCodec: String(finalInfo.video.codec_name),
      audioCodec: String(finalInfo.audio.codec_name),
      compositionStrategy: "SINGLE_NATIVE_CLIP_THEN_LAST_FRAME_HOLD_WITH_BURNED_IN_CAPTIONS",
      sourceArtifactIds: [IDS.narrationArtifactId, IDS.videoArtifactId, IDS.sourceVisualArtifactId, IDS.timelineArtifactId],
      captionMode,
      narrationFit: "PASS",
    });
    const now = new Date().toISOString();
    const timelinePayload = {
      artifactId: IDS.timelineArtifactId, projectId: IDS.projectId, contentId: IDS.contentId, workflowId: IDS.workflowId,
      correlationId: IDS.correlationId, stage: "timeline", status: "completed", sceneIds: [IDS.sceneId], createdAt: now,
      narration: { artifactId: IDS.narrationArtifactId, executionId: IDS.narrationExecutionId, sha256: EXPECTED.audioSha256, startMs: 0, endMs: audioInfo.durationMs },
      visualTimeline: [
        { sourceArtifactId: IDS.videoArtifactId, mode: "NATIVE_CLIP", startMs: 0, endMs: videoInfo.durationMs },
        { sourceArtifactId: IDS.videoArtifactId, mode: "LAST_FRAME_HOLD", startMs: videoInfo.durationMs, endMs: audioInfo.durationMs },
      ],
      durationPolicy: TAIL_POLICY, finalDurationMs: finalInfo.durationMs, validation: "PASS",
    };
    const finalPayload = {
      artifactId: IDS.finalMediaArtifactId, projectId: IDS.projectId, contentId: IDS.contentId, workflowId: IDS.workflowId,
      correlationId: IDS.correlationId, sceneId: IDS.sceneId, stage: "composer", status: "completed", createdAt: now,
      producerExecutionId: IDS.compositionExecutionId, sourceNarrationArtifactId: IDS.narrationArtifactId,
      sourceNarrationExecutionId: IDS.narrationExecutionId, sourceNarrationSha256: EXPECTED.audioSha256,
      sourceVideoArtifactId: IDS.videoArtifactId, sourceVideoSha256: EXPECTED.videoSha256,
      sourceVisualArtifactId: IDS.sourceVisualArtifactId, timelineArtifactId: IDS.timelineArtifactId,
      finalFileReference: output.output.path, storageReference: output.output.path, byteCount: output.output.bytes,
      sha256: output.output.sha256, durationMs: finalInfo.durationMs, width: finalInfo.video.width, height: finalInfo.video.height,
      videoCodec: String(finalInfo.video.codec_name), audioCodec: String(finalInfo.audio.codec_name), container: "mp4",
      compositionStrategy: "SINGLE_NATIVE_CLIP_THEN_LAST_FRAME_HOLD_WITH_BURNED_IN_CAPTIONS",
      durationReconciliation: reconciliation,
      captionEvidence: { mode: captionMode, burnedIn: true, sidecarPath: CAPTION_PATH, captionTrackSha256: captionSha256, exactTextHash: sha256(Buffer.from(EXPECTED.narrationText, "utf8")), segments: captionLayouts, renderer: "FFMPEG_SUBTITLES_LIBASS", renderReceipt: { outputSha256: output.output.sha256, captionTrackSha256: captionSha256 }, semanticVerification: "HUMAN_REVIEW_REQUIRED", timingValidation: "PASS" },
      musicStage: "DEFERRED_NOT_CANONICAL", technicalQa: { status: "PASS", readableVideo: true, readableAudio: true, dimensions: "PASS", narrationCoverage: "PASS", narrationTruncated: false, sourceLineage: "PASS", tailExtension: "PASS", captionsRendered: true, captionSemanticVerification: "HUMAN_REVIEW_REQUIRED", codecsContainer: "PASS" },
      semanticQa: "AWAITING_OWNER_REVIEW", finalProductApproved: false,
      ownerVideoDecision: "APPROVE_FOR_COMPOSITION_CANARY", approvalScope: "PROGRAM_04_PHASE_4_COMPOSITION_CANARY_ONLY",
      localOnly: true, providerCalls: 0, generationBudgetMutations: 0,
    };
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [IDS.compositionExecutionId]);
      const conflict = await client.query("SELECT artifact_id FROM artifacts WHERE artifact_id IN ($1,$2) OR (kind='final_media_artifact' AND workflow_id=$3)", [IDS.timelineArtifactId, IDS.finalMediaArtifactId, IDS.workflowId]);
      if (conflict.rowCount) throw new Error("PHASE_4_PERSISTENCE_IDEMPOTENCY_CONFLICT");
      await client.query("INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at,parent_artifact_id,parent_artifact_kind) VALUES($1,$2,'timeline_plan','timeline',$3,'completed',$4::jsonb,'application/json','1',$5,$6,'scene_video_clip')", [IDS.timelineArtifactId, IDS.workflowId, IDS.correlationId, JSON.stringify(timelinePayload), now, IDS.videoArtifactId]);
      await client.query("INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at,parent_artifact_id,parent_artifact_kind) VALUES($1,$2,'final_media_artifact','composer',$3,'completed',$4::jsonb,'application/json','1',$5,$6,'timeline_plan')", [IDS.finalMediaArtifactId, IDS.workflowId, IDS.correlationId, JSON.stringify(finalPayload), now, IDS.timelineArtifactId]);
      await client.query("INSERT INTO execution_lifecycle_events(execution_id,workflow_id,stage,state,occurred_at,attempt_number,metadata) VALUES($1,$2,'composer','OWNER_APPROVED_FOR_COMPOSITION_CANARY',$3,1,$4::jsonb),($1,$2,'composer','LOCAL_COMPOSITION_COMPLETED',$3,1,$5::jsonb)", [IDS.compositionExecutionId, IDS.workflowId, now, JSON.stringify({ ownerDecision: "APPROVE_FOR_COMPOSITION_CANARY", approvalScope: "PROGRAM_04_PHASE_4_COMPOSITION_CANARY_ONLY", sourceVideoArtifactId: IDS.videoArtifactId }), JSON.stringify({ finalMediaArtifactId: IDS.finalMediaArtifactId, timelineArtifactId: IDS.timelineArtifactId, outputSha256: output.output.sha256, technicalQa: "PASS", semanticQa: "AWAITING_OWNER_REVIEW", providerCalls: 0, generationBudgetMutations: 0 })]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const evidence = { phase: "AMF_PROGRAM_04_PHASE_4_LOCAL_COMPOSITION_AND_QA_CANARY_V1", status: "PASS_LIVE_LOCAL_ONLY", ids: IDS, narration: { artifactId: IDS.narrationArtifactId, sha256: EXPECTED.audioSha256, durationMs: audioInfo.durationMs }, video: { artifactId: IDS.videoArtifactId, sha256: EXPECTED.videoSha256, durationMs: videoInfo.durationMs }, timeline: timelinePayload, captions: finalPayload.captionEvidence, composition: output, final: { artifactId: IDS.finalMediaArtifactId, path: output.output.path, bytes: output.output.bytes, sha256: output.output.sha256, durationMs: finalInfo.durationMs, width: finalInfo.video.width, height: finalInfo.video.height, videoCodec: finalInfo.video.codec_name, audioCodec: finalInfo.audio.codec_name }, qa: finalPayload.technicalQa, semanticQa: "AWAITING_OWNER_REVIEW", finalProductApproved: false, calls: { providers: 0, tts: 0, image: 0, video: 0, upload: 0, analytics: 0 }, budgetMutations: { voice: 0, image: 0, video: 0 } };
    await writeFile(EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await writeFile(REVIEW_PATH, `# Program 4 Phase 4 Owner review\n\nFinal media: ${output.output.path}\n\nTechnical QA: PASS\nSemantic QA: AWAITING_OWNER_REVIEW\nCaptions: burned in; Arabic rendering/readability requires Owner review.\nDuration policy: native clip then deterministic last-frame hold.\n\nDecision: APPROVE_FOR_PRIVATE_PUBLICATION_CANARY / REJECT\n`, "utf8");
    console.log(JSON.stringify(evidence, null, 2));
  }
} finally {
  await pool.end();
}
