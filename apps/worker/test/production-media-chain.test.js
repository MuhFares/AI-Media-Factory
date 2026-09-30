import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { ProductionMediaChainBridge, assembleVisualPrompt, validateVisualPromptContract } from "../dist/media-chain/production-media-chain.js";
import { saveV2DirectionContract, v2SceneContract, v2DirectionContract } from "./visual-v2-fixtures.js";
import { resolveProductionTtsVoice } from "../dist/production-executor.js";

function store() { const rows = []; return { rows, saveArtifact: async (a) => { rows.push(a); }, listArtifacts: async (workflowId) => rows.filter((a) => a.workflowId === workflowId) }; }
function wavDataUrl() { const pcm = Buffer.alloc(1600); const wav = Buffer.alloc(44 + pcm.length); wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44); return `data:audio/wav;base64,${wav.toString("base64")}`; }
function result(capabilityId, input) {
  if (capabilityId === "tts.generate") return { status: "success", resultId: `tts-${input.text.length}`, capabilityId, output: { url: wavDataUrl(), audioId: `audio-${input.text.length}`, providerId: "mock-tts", model: "fixture-model", voice: "fixture", format: "wav" } };
  if (capabilityId === "timeline.plan") return { status: "success", resultId: "timeline-1", capabilityId, output: { timelineId: "timeline-1", narrationDurationMs: input.narrationDurationMs, sceneCount: 3, scenes: [{ sceneId: "scene-001" }, { sceneId: "scene-002" }, { sceneId: "scene-003" }] } };
  if (capabilityId === "image.generate") return { status: "success", resultId: `image-${input.sceneId}`, capabilityId, output: { imageId: `image-${input.sceneId}`, url: `file:///${input.sceneId}.png`, providerId: "mock-image", sha256: `${input.sceneId}-hash` } };
  if (capabilityId === "video.generate") return { status: "success", resultId: `video-${input.sceneId}`, capabilityId, output: { videoId: `video-${input.sceneId}`, url: `file:///${input.sceneId}.mp4`, providerId: "mock-wan" } };
  if (capabilityId === "media.compose") return { status: "success", resultId: "media-1", capabilityId, output: { mediaId: "media-1", path: "file:///final.mp4" } };
  return { status: "failed", resultId: "unknown", capabilityId, error: { code: "UNKNOWN", message: "unknown", retryable: false } };
}

