/**
 * Wan2.2 SageAttention Benchmark — direct endpoint driver (fixed params).
 *
 * Sends the EXACT same request every run:
 *   same source PNG (output/runpod-latest.png)
 *   prompt / negative_prompt fixed
 *   width=480 height=832 length=81 steps=10 cfg=2 seed=42
 *
 * Records per run: delayTime, executionTime (RunPod-reported), total wall,
 * output bytes, status. Saves each video to output/bench/<tag>_N.mp4.
 *
 * Usage:
 *   node --env-file=.env experimental/wan2.2-sageattention/benchmark-run.mjs <endpointId> <tag> <runs>
 * Example:
 *   node --env-file=.env experimental/wan2.2-sageattention/benchmark-run.mjs ba6ogh43k6787r A 3
 */

import fs from "node:fs";
import path from "node:path";

const endpointId = process.argv[2];
const tag = process.argv[3] ?? "run";
const runs = Number(process.argv[4] ?? 3);
const apiKey = process.env.RUNPOD_API_KEY;

if (!endpointId || !apiKey) {
  console.error("usage: node benchmark-run.mjs <endpointId> <tag> <runs>  (needs RUNPOD_API_KEY in env)");
  process.exit(1);
}

const pngPath = path.resolve("./output/runpod-latest.png");
if (!fs.existsSync(pngPath)) {
  console.error(`missing source image: ${pngPath}`);
  process.exit(1);
}
const imageBase64 = fs.readFileSync(pngPath).toString("base64");

const INPUT = {
  prompt: "Create a cinematic short video: animated cat walking, smooth motion, high detail",
  negative_prompt: "blurry, low quality, distorted, flicker",
  image_base64: imageBase64,
  width: 480,
  height: 832,
  length: 81,
  steps: 10,
  cfg: 2,
  seed: 42,
};

const results = [];

for (let i = 1; i <= runs; i += 1) {
  const t0 = Date.now();
  process.stdout.write(`[${tag}${i}] submit... `);
  const submitRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: INPUT }),
  });
  const submitBody = await submitRes.json();
  if (!submitRes.ok || !submitBody.id) {
    console.log(`FAILED submit: ${submitRes.status} ${JSON.stringify(submitBody).slice(0, 200)}`);
    results.push({ run: i, status: "submit-failed" });
    continue;
  }
  const jobId = submitBody.id;
  console.log(`job=${jobId}`);

  // poll
  let status = null;
  let body = null;
  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const pollRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/status/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    body = await pollRes.json();
    status = body.status;
    if (status === "COMPLETED" || status === "FAILED" || status === "CANCELLED" || status === "TIMED_OUT") break;
    process.stdout.write(`  ... ${status ?? "polling"} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
  }

  const wallS = (Date.now() - t0) / 1000;
  if (status !== "COMPLETED") {
    console.log(`[${tag}${i}] FAILED status=${status} error=${JSON.stringify(body?.error ?? "").slice(0, 200)}`);
    results.push({ run: i, status: status ?? "timeout", wallS });
    continue;
  }

  const videoB64 = body.output?.video ?? "";
  const bytes = Buffer.byteLength(videoB64, "base64");
  const rec = {
    run: i,
    status,
    delayTimeMs: body.delayTime,
    executionTimeMs: body.executionTime,
    wallS: Math.round(wallS * 10) / 10,
    outputBytes: bytes,
    jobId,
  };
  results.push(rec);
  console.log(`[${tag}${i}] OK delay=${body.delayTime}ms exec=${body.executionTime}ms wall=${rec.wallS}s bytes=${bytes}`);

  // save video
  const outDir = path.resolve("./output/bench");
  fs.mkdirSync(outDir, { recursive: true });
  const buf = Buffer.from(videoB64, "base64");
  const ftyp = buf.slice(4, 8).toString();
  fs.writeFileSync(path.join(outDir, `${tag}${i}_${jobId}.mp4`), buf);
  console.log(`  saved ${tag}${i}_${jobId}.mp4 (ftyp=${ftyp})`);
}

console.log("\n=== RESULTS ===");
for (const r of results) console.log(JSON.stringify(r));

const ok = results.filter((r) => r.status === "COMPLETED");
if (ok.length > 0) {
  const exec = ok.map((r) => r.executionTimeMs);
  const delay = ok.map((r) => r.delayTimeMs);
  const wall = ok.map((r) => r.wallS);
  const stat = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { mean: Math.round(a.reduce((x, y) => x + y, 0) / a.length), median: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
  };
  console.log(`\n${tag}: n=${ok.length}`);
  console.log(`  executionTime: ${JSON.stringify(stat(exec))} ms`);
  console.log(`  delayTime:     ${JSON.stringify(stat(delay))} ms`);
  console.log(`  wall:          ${JSON.stringify(stat(wall))} s`);
}
