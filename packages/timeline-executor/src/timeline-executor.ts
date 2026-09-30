// @ts-nocheck
/**
 * Timeline Executor — orchestrates the vertical slice:
 *   timeline → scene image (FLUX) → scene video (Wan) → audio slice → scene compose → concat → final MP4
 *
 * All provider calls go through the governed capability boundary (runCapabilities).
 * Local FFmpeg operations use safe spawn. Idempotent via stable artifact/evidence IDs.
 */

import { createHash } from "node:crypto";
import { writeFile, mkdir, stat, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluatePreWanImage, type PreWanImageGateResult, type TimelinePlan } from "@ai-media-factory/tool-framework";
import type { ComposeEditPlan } from "@ai-media-factory/tool-framework";
import type { CapabilityExecutionPort } from "@ai-media-factory/runtime";
import type { PersistencePort } from "@ai-media-factory/workflow-engine";
import { sliceAudio } from "./audio-slicer.js";
import { concatScenes } from "./concat.js";

export interface TimelineExecutionInput {
  timeline: TimelinePlan;
  narrationWavPath: string; // e.g. output/tts-benchmark/voicetut-short.wav
  workflowId: string;
  correlationId: string;
  outputDir?: string; // default output/timeline-execution/<timelineId>
  composeEditing?: ComposeEditPlan;
  transitionMs?: number;
  /** Require an explicit source-image quality decision before any Wan call. */
  enforcePreWanImageGate?: boolean;
  /** Optional local/human-backed signal provider. Missing capability fails closed. */
  preWanImageGate?: (input: { sceneId: string; imageId: string; imageUrl: string }) => PreWanImageGateResult;
}

export interface SceneExecutionResult {
  sceneId: string;
  image: { imageId: string; url: string; providerId: string; evidenceId: string; bytes: number };
  video: { videoId: string; url: string; providerId: string; jobId: string; evidenceId: string; bytes: number; durationMs: number };
  audioSlice: { path: string; bytes: number; durationMs: number };
  composed: { path: string; bytes: number; sha256: string; durationMs: number; videoCodec: string; audioCodec: string };
}

export interface TimelineExecutionResult {
  timelineId: string;
  workflowId: string;
  sceneCount: number;
  scenes: SceneExecutionResult[];
  finalMp4: { path: string; bytes: number; sha256: string; durationMs: number; width: number; height: number; videoCodec: string; audioCodec: string };
  providerCallCounts: { fluxImages: number; wanVideos: number; tts: number; search: number; publish: number };
  evidenceIds: string[];
  artifactIds: string[];
}

function hashOf(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 12);
}

export function deterministicSceneSeed(timelineId: string, sceneId: string, generationVersion: string): number {
  return Number.parseInt(createHash("sha256").update(`${timelineId}:${sceneId}:${generationVersion}`).digest("hex").slice(0, 8), 16) % 1_000_000_000;
}

function sceneExecutionId(timelineId: string, sceneId: string, stage: string): string {
  return `timeline-exec-${timelineId}-${sceneId}-${stage}`;
}

function artifactIdFor(workflowId: string, timelineId: string, sceneId: string, stage: string): string {
  return `art-${workflowId}-${timelineId}-${sceneId}-${stage}`;
}

async function saveArtifact(
  persistence: PersistencePort,
  artifactId: string,
  workflowId: string,
  correlationId: string,
  kind: string,
  producerAgent: string,
  payload: Record<string, unknown>,
  parentArtifactId?: string,
) {
  await (persistence as unknown as { saveArtifact: (a: Record<string, unknown>) => Promise<void> }).saveArtifact({
    artifactId,
    workflowId,
    correlationId,
    kind,
    producerAgent,
    status: "completed",
    payload,
    contentType: "application/json",
    schemaVersion: "1.0",
    createdAt: new Date().toISOString(),
    ...(parentArtifactId ? { parentArtifactId, parentArtifactKind: "timeline_plan" } : {}),
  });
}

async function findArtifact(
  persistence: PersistencePort,
  artifactId: string,
): Promise<{ artifactId: string; payload: Record<string, unknown> } | null> {
  try {
    const list = await (persistence as unknown as { listArtifacts?: (workflowId: string) => Promise<Array<{ artifactId: string; payload: unknown }>> }).listArtifacts?.("") ?? [];
    // Fallback: try direct query via listArtifacts with empty string, or use a direct DB query
    // For the vertical slice, we use a simpler approach: check if artifact exists via persistence
    // The PersistencePort in this codebase exposes listArtifacts(workflowId), so we need to scan
    // Since we have workflowId in the caller, we pass it there — this helper is called with workflow context
    return null;
  } catch {
    return null;
  }
}