describe("ProductionMediaChainBridge", () => {
  it("derives new logical TTS identities for a new media resume", async () => {
    const persistence = store(); const ids = [];
    const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: { executeCapability: async (request) => { ids.push(request.input.logicalSubmissionId); return result(request.capabilityId, request.input); } } });
    const base = { workflowId: "wf-new-logical", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "same frozen script", language: "en", voice: "Mohamed", ttsProvider: "voicetut", ttsModel: "UNKNOWN" };
    await bridge.executeTts({ ...base, mediaResumeId: "resume-r2" });
    await bridge.executeTts({ ...base, mediaResumeId: "resume-r3" });
    strictEqual(ids.length, 2);
    strictEqual(typeof ids[0], "string");
    strictEqual(ids[0] === ids[1], false);
  });

  it("attributes failed VoiceTut chunks only to resolved VoiceTut configuration", async () => {
    const provenance = [];
    const persistence = { ...store(), saveExecutionProvenance: async (row) => provenance.push(row), listExecutionProvenance: async () => provenance };
    const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: { executeCapability: async (request) => ({
      status: "failed", resultId: "failed", capabilityId: request.capabilityId,
      error: { code: "PROVIDER_ERROR", message: "submission outcome unknown", retryable: false, failureMetadata: { provider: "voicetut", model: null, providerReceiptStatus: "UNKNOWN", transportDiagnostic: "DNS_ERROR", transportPhase: "FETCH_INVOCATION_STARTED" } },
    }) } });
    const out = await bridge.executeTts({ workflowId: "wf-vt-provenance", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "one chunk", language: "en", voice: "Mohamed", ttsProvider: "voicetut", ttsModel: "UNKNOWN" });
    strictEqual(out.status, "BLOCKED");
    const coordinator = provenance.find((row) => row.agentId === "tts-chunk-coordinator");
    strictEqual(coordinator.provider, "voicetut");
    strictEqual(coordinator.model, "UNKNOWN");
    strictEqual(coordinator.configuration.logicalChunkId.startsWith("tts-logical-chunk-"), true);
    strictEqual(JSON.stringify(coordinator).includes("groq"), false);
    strictEqual(JSON.stringify(coordinator).includes("fixture"), false);
    strictEqual(coordinator.failureMetadata.providerReceiptStatus, "UNKNOWN");
  });

  it("routes the canonical 280-character narration through two independent single-chunk boundaries", async () => {
    const persistence = store(); const calls = [];
    const script = "Watch this: an unpeeled orange floats, but peel it and it sinks. The peel is full of tiny air pockets, adding lots of volume without much mass. That lowers the orange's average density, so water can support it. Remove the peel, and the fruit becomes denser than water—so it sinks.";
    const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: { executeCapability: async (request) => { calls.push(request); return result(request.capabilityId, request.input); } } });
    const out = await bridge.executeTts({ workflowId: "wf-tts-coordinator", correlationId: "corr", contentId: "c", scriptIdentity: "s", script, language: "en", voice: "hannah" });
    strictEqual(out.status, "COMPLETED");
    deepStrictEqual(calls.map((call) => call.input.text.length), [143, 136]);
    strictEqual(calls.every((call) => call.input.singleChunk === true), true);
    strictEqual(persistence.rows.filter((row) => row.kind === "chunk_audio_artifact").length, 2);
    strictEqual(persistence.rows.some((row) => row.kind === "narration_audio_artifact" && row.payload.childArtifactIds.length === 2), true);
  });

  it("executes real local bridge stages with injected capabilities and pauses before Wan", async () => {
    const persistence = store(); const calls = [];
    const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: { executeCapability: async (request) => { calls.push(request); return result(request.capabilityId, request.input); } } });
    const pending = await bridge.execute({ workflowId: "wf-media", correlationId: "corr", contentId: "content-1", scriptIdentity: "script-1", script: "A measured narration.", language: "en", voice: "fixture" });
    strictEqual(pending.status, "AWAITING_APPROVAL");
    strictEqual(calls.filter((c) => c.capabilityId === "video.generate").length, 0);
    strictEqual(persistence.rows.some((a) => a.kind === "narration_artifact"), true);
    strictEqual(persistence.rows.some((a) => a.kind === "timeline_plan" && a.payload.narrationDurationMs === 100), true);
    strictEqual(persistence.rows.filter((a) => a.kind === "scene_visual_artifact").length, 3);
  });

  it("resumes with per-scene approvals and persists clips plus final media", async () => {
    const persistence = store();
    const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: { executeCapability: async (request) => result(request.capabilityId, request.input) } });
    const completed = await bridge.execute({ workflowId: "wf-media-2", correlationId: "corr", contentId: "content-2", scriptIdentity: "script-2", script: "A measured narration.", language: "en", voice: "fixture", approvedHumanScenes: { "scene-001": "APPROVED", "scene-002": "APPROVED", "scene-003": "APPROVED" } });
    strictEqual(completed.status, "COMPLETED");
    strictEqual(completed.authorizations.length, 3);
    strictEqual(completed.clips.length, 3);
    strictEqual(completed.finalMedia.timelineIdentity, "timeline-1");
    deepStrictEqual(completed.clips.map((c) => c.sceneId), ["scene-001", "scene-002", "scene-003"]);
  });

  it("binds the newest Director scene briefs to exactly one image request per scene", async () => {
    const persistence = store(); const prompts = [];
    const subjects = [
      "photorealistic whole unpeeled orange floating in clear water in a transparent container",
      "photorealistic peeled orange sinking below in clear water in a transparent container",
      "single clean photorealistic orange peel air pockets water buoyancy explanation",
    ];
    const bridge = new ProductionMediaChainBridge({
      persistence,
      directorAgent: { execute: async () => ({ output: { status: "completed", scenePlan: { planId: "p", scenes: [
        { sceneId: "scene-001", narrationSegment: "float", visualPrompt: "photorealistic whole unpeeled orange floating in clear water in a transparent container" },
        { sceneId: "scene-002", narrationSegment: "sink", visualPrompt: "photorealistic peeled orange sinking below in clear water in a transparent container" },
        { sceneId: "scene-003", narrationSegment: "why", visualPrompt: "single clean photorealistic orange peel air pockets water buoyancy explanation" },
      ] } } }) },
      capabilityExecution: { executeCapability: async (request) => { if (request.capabilityId === "image.generate") { prompts.push(request.input.prompt); return { status: "success", resultId: request.input.sceneId, capabilityId: request.capabilityId, output: { imageId: request.input.sceneId, url: `file:///${request.input.sceneId}.png`, providerId: "mock-image" } }; } return result(request.capabilityId, request.input); } },
      videoAgent: { execute: async () => ({ output: {} }) }, mediaAgent: { execute: async () => ({ output: {} }) },
    });
    await bridge.executeDirector({ workflowId: "wf-binding", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "orange", language: "en", voice: "fixture" });
    // V2 fixture plays the future creative-agent role: structured contracts
    // carrying the Director-declared visual content under the style lock.
    await persistence.saveArtifact({ artifactId: "art-wf-binding-visual-direction-v2", workflowId: "wf-binding", correlationId: "corr", kind: "visual_direction_contract", producerAgent: "visual-direction-v2-fixture", status: "completed", payload: v2DirectionContract("wf-binding", ["scene-001", "scene-002", "scene-003"], { scenes: ["scene-001", "scene-002", "scene-003"].map((sceneId, i) => v2SceneContract(sceneId, { subject: subjects[i], action: `fixture action ${i + 1}: resting in clear water` })) }), contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString() });
  const out = await bridge.executeSceneImage({ workflowId: "wf-binding", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "orange", language: "en", voice: "fixture", regenerationVersion: 2 });
    strictEqual(out.status, "COMPLETED");
    strictEqual(prompts.length, 3);
    prompts.forEach((prompt, i) => {
      strictEqual(prompt.startsWith(`SUBJECT: ${subjects[i]}`), true);
      strictEqual(prompt.includes("STYLE LOCK: photoreal_cinematic"), true);
    });
    strictEqual(persistence.rows.filter((a) => a.kind === "scene_visual_artifact" && a.artifactId.endsWith("-regen-v2")).length, 3);
    strictEqual(persistence.rows.some((a) => a.kind === "visual_prompt_plan" && a.artifactId.endsWith("-regen-v2")), true);
  });
});

