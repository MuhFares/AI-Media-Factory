/**
 * FFmpeg media-compose adapter — deterministic local engine.
 *
 * NOT a provider. Invokes ffprobe (input validation) and ffmpeg (composition)
 * via spawn with shell:false and an explicit argument array.
 * Owns all CLI construction; the capability never sees ffmpeg syntax.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

// ---------------------------------------------------------------------------
// ffprobe helpers
// ---------------------------------------------------------------------------

export interface ProbeStreams {
  videoDurationMs: number;
  audioDurationMs: number;
  videoMeta: { width: number; height: number; codec: string; fps: number | null; frameCount: number | null };
  audioMeta: { codec: string; sampleRate: number; channels: number };
}

export interface FFmpegTimings {
  probeInputMs: number;
  composeMs: number;
  probeOutputMs: number;
  totalMs: number;
}

function parseFfprobeJson(raw: string): ProbeStreams {
  const parsed = JSON.parse(raw) as {
    streams: Array<{
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      nb_frames?: string;
      duration?: string;
      sample_rate?: string;
      channels?: number;
    }>;
    format?: { duration?: string };
  };
  const videoStream = parsed.streams.find((s) => s.codec_type === "video") ?? null;
  const audioStream = parsed.streams.find((s) => s.codec_type === "audio") ?? null;

  if (videoStream === null) throw new Error("ffprobe: no video stream found");
  if (audioStream === null) throw new Error("ffprobe: no audio stream found");

  const width = Number(videoStream.width);
  const height = Number(videoStream.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("ffprobe: invalid video dimensions");
  }

  // fps from avg_frame_rate "32/1" etc
  let fps: number | null = null;
  if (typeof videoStream.avg_frame_rate === "string" && videoStream.avg_frame_rate.includes("/")) {
    const [num, den] = videoStream.avg_frame_rate.split("/").map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) fps = num / den;
  }

  let frameCount: number | null = null;
  if (typeof videoStream.nb_frames === "string") {
    const n = Number(videoStream.nb_frames);
    if (Number.isFinite(n) && n > 0) frameCount = n;
  }

  // durations: prefer stream duration, fallback to format duration
  function durationMsOf(s: { duration?: string }, fallback: string | undefined): number {
    const rawDur = s.duration ?? fallback;
    if (rawDur === undefined) throw new Error("ffprobe: missing duration");
    const sec = Number(rawDur);
    if (!Number.isFinite(sec) || sec <= 0) throw new Error(`ffprobe: invalid duration ${rawDur}`);
    return Math.round(sec * 1000);
  }

  const fmtDur = parsed.format?.duration;
  const videoDurationMs = durationMsOf(videoStream, fmtDur);
  const audioDurationMs = durationMsOf(audioStream, fmtDur);

  const sampleRate = Number(audioStream.sample_rate);
  const channels = Number(audioStream.channels);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error("ffprobe: invalid audio sample_rate");
  if (!Number.isFinite(channels) || channels <= 0) throw new Error("ffprobe: invalid audio channels");

  return {
    videoDurationMs,
    audioDurationMs,
    videoMeta: { width, height, codec: String(videoStream.codec_name), fps, frameCount },
    audioMeta: { codec: String(audioStream.codec_name), sampleRate, channels },
  };
}

function ffprobeArgs(filePath: string): string[] {
  return ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath];
}

export async function probeFile(
  filePath: string,
  deps: { ffprobeBin: string; timeoutMs: number },
): Promise<ProbeStreams> {
  const { stdout, stderr, exitCode } = await spawnCollect(deps.ffprobeBin, ffprobeArgs(filePath), deps.timeoutMs);
  if (exitCode !== 0) throw new Error(`ffprobe failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  // stdout must be valid JSON
  try {
    return parseFfprobeJson(stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`ffprobe parse failed: ${msg} — raw: ${stdout.slice(0, 400)}`);
  }
}

// Probe a file that is expected to contain BOTH video and audio (final output)
export async function probeOutputFile(
  filePath: string,
  deps: { ffprobeBin: string; timeoutMs: number },
): Promise<{ durationMs: number; width: number; height: number; videoCodec: string; audioCodec: string; audioSampleRate: number; audioChannels: number }> {
  const streams = await probeFile(filePath, deps);
  return {
    durationMs: Math.min(streams.videoDurationMs, streams.audioDurationMs) > 0 ? Math.max(streams.videoDurationMs, streams.audioDurationMs) : streams.videoDurationMs,
    width: streams.videoMeta.width,
    height: streams.videoMeta.height,
    videoCodec: streams.videoMeta.codec,
    audioCodec: streams.audioMeta.codec,
    audioSampleRate: streams.audioMeta.sampleRate,
    audioChannels: streams.audioMeta.channels,
  };
}

// ---------------------------------------------------------------------------
// ffmpeg composition
// ---------------------------------------------------------------------------

export type AudioStrategy = "shortest" | "trim" | "pad";

export interface ComposeRequest {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  strategy: AudioStrategy;
  preserveVideoAudio: boolean;
  editing?: ComposeEditPlan;
}

export interface ComposeEditPlan {
  captionsPath?: string;
  backgroundMusicPath?: string;
  backgroundMusicVolume?: number;
  soundEffects?: Array<{ path: string; startMs: number; volume?: number }>;
  logoPath?: string;
  watermarkText?: string;
  trimStartMs?: number;
  trimEndMs?: number;
}

export interface ComposeResult {
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  audioSampleRate: number;
  audioChannels: number;
  composition: { strategy: AudioStrategy; videoCopied: boolean; videoReencoded: boolean; audioEncoded: boolean };
}

export function ffmpegArgsFor(req: ComposeRequest, inputProbe: ProbeStreams): { args: string[]; videoCopied: boolean } {
  if (req.editing && Object.keys(req.editing).length > 0) {
    return { args: ffmpegEditingArgs(req), videoCopied: false };
  }
  // For this proof: always AAC audio, video stream copy when valid.
  // Strategy determines duration handling.
  const base = [
    "-y",
    "-i", req.videoPath,
    "-i", req.audioPath,
  ];

  if (req.strategy === "shortest") {
    // -shortest: encode until shortest input ends
    return {
      args: [...base, "-c:v", "copy", "-c:a", "aac", "-shortest", req.outputPath],
      videoCopied: true,
    };
  }
  if (req.strategy === "trim") {
    // trim audio to video duration: -t <videoDuration>
    const tSec = (inputProbe.videoDurationMs / 1000).toFixed(3);
    return {
      args: [...base, "-c:v", "copy", "-c:a", "aac", "-t", tSec, req.outputPath],
      videoCopied: true,
    };
  }
  // pad: apad to video duration
  // -filter_complex "[1:a]apad[a]" -c:v copy -c:a aac -shortest off but pad ensures audio reaches video length
  // Use apad filter + -shortest not needed; apad + -t videoDuration
  const tSec = (inputProbe.videoDurationMs / 1000).toFixed(3);
  return {
    args: [
      ...base,
      "-filter_complex", "[1:a]apad[a]",
      "-map", "0:v:0",
      "-map", "[a]",
      "-c:v", "copy",
      "-c:a", "aac",
      "-t", tSec,
      req.outputPath,
    ],
    videoCopied: true,
  };
}

function filterPath(path: string): string {
  // FFmpeg filter parsers handle forward slashes reliably on Windows; escaping
  // every native backslash can make the subtitles filter crash before render.
  return path.replace(/\\/gu, "/").replace(/:/gu, "\\:").replace(/'/gu, "\\'");
}

function filterText(text: string): string {
  return text.replace(/\\/gu, "\\\\").replace(/:/gu, "\\:").replace(/'/gu, "\\'").replace(/\n/gu, " ");
}

function ffmpegEditingArgs(req: ComposeRequest): string[] {
  const edit = req.editing!;
  const args = ["-y", "-i", req.videoPath, "-i", req.audioPath];
  const musicIndex = edit.backgroundMusicPath ? 2 : null;
  if (musicIndex !== null) args.push("-i", edit.backgroundMusicPath!);
  const sfxStart = musicIndex === null ? 2 : 3;
  for (const sfx of edit.soundEffects ?? []) args.push("-i", sfx.path);
  const logoIndex = sfxStart + (edit.soundEffects?.length ?? 0);
  if (edit.logoPath) args.push("-i", edit.logoPath);

  const videoFilters: string[] = [];
  if (edit.trimStartMs !== undefined || edit.trimEndMs !== undefined) {
    const start = ((edit.trimStartMs ?? 0) / 1000).toFixed(3);
    const end = edit.trimEndMs === undefined ? "" : `:end=${(edit.trimEndMs / 1000).toFixed(3)}`;
    videoFilters.push(`trim=start=${start}${end}`, "setpts=PTS-STARTPTS");
  }
  if (edit.captionsPath) videoFilters.push(`subtitles='${filterPath(edit.captionsPath)}'`);
  if (edit.watermarkText) videoFilters.push(`drawtext=text='${filterText(edit.watermarkText)}':x=24:y=h-th-24:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.45`);
  let videoChain = videoFilters.length > 0 ? `[0:v]${videoFilters.join(",")}[v0]` : `[0:v]null[v0]`;
  let videoOut = "[v0]";
  if (edit.logoPath) {
    videoChain += `;[${logoIndex}:v]format=rgba[logo];[v0][logo]overlay=W-w-24:24:format=auto[v]`;
    videoOut = "[v]";
  }

  const audioParts = ["[1:a]asetpts=PTS-STARTPTS,volume=1[narr]"];
  const mixInputs = ["[narr]"];
  if (musicIndex !== null) {
    audioParts.push(`[${musicIndex}:a]volume=${edit.backgroundMusicVolume ?? 0.12}[bgm]`);
    mixInputs.push("[bgm]");
  }
  for (let i = 0; i < (edit.soundEffects ?? []).length; i++) {
    const sfx = edit.soundEffects![i];
    const delay = Math.max(0, Math.round(sfx.startMs));
    const index = sfxStart + i;
    audioParts.push(`[${index}:a]adelay=${delay}|${delay},volume=${sfx.volume ?? 0.5}[sfx${i}]`);
    mixInputs.push(`[sfx${i}]`);
  }
  if (mixInputs.length === 1) audioParts.push("[narr]anull[a]");
  else audioParts.push(`${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=2[a]`);
  const duration = edit.trimEndMs !== undefined && edit.trimStartMs !== undefined
    ? `-t ${((edit.trimEndMs - edit.trimStartMs) / 1000).toFixed(3)}`
    : "";
  args.push("-filter_complex", `${videoChain};${audioParts.join(";")}`, "-map", videoOut, "-map", "[a]", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac");
  if (edit.trimEndMs === undefined) args.push("-shortest");
  if (duration) args.push("-t", duration.split(" ")[1]);
  args.push(req.outputPath);
  return args;
}

export async function compose(
  req: ComposeRequest,
  inputProbe: ProbeStreams,
  deps: { ffmpegBin: string; timeoutMs: number },
): Promise<{ videoCopied: boolean }> {
  const { args, videoCopied } = ffmpegArgsFor(req, inputProbe);
  const { stderr, exitCode } = await spawnCollect(deps.ffmpegBin, args, deps.timeoutMs);
  if (exitCode !== 0) throw new Error(`ffmpeg failed (exit ${exitCode}): ${stderr.slice(0, 800)}`);
  // verify output exists and non-empty
  const st = await stat(req.outputPath);
  if (st.size === 0) throw new Error("ffmpeg produced empty output");
  return { videoCopied };
}

export interface VideoProbe {
  durationMs: number;
  width: number;
  height: number;
  codec: string;
  fps: number | null;
  frameCount: number | null;
}

async function probeSingleStream(filePath: string, type: "video" | "audio", deps: { ffprobeBin: string; timeoutMs: number }): Promise<Record<string, unknown> & { durationMs: number }> {
  const { stdout, stderr, exitCode } = await spawnCollect(deps.ffprobeBin, ffprobeArgs(filePath), deps.timeoutMs);
  if (exitCode !== 0) throw new Error(`ffprobe ${type} failed (exit ${exitCode}): ${stderr.slice(0, 500)}`);
  const parsed = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: { duration?: string } };
  const stream = parsed.streams?.find((item) => item["codec_type"] === type);
  if (stream === undefined) throw new Error(`ffprobe: no ${type} stream found`);
  const rawDuration = typeof stream["duration"] === "string" ? stream["duration"] : parsed.format?.duration;
  const durationMs = Math.round(Number(rawDuration) * 1000);
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new Error(`ffprobe: invalid ${type} duration`);
  return { ...stream, durationMs };
}

export async function probeVideoFile(filePath: string, deps: { ffprobeBin: string; timeoutMs: number }): Promise<VideoProbe> {
  const stream = await probeSingleStream(filePath, "video", deps);
  const width = Number(stream["width"]); const height = Number(stream["height"]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("ffprobe: invalid video dimensions");
  let fps: number | null = null;
  if (typeof stream["avg_frame_rate"] === "string" && stream["avg_frame_rate"].includes("/")) {
    const [n, d] = stream["avg_frame_rate"].split("/").map(Number); if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) fps = n / d;
  }
  const frames = Number(stream["nb_frames"]);
  return { durationMs: stream.durationMs, width, height, codec: String(stream["codec_name"] ?? "unknown"), fps, frameCount: Number.isFinite(frames) && frames > 0 ? frames : null };
}

export async function probeAudioFile(filePath: string, deps: { ffprobeBin: string; timeoutMs: number }): Promise<{ durationMs: number; codec: string; sampleRate: number; channels: number }> {
  const stream = await probeSingleStream(filePath, "audio", deps);
  return { durationMs: stream.durationMs, codec: String(stream["codec_name"] ?? "unknown"), sampleRate: Number(stream["sample_rate"]), channels: Number(stream["channels"]) };
}

function concatFileLine(filePath: string): string {
  return `file '${resolve(filePath).replace(/\\/gu, "/").replace(/'/gu, "'\\''")}'`;
}

export async function stitchVideoClips(
  clipPaths: readonly string[],
  outputPath: string,
  deps: { ffmpegBin: string; timeoutMs: number },
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("VIDEO_STITCH_REQUIRES_CLIPS");
  await mkdir(resolve(outputPath, ".."), { recursive: true });
  const listPath = `${outputPath}.ffconcat`;
  await writeFile(listPath, `ffconcat version 1.0\n${clipPaths.map(concatFileLine).join("\n")}\n`, "utf8");
  const { stderr, exitCode } = await spawnCollect(deps.ffmpegBin, ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-map", "0:v:0", "-c:v", "copy", "-an", outputPath], deps.timeoutMs);
  if (exitCode !== 0) throw new Error(`ffmpeg stitch failed (exit ${exitCode}): ${stderr.slice(0, 800)}`);
  if ((await stat(outputPath)).size === 0) throw new Error("ffmpeg stitch produced empty output");
}

export function videoTailPadArgs(inputPath: string, outputPath: string, requiredDurationMs: number): string[] {
  if (!Number.isFinite(requiredDurationMs) || requiredDurationMs <= 0) throw new Error("VIDEO_TAIL_PAD_DURATION_INVALID");
  return ["-y", "-i", inputPath, "-vf", `tpad=stop_mode=clone:stop_duration=${(requiredDurationMs / 1000).toFixed(6)}`, "-map", "0:v:0", "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-an", outputPath];
}

export async function padVideoTail(
  inputPath: string,
  outputPath: string,
  requiredDurationMs: number,
  deps: { ffmpegBin: string; timeoutMs: number },
): Promise<void> {
  const { stderr, exitCode } = await spawnCollect(deps.ffmpegBin, videoTailPadArgs(inputPath, outputPath, requiredDurationMs), deps.timeoutMs);
  if (exitCode !== 0) throw new Error(`ffmpeg video tail pad failed (exit ${exitCode}): ${stderr.slice(0, 800)}`);
  if ((await stat(outputPath)).size === 0) throw new Error("ffmpeg video tail pad produced empty output");
}

// ---------------------------------------------------------------------------
// spawn helper — shell:false, no string interpolation
// ---------------------------------------------------------------------------

interface SpawnResult { stdout: string; stderr: string; exitCode: number | null }

function spawnCollect(bin: string, args: readonly string[], timeoutMs: number): Promise<SpawnResult> {
  return new Promise((resolvePromise) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const child = spawn(bin, [...args], { shell: false, windowsHide: true });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolvePromise({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: err.message, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        resolvePromise({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: `timeout after ${timeoutMs}ms`, exitCode: code });
      } else {
        resolvePromise({ stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8"), exitCode: code });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Deterministic mediaId
// ---------------------------------------------------------------------------

export async function mediaIdFor(videoPath: string, audioPath: string, strategy: AudioStrategy, preserveVideoAudio: boolean, editing?: ComposeEditPlan): Promise<string> {
  const vHash = createHash("sha256").update(await readFile(videoPath)).digest("hex").slice(0, 16);
  const aHash = createHash("sha256").update(await readFile(audioPath)).digest("hex").slice(0, 16);
  const settings = `${strategy}:${preserveVideoAudio ? "preserve" : "replace"}:${JSON.stringify(editing ?? {})}`;
  const idHash = createHash("sha256").update(`${vHash}:${aHash}:${settings}`).digest("hex").slice(0, 12);
  return `media-${idHash}`;
}

// Re-export for tests
export { parseFfprobeJson, ffmpegArgsFor as _ffmpegArgsFor };
