/**
 * Concat — joins scene MP4s in timeline order via FFmpeg concat demuxer.
 */

import { spawn } from "node:child_process";
import { stat, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ConcatOptions { transitionMs?: number }

export async function concatScenes(sceneMp4s: readonly string[], outputMp4: string, ffmpegBin = "ffmpeg", options: ConcatOptions = {}): Promise<{ bytes: number; durationMs: number }> {
  if (sceneMp4s.length === 0) throw new Error("no scene MP4s to concat");
  if (sceneMp4s.length === 1) {
    // Single scene — just copy
    const { copyFile } = await import("node:fs/promises");
    await copyFile(sceneMp4s[0], outputMp4);
    const st = await stat(outputMp4);
    const dur = await ffprobeDuration(outputMp4);
    return { bytes: st.size, durationMs: dur };
  }

  if (options.transitionMs && options.transitionMs > 0) {
    const durations = [];
    for (const scene of sceneMp4s) durations.push(await ffprobeDuration(scene));
    const args = xfadeArgs(sceneMp4s, outputMp4, options.transitionMs, durations);
    const result = await spawnCollect(ffmpegBin, args, 60000);
    if (result.exitCode !== 0) throw new Error(`transition concat failed: ${result.stderr.slice(0, 500)}`);
    const st = await stat(outputMp4);
    if (st.size === 0) throw new Error("transition concat produced empty output");
    const dur = await ffprobeDuration(outputMp4);
    return { bytes: st.size, durationMs: dur };
  }

  // Write concat demuxer list file
  const listPath = join(tmpdir(), `concat-${Date.now()}.txt`);
  const listContent = sceneMp4s.map((p) => `file '${p.replace(/'/gu, "'\\''")}'`).join("\n");
  await writeFile(listPath, listContent, "utf8");

  try {
    // Try stream copy first (fast, no re-encode)
    const copyArgs = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputMp4];
    let result = await spawnCollect(ffmpegBin, copyArgs, 30000);
    let usedCopy = true;
    if (result.exitCode !== 0) {
      // Fallback to re-encode
      usedCopy = false;
      const reencArgs = ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", outputMp4];
      result = await spawnCollect(ffmpegBin, reencArgs, 60000);
      if (result.exitCode !== 0) throw new Error(`concat failed (copy and re-encode): ${result.stderr.slice(0, 500)}`);
    }
    const st = await stat(outputMp4);
    if (st.size === 0) throw new Error("concat produced empty output");
    const dur = await ffprobeDuration(outputMp4);
    return { bytes: st.size, durationMs: dur };
  } finally {
    await unlink(listPath).catch(() => {});
  }
}

export function xfadeArgs(sceneMp4s: readonly string[], outputMp4: string, transitionMs: number, durationsMs?: readonly number[]): string[] {
  const seconds = (transitionMs / 1000).toFixed(3);
  const args = ["-y"];
  for (const path of sceneMp4s) args.push("-i", path);
  const chains: string[] = [];
  let video = "[0:v]";
  let audio = "[0:a]";
  let offset = 0;
  for (let i = 1; i < sceneMp4s.length; i++) {
    offset += ((durationsMs?.[i - 1] ?? 1000) / 1000) - transitionMs / 1000;
    const vOut = `v${i}`;
    const aOut = `a${i}`;
    chains.push(`${video}[${i}:v]xfade=transition=fade:duration=${seconds}:offset=${offset.toFixed(3)}[${vOut}]`);
    chains.push(`${audio}[${i}:a]acrossfade=d=${seconds}:c1=tri:c2=tri[${aOut}]`);
    video = `[${vOut}]`;
    audio = `[${aOut}]`;
  }
  args.push("-filter_complex", chains.join(";"), "-map", video, "-map", audio, "-c:v", "libx264", "-preset", "fast", "-crf", "23", "-c:a", "aac", outputMp4);
  return args;
}

async function ffprobeDuration(file: string): Promise<number> {
  const args = ["-v", "quiet", "-print_format", "json", "-show_format", file];
  const r = await spawnCollect("ffprobe", args, 10000);
  if (r.exitCode !== 0) throw new Error(`ffprobe concat output failed: ${r.stderr.slice(0, 300)}`);
  const j = JSON.parse(r.stdout);
  const dur = Number(j.format?.duration);
  if (!Number.isFinite(dur) || dur <= 0) throw new Error("ffprobe concat: invalid duration");
  return Math.round(dur * 1000);
}

function spawnCollect(bin: string, args: readonly string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const child = spawn(bin, [...args], { shell: false, windowsHide: true });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => stdout.push(c));
    child.stderr.on("data", (c: Buffer) => stderr.push(c));
    child.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdout).toString(), stderr: err.message, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) resolve({ stdout: Buffer.concat(stdout).toString(), stderr: `timeout after ${timeoutMs}ms`, exitCode: code });
      else resolve({ stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString(), exitCode: code });
    });
  });
}