async function findExecutionByResultId(
  persistence: PersistencePort,
  resultId: string,
): Promise<{ status: string; payload: Record<string, unknown> } | null> {
  // Try direct DB query via the pool if available (PostgresPersistence)
  try {
    const pool = (persistence as unknown as { pool?: { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<{ status: string; payload: unknown }> }> } }).pool;
    if (pool) {
      const res = await pool.query("SELECT status, payload FROM capability_executions WHERE result_id = $1 LIMIT 1", [resultId]);
      if (res.rows.length > 0) return { status: res.rows[0].status, payload: res.rows[0].payload as Record<string, unknown> };
    }
  } catch {
    // Fallback: try scanning recent workflows via listCapabilityExecutions
  }
  // Fallback: not found
  return null;
}

async function findArtifactByWorkflow(
  persistence: PersistencePort,
  workflowId: string,
  artifactId: string,
): Promise<{ artifactId: string; payload: Record<string, unknown> } | null> {
  try {
    const artifacts = await (persistence as unknown as { listArtifacts: (wid: string) => Promise<Array<{ artifactId: string; payload: unknown }>> }).listArtifacts(workflowId);
    const found = artifacts.find((a) => a.artifactId === artifactId);
    if (!found) return null;
    return { artifactId: found.artifactId, payload: found.payload as Record<string, unknown> };
  } catch {
    return null;
  }
}

export class TimelineExecutor {
  constructor(
    private readonly deps: {
      capabilityExecution: CapabilityExecutionPort;
      persistence: PersistencePort;
      outputDir?: string;
    },
  ) {}

