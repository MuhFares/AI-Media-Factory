import { test } from "node:test";
import assert from "node:assert/strict";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { buildDefaultEngine, createProductionAgentExecutor } from "../dist/index.js";
import { readFile } from "node:fs/promises";
import { withV2ContractFixture } from "./visual-v2-fixtures.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const fixtureAudioUrl = `data:audio/wav;base64,${(await readFile(new URL("../../../output/tts-benchmark/voicetut-short.wav", import.meta.url))).toString("base64")}`;
class MemoryPersistence {
  workflows = new Map(); checkpoints = new Map(); artifacts = new Map(); caps = new Map(); evidence = new Map(); decisions = new Map(); provenance = new Map();
  async saveWorkflow(v) { this.workflows.set(v.workflowId, clone(v)); }
  async loadWorkflow(id) { const v = this.workflows.get(id); return v ? clone(v) : null; }
  async saveCheckpoint(v) { this.checkpoints.set(v.workflowId, clone(v)); }
  async loadLatestCheckpoint(id) { const v = this.checkpoints.get(id); return v ? clone(v) : null; }
  async saveArtifact(v) { this.artifacts.set(v.artifactId, clone(v)); }
  async listArtifacts(id) { return [...this.artifacts.values()].filter((v) => v.workflowId === id).map(clone); }
  async saveCapabilityExecution(v) { this.caps.set(v.resultId, clone(v)); }
  async listCapabilityExecutions(id) { return [...this.caps.values()].filter((v) => v.workflowId === id).map(clone); }
  async saveExecutionEvidence(v) { this.evidence.set(v.evidenceId, clone(v)); }
  async listExecutionEvidence(id) { return [...this.evidence.values()].filter((v) => v.workflowId === id).map(clone); }
  async saveExecutionProvenance(v) { this.provenance.set(v.executionId, clone(v)); }
  async listExecutionProvenance(id) { return [...this.provenance.values()].filter((v) => v.workflowId === id).map(clone); }
  async claimReadyExecutionProvenance(executionId) {
    const value = this.provenance.get(executionId);
    if (value?.configuration?.lifecycleState !== "READY_FOR_SUBMISSION") return false;
    value.configuration.lifecycleState = "PROVIDER_SUBMISSION_INTENT";
    value.configuration.providerSubmissionStarted = true;
    this.provenance.set(executionId, clone(value));
    return true;
  }
  async saveDecision(v) { this.decisions.set(v.decisionId, clone(v)); }
  async listDecisions(id) { return [...this.decisions.values()].filter((v) => v.workflowId === id).map(clone); }
  async close() {}
}
const waitFor = async (fn, label) => { const until = Date.now() + 5000; while (Date.now() < until) { if (await fn()) return; await new Promise((r) => setTimeout(r, 10)); } throw new Error(`timeout: ${label}`); };
const traceEvent = (trace, event) => { trace.push(event); if (process.env.DURABLE_PRODUCE_TRACE === "1") console.error("DURABLE_TRACE_EVENT", JSON.stringify(event)); };
const success = (request, output, extra = {}) => ({ status: "success", resultId: `${request.capabilityId}-${request.requestId}`, capabilityId: request.capabilityId, output, evidence: { evidenceId: `e-${request.requestId}`, capabilityId: request.capabilityId, agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, providerInvoked: true, resultStatus: "success", ...extra } });
function boundary(counts, trace) { return { boundary: { executeCapability: async (request) => {
  traceEvent(trace, { kind: "capability", phase: "ENTER", id: request.capabilityId, at: Date.now() });
  counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1; const i = request.input ?? {};
  let result;
  if (request.capabilityId === "web.search") result = success(request, { results: [{ title: "Egypt travel", url: "https://example.test/egypt", snippet: "fixture" }] });
  else if (request.capabilityId === "tts.generate") result = success(request, { audioUrl: fixtureAudioUrl, audioId: "narration-fixture", providerId: "mock-tts", durationMs: 12640, audioIntegrity: "VALID" });
  else if (request.capabilityId === "timeline.plan") result = success(request, { timelineId: "timeline-13740", narrationDurationMs: i.narrationDurationMs, sceneIds: ["scene-001", "scene-002", "scene-003"] });
  else if (request.capabilityId === "image.generate") result = success(request, { imageId: `image-${i.sceneId}`, url: `file:///${i.sceneId}.png`, providerId: "mock-image" });
  else if (request.capabilityId === "video.generate") result = success(request, { videoId: `video-${i.sourceAssetIds?.[0] ?? counts[request.capabilityId]}`, url: `file:///clip-${counts[request.capabilityId]}.mp4`, providerId: "mock-wan", durationSeconds: 4 }, { videoStatus: "completed" });
  else if (request.capabilityId === "media.compose") result = success(request, { mediaId: "final-media", output: { path: "file:///final.mp4", mimeType: "video/mp4", bytes: 1, sha256: "fixture" }, final: { durationMs: 13740, width: 1080, height: 1920, videoCodec: "h264", audioCodec: "aac" }, composition: { strategy: "shortest", videoCopied: false } });
  else if (request.capabilityId === "publish.youtube") result = success(request, { publicationId: "mock-publication", url: "https://example.test/publication", publishedAt: new Date().toISOString(), providerId: "mock-publisher", idempotencyKey: "mock-publish-key" }, { platform: "youtube" });
  else result = success(request, {});
  traceEvent(trace, { kind: "capability", phase: "EXIT", id: request.capabilityId, at: Date.now() });
  return result;
} } }; }
const makeRuntime = (store, counts, definition, trace) => { const executor = withV2ContractFixture(createProductionAgentExecutor({ persistence: store, providerBoundary: boundary(counts, trace) }), store); const run = executor.executeAgentStep.bind(executor); executor.executeAgentStep = async (step, context) => { counts[`stage:${step.id}`] = (counts[`stage:${step.id}`] ?? 0) + 1; traceEvent(trace, { kind: "stage", phase: "ENTER", id: step.id, at: Date.now() }); const result = await run(step, context); traceEvent(trace, { kind: "stage", phase: "EXIT", id: step.id, status: result.status, error: result.error?.message ?? result.output?.error ?? null, output: step.id === "publisher" ? result.output : undefined, at: Date.now() }); return result; }; const engine = buildDefaultEngine({ persistence: store, executor, definitionLoader: async () => definition }); return { engine, executor }; };

