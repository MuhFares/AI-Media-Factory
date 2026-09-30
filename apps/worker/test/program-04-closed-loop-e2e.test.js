import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPool, migrate, PostgresPublishStore, LearningLoopStore, publicationPreflight,
} from "@ai-media-factory/database";
import {
  createPublishingCapability, createAnalyticsCapability, sha256Canonical,
  publicationIdentityV2, assertCanonicalAnalyticsJoin, assertLearningEvidenceBinding,
} from "@ai-media-factory/tool-framework";
import { ProductionMediaChainBridge } from "../dist/media-chain/production-media-chain.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
if (!process.env.TEST_DATABASE_URL) throw new Error("Program 4 requires explicit isolated TEST_DATABASE_URL");

const tag = `p4-${Date.now().toString(36)}`;
const projectId = `${tag}-project`, contentId = `${tag}-content`, workflowId = `wf-${tag}`;
const correlationId = `${tag}-correlation`, finalHash = "c".repeat(64), channelId = `${tag}-channel`;
let pool;

function wavDataUrl() { const pcm = Buffer.alloc(1600); const wav = Buffer.alloc(44 + pcm.length); wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44); return `data:audio/wav;base64,${wav.toString("base64")}`; }
function capabilityResult(id, input) {
  if (id === "tts.generate") return { status: "success", resultId: `tts-${input.logicalSubmissionId}`, capabilityId: id, output: { url: wavDataUrl(), audioId: "audio", providerId: "stub-tts", model: "stub", voice: input.voice, format: "wav" } };
  if (id === "timeline.plan") return { status: "success", resultId: "timeline", capabilityId: id, output: { timelineId: "timeline", narrationDurationMs: input.narrationDurationMs, sceneCount: 3, scenes: [{ sceneId: "scene-001" }, { sceneId: "scene-002" }, { sceneId: "scene-003" }] } };
  if (id === "image.generate") return { status: "success", resultId: `image-${input.sceneId}`, capabilityId: id, output: { imageId: `image-${input.sceneId}`, url: `https://stub.invalid/${input.sceneId}.png`, providerId: "stub-image", sha256: "d".repeat(64) } };
  if (id === "video.generate") return { status: "success", resultId: `video-${input.sceneId}`, capabilityId: id, output: { videoId: `video-${input.sceneId}`, url: `https://stub.invalid/${input.sceneId}.mp4`, providerId: "stub-video" } };
  if (id === "media.compose") return { status: "success", resultId: "final-media", capabilityId: id, output: { mediaId: "final-media", path: "https://stub.invalid/final.mp4", sha256: finalHash, bytes: 4096, durationMs: 100 } };
  throw new Error(`UNEXPECTED_CAPABILITY:${id}`);
}

before(async () => { pool = createPool({ connectionString: TEST_DATABASE_URL }); await migrate(pool); });
after(async () => { await pool.end(); });

