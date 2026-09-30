import pg from "pg";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ANALYTICS_CAPABILITY_ID,
  AnalyticsCapabilityExecutor,
} from "@ai-media-factory/tool-framework";
import {
  NON_MONETARY_METRICS,
  YouTubeAnalyticsAdapter,
  assertControlledChannel,
  assertCredentialScopes,
  readCredential,
  refreshAccessToken,
  verifyChannel,
} from "@ai-media-factory/provider-adapters";
import { AutomationStore, LearningLoopStore } from "@ai-media-factory/database";
import { computeMediaBuildId } from "@ai-media-factory/worker";

const CONFIRM = "amf-program-04-phase-6-single-analytics-observation-v1";
const args = new Map(process.argv.slice(2).map((value) => {
  const index = value.indexOf("=");
  return index === -1 ? [value, true] : [value.slice(0, index), value.slice(index + 1)];
}));
if (!args.has("--apply") || args.get("--confirm-production") !== CONFIRM) {
  throw new Error(`PRODUCTION_CONFIRMATION_REQUIRED:${CONFIRM}`);
}

const PROJECT_ID = "morroway";
const CONTENT_ID = "content-mulk44ho-kih3gg";
const WORKFLOW_ID = "wf-p4-canary-2b0da0ba762b65477107";
const CORRELATION_ID = "corr-p4-canary-91a7723e93f4253c0309";
const PUBLISHED_REPORT_ID = "art-published-report-b71671ebda5049b64b3b7c82";
const FINAL_MEDIA_ARTIFACT_ID = "art-final-media-canary-e46409193d5f74e14829258c";
const FINAL_MEDIA_SHA256 = "41d8a68152b9f34bb65da54ad18298b8c8f1bdb57a508afd631d75aac4c27d49";
const YOUTUBE_VIDEO_ID = "QC0XPZak0Q4";
const CHANNEL_BINDING_ID = "channel-morroway-youtube";
const EXTERNAL_CHANNEL_ID = "UCA5ECzcK_96akfUT5fQUT3A";
const CREDENTIAL_BINDING_ID = "binding-morroway-youtube-fe06cec2832354a9";
const ANALYTICS_PROVIDER_ID = "youtube-analytics";
const EXECUTION_ID = "analytics-canary-e46409193d5f74e14829258c";
const OWNER_AUTHORITY_REF = "AMF_PROGRAM_04_PHASE_6_SINGLE_ANALYTICS_OBSERVATION_V1";
const CANARY_CLASSIFICATION = "PROGRAM_04_LIVE_CANARY_EXCLUDED_FROM_NORMAL_PRODUCTION_KPIS";
const REQUIRED_ANALYTICS_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sourceBuild = computeMediaBuildId().buildId;
const operations = [];
let oauthRefreshCalls = 0;
let youtubeIdentityCalls = 0;
let analyticsFetches = 0;
let providerHttpStatus = null;
let providerBody = null;

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

async function readJsonResponse(response, code) {
  if (!response.ok) throw new Error(`${code}:HTTP_${response.status}`);
  return response.json();
}

const oauthTransport = {
  async postForm(url, params) {
    oauthRefreshCalls += 1;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams(params).toString(),
    });
    return readJsonResponse(response, "OAUTH_REFRESH_FAILED");
  },
  async get(url, headers) {
    youtubeIdentityCalls += 1;
    const response = await fetch(url, { method: "GET", headers: { ...headers, accept: "application/json" } });
    return readJsonResponse(response, "YOUTUBE_CHANNEL_IDENTITY_FAILED");
  },
};