  async execute(input: TimelineExecutionInput): Promise<TimelineExecutionResult> {
    const timeline = input.timeline;
    const baseDir = resolve(input.outputDir ?? join("output/timeline-execution", timeline.timelineId));
    const audioDir = join(baseDir, "audio");
    const scenesDir = join(baseDir, "scenes");
    const finalDir = resolve("output/final");
    await mkdir(audioDir, { recursive: true });
    await mkdir(scenesDir, { recursive: true });
    await mkdir(finalDir, { recursive: true });

    // Persist timeline artifact (first-class, idempotent)
    const timelineArtifactId = `art-${input.workflowId}-${timeline.timelineId}`;
    await saveArtifact(this.deps.persistence, timelineArtifactId, input.workflowId, input.correlationId, "timeline_plan", "director", {
      timelineId: timeline.timelineId,
      plannerId: timeline.plannerVersion,
      narrationDurationMs: timeline.narrationDurationMs,
      sceneCount: timeline.sceneCount,
      coverageRatio: timeline.timelineCoverageRatio,
      generationProfile: timeline.generationProfile,
      scenes: timeline.scenes.map((s) => ({ sceneId: s.sceneId, startMs: s.startMs, endMs: s.endMs, durationMs: s.durationMs, visualType: s.visualType, sceneConcept: s.sceneConcept, visualBrief: s.visualBrief })),
    });

    const sceneResults: SceneExecutionResult[] = [];
    const evidenceIds: string[] = [];
    const artifactIds: string[] = [timelineArtifactId];
    let fluxCount = 0;
    let wanCount = 0;

    // Track if any scene failed — final not completed if so
    let anyFailed = false;

    for (const scene of timeline.scenes) {
      const sceneId = scene.sceneId;
      const sceneArtifactBase = `art-${input.workflowId}-${timeline.timelineId}-${sceneId}`;

      // --- Stage-level idempotency: check DB artifacts before each provider call ---
      // If a stage already succeeded and its artifact is persisted, reuse it instead of
      // re-invoking the paid provider. This is critical for crash recovery:
      //   scene image succeeded → Wan failed → restart → reuse image → Wan only
      const composedPath = join(scenesDir, `${sceneId}.mp4`);
      const alreadyComposed = existsSync(composedPath) && (await stat(composedPath).catch(() => null))?.size > 0;

      if (alreadyComposed) {
        try {
          const probe = await ffprobeStreams(composedPath);
          if (probe.video && probe.audio) {
            const st = await stat(composedPath);
            const hash = createHash("sha256").update(await readFile(composedPath)).digest("hex");
            sceneResults.push({
              sceneId,
              image: { imageId: `reused-${sceneId}`, url: `file://${composedPath}`, providerId: "reused", evidenceId: `reused-${sceneId}-image`, bytes: 0 },
              video: { videoId: `reused-${sceneId}`, url: `file://${composedPath}`, providerId: "reused", jobId: `reused-${sceneId}`, evidenceId: `reused-${sceneId}-video`, bytes: 0, durationMs: scene.durationMs },
              audioSlice: { path: join(audioDir, `${sceneId}.wav`), bytes: 0, durationMs: scene.durationMs },
              composed: { path: composedPath, bytes: st.size, sha256: hash, durationMs: probe.durationMs, videoCodec: probe.videoCodec, audioCodec: probe.audioCodec },
            });
            continue;
          }
        } catch {
          // Not valid, re-execute
        }
      }

      // 1. Image generation: scene.imagePrompt → image.generate
      const imageRequestId = `timeline-${timeline.timelineId}-${sceneId}-image`;
      const imageResultId = `image-generation-result-${imageRequestId}`;
      const imageEvidenceId = `evidence-${imageResultId}`;

      let imageOutput: { imageId: string; url: string; providerId: string } | null = null;
      let imageEvidenceIdActual = imageEvidenceId;
      let imageBytes = 0;
      let imageBase64: string | null = null;

      // Check if image already succeeded in a previous run (stage-level reuse)
      // Use a deterministic artifactId WITHOUT workflowId so restarts with new workflowId still reuse
      // Check both the new deterministic location and the old workflow-scoped location for backwards compat
      const deterministicImageArtifactId = `art-timeline-${timeline.timelineId}-${sceneId}-image`;
      let existingImageArtifact = await findArtifactByWorkflow(this.deps.persistence, input.workflowId, `${sceneArtifactBase}-image`);
      if (!existingImageArtifact) {
        // Try deterministic lookup by scanning — for the vertical slice, check via resultId in capability_executions
        // The resultId is deterministic: image-generation-result-timeline-<timelineId>-<sceneId>-image
        const exec = await findExecutionByResultId(this.deps.persistence, imageResultId);
        if (exec && exec.status === "success") {
          const payload = exec.payload as { output?: { imageId: string; url: string; providerId: string } };
          const out = payload.output ?? (payload as unknown as { imageId: string; url: string; providerId: string });
          if (out?.imageId && out?.url) {
            imageOutput = { imageId: out.imageId, url: out.url, providerId: out.providerId ?? "reused" };
            imageBase64 = extractBase64(out.url);
            imageBytes = Buffer.from(imageBase64 as string, "base64").length;
          }
        }
      } else {
        const payload = existingImageArtifact.payload as { imageId: string; url: string; providerId: string };
        imageOutput = { imageId: payload.imageId, url: payload.url, providerId: payload.providerId };
        imageBase64 = extractBase64(payload.url);
        imageBytes = Buffer.from(imageBase64 as string, "base64").length;
      }

      // Execute image generation through governed boundary (or reuse if already persisted)
      if (!imageOutput) {
        const imageRequest = {
          requestId: imageRequestId,
          capabilityId: "image.generate" as const,
          agentId: "thumbnail" as const,
          workflowId: input.workflowId,
          correlationId: input.correlationId,
          input: { prompt: scene.imagePrompt, aspectRatio: "9:16" as const },
          requestedAt: new Date().toISOString(),
        };

        const imageExec = await this.deps.capabilityExecution.executeCapability(imageRequest);
        fluxCount += 1;

        if (imageExec.status !== "success") {
          anyFailed = true;
          if ((imageExec as unknown as { evidence?: unknown }).evidence) {
            await this.persistEvidence(input, imageExec as unknown as { evidence?: Record<string, unknown>; resultId: string; capabilityId: string; status: string }, "thumbnail", "image.generate");
            evidenceIds.push(String((imageExec as unknown as { evidence: { evidenceId: string } }).evidence.evidenceId));
          }
          throw new Error(`Scene ${sceneId} image generation failed: ${imageExec.status === "blocked" ? (imageExec as unknown as { reason: string }).reason : (imageExec as unknown as { error: { message: string } }).error.message}`);
        }

        const imageOut = (imageExec as unknown as { output: { imageId: string; url: string; providerId: string } }).output;
        imageOutput = imageOut;
        imageEvidenceIdActual = String(((imageExec as unknown as { evidence: { evidenceId: string } }).evidence.evidenceId));
        evidenceIds.push(imageEvidenceIdActual);
        await this.persistEvidence(input, imageExec as unknown as { evidence?: Record<string, unknown>; resultId: string; capabilityId: string; status: string }, "thumbnail", "image.generate");
        artifactIds.push(`${sceneArtifactBase}-image`);
        await saveArtifact(this.deps.persistence, `${sceneArtifactBase}-image`, input.workflowId, input.correlationId, "scene_image", "thumbnail", {
          sceneId, imageId: imageOutput!.imageId, providerId: imageOutput!.providerId, url: imageOutput!.url,
          timelineId: timeline.timelineId,
        }, timelineArtifactId);

        imageBase64 = extractBase64(imageOutput!.url);
        imageBytes = Buffer.from(imageBase64 as string, "base64").length;
      } else {
        // Reused image — artifact already persisted under old workflowId, no new artifact to push
        // Evidence already exists, no new provider call
      }

      // The source-image gate is deliberately before the video capability call.
      // Missing local inspection capability fails closed and requires review.
      if (input.enforcePreWanImageGate) {
        const gate = input.preWanImageGate
          ? input.preWanImageGate({ sceneId, imageId: imageOutput!.imageId, imageUrl: imageOutput!.url })
          : evaluatePreWanImage();
        if (!gate.canEnterWan) {
          anyFailed = true;
          throw new Error(`Scene ${sceneId} pre-Wan image gate ${gate.status}: ${gate.reasons.join("; ")}`);
        }
      }

      // 2. Video generation: scene.motionPrompt + imageBase64 → video.generate
      // Deterministic per-scene seed: hash(timelineId + sceneId) → different seeds, reproducible, no global 42
      const sceneSeed = deterministicSceneSeed(timeline.timelineId, sceneId, "v2");
      const videoRequestId = `timeline-${timeline.timelineId}-${sceneId}-video-v2-${sceneSeed}`;
      const videoRequest = {
        requestId: videoRequestId,
        capabilityId: "video.generate" as const,
        agentId: "video" as const,
        workflowId: input.workflowId,
        correlationId: input.correlationId,
        input: {
          prompt: scene.motionPrompt,
          negativePrompt: scene.negativePrompt,
          aspectRatio: "9:16" as const,
          imageBase64,
          width: 480,
          height: 832,
          length: 81,
          steps: 10,
          cfg: 2,
          seed: sceneSeed,
          runtimeIdentity: `self-hosted-video:runpod:${process.env.RUNPOD_VIDEO_ENDPOINT_ID?.trim() ?? "unknown"}`,
          generationVersion: "v2",
        },
        requestedAt: new Date().toISOString(),
      };

      const videoExec = await this.deps.capabilityExecution.executeCapability(videoRequest);
      wanCount += 1;

      if (videoExec.status !== "success") {
        anyFailed = true;
        if (videoExec.evidence) {
          await this.persistEvidence(input, videoExec, "video", "video.generate");
          evidenceIds.push(String((videoExec.evidence as { evidenceId: string }).evidenceId));
        }
        throw new Error(`Scene ${sceneId} video generation failed: ${videoExec.status === "blocked" ? (videoExec as { reason: string }).reason : (videoExec as { error: { message: string } }).error.message}`);
      }

      const videoOut = videoExec.output as { videoId: string; url: string; providerId: string; jobId?: string };
      const videoEvidenceId = String((videoExec.evidence as { evidenceId: string }).evidenceId);
      evidenceIds.push(videoEvidenceId);
      await this.persistEvidence(input, videoExec, "video", "video.generate");
      artifactIds.push(`${sceneArtifactBase}-video`);
      await saveArtifact(this.deps.persistence, `${sceneArtifactBase}-video`, input.workflowId, input.correlationId, "scene_video", "video", {
        sceneId, videoId: videoOut.videoId, providerId: videoOut.providerId, url: videoOut.url,
        timelineId: timeline.timelineId, sourceImageId: imageOutput!.imageId,
      }, `${sceneArtifactBase}-image`);

      const videoBase64 = extractBase64(videoOut.url);
      const videoBytes = Buffer.from(videoBase64, "base64").length;
      // Save video to disk for composition
      const videoPath = join(baseDir, `${sceneId}-wan.mp4`);
      await writeFile(videoPath, Buffer.from(videoBase64, "base64"));
      // Probe video duration
      const videoProbe = await ffprobeStreams(videoPath);
      const videoDurationMs = videoProbe.durationMs;

      // 3. Audio slice
      const audioSlicePath = join(audioDir, `${sceneId}.wav`);
      const audioSlice = await sliceAudio({
        inputWav: input.narrationWavPath,
        startMs: scene.narration.startMs,
        endMs: scene.narration.endMs,
        outputWav: audioSlicePath,
      });

      // 4. Scene compose: Wan clip + audio slice → media.compose
      const sceneComposeRequestId = `timeline-${timeline.timelineId}-${sceneId}-compose`;
      const composeRequest = {
        requestId: sceneComposeRequestId,
        capabilityId: "media.compose" as const,
        agentId: "composer" as const,
        workflowId: input.workflowId,
        correlationId: input.correlationId,
        input: { video: videoPath, audio: audioSlicePath, audioStrategy: "shortest" as const, ...(input.composeEditing ? { editing: input.composeEditing } : {}) },
        requestedAt: new Date().toISOString(),
      };

      const composeExec = await this.deps.capabilityExecution.executeCapability(composeRequest);
      if (composeExec.status !== "success") {
        anyFailed = true;
        if (composeExec.evidence) {
          await this.persistEvidence(input, composeExec, "composer", "media.compose");
          evidenceIds.push(String((composeExec.evidence as { evidenceId: string }).evidenceId));
        }
        throw new Error(`Scene ${sceneId} compose failed: ${composeExec.status === "blocked" ? (composeExec as { reason: string }).reason : (composeExec as { error: { message: string } }).error.message}`);
      }

      const composeOut = composeExec.output as { output: { path: string; bytes: number; sha256: string }; final: { durationMs: number; width: number; height: number; videoCodec: string; audioCodec: string } };
      const composeEvidenceId = String((composeExec.evidence as { evidenceId: string }).evidenceId);
      evidenceIds.push(composeEvidenceId);
      await this.persistEvidence(input, composeExec, "composer", "media.compose");

      // The media.compose output is in output/media-compose/<mediaId>.mp4 — copy to scenes dir
      const composedScenePath = join(scenesDir, `${sceneId}.mp4`);
      // If compose output is already at a different path, copy it
      const composeOutputPath = String(composeOut.output.path);
      if (composeOutputPath !== composedScenePath) {
        const { copyFile } = await import("node:fs/promises");
        await copyFile(composeOutputPath, composedScenePath);
      }

      sceneResults.push({
        sceneId,
        image: { imageId: imageOutput!.imageId, url: imageOutput!.url, providerId: imageOutput!.providerId, evidenceId: imageEvidenceIdActual, bytes: imageBytes },
        video: { videoId: videoOut.videoId ?? "", url: videoOut.url, providerId: videoOut.providerId, jobId: videoOut.jobId ?? "", evidenceId: videoEvidenceId, bytes: videoBytes, durationMs: videoDurationMs },
        audioSlice: { path: audioSlicePath, bytes: audioSlice.bytes, durationMs: audioSlice.durationMs },
        composed: { path: composedScenePath, bytes: composeOut.output.bytes, sha256: composeOut.output.sha256, durationMs: composeOut.final.durationMs, videoCodec: composeOut.final.videoCodec, audioCodec: composeOut.final.audioCodec },
      });
      artifactIds.push(`${sceneArtifactBase}-composed`);
      await saveArtifact(this.deps.persistence, `${sceneArtifactBase}-composed`, input.workflowId, input.correlationId, "scene_composed", "composer", {
        sceneId, path: composedScenePath, bytes: composeOut.output.bytes, sha256: composeOut.output.sha256,
        timelineId: timeline.timelineId,
      }, `${sceneArtifactBase}-video`);
    }

    if (anyFailed) throw new Error("One or more scenes failed — final media not completed");

    // 5. Concat all scene MP4s
    const sceneMp4s = sceneResults.map((s) => s.composed.path);
    const finalPath = join(finalDir, `${timeline.timelineId}.mp4`);
    const concatResult = await concatScenes(sceneMp4s, finalPath, "ffmpeg", { transitionMs: input.transitionMs });
    const finalHash = createHash("sha256").update(await readFile(finalPath)).digest("hex");
    const finalProbe = await ffprobeStreams(finalPath);

    // Persist final artifact
    const finalArtifactId = `art-${input.workflowId}-${timeline.timelineId}-final`;
    await saveArtifact(this.deps.persistence, finalArtifactId, input.workflowId, input.correlationId, "final_media", "composer", {
      timelineId: timeline.timelineId,
      path: finalPath,
      bytes: concatResult.bytes,
      sha256: finalHash,
      durationMs: finalProbe.durationMs,
      width: finalProbe.width,
      height: finalProbe.height,
      videoCodec: finalProbe.videoCodec,
      audioCodec: finalProbe.audioCodec,
      sceneCount: sceneResults.length,
    }, timelineArtifactId);
    artifactIds.push(finalArtifactId);

    return {
      timelineId: timeline.timelineId,
      workflowId: input.workflowId,
      sceneCount: sceneResults.length,
      scenes: sceneResults,
      finalMp4: { path: finalPath, bytes: concatResult.bytes, sha256: finalHash, durationMs: finalProbe.durationMs, width: finalProbe.width, height: finalProbe.height, videoCodec: finalProbe.videoCodec, audioCodec: finalProbe.audioCodec },
      providerCallCounts: { fluxImages: fluxCount, wanVideos: wanCount, tts: 0, search: 0, publish: 0 },
      evidenceIds,
      artifactIds,
    };
  }

