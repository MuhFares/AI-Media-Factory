/**
 * Audio slicer — slices narration WAV per scene timing via FFmpeg.
 * Uses spawn with shell:false, no string interpolation.
 */

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export interface SliceRequest {
  inputWav: string;
  startMs: number;
  endMs: number;
  outputWav: string;
  ffmpegBin?: string;
}

export async function sliceAudio(req: SliceRequest): Promise<{ durationMs: number; bytes: number }> {
  const bin = req.ffmpegBin ?? "ffmpeg";
  const startSec = (req.startMs / 1000).toFixed(3);
  const durationSec = ((req.endMs - req.startMs) / 1000).toFixed(3);

  const args = [
    "-y",
    "-i", req.inputWav,
    "-ss", startSec,
    "-t", durationSec,
    "-c", "copy",
    req.outputWav,
  ];

  const result = await spawnCollect(bin, args, 15000);
  if (result.exitCode !== 0) {
    throw new Error(`audio slice failed (exit ${result.exitCode}): ${result.stderr.slice(0, 400)}`);
  }
  const st = await stat(req.outputWav);
  if (st.size === 0) throw new Error("sliced audio is empty");

  // Validate with ffprobe
  const probe = await ffprobeDuration(req.outputWav);
  return { durationMs: probe, bytes: st.size };
}

async function ffprobeDuration(file: string): Promise<number> {
  const args = ["-v", "quiet", "-print_format", "json", "-show_format", file];
  const r = await spawnCollect("ffprobe", args, 8000);
  if (r.exitCode !== 0) throw new Error(`ffprobe slice failed: ${r.stderr.slice(0, 300)}`);
  const j = JSON.parse(r.stdout);
  const dur = Number(j.format?.duration);
  if (!Number.isFinite(dur) || dur <= 0) throw new Error("ffprobe slice: invalid duration");
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