it("resolves production voice from workflow or VoiceTut adapter default, never fixture", () => {
  const previous = process.env.VOICETUT_DEFAULT_SPEAKER;
  delete process.env.VOICETUT_DEFAULT_SPEAKER;
  try {
    strictEqual(resolveProductionTtsVoice(undefined), "Mohamed");
    strictEqual(resolveProductionTtsVoice(undefined, "wf-1789233193749-gvydpiah"), "Mohamed");
    strictEqual(resolveProductionTtsVoice("fixture", "wf-1789233193749-gvydpiah"), "Mohamed");
    strictEqual(resolveProductionTtsVoice("Asmaa"), "Asmaa");
    strictEqual(resolveProductionTtsVoice("   "), "Mohamed");
  } finally {
    if (previous === undefined) delete process.env.VOICETUT_DEFAULT_SPEAKER;
    else process.env.VOICETUT_DEFAULT_SPEAKER = previous;
  }
});

it("selective regeneration excludes locked scene and reviews locked artifact", async () => {
  const persistence = store();
  const calls = [];
  const bridge = new ProductionMediaChainBridge({
    persistence,
    directorAgent: { execute: async () => ({ output: { status: "completed", scenePlan: { status: "completed", scenes: [
      { sceneId: "scene-001", visualPrompt: "one unpeeled orange floating in clear water in transparent glass container" },
      { sceneId: "scene-002", visualPrompt: "one whole peeled orange sinking submerged in clear water in transparent glass container; no slices or wedges" },
      { sceneId: "scene-003", visualPrompt: "one orange peel with porous pith and air pockets beside clear water, buoyancy density conclusion, one clean photorealistic scene" },
    ] } } }) },
    videoAgent: { execute: async () => ({ output: {} }) }, mediaAgent: { execute: async () => ({ output: {} }) },
    capabilityExecution: { executeCapability: async (request) => { calls.push(request.input); return { status: "success", output: { providerId: "fixture", url: "data:image/png;base64,aW1hZ2U=", imageId: `id-${request.input.sceneId}` } }; } },
  });
  await persistence.saveArtifact({ artifactId: "art-wf-binding-director", workflowId: "wf-binding", kind: "scene_plan", status: "completed", payload: { scenes: [
    { sceneId: "scene-001", visualPrompt: "one unpeeled orange floating in clear water in transparent glass container" },
    { sceneId: "scene-002", visualPrompt: "one whole peeled orange sinking submerged in clear water in transparent glass container; no slices or wedges" },
    { sceneId: "scene-003", visualPrompt: "one orange peel with porous pith and air pockets beside clear water, buoyancy density conclusion, one clean photorealistic scene" },
  ] } });
  await saveV2DirectionContract(persistence, "wf-binding", ["scene-001", "scene-002", "scene-003"]);
  const out = await bridge.executeSceneImage({ workflowId: "wf-binding", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "orange", language: "en", voice: "fixture", regenerationVersion: 3, regenerationSceneIds: ["scene-002", "scene-003"], lockedVisualArtifactIds: ["art-wf-binding-scene-001-visual-regen-v2"] });
  strictEqual(out.status, "COMPLETED"); deepStrictEqual(out.output.sceneIds, ["scene-002", "scene-003"]); deepStrictEqual(calls.map((c) => c.sceneId), ["scene-002", "scene-003"]);
  const review = await bridge.executeVisualSemanticReview({ workflowId: "wf-binding", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "orange", language: "en", voice: "fixture", regenerationVersion: 3, regenerationSceneIds: ["scene-002", "scene-003"], lockedVisualArtifactIds: ["art-wf-binding-scene-001-visual-regen-v2"] });
  strictEqual(review.status, "COMPLETED"); strictEqual(persistence.rows.filter((a) => a.kind === "visual_semantic_review").length, 2);
});

