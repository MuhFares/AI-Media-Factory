import { test } from "node:test";
import assert from "node:assert/strict";
import { createProductionAgentExecutor } from "../dist/production-executor.js";
import { readFile } from "node:fs/promises";
import { saveV2DirectionContract } from "./visual-v2-fixtures.js";
const fixtureAudioUrl = `data:audio/wav;base64,${(await readFile(new URL("../../../output/tts-benchmark/voicetut-short.wav", import.meta.url))).toString("base64")}`;

function persistence() {
  const rows = [];
  return {
    rows,
    saveArtifact: async (a) => { const i = rows.findIndex((x) => x.artifactId === a.artifactId); if (i >= 0) rows[i] = a; else rows.push(a); },
    listArtifacts: async (workflowId) => rows.filter((a) => a.workflowId === workflowId),
  };
}

function boundary(calls) {
  return { boundary: { executeCapability: async (request) => {
    calls.push(request);
    const input = request.input ?? {};
    if (request.capabilityId === "tts.generate") return { status: "success", resultId: "tts-1", capabilityId: request.capabilityId, output: { audioUrl: fixtureAudioUrl, audioId: "audio-1", providerId: "mock-tts", durationMs: 13740, audioIntegrity: "VALID" } };
    if (request.capabilityId === "timeline.plan") return { status: "success", resultId: "timeline-1", capabilityId: request.capabilityId, output: { timelineId: "timeline-1", narrationDurationMs: input.narrationDurationMs, scenes: ["scene-001", "scene-002", "scene-003"] } };
    if (request.capabilityId === "image.generate") return { status: "success", resultId: `image-${input.sceneId}`, capabilityId: request.capabilityId, output: { imageId: `image-${input.sceneId}`, url: `file:///${input.sceneId}.png`, providerId: "mock-image" } };
    if (request.capabilityId === "video.generate") return { status: "success", resultId: `video-${request.requestId}`, capabilityId: request.capabilityId, output: { videoId: `video-${request.requestId}`, url: "data:video/mp4;base64,AAAA", providerId: "mock-wan", durationSeconds: 4 }, evidence: { capabilityId: "video.generate", agentId: "video", workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, videoStatus: "completed" } };
    if (request.capabilityId === "media.compose") return { status: "success", resultId: "media-1", capabilityId: request.capabilityId, output: { mediaId: "media-1", output: { path: "file:///final.mp4", mimeType: "video/mp4", bytes: 1, sha256: "fixture" }, final: { durationMs: 13740, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" }, composition: { strategy: "shortest", videoCopied: false } }, evidence: { capabilityId: "media.compose", agentId: "composer", workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true } };
    return { status: "blocked", resultId: "unknown", capabilityId: request.capabilityId, reason: "unexpected" };
  } } };
}

test("default production executor registers and executes all media stages through the real bridge", async () => {
  const store = persistence(); const calls = [];
  await store.saveArtifact({ artifactId: "writer-fixture", workflowId: "wf-default-media", correlationId: "corr", kind: "writer_report", producerAgent: "writer", status: "completed", createdAt: new Date().toISOString(), payload: { contentId: "content-fixture", title: "Egypt travel", content: "Egypt travel begins here." } });
  const executor = createProductionAgentExecutor({ persistence: store, providerBoundary: boundary(calls) });
  const context = { workflowId: "wf-default-media", correlationId: "corr", data: { directive: "Egypt travel", language: "en", voice: "fixture", previousArtifact: { artifactId: "writer-fixture", kind: "writer_report" } } };
  const stages = ["director", "tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa"];
  // V2 fixture plays the future creative-agent role for the deterministic trio.
  await saveV2DirectionContract(store, "wf-default-media", ["scene-001", "scene-002", "scene-003"]);
  for (const agent of stages) { const result = await executor.executeAgentStep({ id: agent, agent, dependencies: [] }, context); assert.equal(result.status, "completed", JSON.stringify(result)); }
  const visuals = store.rows.filter((x) => x.kind === "scene_visual_artifact");
  assert.equal(visuals.length, 3);
  assert.deepEqual(visuals.map((x) => x.payload.sceneId).sort(), ["scene-001", "scene-002", "scene-003"]);
  assert.ok(visuals.every((x) => typeof x.payload.sceneId === "string"));
  assert.equal(store.rows.find((x) => x.kind === "narration_artifact").payload.durationMs, 12640);
  context.data.approvedHumanScenes = { "scene-001": "APPROVED", "scene-002": "APPROVED", "scene-003": "APPROVED" };
  for (const agent of ["wan-authorization", "video", "composer"]) { const result = await executor.executeAgentStep({ id: agent, agent, dependencies: [] }, context); assert.equal(result.status, "completed", JSON.stringify(result)); }
  assert.equal(store.rows.filter((x) => x.kind === "wan_authorization").length, 3);
  assert.equal(store.rows.filter((x) => x.kind === "scene_video_clip").length, 3);
  assert.equal(store.rows.filter((x) => x.kind === "final_media_artifact").length, 1);
  assert.equal(calls.filter((x) => x.capabilityId === "image.generate").length, 3);
  assert.equal(calls.filter((x) => x.capabilityId === "video.generate").length, 3);
});

test("missing media bridge fails closed instead of creating deterministic success", async () => {
  const executor = createProductionAgentExecutor({ providerBoundary: boundary([]), mediaChainBridge: undefined });
  const result = await executor.executeAgentStep({ id: "tts", agent: "tts", dependencies: [] }, { workflowId: "wf-missing", correlationId: "c", data: {} });
  assert.equal(result.status, "failed");
  assert.equal(result.error.message, "EXECUTOR_NOT_CONFIGURED");
});