test("E2E-05/08/09/10: canonical provider-free media to publication to learning loop", async () => {
  const persistence = {
    async saveArtifact(a) { await pool.query(`INSERT INTO artifacts (artifact_id,workflow_id,kind,producer_agent,status,payload,content_type,schema_version,created_at) VALUES ($1,$2,$3,$4,$5,$6,'application/json',$7,$8) ON CONFLICT (artifact_id) DO NOTHING`, [a.artifactId, a.workflowId, a.kind, a.producerAgent ?? "program-04-worker", a.status ?? "completed", JSON.stringify(a.payload ?? {}), a.schemaVersion ?? "program-04-v1", a.createdAt ?? new Date().toISOString()]); },
    async listArtifacts(id) { const q = await pool.query(`SELECT artifact_id,workflow_id,kind,producer_agent,status,payload,content_type,schema_version,created_at FROM artifacts WHERE workflow_id=$1 ORDER BY created_at,artifact_id`, [id]); return q.rows.map((r) => ({ artifactId: r.artifact_id, workflowId: r.workflow_id, kind: r.kind, producerAgent: r.producer_agent, status: r.status, payload: r.payload, contentType: r.content_type, schemaVersion: r.schema_version, createdAt: r.created_at })); },
  };
  let mediaCalls = 0;
  const bridge = new ProductionMediaChainBridge({ persistence, capabilityExecution: { executeCapability: async (request) => { mediaCalls++; return capabilityResult(request.capabilityId, request.input); } } });
  const media = await bridge.execute({ workflowId, correlationId, contentId, scriptIdentity: `${tag}-script`, script: "A bounded provider-free narration.", language: "en", voice: "stub-voice", approvedHumanScenes: { "scene-001": "APPROVED", "scene-002": "APPROVED", "scene-003": "APPROVED" } });
  assert.equal(media.status, "COMPLETED");
  const artifacts = await persistence.listArtifacts(workflowId);
  assert.ok(artifacts.some((a) => a.kind === "narration_artifact"));
  assert.ok(artifacts.some((a) => a.kind === "timeline_plan"));
  assert.equal(artifacts.filter((a) => a.kind === "scene_visual_artifact").length, 3);
  assert.equal(artifacts.filter((a) => a.kind === "scene_video_clip").length, 3);
  assert.ok(artifacts.some((a) => a.kind === "final_media_artifact"));
  assert.equal(artifacts.some((a) => a.kind === "thumbnail_report" || a.kind === "video_report"), false);
  assert.ok(mediaCalls > 0);

  const resolver = { resolve: (id) => ({ capabilityId: id }), isAuthorized: () => true };
  const credentialPreflight = publicationPreflight({ projectId, channelProjectId: projectId, channelStatus: "VERIFIED", channelId, externalChannelId: `${tag}-external-channel`, bindingProjectId: projectId, bindingChannelId: channelId, bindingStatus: "ACTIVE", tokenState: "VALID", visibility: "private", supportedVisibilities: ["private"], title: "Private validation", description: "Provider-free fixture", titleLimit: 100, descriptionLimit: 5000, publicationIdentity: `${tag}-prospective-publication` });
  assert.equal(credentialPreflight.ok, true);
  const publishStore = new PostgresPublishStore(pool); let uploads = 0;
  const publish = createPublishingCapability({ resolver, store: publishStore, provider: { publish: async () => { uploads++; return { providerId: "stub-youtube", status: "completed", publicationId: `${tag}-video`, url: `https://youtube.invalid/watch?v=${tag}`, publishedAt: "2026-09-28T00:00:00.000Z" }; } } });
  const publicationPayload = { assetId: "final-media", title: "Private validation", description: "Provider-free fixture", options: { visibility: "private" } };
  const payloadHash = sha256Canonical(publicationPayload);
  const identity = publicationIdentityV2({ projectId, workflowId, finalMediaSha256: finalHash, targetPlatform: "youtube", targetAccountId: channelId, publicationPayloadHash: payloadHash });
  const authority = { approvalId: `${tag}-publish-approval`, decision: "approved", scope: "PRIVATE_VALIDATION", projectId, workflowId, projectMode: "PRODUCTION", finalMediaArtifactId: "final-media", finalMediaSha256: finalHash, finalProductReviewId: `${tag}-review`, targetPlatform: "youtube", targetAccountId: channelId, publicationPayloadHash: payloadHash, publicationIdentity: identity };
  const request = { requestId: `${tag}-publish`, capabilityId: "publish.youtube", workflowId, correlationId, agentId: "publisher", input: { projectId, finalMediaArtifactId: "final-media", finalMediaSha256: finalHash, mediaTransportRef: { type: "HTTPS_URL", url: "https://media.example/final.mp4", expectedSha256: finalHash }, targetAccountId: channelId, title: publicationPayload.title, description: publicationPayload.description, options: publicationPayload.options, idempotencyKey: identity, publicationAuthority: authority } };
  const first = await publish.execute(request); const replay = await publish.execute(request);
  assert.equal(first.status, "success"); assert.equal(replay.status, "success"); assert.equal(replay.output.deduplicated, true); assert.equal(uploads, 1);
  const publishedReportId = `${tag}-published-report`;
  await persistence.saveArtifact({ artifactId: publishedReportId, workflowId, kind: "published_report", producerAgent: "publisher", status: "completed", payload: { finalMediaArtifactId: "final-media", finalMediaSha256: finalHash, publicationId: first.output.publicationId, channelId, visibility: "private" } });

  let analyticsCalls = 0;
  const analytics = createAnalyticsCapability({ resolver, provider: { fetch: async ({ publicationId }) => { analyticsCalls++; return { providerId: "stub-youtube-analytics", status: "completed", publicationId, metrics: { views: 125, likes: 9 }, retrievedAt: "2026-09-28T01:00:00.000Z" }; } } });
  const fetched = await analytics.execute({ requestId: `${tag}-analytics`, capabilityId: "analytics.fetch", workflowId, correlationId, agentId: "analytics", input: { publicationId: first.output.publicationId, platform: "youtube" } });
  assert.equal(fetched.status, "success"); assert.equal(analyticsCalls, 1);
  const join = { projectId, contentId, workflowId, finalMediaArtifactId: "final-media", finalMediaSha256: finalHash, publishedReportId, providerPublicationId: first.output.publicationId, channelId };
  assert.doesNotThrow(() => assertCanonicalAnalyticsJoin(join));
  const learning = new LearningLoopStore(pool);
  const observed = await learning.recordObservation({ projectId, contentId, workflowId, artifactId: "final-media", finalMediaSha256: finalHash, publishedReportId, publicationId: first.output.publicationId, channelId, analyticsProviderId: fetched.output.providerId, lineageKind: "GOVERNED_RUN", metrics: fetched.output.metrics, metricProvenance: "STUBBED", transportProvenance: "STUBBED", observedAt: fetched.output.retrievedAt });
  assertLearningEvidenceBinding(observed.observation.metrics, ["views"]);
  const learned = await learning.recordLearning({ projectId, observationIds: [observed.observation.observationId], finding: "Provider-free validation observation recorded", evidence: { observationId: observed.observation.observationId, citedMetrics: ["views"] } });
  await assert.rejects(() => learning.recommend({ projectId, learningId: learned.learning.learningId, proposal: "invalid", rationale: "invalid", evidence: { citedMetrics: ["revenue"] } }), /UNOBSERVED_METRIC/);
  const recommendation = await learning.recommend({ projectId, learningId: learned.learning.learningId, proposal: "Await a bounded live canary", rationale: "Only stubbed evidence exists", evidence: { learningId: learned.learning.learningId, observationId: observed.observation.observationId, citedMetrics: ["views"] } });
  const proposal = await learning.proposeNextCycle({ projectId, recommendationId: recommendation.recommendation.recommendationId, summary: "Owner decides whether to authorize the bounded live canary" });
  assert.equal(learned.learning.validationOnly, true);
  assert.equal(proposal.proposal.status, "AWAITS_OWNER_DECISION");
});