it("preserves generic positive and negative visual constraints before provider execution", () => {
  const assembly = assembleVisualPrompt({ visualPrompt: "studio experiment", visualConstraints: {
    requiredSubjects: ["one whole peeled object"], requiredStates: ["submerged"], requiredRelations: ["inside clear water"], requiredEnvironment: ["transparent container"], requiredComposition: ["one single scene"], continuityRequirements: ["same lighting"], forbiddenSubjects: ["slices", "multiple pieces"], forbiddenComposition: ["split screen"], forbiddenText: ["labels"],
  } });
  strictEqual(validateVisualPromptContract(assembly).valid, true);
  strictEqual(assembly.negativePrompt.includes("slices"), true);
  strictEqual(assembly.negativePrompt.includes("split screen"), true);
});

it("blocks before provider when a structured constraint is missing", async () => {
  const persistence = store(); let calls = 0;
  const bridge = new ProductionMediaChainBridge({ persistence, videoAgent: { execute: async () => ({ output: {} }) }, mediaAgent: { execute: async () => ({ output: {} }) }, capabilityExecution: { executeCapability: async () => { calls++; return result("image.generate", {}); } } });
  await persistence.saveArtifact({ artifactId: "art-wf-contract-director", workflowId: "wf-contract", kind: "scene_plan", status: "completed", payload: { scenes: [{ sceneId: "scene-001", visualPrompt: "one whole peeled object submerged in clear water in transparent container", visualConstraints: { requiredSubjects: ["one whole peeled object"], requiredStates: ["floating"], requiredEnvironment: ["clear water"] } }, { sceneId: "scene-002", visualPrompt: "one whole peeled object submerged in clear water in transparent container", visualConstraints: { requiredSubjects: ["one whole peeled object"], requiredStates: ["submerged"], requiredEnvironment: ["clear water"] } }, { sceneId: "scene-003", visualPrompt: "one whole peeled object submerged in clear water in transparent container", visualConstraints: { requiredSubjects: ["one whole peeled object"], requiredStates: ["submerged"], requiredEnvironment: ["clear water"] } }] } });
  const out = await bridge.executeSceneImage({ workflowId: "wf-contract", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "s", language: "en", voice: "fixture" });
  strictEqual(out.status, "BLOCKED"); strictEqual(calls, 0);
});

it("image units follow the Director plan (five scenes => five image calls), not timeline slices", async () => {
  const persistence = store(); const imageCalls = [];
  const scenes = ["scene-001", "scene-002", "scene-003", "scene-004", "scene-005"].map((sceneId) => ({
    sceneId,
    visualPrompt: "one whole peeled object submerged in clear water in transparent container",
    visualConstraints: { requiredSubjects: ["one whole peeled object"], requiredStates: ["submerged"], requiredEnvironment: ["clear water"] },
  }));
  await persistence.saveArtifact({ artifactId: "art-wf-five-director", workflowId: "wf-five", kind: "scene_plan", status: "completed", payload: { sceneIds: scenes.map((s) => s.sceneId), scenes } });
  await persistence.saveArtifact({ artifactId: "art-wf-five-narration", workflowId: "wf-five", kind: "narration_artifact", status: "completed", payload: { durationMs: 30920, voice: "Mohamed" } });
  await saveV2DirectionContract(persistence, "wf-five", ["scene-001", "scene-002", "scene-003", "scene-004", "scene-005"]);
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: { executeCapability: async (request) => {
    if (request.capabilityId === "image.generate") imageCalls.push(request.input.sceneId);
    if (request.capabilityId === "timeline.plan") return { status: "success", resultId: "tl", capabilityId: request.capabilityId, output: { timelineId: "tl", narrationDurationMs: 30920, sceneCount: 8, scenes: [] } };
    return result(request.capabilityId, request.input);
  } } });
  const tl = await bridge.executeTimeline({ workflowId: "wf-five", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "s", language: "en", voice: "Mohamed" });
  strictEqual(tl.status, "COMPLETED");
  deepStrictEqual(tl.output.sceneIds, ["scene-001", "scene-002", "scene-003", "scene-004", "scene-005"], "timeline payload carries Director scenes, not timing slices");
  const img = await bridge.executeSceneImage({ workflowId: "wf-five", correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "s", language: "en", voice: "Mohamed" });
  strictEqual(img.status, "COMPLETED");
  deepStrictEqual(imageCalls, ["scene-001", "scene-002", "scene-003", "scene-004", "scene-005"], "exactly one image per frozen Director scene");
});
