/**
 * Slice 7 — safe artifact preview delivery (isolated TEST DB).
 * Confined file + data-URL delivery with ranges, integrity, and
 * fail-closed denials. Never mutates artifacts, workflows, approvals,
 * authority, or strategy. Zero providers.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXDIR = path.join(REPO, "output", `.test-preview-${Date.now().toString(36)}`);

let pool, persistence, server, base;
async function raw(pathname, options = {}) {
  const res = await fetch(`${base}${pathname}`, options);
  const buf = Buffer.from(await res.arrayBuffer());
  const headers = {};
  for (const [k, v] of res.headers) headers[k.toLowerCase()] = v;
  return { status: res.status, headers, body: buf };
}
async function counts() {
  const jobs = await pool.query("SELECT count(*)::int AS n FROM workflow_jobs");
  const subs = await pool.query("SELECT count(*)::int AS n FROM workflow_submissions");
  const appr = await pool.query("SELECT count(*)::int AS n FROM control_approvals");
  const arts = await pool.query("SELECT count(*)::int AS n FROM artifacts");
  return { jobs: jobs.rows[0].n, subs: subs.rows[0].n, appr: appr.rows[0].n, arts: arts.rows[0].n };
}
async function putArtifact(row) {
  await pool.query(
    `INSERT INTO artifacts (artifact_id, workflow_id, kind, producer_agent, correlation_id, status, payload, content_type, schema_version, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (artifact_id) DO NOTHING`,
    [row.artifact_id, row.workflow_id, row.kind, row.producer_agent, row.correlation_id ?? null,
      row.status ?? "completed", JSON.stringify(row.payload), row.content_type ?? "application/json",
      row.schema_version ?? "test-v1", row.created_at ?? new Date().toISOString()],
  );
}

const IMG_BYTES = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const VID_BYTES = Buffer.from("MP4FIXTURE" + "x".repeat(9990));
const WAV_BYTES = Buffer.from("RIFFFIXTURE" + "y".repeat(990));
const sha = (b) => createHash("sha256").update(b).digest("hex");
const dataUrl = (mime, b) => `data:${mime};base64,${b.toString("base64")}`;

before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  await pool.query("DELETE FROM artifacts WHERE artifact_id LIKE 'art-preview-t-%'");
  persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const control = new ControlPlaneStore(pool);
  const handler = createWorkflowApiHandler({ persistence, queue, control });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(FIXDIR, { recursive: true });
  fs.writeFileSync(path.join(FIXDIR, "clip.mp4"), VID_BYTES);
  fs.writeFileSync(path.join(FIXDIR, "img.png"), IMG_BYTES);
  fs.writeFileSync(path.join(FIXDIR, "narr.wav"), WAV_BYTES);
  const imgRel = path.join(FIXDIR, "img.png");
  await putArtifact({ artifact_id: "art-preview-t-img", workflow_id: "wf-preview-t", kind: "scene_visual_artifact", producer_agent: "scene-image", payload: { artifactPathOrReference: imgRel, imageSha256: sha(IMG_BYTES), imageBytes: IMG_BYTES.length } });
  await putArtifact({ artifact_id: "art-preview-t-vid", workflow_id: "wf-preview-t", kind: "scene_video_clip", producer_agent: "video", payload: { videoPathOrReference: path.join(FIXDIR, "clip.mp4"), videoSha256: sha(VID_BYTES) } });
  await putArtifact({ artifact_id: "art-preview-t-final", workflow_id: "wf-preview-t", kind: "final_media_artifact", producer_agent: "final_media_artifact", payload: { finalFileReference: path.join(FIXDIR, "clip.mp4"), sha256: sha(VID_BYTES), status: "completed" } });
  await putArtifact({ artifact_id: "art-preview-t-audio", workflow_id: "wf-preview-t", kind: "narration_audio_artifact", producer_agent: "tts", payload: { path: dataUrl("audio/wav", WAV_BYTES), sha256: sha(WAV_BYTES) } });
  await putArtifact({ artifact_id: "art-preview-t-viddata", workflow_id: "wf-preview-t", kind: "scene_video_clip", producer_agent: "video", payload: { videoPathOrReference: dataUrl("video/mp4", VID_BYTES), videoSha256: sha(VID_BYTES) } });
  await putArtifact({ artifact_id: "art-preview-t-badsha", workflow_id: "wf-preview-t", kind: "scene_video_clip", producer_agent: "video", payload: { videoPathOrReference: dataUrl("video/mp4", VID_BYTES), videoSha256: "0".repeat(64) } });
  await putArtifact({ artifact_id: "art-preview-t-unsupported", workflow_id: "wf-preview-t", kind: "coding_report", producer_agent: "coding", payload: { summary: "code" } });
  await putArtifact({ artifact_id: "art-preview-t-outside", workflow_id: "wf-preview-t", kind: "final_media_artifact", producer_agent: "x", payload: { finalFileReference: path.join(REPO, "package.json") } });
  await putArtifact({ artifact_id: "art-preview-t-scheme", workflow_id: "wf-preview-t", kind: "final_media_artifact", producer_agent: "x", payload: { finalFileReference: "https://example.invalid/evil.mp4" } });
  await putArtifact({ artifact_id: "art-preview-t-missing", workflow_id: "wf-preview-t", kind: "final_media_artifact", producer_agent: "x", payload: { finalFileReference: path.join(FIXDIR, "nope.mp4") } });
});
after(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(FIXDIR, { recursive: true, force: true });
  await pool.query("DELETE FROM artifacts WHERE artifact_id LIKE 'art-preview-t-%'");
  await persistence.close();
});

test("supported delivery: image bytes, types, caching, no path leak", async () => {
  const r = await raw(`/control/artifacts/preview?artifactId=art-preview-t-img`);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "image/png");
  assert.equal(r.headers["accept-ranges"], "bytes");
  assert.ok(r.headers["content-disposition"].includes("inline"));
  assert.ok(r.headers["content-disposition"].includes("art-preview-t-img.png"));
  assert.deepEqual(r.body, IMG_BYTES);
  assert.ok(!JSON.stringify(r.headers).includes("AI-Media-Factory"), "no absolute path leak in headers");
});

test("video file delivery + byte ranges + invalid range", async () => {
  const full = await raw(`/control/artifacts/preview?artifactId=art-preview-t-vid`);
  assert.equal(full.status, 200);
  assert.equal(full.headers["content-type"], "video/mp4");
  assert.deepEqual(full.body, VID_BYTES);
  const part = await raw(`/control/artifacts/preview?artifactId=art-preview-t-vid`, { headers: { Range: "bytes=0-99" } });
  assert.equal(part.status, 206);
  assert.equal(part.headers["content-range"], `bytes 0-99/${VID_BYTES.length}`);
  assert.deepEqual(part.body, VID_BYTES.subarray(0, 100));
  const tail = await raw(`/control/artifacts/preview?artifactId=art-preview-t-vid`, { headers: { Range: `bytes=${VID_BYTES.length - 10}-` } });
  assert.equal(tail.status, 206);
  assert.equal(tail.body.length, 10);
  const bad = await raw(`/control/artifacts/preview?artifactId=art-preview-t-vid`, { headers: { Range: "bytes=99999999-" } });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers["content-range"], `bytes */${VID_BYTES.length}`);
  const garbage = await raw(`/control/artifacts/preview?artifactId=art-preview-t-vid`, { headers: { Range: "bytes=abc" } });
  assert.equal(garbage.status, 416);
});

test("data-URL delivery with digest verification; mismatch fails closed", async () => {
  const r = await raw(`/control/artifacts/preview?artifactId=art-preview-t-audio`);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "audio/wav");
  assert.deepEqual(r.body, WAV_BYTES);
  const v = await raw(`/control/artifacts/preview?artifactId=art-preview-t-viddata`);
  assert.equal(v.status, 200);
  assert.deepEqual(v.body, VID_BYTES);
  const bad = await raw(`/control/artifacts/preview?artifactId=art-preview-t-badsha`);
  assert.equal(bad.status, 500);
  assert.ok(!bad.body.toString().includes("AI-Media-Factory"));
});

test("denials: unknown id, malformed id, unsupported type, missing file, outside root, scheme", async () => {
  assert.equal((await raw(`/control/artifacts/preview?artifactId=art-preview-t-nope`)).status, 404);
  assert.equal((await raw(`/control/artifacts/preview?artifactId=`)).status, 400);
  assert.equal((await raw(`/control/artifacts/preview?artifactId=../secret`)).status, 400);
  assert.equal((await raw(`/control/artifacts/preview?artifactId=art-preview-t-unsupported`)).status, 404);
  assert.equal((await raw(`/control/artifacts/preview?artifactId=art-preview-t-missing`)).status, 404);
  const outside = await raw(`/control/artifacts/preview?artifactId=art-preview-t-outside`);
  assert.equal(outside.status, 403);
  const scheme = await raw(`/control/artifacts/preview?artifactId=art-preview-t-scheme`);
  assert.equal(scheme.status, 403);
  for (const r of [outside, scheme]) {
    assert.ok(!r.body.toString().includes("AI-Media-Factory"), "no absolute path leak in denial bodies");
  }
});

test("preview causes zero state change: artifacts, workflows, approvals untouched", async () => {
  const snap = async (id) => (await pool.query("SELECT * FROM artifacts WHERE artifact_id=$1", [id])).rows[0];
  const before = await counts();
  const rowBefore = JSON.stringify(await snap("art-preview-t-vid"));
  await raw(`/control/artifacts/preview?artifactId=art-preview-t-vid`);
  await raw(`/control/artifacts/preview?artifactId=art-preview-t-vid`, { headers: { Range: "bytes=0-9" } });
  await raw(`/control/artifacts/preview?artifactId=art-preview-t-audio`);
  assert.deepEqual(await counts(), before, "no workflow/approval/artifact writes");
  assert.equal(JSON.stringify(await snap("art-preview-t-vid")), rowBefore, "canonical row byte-identical");
});
