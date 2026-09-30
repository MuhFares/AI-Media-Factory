import pg from "pg";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PublishingCapabilityExecutor,
  PUBLISH_CAPABILITY_ID,
  mediaTransportFingerprint,
  preflightMediaTransport,
  publicationIdentityV2,
  sha256Canonical,
} from "@ai-media-factory/tool-framework";
import {
  M4_BUDGET,
  YouTubePublishAdapter,
  markerFor,
  prepareM4Upload,
} from "@ai-media-factory/provider-adapters";
import {
  AutomationStore,
  PostgresPublishSessionStore,
  PostgresPublishStore,
} from "@ai-media-factory/database";
import { computeMediaBuildId } from "@ai-media-factory/worker";

const CONFIRM = "amf-program-04-phase-5-private-publication-canary-reauthorized-v2";
const args = new Map(process.argv.slice(2).map((value) => {
  const index = value.indexOf("=");
  return index === -1 ? [value, true] : [value.slice(0, index), value.slice(index + 1)];
}));
if (!args.has("--apply") || args.get("--confirm-production") !== CONFIRM) {
  throw new Error(`PRODUCTION_CONFIRMATION_REQUIRED:${CONFIRM}`);
}

const EXPECTED_BUILD = "e4f95be2dd1fc9e3a8a00120b955b0be175081451a1b66f8e5d84d958668193f";
const PROJECT_ID = "morroway";
const CONTENT_ID = "content-mulk44ho-kih3gg";
const WORKFLOW_ID = "wf-p4-canary-2b0da0ba762b65477107";
const CORRELATION_ID = "corr-p4-canary-91a7723e93f4253c0309";
const FINAL_MEDIA_ARTIFACT_ID = "art-final-media-canary-e46409193d5f74e14829258c";
const FINAL_MEDIA_SHA256 = "41d8a68152b9f34bb65da54ad18298b8c8f1bdb57a508afd631d75aac4c27d49";
const FINAL_MEDIA_PATH = "D:\\AIWorkspace\\AI-Media-Factory\\output\\program-04-live-canary\\phase-4\\media-04f2c32076e7.mp4";
const CHANNEL_BINDING_ID = "channel-morroway-youtube";
const EXTERNAL_CHANNEL_ID = "UCA5ECzcK_96akfUT5fQUT3A";
const CREDENTIAL_BINDING_ID = "binding-morroway-youtube-fe06cec2832354a9";
const TITLE = "Morroway — Program 4 Private Canary";
const DESCRIPTION = "Private validation upload for the AMF Program 4 bounded live canary.\nNot approved for public release.";
const VISIBILITY = "private";
const PUBLICATION_EXECUTION_ID = "publication-canary-v2-e46409193d5f74e14829258c";
const TECHNICAL_QA_ID = "art-final-technical-qa-phase5-v2-e46409193d5f74e14829258c";
const FINAL_REVIEW_ID = "art-final-product-review-phase5-v2-e46409193d5f74e14829258c";
const AUTHORIZATION_ID = "art-publisher-authorization-phase5-v2-e46409193d5f74e14829258c";
const INTENT_ID = "art-publication-intent-phase5-v2-e46409193d5f74e14829258c";
const OWNER_AUTHORITY_REF = "AMF_PROGRAM_04_PHASE_5_PRIVATE_PUBLICATION_CANARY_REAUTHORIZED_V2";
const PREVIOUS_BLOCKED_IDENTITY = "publish:v2:c214902df486eea757c3c6d815918b9cf628c923ab34d224a27313d1229d131f";
const EXPECTED_PAYLOAD_HASH = "0f9afd05f726c12b05f2ce7992f1f1aa89a9c6930dbb17ac72816e17220177f2";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const operations = [];
let oauthNetworkCalls = 0;
let youtubeIdentityCalls = 0;
let youtubeReceiptCalls = 0;
let logicalUploadCalls = 0;
let budgetConsumed = false;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

async function jsonResponse(response, code) {
  if (!response.ok) throw new Error(`${code}:HTTP_${response.status}`);
  return response.json();
}

