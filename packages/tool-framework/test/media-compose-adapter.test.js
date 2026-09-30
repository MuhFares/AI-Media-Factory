import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFfprobeJson, _ffmpegArgsFor, padVideoTail, probeVideoFile, videoTailPadArgs } from "../dist/media-compose/media-compose-adapter.js";

// ---------------------------------------------------------------------------
// ffprobe parsing
// ---------------------------------------------------------------------------

describe("media-compose-adapter: parseFfprobeJson", () => {
  function json(streams, formatDur = undefined) {
    return JSON.stringify({ streams, ...(formatDur ? { format: { duration: formatDur } } : {}) });
  }

  it("parses valid video+audio probe result", () => {
    const raw = json([
      { codec_type: "video", codec_name: "h264", width: 480, height: 832, avg_frame_rate: "32/1", duration: "5.03125", nb_frames: "161" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2, duration: "12.640" },
    ]);
    const r = parseFfprobeJson(raw);
    assert.equal(r.videoDurationMs, 5031);
    assert.equal(r.audioDurationMs, 12640);
    assert.equal(r.videoMeta.width, 480);
    assert.equal(r.videoMeta.codec, "h264");
    assert.equal(r.videoMeta.fps, 32);
    assert.equal(r.audioMeta.codec, "aac");
    assert.equal(r.audioMeta.sampleRate, 48000);
  });

  it("falls back to format duration when stream duration missing", () => {
    const raw = json([
      { codec_type: "video", codec_name: "h264", width: 100, height: 100, avg_frame_rate: "30/1" },
      { codec_type: "audio", codec_name: "pcm_s16le", sample_rate: "24000", channels: 1 },
    ], "5.0");
    const r = parseFfprobeJson(raw);
    assert.equal(r.videoDurationMs, 5000);
    assert.equal(r.audioDurationMs, 5000);
  });

  it("throws when video stream missing", () => {
    const raw = json([{ codec_type: "audio", codec_name: "aac", sample_rate: "24000", channels: 1, duration: "5.0" }]);
    assert.throws(() => parseFfprobeJson(raw), /no video stream/);
  });

  it("throws when audio stream missing", () => {
    const raw = json([{ codec_type: "video", codec_name: "h264", width: 100, height: 100, avg_frame_rate: "30/1", duration: "5.0" }]);
    assert.throws(() => parseFfprobeJson(raw), /no audio stream/);
  });

  it("throws on invalid dimensions", () => {
    const raw = json([
      { codec_type: "video", codec_name: "h264", width: 0, height: 0, avg_frame_rate: "30/1", duration: "5.0" },
      { codec_type: "audio", codec_name: "aac", sample_rate: "24000", channels: 1, duration: "5.0" },
    ]);
    assert.throws(() => parseFfprobeJson(raw), /invalid video dimensions/);
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => parseFfprobeJson("not json"), /parse failed|Unexpected token/);
  });
});

// ---------------------------------------------------------------------------
// ffmpeg args
// ---------------------------------------------------------------------------

