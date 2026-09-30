/**
 * media.compose capability — composes a video MP4 + narration WAV into a final MP4.
 *
 * Deterministic local engine (FFmpeg), not a provider. The adapter owns all
 * ffprobe/ffmpeg invocation; the capability owns validation, path safety,
 * strategy selection, output verification, and evidence.
 */

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { CapabilityExecutorPort, CapabilityRequest, CapabilityResult, CapabilityResolver, ExecutionEvidence } from "../capabilities.js";
import { compose, mediaIdFor, padVideoTail, probeFile, probeOutputFile, probeVideoFile, stitchVideoClips } from "./media-compose-adapter.js";
import type { AudioStrategy, ComposeEditPlan } from "./media-compose-adapter.js";
import { assessNarrationFit } from "./narration-fit.js";
import type { NarrationFitResult, VideoTailPadPolicy } from "./narration-fit.js";

export const MEDIA_COMPOSE_CAPABILITY_ID = "media.compose";

export interface MediaComposeCapabilityInput {
  video: string;
  audio: string;
  outputFormat?: "mp4";
  audioStrategy?: AudioStrategy;
  preserveVideoAudio?: boolean;
  editing?: ComposeEditPlan;
  productionComposition?: {
    workflowId: string;
    timelineArtifactId: string;
    narrationArtifactId: string;
    sceneIds: readonly string[];
    clipArtifactIds: readonly string[];
    clipPaths: readonly string[];
    narrationIdentity: string;
    videoTailPadPolicy?: VideoTailPadPolicy;
  };
}

export interface MediaComposeCapabilityOutput {
  mediaId: string;
  editPlanId?: string;
  status: string;
  providerId: string;
  output: { mimeType: string; path: string; bytes: number; sha256: string };
  input: { videoDurationMs: number; audioDurationMs: number };
  final: { durationMs: number; width: number; height: number; videoCodec: string; audioCodec: string; audioSampleRate: number; audioChannels: number };
  composition: { strategy: AudioStrategy; videoCopied: boolean; videoReencoded: boolean; audioEncoded: boolean };
  durationReconciliation?: {
    sourceClipArtifactIds: readonly string[];
    sourceClipPaths: readonly string[];
    stitchedVideoPath: string;
    stitchedVideoSha256: string;
    stitchedVideoMeasuredDurationMs: number;
    narrationArtifactId: string;
    narrationSha256: string;
    narrationMeasuredDurationMs: number;
    timelineArtifactId: string;
    initialDecision: NarrationFitResult;
    padPolicy?: VideoTailPadPolicy;
    padMode?: "LAST_FRAME_HOLD";
    calculatedExtensionMs?: number;
    targetVideoDurationMs?: number;
    paddedVideoPath?: string;
    paddedVideoSha256?: string;
    paddedVideoMeasuredDurationMs?: number;
    postPadDecision?: NarrationFitResult;
    padExecutions: number;
  };
  timings: { probeInputMs: number; composeMs: number; probeOutputMs: number; totalMs: number };
}

export interface MediaComposeCapabilityPolicy {
  allowedOutputFormats: readonly string[];
  allowedStrategies: readonly AudioStrategy[];
  allowedRoots: readonly string[];
  outputDir: string;
  ffmpegBin: string;
  ffprobeBin: string;
  probeTimeoutMs: number;
  composeTimeoutMs: number;
}

type MediaComposeRequest = CapabilityRequest<MediaComposeCapabilityInput>;
type MediaComposeResult = CapabilityResult<MediaComposeCapabilityOutput>;

const DEFAULT_POLICY: MediaComposeCapabilityPolicy = {
  allowedOutputFormats: ["mp4"],
  // `shortest` was the pilot's narration-loss regression: it silently lets
  // whichever stream ends first define the product duration. Keep it
  // available only for explicitly configured legacy workflows; production's
  // default is narration-preserving padding.
  allowedStrategies: ["pad", "trim", "shortest"],
  allowedRoots: [resolve("output")],
  outputDir: resolve("output/media-compose"),
  ffmpegBin: projectBinary("FFMPEG_PATH", "ffmpeg-static", "ffmpeg"),
  ffprobeBin: projectBinary("FFPROBE_PATH", "ffprobe-static", "ffprobe"),
  probeTimeoutMs: 15_000,
  composeTimeoutMs: 120_000,
};

/** Prefer bundled project binaries, but keep a safe PATH fallback when an
 * optional static-binary package is absent in a deployed runtime. */