const oauthTransport = {
  async postForm(url, params) {
    oauthNetworkCalls += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    return jsonResponse(response, "OAUTH_REFRESH_FAILED");
  },
  async get(url, headers) {
    youtubeIdentityCalls += 1;
    const response = await fetch(url, { method: "GET", headers: { ...headers, accept: "application/json" } });
    return jsonResponse(response, "YOUTUBE_CHANNEL_IDENTITY_FAILED");
  },
};

async function insertArtifact(client, artifact) {
  const existing = await client.query(`SELECT artifact_id,kind,payload FROM artifacts WHERE artifact_id=$1`, [artifact.artifactId]);
  if (existing.rowCount) {
    invariant(existing.rows[0].kind === artifact.kind, "ARTIFACT_IDENTITY_CONFLICT");
    return false;
  }
  await client.query(
    `INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at,parent_artifact_id,parent_artifact_kind)
     VALUES($1,$2,$3,$4,$5,$6,$7,'application/json',$8,$9,$10,$11)`,
    [artifact.artifactId, WORKFLOW_ID, artifact.kind, artifact.producerAgent, CORRELATION_ID,
      artifact.status, JSON.stringify(artifact.payload), artifact.schemaVersion, artifact.createdAt,
      artifact.parentArtifactId ?? null, artifact.parentArtifactKind ?? null],
  );
  return true;
}

async function verifyReceipt(accessToken, providerVideoId) {
  youtubeReceiptCalls += 1;
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,status");
  url.searchParams.set("id", providerVideoId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await jsonResponse(response, "YOUTUBE_RECEIPT_VERIFICATION_FAILED");
    const item = Array.isArray(body?.items) ? body.items[0] : undefined;
    invariant(item && typeof item.id === "string", "YOUTUBE_RECEIPT_MISSING");
    return item;
  } finally {
    clearTimeout(timer);
  }
}

