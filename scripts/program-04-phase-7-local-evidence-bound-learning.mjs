import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { LearningLoopStore } from "@ai-media-factory/database";

const CONFIRM = "amf-program-04-phase-7-local-evidence-bound-learning-v1";
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
const OBSERVATION_ID = "obs-ea5b7d61d0a7";
const ANALYTICS_REPORT_ID = "art-analytics-report-ea5b7d61d0a7";
const PUBLISHED_REPORT_ID = "art-published-report-b71671ebda5049b64b3b7c82";
const FINAL_MEDIA_ARTIFACT_ID = "art-final-media-canary-e46409193d5f74e14829258c";
const FINAL_MEDIA_SHA256 = "41d8a68152b9f34bb65da54ad18298b8c8f1bdb57a508afd631d75aac4c27d49";
const YOUTUBE_VIDEO_ID = "QC0XPZak0Q4";
const CANARY_CLASSIFICATION = "PROGRAM_04_LIVE_CANARY_EXCLUDED_FROM_NORMAL_PRODUCTION_KPIS";
const OWNER_AUTHORITY_REF = "AMF_PROGRAM_04_PHASE_7_LOCAL_EVIDENCE_BOUND_LEARNING_V1";

const FINDING = "PROCESS_VALIDATION: the private-canary publication-to-analytics chain and canonical identity join worked; the live provider returned a valid empty response, so CONTENT_PERFORMANCE is INSUFFICIENT_DATA.";
const RECOMMENDATION = "NO_CONTENT_PERFORMANCE_CONCLUSION; collect a future measurement on separately approved real production content after a meaningful observation window.";
const RATIONALE = "The only live evidence is an HTTP 200 analytics response with zero rows for an immediate private canary. No performance metric was returned, so creative, audience, retention, engagement, platform, or content-quality conclusions are unsupported.";
const PROPOSAL_SUMMARY = "For a future separately approved production item, retain the canonical publication/analytics lineage and collect analytics after a meaningful measurement window; make no creative optimization or topic decision from this private canary.";
const INSUFFICIENT_REASON = "The video-specific YouTube Analytics response contained zero rows and no returned metrics during the immediate private-canary measurement window.";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

function invariant(condition, code) {
  if (!condition) throw new Error(code);
}