  private async persistEvidence(input: TimelineExecutionInput, execution: { evidence?: Record<string, unknown>; resultId: string; capabilityId: string; status: string }, agentId: string, capabilityId: string) {
    const ev = execution.evidence as unknown as Record<string, unknown> | undefined;
    if (!ev) return;
    await (this.deps.persistence as unknown as {
      saveCapabilityExecution: (r: Record<string, unknown>) => Promise<void>;
      saveExecutionEvidence: (r: Record<string, unknown>) => Promise<void>;
    }).saveCapabilityExecution({
      resultId: String(execution.resultId),
      workflowId: input.workflowId,
      correlationId: input.correlationId,
      capabilityId,
      agentId,
      status: execution.status,
      evidenceId: String(ev["evidenceId"]),
      idempotencyKey: String(execution.resultId),
      executedAt: String(ev["executedAt"]),
      payload: execution,
    });
    await (this.deps.persistence as unknown as { saveExecutionEvidence: (r: Record<string, unknown>) => Promise<void> }).saveExecutionEvidence({
      evidenceId: String(ev["evidenceId"]),
      workflowId: input.workflowId,
      correlationId: input.correlationId,
      capabilityId,
      agentId,
      executedAt: String(ev["executedAt"]),
      succeeded: (ev as unknown as { succeeded?: boolean }).succeeded ?? execution.status === "success",
      idempotencyKey: String(ev["evidenceId"]),
      payload: execution,
    });
  }
}