function ymd(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function rawReturnedMetrics(body) {
  const headers = Array.isArray(body?.columnHeaders) ? body.columnHeaders : [];
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (!Array.isArray(rows[0])) return {};
  const result = {};
  for (let index = 0; index < headers.length; index += 1) {
    const name = headers[index]?.name;
    const value = rows[0][index];
    if (name !== "video" && typeof name === "string" && typeof value === "number" && Number.isFinite(value)) {
      result[name] = value;
    }
  }
  return result;
}

async function insertAnalyticsArtifact(observation, reportPayload, dataStatus, metrics, retrievedAt) {
  const artifactId = `art-analytics-report-${observation.observationId.slice(4)}`;
  const payload = {
    artifactId,
    projectId: PROJECT_ID,
    contentId: CONTENT_ID,
    workflowId: WORKFLOW_ID,
    correlationId: CORRELATION_ID,
    stage: "analytics",
    taskId: EXECUTION_ID,
    createdAt: retrievedAt,
    status: "completed",
    summary: "One bounded live YouTube Analytics observation for the Program-4 private canary.",
    observationId: observation.observationId,
    observationSource: "LIVE",
    observationStatus: dataStatus,
    dataCompleteness: dataStatus,
    canaryClassification: CANARY_CLASSIFICATION,
    excludedFromNormalProductionKpis: true,
    publishedReportArtifactId: PUBLISHED_REPORT_ID,
    finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID,
    finalMediaSha256: FINAL_MEDIA_SHA256,
    providerPublicationId: YOUTUBE_VIDEO_ID,
    channelBindingId: CHANNEL_BINDING_ID,
    externalChannelId: EXTERNAL_CHANNEL_ID,
    analyticsProviderId: ANALYTICS_PROVIDER_ID,
    visibility: "private",
    measurementWindow: { start: observation.windowStart, end: observation.windowEnd },
    retrievedAt,
    metrics,
    metricsActuallyReturned: Object.keys(metrics),
    ownerAuthorityRef: OWNER_AUTHORITY_REF,
    sourcePublishedReportStatus: reportPayload.status,
  };
  const existing = await pool.query(`SELECT artifact_id,payload FROM artifacts WHERE artifact_id=$1`, [artifactId]);
  if (existing.rowCount) {
    invariant(existing.rows[0].payload?.observationId === observation.observationId, "ANALYTICS_ARTIFACT_IDENTITY_CONFLICT");
    return artifactId;
  }
  await pool.query(
    `INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at,parent_artifact_id,parent_artifact_kind)
     VALUES($1,$2,'analytics_report','analytics',$3,'completed',$4,'application/json','amf.analytics-report.v1',$5,$6,'published_report')`,
    [artifactId, WORKFLOW_ID, CORRELATION_ID, JSON.stringify(payload), retrievedAt, PUBLISHED_REPORT_ID],
  );
  return artifactId;
}

try {
  invariant(typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0, "DATABASE_URL_REQUIRED");
  const liveWorkers = await pool.query(
    `SELECT worker_instance_id,build_id,worker_role,last_heartbeat_at,process_id
       FROM amf_worker_presence
      WHERE runtime_mode='PERSISTENT_PRODUCTION_WORKER' AND last_heartbeat_at >= $1
      ORDER BY last_heartbeat_at DESC`,
    [new Date(Date.now() - 120_000).toISOString()],
  );
  invariant(liveWorkers.rowCount === 1, "WORKER_SINGLETON_NOT_HEALTHY");
  invariant(liveWorkers.rows[0].build_id === sourceBuild, "WORKER_BUILD_MISMATCH");
  invariant(liveWorkers.rows[0].worker_role === "canonical-production-queue-worker", "WORKER_ROLE_MISMATCH");
  const queue = await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_jobs WHERE status IN ('queued','running')`);
  invariant(Number(queue.rows[0].count) === 0, "QUEUE_CONFLICT");

  const report = await pool.query(
    `SELECT artifact_id,workflow_id,status,payload,parent_artifact_id,parent_artifact_kind
       FROM artifacts WHERE artifact_id=$1 AND kind='published_report' AND status='completed'`,
    [PUBLISHED_REPORT_ID],
  );
  invariant(report.rowCount === 1, "PUBLISHED_REPORT_MISSING");
  const published = report.rows[0].payload;
  invariant(report.rows[0].workflow_id === WORKFLOW_ID && published.projectId === PROJECT_ID && published.contentId === CONTENT_ID, "PUBLISHED_REPORT_OWNERSHIP_MISMATCH");
  invariant(report.rows[0].parent_artifact_id === FINAL_MEDIA_ARTIFACT_ID && report.rows[0].parent_artifact_kind === "final_media_artifact", "PUBLISHED_REPORT_PARENT_LINEAGE_INVALID");
  invariant(published.finalMediaArtifactId === FINAL_MEDIA_ARTIFACT_ID && published.finalMediaSha256 === FINAL_MEDIA_SHA256, "PUBLISHED_REPORT_MEDIA_LINEAGE_INVALID");
  invariant(published.providerVideoId === YOUTUBE_VIDEO_ID && published.externalChannelId === EXTERNAL_CHANNEL_ID, "PUBLISHED_REPORT_PROVIDER_LINEAGE_INVALID");
  invariant(published.visibility === "private" && published.publicationStatus === "PRIVATE_VALIDATION_COMPLETE", "PUBLISHED_REPORT_STATUS_INVALID");

  const publication = await pool.query(
    `SELECT publication_id,status,visibility,workflow_id,asset_id FROM provider_publications
      WHERE publication_id=$1 AND workflow_id=$2 AND asset_id=$3`,
    [YOUTUBE_VIDEO_ID, WORKFLOW_ID, FINAL_MEDIA_ARTIFACT_ID],
  );
  invariant(publication.rowCount === 1 && publication.rows[0].status === "completed" && publication.rows[0].visibility === "private", "PROVIDER_PUBLICATION_INVALID");
  const channel = await pool.query(`SELECT * FROM channels WHERE channel_id=$1 AND project_id=$2 AND platform='youtube' AND status='VERIFIED'`, [CHANNEL_BINDING_ID, PROJECT_ID]);
  invariant(channel.rowCount === 1 && channel.rows[0].external_channel_id === EXTERNAL_CHANNEL_ID, "CHANNEL_BINDING_INVALID");
  const bindings = await pool.query(`SELECT * FROM credential_bindings WHERE binding_id=$1 AND project_id=$2 AND channel_id=$3 AND provider='youtube' AND status='ACTIVE'`, [CREDENTIAL_BINDING_ID, PROJECT_ID, CHANNEL_BINDING_ID]);
  invariant(bindings.rowCount === 1, "CREDENTIAL_BINDING_INVALID");

  const budgetBefore = await pool.query(`SELECT limit_count,used_count,max_retries FROM automation_call_budgets WHERE project_id=$1 AND call_kind='analytics'`, [PROJECT_ID]);
  invariant(budgetBefore.rowCount === 1, "ANALYTICS_BUDGET_MISSING");
  invariant(Number(budgetBefore.rows[0].limit_count) === 1 && Number(budgetBefore.rows[0].used_count) === 0 && Number(budgetBefore.rows[0].max_retries) === 0, "ANALYTICS_BUDGET_STATE_INVALID");
  const existingObservations = await pool.query(`SELECT observation_id FROM performance_observations WHERE published_report_id=$1 OR (publication_id=$2 AND analytics_provider_id=$3)`, [PUBLISHED_REPORT_ID, YOUTUBE_VIDEO_ID, ANALYTICS_PROVIDER_ID]);
  invariant(existingObservations.rowCount === 0, "ANALYTICS_OBSERVATION_ALREADY_EXISTS");
  const existingReports = await pool.query(`SELECT artifact_id FROM artifacts WHERE workflow_id=$1 AND kind='analytics_report'`, [WORKFLOW_ID]);
  invariant(existingReports.rowCount === 0, "ANALYTICS_REPORT_ALREADY_EXISTS");

  const credential = await readCredential({ readFile: (file) => readFile(file, "utf8") }, String(bindings.rows[0].credential_ref));
  assertCredentialScopes(credential);
  invariant(credential.scopes.includes(REQUIRED_ANALYTICS_SCOPE), "ANALYTICS_SCOPE_MISSING");
  const minted = await refreshAccessToken(oauthTransport, credential);
  const authenticatedChannel = await verifyChannel(oauthTransport, minted.accessToken);
  assertControlledChannel(authenticatedChannel.channelId);
  invariant(authenticatedChannel.channelId === EXTERNAL_CHANNEL_ID, "CHANNEL_IDENTITY_MISMATCH");

  const publicationDate = ymd(published.publishedAt);
  const today = ymd(new Date());
  const windowDays = Math.max(1, Math.floor((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${publicationDate}T00:00:00.000Z`)) / 86_400_000) + 1);
  const automation = new AutomationStore(pool);
  await automation.consumeCallBudget(PROJECT_ID, "analytics", 1, EXECUTION_ID);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsed = new URL(String(url));
    if (parsed.hostname === "youtubeanalytics.googleapis.com" && parsed.pathname === "/v2/reports") {
      analyticsFetches += 1;
      invariant(analyticsFetches === 1, "SECOND_ANALYTICS_FETCH_PROHIBITED");
      invariant(parsed.searchParams.get("filters") === `video==${YOUTUBE_VIDEO_ID}`, "ANALYTICS_VIDEO_FILTER_MISMATCH");
      invariant(parsed.searchParams.get("startDate") === publicationDate, "ANALYTICS_WINDOW_START_MISMATCH");
      invariant(parsed.searchParams.get("endDate") === today, "ANALYTICS_WINDOW_END_MISMATCH");
      const response = await originalFetch(url, init);
      providerHttpStatus = response.status;
      try { providerBody = await response.clone().json(); } catch { providerBody = null; }
      return response;
    }
    return originalFetch(url, init);
  };

  let capabilityResult;
  try {
    const adapter = new YouTubeAnalyticsAdapter({
      accessToken: minted.accessToken,
      metrics: [...NON_MONETARY_METRICS],
      maxRetries: 0,
      windowDays,
      timeoutMs: 30_000,
      onOperation: (event) => operations.push(event),
    });
    const resolver = {
      resolve: (id) => id === ANALYTICS_CAPABILITY_ID ? { capabilityId: id } : null,
      isAuthorized: (agentId, capabilityId) => agentId === "analytics" && capabilityId === ANALYTICS_CAPABILITY_ID,
    };
    const executor = new AnalyticsCapabilityExecutor(adapter, resolver, { maxPublicationIdLength: 500 });
    capabilityResult = await executor.execute({
      requestId: EXECUTION_ID,
      capabilityId: ANALYTICS_CAPABILITY_ID,
      operation: "fetch",
      agentId: "analytics",
      workflowId: WORKFLOW_ID,
      correlationId: CORRELATION_ID,
      requestedAt: new Date().toISOString(),
      input: { publicationId: YOUTUBE_VIDEO_ID, platform: "youtube" },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  invariant(analyticsFetches === 1, "ANALYTICS_FETCH_COUNT_INVALID");
  invariant(capabilityResult.status === "success", `ANALYTICS_CAPABILITY_${capabilityResult.status.toUpperCase()}`);
  invariant(capabilityResult.output.publicationId === YOUTUBE_VIDEO_ID && capabilityResult.output.providerId === ANALYTICS_PROVIDER_ID, "ANALYTICS_PROVIDER_IDENTITY_MISMATCH");

  const rowsReturned = Array.isArray(providerBody?.rows) ? providerBody.rows.length : 0;
  const rawMetrics = rawReturnedMetrics(providerBody);
  const metrics = { ...capabilityResult.output.metrics };
  if (typeof rawMetrics.averageViewDuration === "number") metrics.averageViewDurationSeconds = rawMetrics.averageViewDuration;
  const dataStatus = rowsReturned === 0 ? "EMPTY_VALID_PROVIDER_RESPONSE" : "INSUFFICIENT_DATA";
  const learning = new LearningLoopStore(pool);
  const recorded = await learning.recordObservation({
    projectId: PROJECT_ID,
    contentId: CONTENT_ID,
    workflowId: WORKFLOW_ID,
    artifactId: FINAL_MEDIA_ARTIFACT_ID,
    finalMediaSha256: FINAL_MEDIA_SHA256,
    publishedReportId: PUBLISHED_REPORT_ID,
    publicationId: YOUTUBE_VIDEO_ID,
    channelId: EXTERNAL_CHANNEL_ID,
    analyticsProviderId: ANALYTICS_PROVIDER_ID,
    experimentId: CANARY_CLASSIFICATION,
    lineageKind: "GOVERNED_RUN",
    windowStart: publicationDate,
    windowEnd: today,
    metrics,
    metricProvenance: "LIVE",
    transportProvenance: "LIVE",
    observedAt: capabilityResult.output.retrievedAt,
  });
  invariant(recorded.created, "ANALYTICS_OBSERVATION_NOT_CREATED");
  const analyticsReportArtifactId = await insertAnalyticsArtifact(recorded.observation, published, dataStatus, metrics, capabilityResult.output.retrievedAt);
  await automation.recordEvent({
    projectId: PROJECT_ID,
    kind: "analytics.live_canary.observed",
    subjectType: "performance_observation",
    subjectId: recorded.observation.observationId,
    what: "Program-4 bounded live-canary analytics observation captured",
    why: { ownerAuthorityRef: OWNER_AUTHORITY_REF, publicationId: YOUTUBE_VIDEO_ID },
    policyRef: { classification: CANARY_CLASSIFICATION, excludedFromNormalProductionKpis: true, noLearningExecution: true },
    authorityRef: { task: OWNER_AUTHORITY_REF, maxFetches: 1, retries: 0 },
    budgetRef: { callKind: "analytics", limit: 1, used: 1 },
    result: { observationId: recorded.observation.observationId, analyticsReportArtifactId, dataStatus, providerRowsReturned: rowsReturned },
  });

  const budgetAfter = await pool.query(`SELECT limit_count,used_count,max_retries FROM automation_call_budgets WHERE project_id=$1 AND call_kind='analytics'`, [PROJECT_ID]);
  const receiptPath = path.join(process.cwd(), "output", "program-04-live-canary", "phase-6", "phase-6-analytics-observation-receipt.json");
  await mkdir(path.dirname(receiptPath), { recursive: true });
  const requestedMetricNames = [...NON_MONETARY_METRICS];
  const returnedProviderMetricNames = Object.keys(rawMetrics);
  const receipt = {
    task: OWNER_AUTHORITY_REF,
    phase6Status: "PASS_LIVE",
    sourceBuild,
    workerPid: Number(liveWorkers.rows[0].process_id),
    publishedReportArtifactId: PUBLISHED_REPORT_ID,
    finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID,
    finalMediaSha256: FINAL_MEDIA_SHA256,
    youtubeVideoId: YOUTUBE_VIDEO_ID,
    visibility: "private",
    channelId: EXTERNAL_CHANNEL_ID,
    analyticsProviderId: ANALYTICS_PROVIDER_ID,
    tokenLiveness: "VALID",
    analyticsScopeValid: true,
    measurementStart: publicationDate,
    measurementEnd: today,
    retrievedAt: capabilityResult.output.retrievedAt,
    budget: {
      before: { limit: 1, used: 0, remaining: 1, retries: 0 },
      after: { limit: Number(budgetAfter.rows[0].limit_count), used: Number(budgetAfter.rows[0].used_count), remaining: Number(budgetAfter.rows[0].limit_count) - Number(budgetAfter.rows[0].used_count), retries: Number(budgetAfter.rows[0].max_retries) },
    },
    oauthRefreshCalls,
    youtubeIdentityCalls,
    analyticsFetches,
    analyticsRetries: 0,
    providerHttpStatus,
    providerRowsReturned: rowsReturned,
    observationId: recorded.observation.observationId,
    analyticsReportArtifactId,
    observationSource: "LIVE",
    observationStatus: dataStatus,
    dataCompleteness: dataStatus,
    metrics,
    metricsReturned: returnedProviderMetricNames,
    metricsNotReturned: requestedMetricNames.filter((name) => !returnedProviderMetricNames.includes(name)),
    canaryClassification: CANARY_CLASSIFICATION,
    excludedFromNormalProductionKpis: true,
    operations: operations.map(({ operation, outcome, retryCount, statusCode }) => ({ operation, outcome, retryCount, statusCode })),
    learningExecuted: false,
  };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
} finally {
  await pool.end();
}