function projectBinary(envName: string, packageName: string, pathFallback: string): string {
  const configured = process.env[envName]?.trim();
  if (configured) return configured;
  try {
    const required = createRequire(import.meta.url)(packageName) as { path?: string } | string;
    if (typeof required === "string" && required.length > 0) return required;
    if (typeof required === "object" && required !== null && typeof required.path === "string" && required.path.length > 0) return required.path;
  } catch {
    // Optional static binary unavailable; use the configured system PATH.
  }
  return pathFallback;
}

export class MediaComposeCapabilityExecutor implements CapabilityExecutorPort<MediaComposeCapabilityInput, MediaComposeCapabilityOutput> {
  private readonly policy: MediaComposeCapabilityPolicy;
  private readonly roots: string[];

  constructor(policy: Partial<MediaComposeCapabilityPolicy>, private readonly resolver: CapabilityResolver) {
    const merged = { ...DEFAULT_POLICY, ...policy };
    if (merged.allowedOutputFormats.length === 0) throw new Error("allowedOutputFormats must be non-empty");
    if (merged.allowedStrategies.length === 0) throw new Error("allowedStrategies must be non-empty");
    if (merged.allowedRoots.length === 0) throw new Error("allowedRoots must be non-empty");
    this.policy = merged;
    this.roots = merged.allowedRoots.map((r) => resolve(r));
  }