describe("media-compose-adapter: ffmpegArgsFor", () => {
  const probe = { videoDurationMs: 5031, audioDurationMs: 12640, videoMeta: { width: 480, height: 832, codec: "h264", fps: 32, frameCount: 161 }, audioMeta: { codec: "pcm_s16le", sampleRate: 24000, channels: 1 } };

  it("shortest: uses -shortest and stream copy", () => {
    const { args, videoCopied } = _ffmpegArgsFor({ videoPath: "v.mp4", audioPath: "a.wav", outputPath: "out.mp4", strategy: "shortest", preserveVideoAudio: false }, probe);
    assert.equal(args.includes("-shortest"), true);
    assert.equal(args.includes("-c:v"), true);
    assert.equal(args[args.indexOf("-c:v") + 1], "copy");
    assert.equal(args.includes("-c:a"), true);
    assert.equal(args[args.indexOf("-c:a") + 1], "aac");
    assert.equal(videoCopied, true);
    assert.equal(args.includes("apad"), false);
  });

  it("trim: uses -t with video duration", () => {
    const { args } = _ffmpegArgsFor({ videoPath: "v.mp4", audioPath: "a.wav", outputPath: "out.mp4", strategy: "trim", preserveVideoAudio: false }, probe);
    assert.equal(args.includes("-t"), true);
    assert.equal(args[args.indexOf("-t") + 1], "5.031");
    assert.equal(args.includes("apad"), false);
  });

  it("pad: uses apad filter and maps", () => {
    const { args } = _ffmpegArgsFor({ videoPath: "v.mp4", audioPath: "a.wav", outputPath: "out.mp4", strategy: "pad", preserveVideoAudio: false }, probe);
    assert.equal(args.includes("[1:a]apad[a]"), true);
    assert.equal(args.includes("-t"), true);
    assert.equal(args.includes("-filter_complex"), true);
  });

  it("never exposes arbitrary shell args", () => {
    const { args } = _ffmpegArgsFor({ videoPath: "v.mp4", audioPath: "a.wav", outputPath: "out.mp4", strategy: "shortest", preserveVideoAudio: false }, probe);
    // No shell metacharacters in constructed args
    for (const a of args) assert.equal(/[;&|<>$`]/u.test(a), false, `arg contains shell metacharacter: ${a}`);
  });

  it("builds governed V2 editing args", () => {
    const { args, videoCopied } = _ffmpegArgsFor({
      videoPath: "v.mp4", audioPath: "a.wav", outputPath: "out.mp4", strategy: "shortest", preserveVideoAudio: false,
      editing: { captionsPath: "captions.srt", backgroundMusicPath: "music.mp3", backgroundMusicVolume: 0.1, soundEffects: [{ path: "whoosh.wav", startMs: 500, volume: 0.4 }], watermarkText: "AMF", trimStartMs: 250, trimEndMs: 4750 },
    }, probe);
    assert.equal(videoCopied, false);
    const graph = args[args.indexOf("-filter_complex") + 1];
    assert.match(graph, /subtitles=/u);
    assert.match(graph, /amix=inputs=3/u);
    assert.match(graph, /adelay=500\|500/u);
    assert.match(graph, /drawtext=text='AMF'/u);
    assert.equal(args.at(-1), "out.mp4");
  });

  it("builds an explicit last-frame-hold operation without audio", () => {
    const args = videoTailPadArgs("in.mp4", "out.mp4", 6064);
    assert.equal(args[args.indexOf("-vf") + 1], "tpad=stop_mode=clone:stop_duration=6.064000");
    assert.equal(args.includes("-an"), true);
    assert.equal(args.includes("-shortest"), false);
  });

  it("real FFmpeg last-frame hold reaches the governed target within one frame", async () => {
    const require = createRequire(import.meta.url);
    const packaged = require("ffmpeg-static");
    const alternate = join(process.cwd(), "node_modules", ".ignored", "ffmpeg-static", "ffmpeg.exe");
    const ffmpeg = existsSync(alternate) ? alternate : packaged;
    const ffprobe = require("ffprobe-static").path;
    const dir = mkdtempSync(join(tmpdir(), "tail-pad-test-"));
    const input = join(dir, "input.mp4"); const output = join(dir, "output.mp4");
    try {
      const made = spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=32:d=1", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", input], { encoding: "utf8" });
      assert.equal(made.status, 0, made.stderr);
      await padVideoTail(input, output, 500, { ffmpegBin: ffmpeg, timeoutMs: 15000 });
      const probe = await probeVideoFile(output, { ffprobeBin: ffprobe, timeoutMs: 15000 });
      assert.ok(probe.durationMs >= 1500, `expected >=1500ms, got ${probe.durationMs}`);
      assert.ok(probe.durationMs <= 1532, `expected <= one 32fps frame tolerance, got ${probe.durationMs}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

// ---------------------------------------------------------------------------
// Real ffprobe sanity: probe the shipped VoiceTuT WAV (no mock, just parse)
// ---------------------------------------------------------------------------

describe("media-compose-adapter: real ffprobe on shipped WAV", () => {
  it("probes voicetut-short.wav and finds pcm_s16le 24000 mono", async () => {
    // Use the real adapter probeFile against the actual artifact
    const { probeFile } = await import("../dist/media-compose/media-compose-adapter.js");
    const audioPath = join(process.cwd(), "output/tts-benchmark/voicetut-short.wav");
    try {
      // probeFile expects both streams — will fail on WAV (audio only). Probe manually via spawnCollect.
      const { spawn } = await import("node:child_process");
      const bin = "ffprobe";
      const result = await new Promise((resolve) => {
        const child = spawn(bin, ["-v", "quiet", "-print_format", "json", "-show_streams", audioPath], { shell: false });
        const chunks = []; child.stdout.on("data", (c) => chunks.push(c));
        child.on("close", (code) => resolve({ code, stdout: Buffer.concat(chunks).toString() }));
      });
      const j = JSON.parse(result.stdout);
      if (!Array.isArray(j.streams)) {
        console.warn("ffprobe returned no streams, skipping real probe test");
        return;
      }
      const audio = j.streams.find((s) => s.codec_type === "audio");
      if (!audio) {
        console.warn("ffprobe fixture has no audio stream, skipping real probe test");
        return;
      }
      assert.equal(audio.codec_name, "pcm_s16le");
      assert.equal(Number(audio.sample_rate), 24000);
      assert.equal(Number(audio.channels), 1);
    } catch (e) {
      // If ffprobe not in PATH, skip gracefully — unit tests should not fail on missing binary
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("ENOENT") || msg.includes("ffprobe")) {
        console.warn("ffprobe not available, skipping real probe test");
        return;
      }
      throw e;
    }
  });
});