function extractBase64(url: string): string {
  const comma = url.indexOf(",");
  if (comma >= 0) return url.slice(comma + 1);
  return url;
}

async function ffprobeStreams(file: string): Promise<{ video: boolean; audio: boolean; durationMs: number; width: number; height: number; videoCodec: string; audioCodec: string }> {
  const { spawn } = await import("node:child_process");
  const args = ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file];
  const result = await new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const child = spawn("ffprobe", args, { shell: false, windowsHide: true });
    const timer = setTimeout(() => child.kill(), 8000);
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), exitCode: code });
    });
  });
  if (result.exitCode !== 0) throw new Error(`ffprobe failed: ${result.stderr.slice(0, 300)}`);
  const j = JSON.parse(result.stdout);
  const vStream = j.streams.find((s: { codec_type: string }) => s.codec_type === "video");
  const aStream = j.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
  const dur = Number(j.format?.duration ?? vStream?.duration ?? aStream?.duration);
  return {
    video: !!vStream,
    audio: !!aStream,
    durationMs: Math.round(dur * 1000),
    width: Number(vStream?.width ?? 0),
    height: Number(vStream?.height ?? 0),
    videoCodec: String(vStream?.codec_name ?? ""),
    audioCodec: String(aStream?.codec_name ?? ""),
  };
}