  async execute(request: MediaComposeRequest): Promise<MediaComposeResult> {
    const startedAt = Date.now();

    // authorization
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (request.capabilityId !== MEDIA_COMPOSE_CAPABILITY_ID || descriptor === null || !this.resolver.isAuthorized(request.agentId, request.capabilityId)) {
      return this.blocked(request, "media.compose capability is not authorized");
    }

    // validate contract
    const input = request.input as MediaComposeCapabilityInput;
    const validation = this.validateInput(input);
    if (validation !== null) return this.blocked(request, validation);

    const strategy: AudioStrategy = (input.audioStrategy ?? "pad") as AudioStrategy;
    const outputFormat = input.outputFormat ?? "mp4";
    const preserveVideoAudio = input.preserveVideoAudio ?? false;

    // path safety
    let videoPath: string;
    let audioPath: string;
    let productionClipPaths: string[] = [];
    try {
      videoPath = this.canonicalize(input.video);
      audioPath = this.canonicalize(input.audio);
      productionClipPaths = input.productionComposition?.clipPaths.map((clip) => this.canonicalize(clip)) ?? [];
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.blocked(request, msg);
    }

    // existence + non-empty + type check
    const existsError = await this.checkFiles(videoPath, audioPath);
    if (existsError !== null) return this.blocked(request, existsError);
    for (const clipPath of productionClipPaths) {
      const clipError = await this.checkAuxiliaryFile(clipPath);
      if (clipError !== null) return this.blocked(request, clipError);
      if (!/[.](mp4|mov|webm|mkv)$/iu.test(clipPath)) return this.blocked(request, "production clip file type is not supported");
    }
    const editFiles = input.editing ? [input.editing.captionsPath, input.editing.backgroundMusicPath, input.editing.logoPath, ...(input.editing.soundEffects ?? []).map((s) => s.path)].filter((p): p is string => typeof p === "string") : [];
    for (const editFile of editFiles) {
      let safeEditPath: string;
      try { safeEditPath = this.canonicalize(editFile); } catch (e) { return this.blocked(request, e instanceof Error ? e.message : String(e)); }
      const editError = await this.checkAuxiliaryFile(safeEditPath);
      if (editError !== null) return this.blocked(request, editError);
    }

    let durationReconciliation: MediaComposeCapabilityOutput["durationReconciliation"];
    if (input.productionComposition !== undefined) {
      try {
        const clipHashes = await Promise.all(productionClipPaths.map(async (clip) => createHash("sha256").update(await readFile(clip)).digest("hex")));
        const stitchId = createHash("sha256").update(JSON.stringify({ clipHashes, sceneIds: input.productionComposition!.sceneIds })).digest("hex").slice(0, 16);
        const stitchedVideoPath = resolve(this.policy.outputDir, `stitched-${stitchId}.mp4`);
        await stitchVideoClips(productionClipPaths, stitchedVideoPath, { ffmpegBin: this.policy.ffmpegBin, timeoutMs: this.policy.composeTimeoutMs });
        const stitchedProbe = await probeVideoFile(stitchedVideoPath, { ffprobeBin: this.policy.ffprobeBin, timeoutMs: this.policy.probeTimeoutMs });
        const narrationProbe = await this.probeInputs(productionClipPaths[0]!, audioPath);
        const fitPolicy = {
          speechSafetyTailMs: input.productionComposition.videoTailPadPolicy?.safetyTailMs ?? 300,
          maxTempoSpeedup: 1.15,
          ...(input.productionComposition.videoTailPadPolicy ? { videoTailPad: input.productionComposition.videoTailPadPolicy } : {}),
        };
        const initialDecision = assessNarrationFit(stitchedProbe.durationMs, narrationProbe.audioDurationMs, fitPolicy);
        durationReconciliation = {
          sourceClipArtifactIds: input.productionComposition.clipArtifactIds,
          sourceClipPaths: productionClipPaths,
          stitchedVideoPath,
          stitchedVideoSha256: createHash("sha256").update(await readFile(stitchedVideoPath)).digest("hex"),
          stitchedVideoMeasuredDurationMs: stitchedProbe.durationMs,
          narrationArtifactId: input.productionComposition.narrationArtifactId,
          narrationSha256: createHash("sha256").update(await readFile(audioPath)).digest("hex"),
          narrationMeasuredDurationMs: narrationProbe.audioDurationMs,
          timelineArtifactId: input.productionComposition.timelineArtifactId,
          initialDecision,
          ...(input.productionComposition.videoTailPadPolicy ? { padPolicy: input.productionComposition.videoTailPadPolicy } : {}),
          padExecutions: 0,
        };
        if (initialDecision.fitStatus === "VIDEO_TAIL_PAD_REQUIRED" && initialDecision.videoPad !== undefined) {
          const paddedVideoPath = resolve(this.policy.outputDir, `padded-${stitchId}-${initialDecision.videoPad.requiredDurationMs}.mp4`);
          try {
            const existing = await stat(paddedVideoPath);
            if (!existing.isFile() || existing.size === 0) throw new Error("PAD_CACHE_INVALID");
          } catch {
            await padVideoTail(stitchedVideoPath, paddedVideoPath, initialDecision.videoPad.requiredDurationMs, { ffmpegBin: this.policy.ffmpegBin, timeoutMs: this.policy.composeTimeoutMs });
          }
          const paddedProbe = await probeVideoFile(paddedVideoPath, { ffprobeBin: this.policy.ffprobeBin, timeoutMs: this.policy.probeTimeoutMs });
          const postPadDecision = assessNarrationFit(paddedProbe.durationMs, narrationProbe.audioDurationMs, fitPolicy);
          durationReconciliation = { ...durationReconciliation, padMode: "LAST_FRAME_HOLD", calculatedExtensionMs: initialDecision.videoPad.requiredDurationMs, targetVideoDurationMs: initialDecision.videoPad.targetVideoDurationMs, paddedVideoPath, paddedVideoSha256: createHash("sha256").update(await readFile(paddedVideoPath)).digest("hex"), paddedVideoMeasuredDurationMs: paddedProbe.durationMs, postPadDecision, padExecutions: 1 };
          if (postPadDecision.fitStatus !== "PASS") return this.blocked(request, `NARRATION_FIT_AFTER_PAD:${postPadDecision.fitStatus}`);
          videoPath = paddedVideoPath;
        } else if (initialDecision.fitStatus !== "PASS") {
          return this.blocked(request, `NARRATION_FIT:${initialDecision.fitStatus}${initialDecision.blockReason ? `:${initialDecision.blockReason}` : ""}`);
        } else {
          videoPath = stitchedVideoPath;
        }
      } catch (e) {
        return this.failed(request, "EXECUTION", `Deterministic video reconciliation failed: ${e instanceof Error ? e.message : String(e)}`, startedAt, true, { videoDurationMs: 0, audioDurationMs: 0 });
      }
    }

    // probe inputs
    const tProbe0 = Date.now();
    let probe: Awaited<ReturnType<typeof probeFile>>;
    try {
      // probe both in sequence to get durations (adapter probes each file expecting both streams)
      // For input video: probe expects both streams but video MP4 has only video stream.
      // So probe with a lenient helper: probeFile expects both -> use direct ffprobe per file with stream counting.
      probe = await this.probeInputs(videoPath, audioPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.failed(request, "OUTPUT_VALIDATION", `Input probe failed: ${msg}`, startedAt, false, { videoDurationMs: 0, audioDurationMs: 0 });
    }
    const probeInputMs = Date.now() - tProbe0;

    // deterministic mediaId + output path
    const mediaId = await mediaIdFor(videoPath, audioPath, strategy, preserveVideoAudio, input.editing);
    const outputPath = resolve(this.policy.outputDir, `${mediaId}.mp4`);

    // compose
    const tCompose0 = Date.now();
    let videoCopied = false;
    try {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(this.policy.outputDir, { recursive: true });
      const res = await compose(
        { videoPath, audioPath, outputPath, strategy, preserveVideoAudio, editing: input.editing },
        { videoDurationMs: probe.videoDurationMs, audioDurationMs: probe.audioDurationMs, videoMeta: probe.videoMeta, audioMeta: probe.audioMeta },
        { ffmpegBin: this.policy.ffmpegBin, timeoutMs: this.policy.composeTimeoutMs },
      );
      videoCopied = res.videoCopied;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = msg.includes("timeout") ? "TIMEOUT" : "EXECUTION";
      return this.failed(request, code, `FFmpeg compose failed: ${msg}`, startedAt, true, { videoDurationMs: probe.videoDurationMs, audioDurationMs: probe.audioDurationMs });
    }
    const composeMs = Date.now() - tCompose0;

    // probe output + validate final MP4 contains both streams
    const tProbe1 = Date.now();
    let final: Awaited<ReturnType<typeof probeOutputFile>>;
    try {
      final = await probeOutputFile(outputPath, { ffprobeBin: this.policy.ffprobeBin, timeoutMs: this.policy.probeTimeoutMs });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.failed(request, "OUTPUT_VALIDATION", `Output validation failed: ${msg}`, startedAt, true, { videoDurationMs: probe.videoDurationMs, audioDurationMs: probe.audioDurationMs });
    }
    const probeOutputMs = Date.now() - tProbe1;

    const outStat = await stat(outputPath);
    const outBytes = outStat.size;
    const outHash = createHash("sha256").update(await readFile(outputPath)).digest("hex");

    // duration strategy check: warn but not fail (timeline gap is expected)
    const output: MediaComposeCapabilityOutput = {
      mediaId,
      ...(input.editing ? { editPlanId: createHash("sha256").update(JSON.stringify(input.editing)).digest("hex").slice(0, 16) } : {}),
      status: "completed",
      providerId: "ffmpeg",
      output: { mimeType: "video/mp4", path: outputPath, bytes: outBytes, sha256: outHash },
      input: { videoDurationMs: probe.videoDurationMs, audioDurationMs: probe.audioDurationMs },
      final: { durationMs: final.durationMs, width: final.width, height: final.height, videoCodec: final.videoCodec, audioCodec: final.audioCodec, audioSampleRate: final.audioSampleRate, audioChannels: final.audioChannels },
      composition: { strategy, videoCopied, videoReencoded: !videoCopied, audioEncoded: true },
      ...(durationReconciliation ? { durationReconciliation } : {}),
      timings: { probeInputMs, composeMs, probeOutputMs, totalMs: Date.now() - startedAt },
    };

    return {
      status: "success",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      output,
      evidence: this.evidence(request, output, true, startedAt, true),
    };
  }

  private async probeInputs(videoPath: string, audioPath: string): Promise<{ videoDurationMs: number; audioDurationMs: number; videoMeta: { width: number; height: number; codec: string; fps: number | null; frameCount: number | null }; audioMeta: { codec: string; sampleRate: number; channels: number } }> {
    // Use ffprobe per file: video file should have video stream, audio file has audio stream
    const { spawn } = await import("node:child_process");
    const probeOne = (file: string, expect: "video" | "audio") =>
      new Promise<{ durationMs: number; meta: Record<string, unknown> }>((resolveP, rejectP) => {
        const args = ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", file];
        const child = spawn(this.policy.ffprobeBin, args, { shell: false, windowsHide: true });
        const chunks: Buffer[] = [];
        const errChunks: Buffer[] = [];
        const timer = setTimeout(() => { child.kill(); rejectP(new Error(`ffprobe timeout for ${expect}`)); }, this.policy.probeTimeoutMs);
        child.stdout.on("data", (c: Buffer) => chunks.push(c));
        child.stderr.on("data", (c: Buffer) => errChunks.push(c));
        child.on("error", (e) => { clearTimeout(timer); rejectP(e); });
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code !== 0) { rejectP(new Error(`ffprobe ${expect} failed exit ${code}: ${Buffer.concat(errChunks).toString().slice(0, 300)}`)); return; }
          try {
            const j = JSON.parse(Buffer.concat(chunks).toString()) as { streams: Array<Record<string, unknown>>; format?: { duration?: string } };
            const stream = j.streams.find((s) => s["codec_type"] === expect);
            if (!stream) { rejectP(new Error(`ffprobe: no ${expect} stream in ${file}`)); return; }
            const dur = (stream["duration"] as string | undefined) ?? j.format?.duration;
            if (!dur) { rejectP(new Error(`ffprobe: missing duration for ${expect}`)); return; }
            const ms = Math.round(Number(dur) * 1000);
            if (!Number.isFinite(ms) || ms <= 0) { rejectP(new Error(`ffprobe: invalid duration ${dur}`)); return; }
            resolveP({ durationMs: ms, meta: stream });
          } catch (e) { rejectP(e); }
        });
      });

    const [v, a] = await Promise.all([probeOne(videoPath, "video"), probeOne(audioPath, "audio")]);
    const width = Number((v.meta as Record<string, unknown>)["width"]);
    const height = Number((v.meta as Record<string, unknown>)["height"]);
    const vCodec = String((v.meta as Record<string, unknown>)["codec_name"]);
    let fps: number | null = null;
    const afr = (v.meta as Record<string, unknown>)["avg_frame_rate"] as string | undefined;
    if (typeof afr === "string" && afr.includes("/")) { const [n, d] = afr.split("/").map(Number); if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) fps = n / d; }
    let frameCount: number | null = null;
    const nbf = (v.meta as Record<string, unknown>)["nb_frames"] as string | undefined;
    if (typeof nbf === "string") { const n = Number(nbf); if (Number.isFinite(n) && n > 0) frameCount = n; }
    const sampleRate = Number((a.meta as Record<string, unknown>)["sample_rate"]);
    const channels = Number((a.meta as Record<string, unknown>)["channels"]);
    const aCodec = String((a.meta as Record<string, unknown>)["codec_name"]);
    return { videoDurationMs: v.durationMs, audioDurationMs: a.durationMs, videoMeta: { width, height, codec: vCodec, fps, frameCount }, audioMeta: { codec: aCodec, sampleRate, channels } };
  }

  private validateInput(input: MediaComposeCapabilityInput): string | null {
    if (typeof input.video !== "string" || input.video.trim().length === 0) return "video path must not be empty";
    if (typeof input.audio !== "string" || input.audio.trim().length === 0) return "audio path must not be empty";
    if (input.outputFormat !== undefined && !this.policy.allowedOutputFormats.includes(input.outputFormat)) return "outputFormat is not in the configured allowed set";
    if (input.audioStrategy !== undefined && !this.policy.allowedStrategies.includes(input.audioStrategy as AudioStrategy)) return "audioStrategy is not in the configured allowed set";
    if (input.preserveVideoAudio !== undefined && typeof input.preserveVideoAudio !== "boolean") return "preserveVideoAudio must be a boolean";
    if (input.productionComposition !== undefined) {
      const p = input.productionComposition;
      if (!Array.isArray(p.sceneIds) || !Array.isArray(p.clipArtifactIds) || !Array.isArray(p.clipPaths) || p.sceneIds.length === 0 || p.sceneIds.length !== p.clipArtifactIds.length || p.sceneIds.length !== p.clipPaths.length) return "productionComposition clip lineage is invalid";
      if (new Set(p.sceneIds).size !== p.sceneIds.length || p.clipPaths.some((path) => typeof path !== "string" || path.trim() === "")) return "productionComposition scene order is invalid";
      if (typeof p.timelineArtifactId !== "string" || p.timelineArtifactId.trim() === "" || typeof p.narrationArtifactId !== "string" || p.narrationArtifactId.trim() === "") return "productionComposition canonical lineage is missing";
    }
    if (input.editing !== undefined) {
      const e = input.editing;
      for (const [label, value] of [["backgroundMusicVolume", e.backgroundMusicVolume], ["trimStartMs", e.trimStartMs], ["trimEndMs", e.trimEndMs]] as const) {
        if (value !== undefined && (!Number.isFinite(value) || value < 0)) return `${label} must be a non-negative finite number`;
      }
      if (e.backgroundMusicVolume !== undefined && e.backgroundMusicVolume > 1) return "backgroundMusicVolume must be <= 1";
      if (e.trimEndMs !== undefined && e.trimStartMs !== undefined && e.trimEndMs <= e.trimStartMs) return "trimEndMs must exceed trimStartMs";
      if (e.watermarkText !== undefined && (typeof e.watermarkText !== "string" || e.watermarkText.length > 120)) return "watermarkText must be <= 120 characters";
      for (const sfx of e.soundEffects ?? []) {
        if (typeof sfx.path !== "string" || !Number.isFinite(sfx.startMs) || sfx.startMs < 0 || (sfx.volume !== undefined && (!Number.isFinite(sfx.volume) || sfx.volume < 0 || sfx.volume > 1))) return "invalid sound effect edit spec";
      }
    }
    // reject arbitrary ffmpeg args smuggling
    const raw = input as unknown as Record<string, unknown>;
    if ("ffmpegArgs" in raw || "args" in raw || "command" in raw) return "arbitrary ffmpeg arguments are not permitted";
    return null;
  }

  private canonicalize(p: string): string {
    if (typeof p !== "string" || p.length === 0 || p.includes("\0")) throw new Error("Invalid path");
    const abs = isAbsolute(p) ? resolve(p) : resolve(p);
    // traversal check: must be within allowedRoots
    const within = this.roots.some((root) => {
      const rel = relative(root, abs);
      const first = rel.split(sep)[0];
      return rel === "" || (first !== ".." && !isAbsolute(rel));
    });
    if (!within) throw new Error(`Path is outside allowed roots: ${p}`);
    return abs;
  }

  private async checkFiles(videoPath: string, audioPath: string): Promise<string | null> {
    for (const [label, file] of [["video", videoPath] as const, ["audio", audioPath] as const]) {
      try {
        const st = await stat(file);
        if (!st.isFile()) return `${label} path is not a file`;
        if (st.size === 0) return `${label} file is empty`;
      } catch {
        return `${label} file does not exist: ${file}`;
      }
      // extension guard
      const ext = file.toLowerCase().split(".").pop() ?? "";
      if (label === "video" && !["mp4", "mov", "webm", "mkv"].includes(ext)) return "video file type is not supported";
      if (label === "audio" && !["wav", "mp3", "m4a", "aac", "flac", "ogg"].includes(ext)) return "audio file type is not supported";
    }
    // do not overwrite source
    if (videoPath === audioPath) return "video and audio must be different files";
    return null;
  }

  private async checkAuxiliaryFile(file: string): Promise<string | null> {
    try {
      const st = await stat(file);
      if (!st.isFile()) return `editing asset is not a file: ${file}`;
      if (st.size === 0) return `editing asset is empty: ${file}`;
    } catch { return `editing asset does not exist: ${file}`; }
    return null;
  }

  private blocked(request: MediaComposeRequest, reason: string): MediaComposeResult {
    return { status: "blocked", resultId: this.resultId(request), capabilityId: request.capabilityId, reason };
  }

  private failed(request: MediaComposeRequest, code: string, message: string, startedAt: number, providerInvoked: boolean, durations: { videoDurationMs: number; audioDurationMs: number }): MediaComposeResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: false },
      evidence: this.evidence(request, { videoDurationMs: durations.videoDurationMs, audioDurationMs: durations.audioDurationMs } as unknown as MediaComposeCapabilityOutput, false, startedAt, providerInvoked, { code, message }),
    };
  }

  private evidence(request: MediaComposeRequest, output: MediaComposeCapabilityOutput | { videoDurationMs: number; audioDurationMs: number }, succeeded: boolean, startedAt: number, providerInvoked: boolean, error?: { code: string; message: string }): ExecutionEvidence {
    const isOutput = (output as MediaComposeCapabilityOutput).mediaId !== undefined;
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      providerId: "ffmpeg",
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      executedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      succeeded,
      resultStatus: succeeded ? "success" : "failed",
      ...(isOutput ? { videoDurationMs: (output as { videoDurationMs: number }).videoDurationMs } : {}),
      ...(error === undefined ? {} : { error }),
    };
  }

  private resultId(request: MediaComposeRequest): string {
    return `media-compose-result-${request.requestId}`;
  }
}

export interface CreateMediaComposeCapabilityOptions {
  policy?: Partial<MediaComposeCapabilityPolicy>;
  resolver: CapabilityResolver;
}

export function createMediaComposeCapability(options: CreateMediaComposeCapabilityOptions): MediaComposeCapabilityExecutor {
  return new MediaComposeCapabilityExecutor(options.policy ?? {}, options.resolver);
}
