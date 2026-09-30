/**
 * VISUAL PIPELINE V2 PRODUCTION CERTIFICATION MATRIX (§21 A–V).
 *
 * Provider-free: in-memory bridge fixtures with a counting capability
 * boundary (no provider, no network). DB-backed assertions use the isolated
 * test DB; production is verified READ-ONLY (R8 immutability).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { ProductionMediaChainBridge } from "../dist/media-chain/production-media-chain.js";
import { deterministicImageSeed } from "@ai-media-factory/tool-framework";
import { saveV2DirectionContract, v2SceneContract, v2DirectionContract } from "./visual-v2-fixtures.js";
import { createPool, migrate, ControlPlaneStore } from "@ai-media-factory/database";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

function store() {
  const rows = [];
  return {
    rows,
    saveArtifact: async (a) => { const i = rows.findIndex((x) => x.artifactId === a.artifactId); if (i >= 0) rows[i] = a; else rows.push(a); },
    listArtifacts: async (workflowId) => rows.filter((a) => a.workflowId === workflowId),
  };
}

function pngDataUrl(width = 768, height = 1344) {
  const bytes = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function boundary(calls, failures = {}) {
  return {
    executeCapability: async (request) => {
      calls.push(request);
      const sceneId = request.input?.sceneId;
      if (failures[request.capabilityId] ?? failures[sceneId]) throw new Error("FIXTURE_FAILURE");
      if (request.capabilityId === "image.generate") {
        return { status: "success", resultId: request.requestId, capabilityId: request.capabilityId, output: { imageId: `img-${sceneId}`, url: `file:///${sceneId}.png`, providerId: "mock-image" } };
      }
      return { status: "success", resultId: request.requestId, capabilityId: request.capabilityId, output: {} };
    },
  };
}

const baseInput = (workflowId) => ({ workflowId, correlationId: "corr", contentId: "c", scriptIdentity: "s", script: "fixture script", language: "en", voice: "fixture" });

async function saveDirectorPlan(persistence, workflowId, sceneIds) {
  await persistence.saveArtifact({
    artifactId: `art-${workflowId}-director`, workflowId, correlationId: "corr", kind: "scene_plan",
    producerAgent: "director", status: "completed",
    payload: { planId: "p", workflowId, sceneIds, scenes: sceneIds.map((sceneId) => ({ sceneId, narrationSegment: `segment ${sceneId}` })) },
    contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString(),
  });
}

async function saveVisual(persistence, workflowId, sceneId, ref) {
  await persistence.saveArtifact({
    artifactId: `art-${workflowId}-${sceneId}-visual`, workflowId, correlationId: "corr", kind: "scene_visual_artifact",
    producerAgent: "scene-image", status: "completed",
    payload: { artifactId: `art-${workflowId}-${sceneId}-visual`, sceneId, artifactPathOrReference: ref ?? `file:///${sceneId}.png`, provider: "mock-image", generationId: `img-${sceneId}`, integrityStatus: "VALID" },
    contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString(),
  });
}

// A: R8-class narration echo without a V2 contract fails before provider.
test("A: narration-echo Director plan without V2 contract BLOCKS with zero provider calls", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-a", ["scene-001", "scene-002", "scene-003"]);
  const out = await bridge.executeSceneImage(baseInput("wf-a"));
  assert.equal(out.status, "BLOCKED");
  assert.equal(out.output.reason, "VISUAL_DIRECTION_CONTRACT_MISSING");
  for (const id of ["image.generate", "tts.generate", "timeline.plan", "video.generate", "media.compose"]) {
    assert.equal(calls.filter((c) => c.capabilityId === id).length, 0, `no ${id} call (S/T/U/V)`);
  }
});

// A2: corrupt contract (empty visual semantics) fails validation before provider.
test("A2: invalid V2 contract BLOCKS with zero provider calls", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-a2", ["scene-001"]);
  await persistence.saveArtifact({
    artifactId: "art-wf-a2-contract", workflowId: "wf-a2", correlationId: "corr", kind: "visual_direction_contract",
    producerAgent: "fixture", status: "completed",
    payload: v2DirectionContract("wf-a2", ["scene-001"], { scenes: [v2SceneContract("scene-001", { subject: "", action: "" })] }),
    contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString(),
  });
  const out = await bridge.executeSceneImage(baseInput("wf-a2"));
  assert.equal(out.status, "BLOCKED");
  assert.equal(out.output.reason, "VISUAL_DIRECTION_CONTRACT_INVALID");
  assert.equal(calls.length, 0);
});

// B+F: valid structured scene compiles with the global style lock.
test("B+F: valid scene compiles and carries the style lock", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-b", ["scene-001"]);
  await saveV2DirectionContract(persistence, "wf-b", ["scene-001"]);
  const out = await bridge.executeSceneImage(baseInput("wf-b"));
  assert.equal(out.status, "COMPLETED");
  const prompt = calls.find((c) => c.capabilityId === "image.generate").input.prompt;
  assert.ok(prompt.includes("STYLE LOCK: photoreal_cinematic"));
  assert.equal(calls.filter((c) => c.capabilityId === "image.generate").length, 1);
});

// C: photoreal lock + cartoon scene fails before provider.
test("C: cartoon scene under photoreal lock BLOCKS with zero provider calls", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-c", ["scene-001"]);
  await persistence.saveArtifact({
    artifactId: "art-wf-c-contract", workflowId: "wf-c", correlationId: "corr", kind: "visual_direction_contract",
    producerAgent: "fixture", status: "completed",
    payload: v2DirectionContract("wf-c", ["scene-001"], { scenes: [v2SceneContract("scene-001", { subject: "a cartoon dragon mascot waving", action: "posing cheerfully for the viewer" })] }),
    contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString(),
  });
  const out = await bridge.executeSceneImage(baseInput("wf-c"));
  assert.equal(out.status, "BLOCKED");
  assert.match(out.output.reason, /VISUAL_PROMPT_COMPILATION_BLOCKED/);
  assert.equal(calls.length, 0);
});

// D: TEXT FORBIDDEN + readable-text-dependent scene fails.
test("D: readable-text-dependent scene under TEXT_POLICY=FORBIDDEN BLOCKS", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-d", ["scene-001"]);
  await persistence.saveArtifact({
    artifactId: "art-wf-d-contract", workflowId: "wf-d", correlationId: "corr", kind: "visual_direction_contract",
    producerAgent: "fixture", status: "completed",
    payload: v2DirectionContract("wf-d", ["scene-001"], { scenes: [v2SceneContract("scene-001", { subject: "a title card with readable headline text", action: "displaying the episode title in large letters", mustNotInclude: [] })] }),
    contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString(),
  });
  const out = await bridge.executeSceneImage(baseInput("wf-d"));
  assert.equal(out.status, "BLOCKED");
  assert.equal(calls.length, 0);
});

// E: UI FORBIDDEN + app/interface scene fails.
test("E: app-interface scene under UI_POLICY=FORBIDDEN BLOCKS", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-e", ["scene-001"]);
  await persistence.saveArtifact({
    artifactId: "art-wf-e-contract", workflowId: "wf-e", correlationId: "corr", kind: "visual_direction_contract",
    producerAgent: "fixture", status: "completed",
    payload: v2DirectionContract("wf-e", ["scene-001"], { scenes: [v2SceneContract("scene-001", { subject: "a mobile app dashboard interface", action: "scrolling through menu icons on the display", textPolicy: "INCIDENTAL_NONREADABLE", mustNotInclude: [] })] }),
    contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString(),
  });
  const out = await bridge.executeSceneImage(baseInput("wf-e"));
  assert.equal(out.status, "BLOCKED");
  assert.equal(calls.length, 0);
});

// G: same contract compiles deterministically.
test("G: identical contracts compile to identical prompts", async () => {
  const runOnce = async (wf) => {
    const persistence = store(); const calls = [];
    const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
    await saveDirectorPlan(persistence, wf, ["scene-001"]);
    await saveV2DirectionContract(persistence, wf, ["scene-001"]);
    const out = await bridge.executeSceneImage(baseInput(wf));
    assert.equal(out.status, "COMPLETED");
    return calls.find((c) => c.capabilityId === "image.generate").input.prompt;
  };
  assert.equal(await runOnce("wf-g1"), await runOnce("wf-g2"));
});

// H: seed persisted and passed to the provider; stable per execution identity.
test("H: deterministic seed is persisted and sent to the provider", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-h", ["scene-001"]);
  await saveV2DirectionContract(persistence, "wf-h", ["scene-001"], "art-wf-h-contract");
  const out = await bridge.executeSceneImage(baseInput("wf-h"));
  assert.equal(out.status, "COMPLETED");
  const expected = deterministicImageSeed("wf-h", "scene-001", "initial:art-wf-h-contract");
  assert.equal(calls.find((c) => c.capabilityId === "image.generate").input.seed, expected);
  const visual = persistence.rows.find((a) => a.kind === "scene_visual_artifact");
  assert.equal(visual.payload.seed, expected);
});

// I: a new contract (new visual iteration) intentionally changes the seed.
test("I: new contract identity yields a new seed", async () => {
  assert.notEqual(
    deterministicImageSeed("wf-h", "scene-001", "initial:art-wf-h-contract"),
    deterministicImageSeed("wf-h", "scene-001", "initial:art-wf-h-contract-v2"),
  );
});

// O2/P2: image.generate call carries no reference/img2img/control inputs.
test("image calls carry no reference, img2img, or adapter-control inputs", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-shape", ["scene-001"]);
  await saveV2DirectionContract(persistence, "wf-shape", ["scene-001"]);
  const out = await bridge.executeSceneImage(baseInput("wf-shape"));
  assert.equal(out.status, "COMPLETED");
  const input = calls.find((c) => c.capabilityId === "image.generate").input;
  for (const key of ["referenceImageUrl", "referenceImageBase64", "referenceImageMimeType", "strength", "controlNet", "ipAdapter", "lora", "initImage", "imageToImage"]) {
    assert.equal(key in input, false, `no ${key} on the FLUX path`);
  }
  assert.equal(typeof input.seed, "number", "deterministic seed always supplied (no random fallback)");
  assert.equal(input.aspectRatio, "9:16");
});

// J: semantic FAIL blocks WAN even with genuine human approval.
test("J: semantic FAIL blocks WAN authorization", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-j", ["scene-001"]);
  await saveVisual(persistence, "wf-j", "scene-001");
  await persistence.saveArtifact({ artifactId: "s", workflowId: "wf-j", kind: "visual_semantic_review", status: "completed", payload: { artifactId: "s", sceneId: "scene-001", verdict: "FAIL" } });
  await persistence.saveArtifact({ artifactId: "q", workflowId: "wf-j", kind: "visual_technical_qa", status: "completed", payload: { artifactId: "q", sceneId: "scene-001", verdict: "PASS" } });
  const out = await bridge.executeWanAuthorization({ ...baseInput("wf-j"), approvedHumanScenes: { "scene-001": "APPROVED" } });
  assert.equal(out.status, "BLOCKED");
  assert.match(out.output.reason, /SEMANTIC_OR_TECHNICAL_FAIL/);
  assert.equal(persistence.rows.filter((a) => a.kind === "wan_authorization").length, 0);
});

// K: UNAVAILABLE + gate on (approvals pending) pauses for human review.
test("K: UNAVAILABLE without approvals pauses for human review, authorizes nothing", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-k", ["scene-001"]);
  await saveVisual(persistence, "wf-k", "scene-001");
  const out = await bridge.executeWanAuthorization(baseInput("wf-k"));
  assert.equal(out.status, "AWAITING_APPROVAL");
  assert.equal(out.output.reason, "HUMAN_REVIEW_REQUIRED");
  assert.equal(persistence.rows.filter((a) => a.kind === "wan_authorization").length, 0);
});

// L+M+N: bypass blocks; no fake approvals; semantic stays UNAVAILABLE.
test("L+M+N: policy bypass BLOCKS wan with no fabricated human approval or semantic PASS", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-l", ["scene-001"]);
  await saveVisual(persistence, "wf-l", "scene-001");
  await persistence.saveArtifact({ artifactId: "s", workflowId: "wf-l", kind: "visual_semantic_review", status: "completed", payload: { artifactId: "s", sceneId: "scene-001", verdict: "UNAVAILABLE" } });
  await persistence.saveArtifact({ artifactId: "q", workflowId: "wf-l", kind: "visual_technical_qa", status: "completed", payload: { artifactId: "q", sceneId: "scene-001", verdict: "PASS" } });
  const out = await bridge.executeWanAuthorization({ ...baseInput("wf-l"), visualGateOutcome: "policy_bypass", visualGateSceneDecisions: { "scene-001": "APPROVED" } });
  assert.equal(out.status, "BLOCKED");
  assert.equal(out.output.reason, "WAN_BLOCKED:POLICY_BYPASS_SEMANTIC_UNRESOLVED");
  assert.equal(persistence.rows.filter((a) => a.kind === "wan_authorization").length, 0, "M: no authorization");
  const dumped = JSON.stringify(persistence.rows);
  assert.ok(!dumped.includes("human_operator"), "M: no synthetic human approval");
  const semantics = persistence.rows.filter((a) => a.kind === "visual_semantic_review");
  assert.ok(semantics.every((a) => a.payload.verdict === "UNAVAILABLE"), "N: no fabricated semantic PASS");
  for (const id of ["video.generate", "media.compose"]) {
    assert.equal(calls.filter((c) => c.capabilityId === id).length, 0, `no ${id} call (V)`);
  }
});

// O: technical QA PASS alone cannot authorize WAN.
test("O: QA PASS without human approval authorizes nothing", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-o", ["scene-001"]);
  await saveVisual(persistence, "wf-o", "scene-001");
  await persistence.saveArtifact({ artifactId: "q", workflowId: "wf-o", kind: "visual_technical_qa", status: "completed", payload: { artifactId: "q", sceneId: "scene-001", verdict: "PASS" } });
  const out = await bridge.executeWanAuthorization(baseInput("wf-o"));
  assert.equal(out.status, "AWAITING_APPROVAL");
  assert.equal(persistence.rows.filter((a) => a.kind === "wan_authorization").length, 0);
});

// Genuine-path control: direct owner approvals + QA PASS authorize WAN.
test("genuine human approval with QA PASS authorizes WAN (legitimate path preserved)", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-gen", ["scene-001", "scene-002"]);
  await saveVisual(persistence, "wf-gen", "scene-001");
  await saveVisual(persistence, "wf-gen", "scene-002");
  await persistence.saveArtifact({ artifactId: "q1", workflowId: "wf-gen", kind: "visual_technical_qa", status: "completed", payload: { artifactId: "q1", sceneId: "scene-001", verdict: "PASS" } });
  await persistence.saveArtifact({ artifactId: "q2", workflowId: "wf-gen", kind: "visual_technical_qa", status: "completed", payload: { artifactId: "q2", sceneId: "scene-002", verdict: "PASS" } });
  const out = await bridge.executeWanAuthorization({ ...baseInput("wf-gen"), approvedHumanScenes: { "scene-001": "APPROVED", "scene-002": "APPROVED" } });
  assert.equal(out.status, "COMPLETED");
  assert.equal(persistence.rows.filter((a) => a.kind === "wan_authorization").length, 2);
});

// Gate-approved control: gate outcome approved + scene decisions authorize WAN.
test("gate-approved scene decisions authorize WAN (legitimate path preserved)", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-gate", ["scene-001"]);
  await saveVisual(persistence, "wf-gate", "scene-001");
  await persistence.saveArtifact({ artifactId: "q", workflowId: "wf-gate", kind: "visual_technical_qa", status: "completed", payload: { artifactId: "q", sceneId: "scene-001", verdict: "PASS" } });
  const out = await bridge.executeWanAuthorization({ ...baseInput("wf-gate"), visualGateOutcome: "approved", visualGateSceneDecisions: { "scene-001": "APPROVED" } });
  assert.equal(out.status, "COMPLETED");
  assert.equal(persistence.rows.filter((a) => a.kind === "wan_authorization").length, 1);
});

// Technical QA real checks: corrupt data-URL fails; valid PNG passes with dims.
test("technical QA performs real byte checks on data-URL payloads", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-qa", ["scene-001", "scene-002"]);
  await saveVisual(persistence, "wf-qa", "scene-001", pngDataUrl(768, 1344));
  await saveVisual(persistence, "wf-qa", "scene-002", "data:image/png;base64,bm90LWEtcG5n");
  const out = await bridge.executeVisualTechnicalQa(baseInput("wf-qa"));
  assert.equal(out.status, "BLOCKED");
  assert.match(out.output.reason, /VISUAL_TECHNICAL_QA_FAILED:scene-002/);
  const qa1 = persistence.rows.find((a) => a.artifactId.endsWith("scene-001-visual-qa"));
  assert.equal(qa1.payload.verdict, "PASS");
  assert.equal(qa1.payload.byteChecks, "PERFORMED");
  assert.equal(qa1.payload.width, 768);
  assert.equal(qa1.payload.height, 1344);
});

// Semantic V2 dimensions artifact: UNKNOWN per dimension, overall UNAVAILABLE.
test("semantic review persists per-dimension UNKNOWN artifact, never PASS", async () => {
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-sem", ["scene-001"]);
  await saveVisual(persistence, "wf-sem", "scene-001");
  const out = await bridge.executeVisualSemanticReview(baseInput("wf-sem"));
  assert.equal(out.status, "COMPLETED");
  assert.equal(out.output.verdict, "UNAVAILABLE");
  const sem = persistence.rows.find((a) => a.kind === "visual_semantic_review");
  assert.equal(sem.payload.verdict, "UNAVAILABLE");
  assert.equal(Object.keys(sem.payload.dimensions).length, 11);
  assert.ok(Object.values(sem.payload.dimensions).every((d) => d.verdict === "UNKNOWN"));
});

// P+Q: bridge flows never touch approvals and never create resumes/jobs (test DB).
let testPool;
before(async () => {
  testPool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(testPool);
});

after(async () => { await testPool.end(); });

test("P+Q: certification flows create no approvals, resumes, or jobs", async () => {
  const control = new ControlPlaneStore(testPool);
  const approvalId = `approval-visual-v2-matrix-gate`;
  const now = new Date().toISOString();
  await testPool.query(`DELETE FROM control_approvals WHERE approval_id='${approvalId}'`);
  await control.createApproval({
    approvalId, projectId: "proj-matrix", targetType: "workflow_gate", targetId: "wf-matrix:visual-human-gate",
    agentRecommendation: { workflowId: "wf-matrix", stepId: "visual-human-gate" }, agentConfidence: null,
    evidenceRefs: [], status: "PENDING", supersedes: null, supersededBy: null, createdAt: now,
  });
  const beforeResumes = (await testPool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches`)).rows[0].n;
  const beforeJobs = (await testPool.query(`SELECT count(*)::int AS n FROM workflow_jobs`)).rows[0].n;
  // Bypass wan flow through the real bridge (in-memory store, counting boundary).
  const persistence = store(); const calls = [];
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: boundary(calls) });
  await saveDirectorPlan(persistence, "wf-matrix", ["scene-001"]);
  await saveVisual(persistence, "wf-matrix", "scene-001");
  const out = await bridge.executeWanAuthorization({ ...baseInput("wf-matrix"), visualGateOutcome: "policy_bypass", visualGateSceneDecisions: { "scene-001": "APPROVED" } });
  assert.equal(out.status, "BLOCKED");
  const approval = await control.getApproval(approvalId);
  assert.equal(approval.status, "PENDING", "P: approvals untouched by bridge flows");
  assert.equal(approval.ownerDecision, null);
  assert.equal((await testPool.query(`SELECT count(*)::int AS n FROM media_resume_dispatches`)).rows[0].n, beforeResumes, "Q: no resume auto-created");
  assert.equal((await testPool.query(`SELECT count(*)::int AS n FROM workflow_jobs`)).rows[0].n, beforeJobs, "Q: no jobs created");
  await testPool.query(`DELETE FROM control_approvals WHERE approval_id='${approvalId}'`);
});

// R: R8 history immutable; visual iteration recorded via the visual path.
test("R: R8 history immutable, iteration recorded, prompt gate decided, no R9", async () => {  assert.ok(process.env.DATABASE_URL && process.env.DATABASE_URL !== TEST_DATABASE_URL, "production DATABASE_URL present and distinct");
  const { Pool } = await import("pg");
  const prod = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const WF = "wf-1789233193749-gvydpiah";
    const r8 = (await prod.query(`SELECT outcome FROM media_resume_dispatches WHERE resume_id='media-resume-${WF}-from-timeline-r8'`)).rows;
    assert.equal(r8[0]?.outcome, "VISUAL_GATE_PENDING");
    const usage = (await prod.query(`SELECT count(*)::int AS n FROM media_resume_provider_usage WHERE resume_id='media-resume-${WF}-from-timeline-r8'`)).rows[0].n;
    assert.equal(usage, 6, "R8 budget usage unchanged (S/T: no TTS/timeline replay)");
    // Owner decision recorded through the visual path (DECIDED/REQUEST_ITERATION),
    // routed to VisualIteration #1 — never a content revision task.
    const gate = (await prod.query(`SELECT status, owner_decision FROM control_approvals WHERE approval_id='approval-${WF}-visual-human-gate'`)).rows;
    assert.equal(gate[0]?.status, "DECIDED");
    assert.equal(gate[0]?.owner_decision, "REQUEST_ITERATION");
    const it = (await prod.query(`SELECT status, authorized_image_budget, used_image_budget, visual_direction_contract_artifact_id FROM visual_iterations WHERE visual_iteration_id='visual-iteration-${WF}-1'`)).rows;
    // Attempt-4 supersession loop completed (CONTRACT_REQUIRED → CONTRACT_PREPARED
    // → OWNER_REVIEW_REQUIRED): canonical materials are the Attempt-4 set,
    // still unauthorized. This is the reconciled resting state.
    assert.equal(it[0]?.status, "OWNER_REVIEW_REQUIRED");
    assert.equal(it[0]?.authorized_image_budget, 0, "no generation authorized");
    assert.equal(it[0]?.used_image_budget, 0);
    assert.equal(it[0]?.visual_direction_contract_artifact_id, `art-${WF}-visual-direction-vi1-creative-a4`, "canonical materials are Attempt-4");
    const promptGate = (await prod.query(`SELECT status, owner_decision, owner_rationale FROM control_approvals WHERE approval_id='approval-${WF}-visual-prompt-owner-review'`)).rows;
    // Owner APPROVE recorded for prompt preparation ONLY: binds the exact
    // Attempt-4 canonical artifacts; authorizes zero provider calls.
    assert.equal(promptGate[0]?.status, "DECIDED");
    assert.equal(promptGate[0]?.owner_decision, "APPROVE");
    assert.ok(String(promptGate[0]?.owner_rationale ?? "").includes(`art-${WF}-visual-prompt-plan-vi1-creative-a4-flux-final`), "rationale binds the final FLUX plan");
    assert.ok(String(promptGate[0]?.owner_rationale ?? "").includes("AUTHORIZED_IMAGE_BUDGET remains 0"), "rationale withholds generation");
    const revtasks = (await prod.query(`SELECT count(*)::int AS n FROM review_revision_tasks WHERE workflow_id='${WF}' AND created_at > '2026-09-16T12:40:00.000Z'`)).rows[0].n;
    assert.equal(revtasks, 0, "no content revision task for the visual iteration");
    const maxAttempt = (await prod.query(`SELECT max(resume_attempt)::int AS m FROM media_resume_dispatches WHERE workflow_id='${WF}'`)).rows[0].m;
    assert.equal(maxAttempt, 8, "no R9");
    const r7 = (await prod.query(`SELECT outcome FROM media_resume_dispatches WHERE resume_id='media-resume-${WF}-from-timeline-r7'`)).rows;
    assert.equal(r7[0]?.outcome, "FAILED");
  } finally {
    await prod.end();
  }
});