try {
  const sourceBuild = computeMediaBuildId().buildId;
  invariant(sourceBuild === EXPECTED_BUILD, "SOURCE_BUILD_MISMATCH");
  const liveWorkers = await pool.query(
    `SELECT worker_instance_id,build_id,worker_role,last_heartbeat_at,process_id
       FROM amf_worker_presence
      WHERE runtime_mode='PERSISTENT_PRODUCTION_WORKER' AND last_heartbeat_at >= $1
      ORDER BY last_heartbeat_at DESC`,
    [new Date(Date.now() - 120_000).toISOString()],
  );
  invariant(liveWorkers.rowCount === 1, "WORKER_SINGLETON_NOT_HEALTHY");
  invariant(liveWorkers.rows[0].build_id === EXPECTED_BUILD, "WORKER_BUILD_MISMATCH");
  invariant(liveWorkers.rows[0].worker_role === "canonical-production-queue-worker", "WORKER_ROLE_MISMATCH");
  const queue = await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_jobs WHERE status IN ('queued','running')`);
  invariant(Number(queue.rows[0].count) === 0, "QUEUE_CONFLICT");

  const media = await pool.query(`SELECT * FROM artifacts WHERE artifact_id=$1 AND workflow_id=$2 AND kind='final_media_artifact' AND status='completed'`, [FINAL_MEDIA_ARTIFACT_ID, WORKFLOW_ID]);
  invariant(media.rowCount === 1, "FINAL_MEDIA_ARTIFACT_INVALID");
  const payload = media.rows[0].payload;
  invariant(payload.projectId === PROJECT_ID && payload.contentId === CONTENT_ID && payload.workflowId === WORKFLOW_ID, "FINAL_MEDIA_OWNERSHIP_MISMATCH");
  invariant(payload.sha256 === FINAL_MEDIA_SHA256 && payload.technicalQa?.status === "PASS", "FINAL_MEDIA_TECHNICAL_QA_INVALID");
  invariant(await realpath(FINAL_MEDIA_PATH) === await realpath(payload.storageReference), "FINAL_MEDIA_PATH_MISMATCH");
  const fileInfo = await stat(FINAL_MEDIA_PATH);
  invariant(fileInfo.isFile() && fileInfo.size > 0, "FINAL_MEDIA_FILE_INVALID");
  const localBytes = await readFile(FINAL_MEDIA_PATH);
  const localSha256 = createHash("sha256").update(localBytes).digest("hex");
  invariant(localSha256 === FINAL_MEDIA_SHA256, "FINAL_MEDIA_SHA256_MISMATCH");

  const channel = await pool.query(`SELECT * FROM channels WHERE channel_id=$1 AND project_id=$2 AND platform='youtube' AND status='VERIFIED'`, [CHANNEL_BINDING_ID, PROJECT_ID]);
  invariant(channel.rowCount === 1 && channel.rows[0].external_channel_id === EXTERNAL_CHANNEL_ID, "YOUTUBE_CHANNEL_BINDING_INVALID");
  const bindings = await pool.query(`SELECT * FROM credential_bindings WHERE project_id=$1 AND channel_id=$2 AND provider='youtube' AND status='ACTIVE'`, [PROJECT_ID, CHANNEL_BINDING_ID]);
  invariant(bindings.rowCount === 1 && bindings.rows[0].binding_id === CREDENTIAL_BINDING_ID, "YOUTUBE_CREDENTIAL_BINDING_INVALID");
  const credentialPath = String(bindings.rows[0].credential_ref);
  invariant(path.isAbsolute(credentialPath), "CREDENTIAL_REFERENCE_NOT_ABSOLUTE");
  invariant(!path.resolve(credentialPath).startsWith(path.resolve(process.cwd()) + path.sep), "CREDENTIAL_REFERENCE_INSIDE_REPOSITORY");
  invariant((await stat(credentialPath)).isFile(), "CREDENTIAL_REFERENCE_UNAVAILABLE");

  const budgetBefore = await pool.query(`SELECT * FROM automation_call_budgets WHERE project_id=$1 AND call_kind='private_upload'`, [PROJECT_ID]);
  invariant(budgetBefore.rowCount === 1, "PRIVATE_UPLOAD_BUDGET_MISSING");
  invariant(Number(budgetBefore.rows[0].limit_count) === 1 && Number(budgetBefore.rows[0].used_count) === 0 && Number(budgetBefore.rows[0].max_retries) === 0, "PRIVATE_UPLOAD_BUDGET_STATE_INVALID");

  const publicationPayloadHash = sha256Canonical({
    assetId: FINAL_MEDIA_ARTIFACT_ID,
    title: TITLE,
    description: DESCRIPTION,
    options: { visibility: VISIBILITY },
  });
  invariant(publicationPayloadHash === EXPECTED_PAYLOAD_HASH, "PUBLICATION_PAYLOAD_HASH_MISMATCH");
  const publicationIdentity = publicationIdentityV2({
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    finalMediaSha256: FINAL_MEDIA_SHA256,
    targetPlatform: "youtube",
    targetAccountId: EXTERNAL_CHANNEL_ID,
    publicationPayloadHash,
  });
  invariant(publicationIdentity === PREVIOUS_BLOCKED_IDENTITY, "PUBLICATION_IDENTITY_DRIFT");
  const transport = { type: "LOCAL_FILE", path: FINAL_MEDIA_PATH, expectedSha256: FINAL_MEDIA_SHA256, expectedByteCount: fileInfo.size, mimeType: "video/mp4" };
  const transportPreflight = await preflightMediaTransport(transport, FINAL_MEDIA_SHA256);
  const transportFingerprint = mediaTransportFingerprint(transport);
  const uploadSessionId = markerFor(FINAL_MEDIA_ARTIFACT_ID, FINAL_MEDIA_SHA256, TITLE, VISIBILITY);

  const priorPublication = await pool.query(`SELECT * FROM provider_publications WHERE idempotency_key=$1 OR (workflow_id=$2 AND asset_id=$3)`, [publicationIdentity, WORKFLOW_ID, FINAL_MEDIA_ARTIFACT_ID]);
  invariant(priorPublication.rowCount === 0, "PRIOR_PUBLICATION_EXISTS");
  const priorSession = await pool.query(`SELECT * FROM provider_upload_sessions WHERE marker=$1 OR final_media_artifact_id=$2`, [uploadSessionId, FINAL_MEDIA_ARTIFACT_ID]);
  invariant(priorSession.rowCount === 0, "PRIOR_UPLOAD_SESSION_EXISTS");
  const priorReport = await pool.query(`SELECT artifact_id FROM artifacts WHERE workflow_id=$1 AND kind='published_report'`, [WORKFLOW_ID]);
  invariant(priorReport.rowCount === 0, "PRIOR_PUBLISHED_REPORT_EXISTS");

  // Canonical credential use mints a short-lived in-memory token and verifies
  // the exact authenticated channel. No token is logged or persisted.
  const ready = await prepareM4Upload(
    { readFile: (file) => readFile(file, "utf8") },
    oauthTransport,
    { credentialPath, requestedVisibility: VISIBILITY, budget: M4_BUDGET },
  );
  invariant(ready.channelId === EXTERNAL_CHANNEL_ID && ready.visibility === VISIBILITY, "CHANNEL_IDENTITY_MISMATCH");

  const createdAt = new Date().toISOString();
  const authority = {
    approvalId: OWNER_AUTHORITY_REF,
    decision: "approved",
    scope: "PRIVATE_VALIDATION",
    projectId: PROJECT_ID,
    workflowId: WORKFLOW_ID,
    projectMode: "PRODUCTION",
    finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID,
    finalMediaSha256: FINAL_MEDIA_SHA256,
    finalProductReviewId: FINAL_REVIEW_ID,
    targetPlatform: "youtube",
    targetAccountId: EXTERNAL_CHANNEL_ID,
    publicationPayloadHash,
    publicationIdentity,
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await insertArtifact(client, {
      artifactId: TECHNICAL_QA_ID, kind: "final_technical_qa", producerAgent: "qa", status: "completed", schemaVersion: "amf.final-technical-qa.v1", createdAt,
      parentArtifactId: FINAL_MEDIA_ARTIFACT_ID, parentArtifactKind: "final_media_artifact",
      payload: { artifactId: TECHNICAL_QA_ID, projectId: PROJECT_ID, contentId: CONTENT_ID, workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID, stage: "qa", taskId: PUBLICATION_EXECUTION_ID, createdAt, status: "completed", finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID, finalMediaSha256: FINAL_MEDIA_SHA256, technicalQaStatus: "PASS", source: "PHASE_4_CANONICAL_TECHNICAL_QA" },
    });
    await insertArtifact(client, {
      artifactId: FINAL_REVIEW_ID, kind: "final_product_review", producerAgent: "final-product-review", status: "completed", schemaVersion: "amf.final-product-review.v1", createdAt,
      parentArtifactId: TECHNICAL_QA_ID, parentArtifactKind: "final_technical_qa",
      payload: { artifactId: FINAL_REVIEW_ID, projectId: PROJECT_ID, contentId: CONTENT_ID, workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID, stage: "final-product-review", taskId: PUBLICATION_EXECUTION_ID, createdAt, status: "approved", decision: "APPROVE_FOR_PRIVATE_PUBLICATION_CANARY", approvalScope: "PROGRAM_04_PHASE_5_PRIVATE_PUBLICATION_CANARY_ONLY", qualityAssessment: "PIPELINE_CANARY_ACCEPTABLE_NOT_FINAL_BRAND_STANDARD", publicPublicationApproved: false, finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID, finalMediaSha256: FINAL_MEDIA_SHA256, ownerAuthorityRef: OWNER_AUTHORITY_REF },
    });
    await insertArtifact(client, {
      artifactId: AUTHORIZATION_ID, kind: "publisher_authorization", producerAgent: "publisher-authorization", status: "completed", schemaVersion: "amf.publisher-authorization.v1", createdAt,
      parentArtifactId: FINAL_REVIEW_ID, parentArtifactKind: "final_product_review",
      payload: { artifactId: AUTHORIZATION_ID, projectId: PROJECT_ID, contentId: CONTENT_ID, workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID, stage: "publisher-authorization", taskId: PUBLICATION_EXECUTION_ID, createdAt, status: "AUTHORIZED", scope: "PRIVATE_VALIDATION", finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID, finalMediaSha256: FINAL_MEDIA_SHA256, channelBindingId: CHANNEL_BINDING_ID, credentialBindingId: CREDENTIAL_BINDING_ID, visibility: VISIBILITY, title: TITLE, description: DESCRIPTION, publicationPayloadHash, publicationIdentity, ownerAuthorityRef: OWNER_AUTHORITY_REF, previousBlockedAttempt: "BLOCKED_PRE_TRANSPORT_NO_UPLOAD" },
    });
    await insertArtifact(client, {
      artifactId: INTENT_ID, kind: "publication_integration_validation", producerAgent: "publisher-authorization", status: "completed", schemaVersion: "amf.publication-integration-validation.v1", createdAt,
      parentArtifactId: AUTHORIZATION_ID, parentArtifactKind: "publisher_authorization",
      payload: { artifactId: INTENT_ID, projectId: PROJECT_ID, contentId: CONTENT_ID, workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID, stage: "publisher", taskId: PUBLICATION_EXECUTION_ID, createdAt, status: "INTENT_PERSISTED", finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID, finalMediaSha256: FINAL_MEDIA_SHA256, mediaTransportType: transport.type, transportFingerprint, publicationIdentity, publicationPayloadHash, uploadSessionId, channelBindingId: CHANNEL_BINDING_ID, credentialBindingId: CREDENTIAL_BINDING_ID, visibility: VISIBILITY, ownerAuthorityRef: OWNER_AUTHORITY_REF },
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const sessionStore = new PostgresPublishSessionStore(pool);
  await sessionStore.savePending(uploadSessionId, undefined, {
    finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID,
    finalMediaSha256: FINAL_MEDIA_SHA256,
    transportType: transport.type,
    transportFingerprint,
  });

  // The Program-4 budget authority is a hard atomic-consume ledger (it has no
  // separate reserved column). Consume immediately before the only authorized
  // logical upload; any started/ambiguous provider effect therefore counts once.
  const automation = new AutomationStore(pool);
  await automation.consumeCallBudget(PROJECT_ID, "private_upload", 1, PUBLICATION_EXECUTION_ID);
  budgetConsumed = true;

  const adapter = new YouTubePublishAdapter({
    accessToken: ready.accessToken,
    publishSessionStore: sessionStore,
    enableMarkerDedup: false,
    embedIdempotencyMarker: false,
    onOperation: (event) => operations.push(event),
  });
  const publishStore = new PostgresPublishStore(pool);
  const resolver = {
    resolve: (id) => id === PUBLISH_CAPABILITY_ID ? { capabilityId: id } : null,
    isAuthorized: (agentId, capabilityId) => agentId === "publisher" && capabilityId === PUBLISH_CAPABILITY_ID,
  };
  const executor = new PublishingCapabilityExecutor(adapter, publishStore, resolver, {
    maxTitleLength: 100,
    maxDescriptionLength: 5000,
    maxAssetIdLength: 500,
    maxTags: 30,
    maxTagLength: 500,
    allowedVisibility: ["private"],
  });
  logicalUploadCalls = 1;
  const result = await executor.execute({
    requestId: PUBLICATION_EXECUTION_ID,
    capabilityId: PUBLISH_CAPABILITY_ID,
    operation: "publish",
    agentId: "publisher",
    workflowId: WORKFLOW_ID,
    correlationId: CORRELATION_ID,
    requestedAt: new Date().toISOString(),
    input: {
      projectId: PROJECT_ID,
      finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID,
      finalMediaSha256: FINAL_MEDIA_SHA256,
      mediaTransportRef: transport,
      targetAccountId: EXTERNAL_CHANNEL_ID,
      title: TITLE,
      description: DESCRIPTION,
      options: { visibility: VISIBILITY },
      idempotencyKey: publicationIdentity,
      publicationAuthority: authority,
    },
  });

  if (result.status !== "success") {
    await pool.query(`UPDATE artifacts SET payload=jsonb_set(payload,'{status}',to_jsonb('RECONCILIATION_REQUIRED'::text),true) WHERE artifact_id=$1`, [INTENT_ID]);
    console.log(JSON.stringify({
      outcome: "RECONCILIATION_REQUIRED", sourceBuild, workerPid: Number(liveWorkers.rows[0].process_id),
      publicationIdentity, publicationPayloadHash, uploadSessionId, budgetConsumed,
      oauthNetworkCalls, youtubeIdentityCalls, logicalUploadCalls,
      providerOperations: operations.map(({ operation, outcome, retryCount, statusCode }) => ({ operation, outcome, retryCount, statusCode })),
      failure: result.status === "failed" ? result.error?.code ?? "PROVIDER_FAILED" : result.reason ?? "PUBLISH_BLOCKED",
    }, null, 2));
    process.exitCode = 2;
  } else {
    const output = result.output;
    invariant(output.finalMediaArtifactId === FINAL_MEDIA_ARTIFACT_ID && output.finalMediaSha256 === FINAL_MEDIA_SHA256, "PUBLISHED_LINEAGE_MISMATCH");
    invariant(output.idempotencyKey === publicationIdentity && output.mediaTransportFingerprint === transportFingerprint, "PUBLISHED_IDENTITY_MISMATCH");
    invariant(typeof output.publicationId === "string" && output.publicationId.length > 0, "YOUTUBE_VIDEO_ID_MISSING");
    const receipt = await verifyReceipt(ready.accessToken, output.publicationId);
    invariant(receipt.snippet?.channelId === EXTERNAL_CHANNEL_ID, "YOUTUBE_RECEIPT_CHANNEL_MISMATCH");
    invariant(receipt.status?.privacyStatus === VISIBILITY, "YOUTUBE_RECEIPT_VISIBILITY_MISMATCH");
    invariant(receipt.snippet?.title === TITLE && receipt.snippet?.description === DESCRIPTION, "YOUTUBE_RECEIPT_METADATA_MISMATCH");

    const reportId = `art-published-report-${createHash("sha256").update(`${publicationIdentity}:${output.publicationId}`).digest("hex").slice(0, 24)}`;
    const publishedAt = output.publishedAt ?? new Date().toISOString();
    const reportPayload = {
      artifactId: reportId, reportId, projectId: PROJECT_ID, contentId: CONTENT_ID, workflowId: WORKFLOW_ID,
      correlationId: CORRELATION_ID, stage: "publisher", taskId: PUBLICATION_EXECUTION_ID, createdAt: publishedAt,
      status: "completed", summary: "Private validation publication completed through the canonical YouTube capability.",
      finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID, finalMediaSha256: FINAL_MEDIA_SHA256,
      provider: "youtube", providerId: "youtube", channelBindingId: CHANNEL_BINDING_ID,
      externalChannelId: EXTERNAL_CHANNEL_ID, providerVideoId: output.publicationId, publicationId: output.publicationId,
      visibility: VISIBILITY, title: TITLE, description: DESCRIPTION, publicationIdentity,
      publicationPayloadHash, publicationExecutionId: PUBLICATION_EXECUTION_ID,
      credentialBindingId: CREDENTIAL_BINDING_ID, mediaTransportType: transport.type,
      transportFingerprint, publishedAt, publishedUrl: output.url, idempotencyKey: publicationIdentity,
      publicationStatus: "PRIVATE_VALIDATION_COMPLETE", executionEvidencePresent: true,
      receipt: { providerConfirmed: true, channelIdentityVerified: true, visibilityVerified: true, metadataVerified: true },
      provenance: { ownerAuthorityRef: OWNER_AUTHORITY_REF, previousBlockedAttempt: "BLOCKED_PRE_TRANSPORT_NO_UPLOAD", capabilityEvidenceId: result.evidence?.evidenceId ?? null },
      metadata: { workflowId: WORKFLOW_ID, correlationId: CORRELATION_ID }, capabilityExecutions: [result],
    };
    const save = await pool.connect();
    try {
      await save.query("BEGIN");
      await save.query(`UPDATE provider_publications SET workflow_id=$2,asset_id=$3,visibility='private',updated_at=$4 WHERE idempotency_key=$1 AND status='completed' AND publication_id=$5`, [publicationIdentity, WORKFLOW_ID, FINAL_MEDIA_ARTIFACT_ID, new Date().toISOString(), output.publicationId]);
      await insertArtifact(save, { artifactId: reportId, kind: "published_report", producerAgent: "publisher", status: "completed", schemaVersion: "amf.published-report.v1", createdAt: publishedAt, parentArtifactId: FINAL_MEDIA_ARTIFACT_ID, parentArtifactKind: "final_media_artifact", payload: reportPayload });
      await save.query(`UPDATE artifacts SET payload=jsonb_set(jsonb_set(payload,'{status}',to_jsonb('COMPLETED'::text),true),'{publishedReportArtifactId}',to_jsonb($2::text),true) WHERE artifact_id=$1`, [INTENT_ID, reportId]);
      await save.query(`INSERT INTO automation_events(event_id,project_id,kind,subject_type,subject_id,what,why,policy_ref,authority_ref,budget_ref,result,created_at) VALUES($1,$2,'publication.private.completed','published_report',$3,$4,$5,$6,$7,$8,$9,$10)`, [
        `event-${randomUUID()}`, PROJECT_ID, reportId, "Program-4 private publication canary completed",
        JSON.stringify({ phase: "PHASE_5", previousBlockedPreserved: true }),
        JSON.stringify({ visibility: VISIBILITY, publicAuthorized: false }),
        JSON.stringify({ ownerAuthorityRef: OWNER_AUTHORITY_REF, publicationIdentity }),
        JSON.stringify({ callKind: "private_upload", limit: 1, used: 1, retries: 0 }),
        JSON.stringify({ providerVideoId: output.publicationId, status: "PRIVATE_VALIDATION_COMPLETE" }),
        new Date().toISOString(),
      ]);
      await save.query("COMMIT");
    } catch (error) {
      await save.query("ROLLBACK");
      throw error;
    } finally {
      save.release();
    }

    const budgetAfter = await pool.query(`SELECT limit_count,used_count,max_retries FROM automation_call_budgets WHERE project_id=$1 AND call_kind='private_upload'`, [PROJECT_ID]);
    const sessionAfter = await pool.query(`SELECT status,provider_id,publication_id,final_media_artifact_id,final_media_sha256,transport_type,transport_fingerprint FROM provider_upload_sessions WHERE marker=$1`, [uploadSessionId]);
    const receiptPath = path.join(process.cwd(), "output", "program-04-live-canary", "phase-5", "phase-5-private-publication-v2-receipt.json");
    await mkdir(path.dirname(receiptPath), { recursive: true });
    const safeReceipt = {
      task: OWNER_AUTHORITY_REF, outcome: "PASS_LIVE_PRIVATE", sourceBuild,
      workerPid: Number(liveWorkers.rows[0].process_id), finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID,
      finalMediaSha256: FINAL_MEDIA_SHA256, finalMediaBytes: fileInfo.size,
      mediaTransportType: transport.type, transportFingerprint: transportPreflight.fingerprint,
      publicationIdentity, publicationPayloadHash, publicationExecutionId: PUBLICATION_EXECUTION_ID,
      uploadSessionId, providerVideoId: output.publicationId, publishedReportArtifactId: reportId,
      visibility: VISIBILITY, externalChannelId: EXTERNAL_CHANNEL_ID, credentialBindingId: CREDENTIAL_BINDING_ID,
      publishedAt, budget: { before: { limit: 1, used: 0 }, after: { limit: Number(budgetAfter.rows[0].limit_count), used: Number(budgetAfter.rows[0].used_count) }, retries: Number(budgetAfter.rows[0].max_retries) },
      session: sessionAfter.rows[0], oauthNetworkCalls, youtubeIdentityCalls, youtubeReceiptCalls,
      logicalUploadCalls, providerOperations: operations.map(({ operation, outcome, retryCount, statusCode }) => ({ operation, outcome, retryCount, statusCode })),
      publicPublicationAuthorized: false, previousBlockedAttemptPreserved: true,
    };
    await writeFile(receiptPath, JSON.stringify(safeReceipt, null, 2) + "\n", "utf8");
    console.log(JSON.stringify({ ...safeReceipt, receiptPath }, null, 2));
  }
} finally {
  await pool.end();
}