test("actual produce workflow reaches durable media closure before the separately recorded publication-QA blocker", { timeout: 15000 }, async () => {
  const definition = directiveToWorkflowDefinition("produce"); const store = new MemoryPersistence(); const counts = {}; const trace = []; const workflowId = "wf-produce-durable";
  process.env.TEXT_AGENT_PROVIDER = "deterministic";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { trace.push({ kind: "network", phase: "BLOCKED", id: "fetch", at: Date.now() }); throw new Error("TEST_NETWORK_TRIPWIRE"); };
  try {
  const first = makeRuntime(store, counts, definition, trace);
  await first.engine.start({ workflowId, definition, trigger: { directive: "produce", contentTopic: "Egypt travel. Ancient history. Modern culture.", language: "en", voice: "fixture" }, correlationId: "corr-produce", brandId: null });
  try { await waitFor(async () => (await store.loadWorkflow(workflowId))?.state === "AWAITING_APPROVAL", "pre-production owner gate"); } catch (error) { console.error("DURABLE_TRACE", JSON.stringify({ trace, workflow: await store.loadWorkflow(workflowId), handles: process._getActiveHandles().map((handle) => handle.constructor?.name) })); throw error; }
  const preGate = await store.loadWorkflow(workflowId);
  const preGateArtifacts = await store.listArtifacts(workflowId);
  assert.equal(preGate.state, "AWAITING_APPROVAL");
  assert.equal(preGate.steps.find((step) => step.stepId === "pre-production-owner-gate")?.status, "running");
  assert.equal(preGate.steps.find((step) => step.stepId === "director")?.status, "pending");
  assert.equal(preGateArtifacts.filter((a) => a.kind === "review_report").length, 1, "review artifact persisted before the gate");
  assert.equal(preGateArtifacts.some((a) => a.kind === "scene_plan"), false, "no director work before owner approval");
  assert.equal(preGateArtifacts.some((a) => a.kind === "narration_artifact"), false, "no tts work before owner approval");
  assert.equal(preGateArtifacts.some((a) => a.kind === "timeline_plan"), false, "no timeline work before owner approval");
  assert.equal(preGateArtifacts.some((a) => a.kind === "scene_visual_artifact"), false, "no scene-image work before owner approval");
  assert.equal(counts["tts.generate"] ?? 0, 0); assert.equal(counts["image.generate"] ?? 0, 0); assert.equal(counts["video.generate"] ?? 0, 0); assert.equal(counts["media.compose"] ?? 0, 0);
  await first.engine.signalApproval(workflowId, { workflowId, stepId: "pre-production-owner-gate", outcome: "approved", approver: "human_operator", note: "owner approved content package", decidedAt: new Date().toISOString() });
  await waitFor(async () => { const workflow = await store.loadWorkflow(workflowId); return workflow?.state === "AWAITING_APPROVAL" && workflow.steps?.find((step) => step.stepId === "visual-human-gate")?.status === "running"; }, "visual human gate");
  const checkpoint = await store.loadWorkflow(workflowId); const artifacts = await store.listArtifacts(workflowId);
  assert.equal(checkpoint.state, "AWAITING_APPROVAL"); assert.equal(counts["video.generate"] ?? 0, 0); assert.equal(counts["media.compose"] ?? 0, 0);
  assert.equal(counts["stage:director"] ?? 0, 1, "director starts exactly once after owner approval");
  for (const kind of ["scene_plan", "narration_artifact", "timeline_plan", "scene_visual_artifact", "visual_semantic_review", "visual_technical_qa"]) assert.ok(artifacts.some((a) => a.kind === kind), `persisted ${kind}`);
  assert.equal(artifacts.filter((a) => a.kind === "scene_visual_artifact").length, 3);
  const before = clone(counts); const old = first; // Explicitly discard all runtime references before reconstructing.
  const second = makeRuntime(store, counts, definition, trace); assert.notEqual(second.engine, old.engine); assert.notEqual(second.executor, old.executor);
  await second.engine.resume(workflowId);
  await waitFor(async () => (await store.loadWorkflow(workflowId))?.state === "AWAITING_APPROVAL", "reloaded visual human gate");
  await second.engine.signalApproval(workflowId, { workflowId, stepId: "visual-human-gate", outcome: "approved", approver: "human_operator", note: "fixture approval", decidedAt: new Date().toISOString(), sceneDecisions: { "scene-001": "APPROVED", "scene-002": "APPROVED", "scene-003": "APPROVED" } });
  await waitFor(async () => { const workflow = await store.loadWorkflow(workflowId); return workflow?.state === "AWAITING_APPROVAL" && workflow.steps?.find((step) => step.stepId === "final-human-gate")?.status === "running"; }, "final human gate");
  const finalGateArtifacts = await store.listArtifacts(workflowId); const finalMediaBeforeFinalGate = finalGateArtifacts.find((a) => a.kind === "final_media_artifact"); const technical = finalGateArtifacts.find((a) => a.kind === "final_technical_qa"); const product = finalGateArtifacts.find((a) => a.kind === "final_product_review"); assert.ok(finalMediaBeforeFinalGate && technical && product); assert.equal(finalMediaBeforeFinalGate.correlationId, "corr-produce");
  const finalRuntime = makeRuntime(store, counts, definition, trace); assert.notEqual(finalRuntime.engine, second.engine);
  await finalRuntime.engine.resume(workflowId); await waitFor(async () => { const workflow = await store.loadWorkflow(workflowId); return workflow?.state === "AWAITING_APPROVAL" && workflow.steps?.find((step) => step.stepId === "final-human-gate")?.status === "running"; }, "reloaded final gate");
  await finalRuntime.engine.signalApproval(workflowId, { approvalId: "fixture-publication-approval", workflowId, stepId: "final-human-gate", outcome: "approved", scope: "PUBLIC_PUBLISH", authorityBinding: { projectId: "fixture", workflowId, projectMode: "TEST", finalMediaArtifactId: finalMediaBeforeFinalGate.artifactId, finalMediaSha256: "fixture", finalProductReviewId: product.artifactId, targetPlatform: "youtube", targetAccountId: "fixture-account", publicationPayloadHash: "fixture-payload", publicationIdentity: "publish:v2:fixture" }, approver: "human_operator", note: "final fixture approval", decidedAt: new Date().toISOString(), finalMediaArtifactId: finalMediaBeforeFinalGate.artifactId, finalTechnicalQAReportId: technical.artifactId, finalProductReviewId: product.artifactId });
  await waitFor(async () => (await store.listArtifacts(workflowId)).some((a) => a.kind === "published_report"), "publication result");
  const after = clone(counts); const finalArtifacts = await store.listArtifacts(workflowId); const provenance = await store.listExecutionProvenance(workflowId);
  assert.equal(new Set(provenance.map((row) => row.executionId)).size, provenance.length, "execution IDs are unique");
  assert.equal(after["tts.generate"], before["tts.generate"]); assert.equal(after["timeline.plan"], before["timeline.plan"]); assert.equal(after["image.generate"], before["image.generate"]);
  for (const stage of ["planner-initial", "research", "planner-synthesis", "writer", "director", "tts", "timeline", "scene-image", "visual-semantic-review", "visual-technical-qa"]) assert.equal(after[`stage:${stage}`], before[`stage:${stage}`], `no rerun: ${stage}`);
  assert.equal(after["video.generate"], 3); assert.equal(after["media.compose"], 1); assert.equal(after["publish.youtube"], 1);
  assert.equal(finalArtifacts.filter((a) => a.kind === "wan_authorization").length, 3); assert.equal(finalArtifacts.filter((a) => a.kind === "scene_video_clip").length, 3); assert.equal(finalArtifacts.filter((a) => a.kind === "final_media_artifact").length, 1);
  assert.equal(after["stage:video"], 1); assert.equal(after["stage:composer"], 1); assert.equal(after["stage:qa"], 1); assert.equal(after["stage:publisher"], 1);
  const narration = finalArtifacts.find((a) => a.kind === "narration_artifact"); const timeline = finalArtifacts.find((a) => a.kind === "timeline_plan"); const finalMedia = finalArtifacts.find((a) => a.kind === "final_media_artifact"); assert.equal(narration.payload.durationMs, 12640); assert.equal(timeline.payload.narrationDurationMs, 12640); assert.equal(finalMedia.payload.durationMs, 12640);
  for (const agent of ["planner", "research", "writer", "review", "qa", "publisher"]) assert.ok(provenance.some((row) => row.agentId === agent), `agent attribution: ${agent}`);
  assert.ok(provenance.some((row) => row.agentId === "writer" && row.provider === "worker-deterministic" && row.model === "deterministic"));
  for (const agent of ["director", "tts", "timeline", "scene-image", "video", "composer"]) assert.ok(provenance.some((row) => row.agentId === agent && row.capability === "agent.execute"), `agent attribution: ${agent}`);
  for (const capability of ["tts.generate", "image.generate", "video.generate", "media.compose"]) assert.ok(provenance.some((row) => row.capability === capability), `attribution: ${capability}`);
  for (const sceneId of ["scene-001", "scene-002", "scene-003"]) assert.ok(provenance.some((row) => row.capability === "image.generate" && row.artifactIds.includes(`art-${workflowId}-${sceneId}-visual`)), `image artifact linkage: ${sceneId}`);
  } finally { globalThis.fetch = originalFetch; }
});