try {
  invariant(typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0, "DATABASE_URL_REQUIRED");
  const observationRows = await pool.query(`SELECT * FROM performance_observations WHERE observation_id=$1`, [OBSERVATION_ID]);
  invariant(observationRows.rowCount === 1, "OBSERVATION_MISSING");
  const observation = observationRows.rows[0];
  invariant(observation.project_id === PROJECT_ID && observation.content_id === CONTENT_ID && observation.workflow_id === WORKFLOW_ID, "OBSERVATION_RUNTIME_IDENTITY_MISMATCH");
  invariant(observation.artifact_id === FINAL_MEDIA_ARTIFACT_ID && observation.final_media_sha256 === FINAL_MEDIA_SHA256, "OBSERVATION_MEDIA_LINEAGE_MISMATCH");
  invariant(observation.published_report_id === PUBLISHED_REPORT_ID && observation.publication_id === YOUTUBE_VIDEO_ID, "OBSERVATION_PUBLICATION_LINEAGE_MISMATCH");
  invariant(observation.metric_provenance === "LIVE" && observation.transport_provenance === "LIVE", "OBSERVATION_NOT_LIVE");
  invariant(observation.experiment_id === CANARY_CLASSIFICATION, "CANARY_CLASSIFICATION_MISMATCH");
  invariant(observation.lineage_kind === "GOVERNED_RUN", "OBSERVATION_LINEAGE_KIND_INVALID");
  invariant(observation.metrics && typeof observation.metrics === "object" && !Array.isArray(observation.metrics) && Object.keys(observation.metrics).length === 0, "OBSERVATION_METRICS_NOT_EMPTY");

  const analyticsReportRows = await pool.query(`SELECT * FROM artifacts WHERE artifact_id=$1 AND kind='analytics_report' AND status='completed'`, [ANALYTICS_REPORT_ID]);
  invariant(analyticsReportRows.rowCount === 1, "ANALYTICS_REPORT_MISSING");
  const analyticsReport = analyticsReportRows.rows[0];
  invariant(analyticsReport.workflow_id === WORKFLOW_ID && analyticsReport.parent_artifact_id === PUBLISHED_REPORT_ID && analyticsReport.parent_artifact_kind === "published_report", "ANALYTICS_REPORT_LINEAGE_INVALID");
  invariant(analyticsReport.payload?.observationId === OBSERVATION_ID && analyticsReport.payload?.dataCompleteness === "EMPTY_VALID_PROVIDER_RESPONSE", "ANALYTICS_REPORT_EVIDENCE_INVALID");
  invariant(analyticsReport.payload?.excludedFromNormalProductionKpis === true && analyticsReport.payload?.canaryClassification === CANARY_CLASSIFICATION, "CANARY_KPI_EXCLUSION_MISSING");

  const publicationRows = await pool.query(`SELECT * FROM artifacts WHERE artifact_id=$1 AND kind='published_report' AND status='completed'`, [PUBLISHED_REPORT_ID]);
  invariant(publicationRows.rowCount === 1, "PUBLISHED_REPORT_MISSING");
  const publication = publicationRows.rows[0];
  invariant(publication.parent_artifact_id === FINAL_MEDIA_ARTIFACT_ID && publication.payload?.finalMediaArtifactId === FINAL_MEDIA_ARTIFACT_ID && publication.payload?.finalMediaSha256 === FINAL_MEDIA_SHA256, "FINAL_MEDIA_TO_PUBLICATION_LINEAGE_INVALID");
  invariant(publication.payload?.providerVideoId === YOUTUBE_VIDEO_ID && publication.payload?.visibility === "private", "PUBLICATION_EVIDENCE_INVALID");

  const priorLearning = await pool.query(`SELECT learning_id FROM learning_records WHERE project_id=$1 AND source_observation_ids @> $2::jsonb`, [PROJECT_ID, JSON.stringify([OBSERVATION_ID])]);
  invariant(priorLearning.rowCount === 0, "PHASE_7_LEARNING_ALREADY_EXISTS");
  const priorWorkflowCount = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_submissions`)).rows[0].count);

  const store = new LearningLoopStore(pool);
  const learningResult = await store.recordLearning({
    projectId: PROJECT_ID,
    observationIds: [OBSERVATION_ID],
    experimentId: CANARY_CLASSIFICATION,
    finding: FINDING,
    evidence: {
      ownerAuthorityRef: OWNER_AUTHORITY_REF,
      observationId: OBSERVATION_ID,
      analyticsReportArtifactId: ANALYTICS_REPORT_ID,
      publishedReportId: PUBLISHED_REPORT_ID,
      finalMediaArtifactId: FINAL_MEDIA_ARTIFACT_ID,
      finalMediaSha256: FINAL_MEDIA_SHA256,
      providerPublicationId: YOUTUBE_VIDEO_ID,
      providerResponseStatus: 200,
      providerRowsReturned: 0,
      measurementWindow: { start: observation.window_start, end: observation.window_end },
      observationSource: "LIVE",
      dataStatus: "EMPTY_VALID_PROVIDER_RESPONSE",
      learningType: "PROCESS_VALIDATION",
      processLearningStatus: "VALIDATED",
      contentPerformanceStatus: "INSUFFICIENT_DATA",
      insufficientDataReason: INSUFFICIENT_REASON,
      citedMetrics: [],
      metricsReturned: [],
      canaryClassification: CANARY_CLASSIFICATION,
      excludedFromNormalProductionKpis: true,
      conclusions: [
        "The private publication chain completed and its canonical analytics identity/join resolved.",
        "The provider returned a valid empty analytics response.",
        "Content performance cannot be evaluated from this observation.",
      ],
      unsupportedConclusionsProhibited: true,
    },
  });
  invariant(learningResult.created, "LEARNING_RECORD_NOT_CREATED");
  invariant(learningResult.learning.sourceObservationIds.length === 1 && learningResult.learning.sourceObservationIds[0] === OBSERVATION_ID, "LEARNING_OBSERVATION_BINDING_INVALID");

  const recommendationResult = await store.recommend({
    projectId: PROJECT_ID,
    learningId: learningResult.learning.learningId,
    proposal: RECOMMENDATION,
    rationale: RATIONALE,
    evidence: {
      learningId: learningResult.learning.learningId,
      observationId: OBSERVATION_ID,
      citedMetrics: [],
      evidenceRefs: [OBSERVATION_ID, ANALYTICS_REPORT_ID, PUBLISHED_REPORT_ID, FINAL_MEDIA_ARTIFACT_ID],
      recommendationStatus: "EVIDENCE_BOUND",
      contentPerformanceStatus: "INSUFFICIENT_DATA",
      canaryClassification: CANARY_CLASSIFICATION,
      excludedFromNormalProductionKpis: true,
      automaticAnalyticsFetchAuthorized: false,
      automaticExecutionAuthorized: false,
    },
  });
  invariant(recommendationResult.created && recommendationResult.recommendation.requiresOwnerDecision, "RECOMMENDATION_NOT_OWNER_GATED");

  const proposalResult = await store.proposeNextCycle({
    projectId: PROJECT_ID,
    recommendationId: recommendationResult.recommendation.recommendationId,
    summary: PROPOSAL_SUMMARY,
    approvalId: null,
  });
  invariant(proposalResult.created, "NEXT_CYCLE_PROPOSAL_NOT_CREATED");
  invariant(proposalResult.proposal.status === "AWAITS_OWNER_DECISION" && proposalResult.proposal.approvalId === null, "NEXT_CYCLE_OWNER_BOUNDARY_INVALID");

  const afterWorkflowCount = Number((await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_submissions`)).rows[0].count);
  invariant(afterWorkflowCount === priorWorkflowCount, "NEXT_CYCLE_EXECUTION_CREATED");
  const persisted = await pool.query(
    `SELECT l.learning_id,l.source_observation_ids,l.experiment_id,l.finding,l.evidence,l.validation_only,
            r.recommendation_id,r.learning_id AS recommendation_learning_id,r.proposal,r.rationale,r.evidence AS recommendation_evidence,r.requires_owner_decision,
            p.proposal_id,p.recommendation_id AS proposal_recommendation_id,p.summary,p.approval_id,p.status
       FROM learning_records l
       JOIN next_cycle_recommendations r ON r.learning_id=l.learning_id
       JOIN next_cycle_proposals p ON p.recommendation_id=r.recommendation_id
      WHERE l.learning_id=$1 AND r.recommendation_id=$2 AND p.proposal_id=$3`,
    [learningResult.learning.learningId, recommendationResult.recommendation.recommendationId, proposalResult.proposal.proposalId],
  );
  invariant(persisted.rowCount === 1, "LEARNING_CHAIN_NOT_DURABLE");
  const row = persisted.rows[0];
  invariant(Array.isArray(row.evidence?.citedMetrics) && row.evidence.citedMetrics.length === 0, "UNSUPPORTED_METRICS_CITED");
  invariant(Array.isArray(row.recommendation_evidence?.citedMetrics) && row.recommendation_evidence.citedMetrics.length === 0, "RECOMMENDATION_UNSUPPORTED_METRICS_CITED");
  invariant(row.experiment_id === CANARY_CLASSIFICATION && row.evidence?.excludedFromNormalProductionKpis === true && row.recommendation_evidence?.excludedFromNormalProductionKpis === true, "LEARNING_CANARY_EXCLUSION_LOST");

  const receiptPath = path.join(process.cwd(), "output", "program-04-live-canary", "phase-7", "phase-7-learning-receipt.json");
  await mkdir(path.dirname(receiptPath), { recursive: true });
  const receipt = {
    task: OWNER_AUTHORITY_REF,
    phase7Status: "PASS_LOCAL",
    observationId: OBSERVATION_ID,
    observationStatus: "EMPTY_VALID_PROVIDER_RESPONSE",
    observationRows: 0,
    observationMetricsReturned: [],
    learningRecordId: learningResult.learning.learningId,
    learningType: "PROCESS_VALIDATION",
    learningStatus: "INSUFFICIENT_DATA",
    contentPerformanceStatus: "INSUFFICIENT_DATA",
    processLearningStatus: "VALIDATED",
    insufficientDataReason: INSUFFICIENT_REASON,
    conclusions: learningResult.learning.evidence.conclusions,
    recommendations: [RECOMMENDATION],
    recommendationArtifactId: recommendationResult.recommendation.recommendationId,
    recommendationStatus: "EVIDENCE_BOUND",
    nextCycleProposalId: proposalResult.proposal.proposalId,
    nextCycleState: proposalResult.proposal.status,
    nextCycleExecuted: false,
    finalMediaToLearningLineage: "PASS",
    evidenceBindingValid: true,
    canaryClassification: CANARY_CLASSIFICATION,
    excludedFromNormalProductionKpis: true,
    unsupportedMetricsUsed: false,
    zeroFillPerformed: false,
    performanceConclusionFabricated: false,
    providerCalls: 0,
    analyticsCalls: 0,
    mediaCalls: 0,
    uploads: 0,
    llmCalls: 0,
    researchCalls: 0,
    databaseRowsCreated: 3,
  };
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ...receipt, receiptPath }, null, 2));
} finally {
  await pool.end();
}
