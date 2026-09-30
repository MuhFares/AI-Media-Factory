/**
 * Workflow submission / query HTTP handler (Phase 1).
 *
 * API surface:
 *   POST /workflows                              submit + enqueue (idempotent)
 *   GET  /workflows/{workflowId}                 status
 *   GET  /workflows/{workflowId}/artifacts       produced artifacts
 *   GET  /workflows/{workflowId}/lineage         artifacts with lineage links
 *   GET  /workflows/{workflowId}/executions      capability executions
 *
 * POST never executes the workflow synchronously — it validates the directive,
 * writes a durable, idempotent submission and enqueues a job for the worker.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, lstatSync } from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { PostgresPersistence, PostgresQueue, ControlPlaneStore, OwnerDecision, PostgresRevisionDispatcher, PostgresReviewResumeDispatcher, PostgresMediaResumeDispatcher, StrategicStore, StrategicEntityType, LifecycleStore, LearningLoopStore, ContentStore, SubjectStore, ChannelStore, AutomationStore, ModelIntelligenceStore, ModelBenchmarkRuntimeStore, ProductionModelRoutingStore, ProductionCallBudgetStore, OwnerAutonomyStore } from "@ai-media-factory/database";
import { ownerOnboarding, ownerRouting, ownerRoutingActivate, ownerBudgetSet, ownerNextCycleList, ownerNextCycleDecide, ownerAudit, ownerOperationMatrix, ownerHealth, ownerWorkerControl, ownerCredentialHealthList, ownerCredentialHealthVerify } from "./owner-autonomy-api.js";
import type { CredentialHealthVerifier } from "./owner-autonomy-api.js";
import {
  automationPolicyGet, automationPolicySet, automationStatus, automationOverview,
  automationJobsList, automationJobSchedule, automationJobCancel, automationEvents,
  automationAttentionList, automationAttentionResolve, automationBudgetsGet, automationBudgetSet,
  automationExplain, automationTick, automationTrigger, automationProposalEvaluate,
  automationProposalStart, automationMeasurementSchedule, automationLearningChain, automationRecover,
} from "./automation-api.js";
import { deriveContentStatus } from "@ai-media-factory/database";
import { ApprovalActionabilityStore } from "@ai-media-factory/database";
import { agentCatalog, catalogEntry, friendlyProvider, timeAgo } from "./agent-catalog.js";
import { buildAgentTaskProfiles, buildBenchmarkRoleProfiles, buildRoleCandidatePools, buildBenchmarkExecutionPlan, benchmarkDataset, executiveArchitecture, orchestratorArchitecture, routingProposals, costArchitecture, BENCHMARK_STATUS, structuredUtilityClassification } from "./model-routing-benchmark.js";
import { benchmarkFixtures, validateBenchmarkContracts, resolveFinalists, BENCHMARK_EVALUATOR_VERSION } from "./model-benchmark-contracts.js";
import {
  analyticsOverview, analyticsContent, analyticsContentDetail, analyticsCompare,
  analyticsExperiments, analyticsInsights, analyticsAvailability, analyticsAgentQuery,
  metricCatalog,
} from "./analytics-api.js";

/**
 * Slice 5 canonical command authority (server-side single source).
 * A command never grants production/publication/strategy authority.
 */
function commandAuthority(mode: string): {
  commandClass: "ANALYSIS" | "GOVERNED_WORK";
  label: string; will: string[]; willNot: string[]; externalEffects: string;
} {
  if (mode === "START_GOVERNED_TASK") {
    return {
      commandClass: "GOVERNED_WORK",
      label: "Governed workflow task",
      will: ["Start a governed workflow that advances between approval gates.", "Stop at any protected gate until you decide."],
      willNot: ["Approve production.", "Authorize publication.", "Make anything public.", "Change strategy or configuration."],
      externalEffects: "Depends on the task; research tasks may call the text provider, media tasks may call generation providers. Cost is UNKNOWN unless provider metadata says otherwise.",
    };
  }
  if (mode === "MULTI_AGENT_REVIEW") {
    return {
      commandClass: "ANALYSIS",
      label: "Multi-agent review",
      will: ["Run each selected agent independently and persist each output separately.", "Produce a separate governed synthesis of the independent outputs."],
      willNot: ["Approve production.", "Authorize publication.", "Make anything public.", "Change strategy or configuration.", "Fabricate agreement between agents."],
      externalEffects: "May call the configured text provider per agent; cost UNKNOWN unless provider metadata says otherwise.",
    };
  }
  return {
    commandClass: "ANALYSIS",
    label: "Single-agent analysis",
    will: ["Ask one agent to perform governed analysis and return a recorded result."],
    willNot: ["Approve production.", "Authorize publication.", "Make anything public.", "Change strategy or configuration."],
    externalEffects: "May call the configured text provider once; cost UNKNOWN unless provider metadata says otherwise.",
  };
}

/** Canonical selectable roster: registered agents only, no duplicates, no runtime components. */
function agentSelectorRoster(_deps: WorkflowApiDeps, res: ServerResponse): void {
  const roster = agentCatalog().filter((a) => a.registered).map((a) => ({ key: a.key, displayName: a.displayName, role: a.role }));
  sendJson(res, 200, { roster, count: roster.length });
}
import { directiveToWorkflowDefinition, withInitialProviderAuthorityGate, Orchestrator, type OrchestratorDirective } from "@ai-media-factory/orchestrator";

export interface WorkflowApiDeps {
  readonly persistence: PostgresPersistence;
  readonly queue: PostgresQueue;
  readonly control: ControlPlaneStore;
  /** Strategic Operating Layer V1 store (optional for legacy deployments). */
  readonly strategic?: StrategicStore;
  /** Slice 2 canonical lifecycle read model (optional for legacy deployments). */
  readonly lifecycle?: LifecycleStore;
  /** M2 governed learning loop (optional for legacy deployments). */
  readonly learning?: LearningLoopStore;
  /** Program 2 canonical content domain (optional for legacy deployments). */
  readonly content?: ContentStore;
  /** Program 3 subject/scene identity graph (optional for legacy deployments). */
  readonly subjects?: SubjectStore;
  /** Program 5 channel registry (optional for legacy deployments). */
  readonly channels?: ChannelStore;
  /** Program 6 governed automation (optional for legacy deployments). */
  readonly automation?: AutomationStore;
  readonly modelIntelligence?: ModelIntelligenceStore;
  readonly modelBenchmarkRuntime?: ModelBenchmarkRuntimeStore;
  readonly productionModelRouting?: ProductionModelRoutingStore;
  readonly productionCallBudgets?: ProductionCallBudgetStore;
  /** Program 5 canonical Owner product operations over existing authorities. */
  readonly ownerAutonomy?: OwnerAutonomyStore;
  readonly credentialHealthVerifier?: CredentialHealthVerifier;
  /** Slice 3 approval actionability (optional for legacy deployments). */
  readonly actionability?: ApprovalActionabilityStore;
  /** Revision Cycle V1 owner authorization surface (optional for legacy deployments). */
  readonly revisions?: PostgresRevisionDispatcher;
  /** Review-only technical resume owner authorization surface (optional for legacy deployments). */
  readonly reviewResumes?: PostgresReviewResumeDispatcher;
  /** Media technical resume owner authorization surface (optional for legacy deployments). */
  readonly mediaResumes?: PostgresMediaResumeDispatcher;
}

export interface SubmitBody {
  readonly directive?: unknown;
  readonly correlationId?: unknown;
  readonly brandId?: unknown;
  readonly idempotencyKey?: unknown;
  readonly commandContext?: unknown;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  // Owner UI must never serve stale control-plane truth from heuristic caches.
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Cache-Control": "no-store" });
  res.end(data);
}

/**
 * Program 1 Workstream B — server-side Owner authentication for mutating
 * control routes. Single shared Owner token (AMF_OWNER_TOKEN), constant-time
 * comparison, fail closed: unconfigured server denies mutations (503),
 * missing/invalid credentials denied (401). Read-only GETs stay open.
 * Designed for later RBAC extension (per-identity subjects) without change
 * to the enforcement points.
 */
function ownerToken(): string | null {
  const t = process.env.AMF_OWNER_TOKEN;
  return typeof t === "string" && t.trim() !== "" ? t : null;
}

function ownerAuthorized(req: IncomingMessage): boolean {
  const expected = ownerToken();
  if (!expected) return false;
  const header = req.headers.authorization;
  if (typeof header !== "string") return false;
  const m = /^Bearer (.+)$/.exec(header.trim());
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Returns true when the request may proceed; otherwise denies and returns false. */
function requireOwner(req: IncomingMessage, res: ServerResponse): boolean {
  if (ownerAuthorized(req)) return true;
  if (!ownerToken()) {
    sendJson(res, 503, { error: "owner authentication is not configured; set AMF_OWNER_TOKEN" });
    return false;
  }
  sendJson(res, 401, { error: "owner authentication required" });
  return false;
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw.length === 0 ? {} : JSON.parse(raw));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export function createWorkflowApiHandler(deps: WorkflowApiDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const orchestrator = new Orchestrator();

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      // Program 1 Workstream B: every state-changing request must carry Owner
      // authentication. Read-only GETs stay open for inspection surfaces.
      if ((method === "POST" || method === "PUT" || method === "DELETE" || method === "PATCH")
        && !requireOwner(req, res)) {
        return;
      }

      if (method === "POST" && path === "/workflows") {
        return await handleCreate(deps, orchestrator, req, res);
      }
      if (path === "/control/approvals" && method === "GET") return await listApprovals(deps, res, url);
      if (path === "/control/approvals" && method === "POST") return await createApproval(deps, req, res);
      const decisionMatch = path.match(/^\/control\/approvals\/([^/]+)\/decision$/);
      if (decisionMatch && method === "POST") return await decideApproval(deps, req, res, decodeURIComponent(decisionMatch[1]));
      if (path === "/control/commands" && method === "GET") return await listCommands(deps, res, url);
      if (path === "/control/commands" && method === "POST") return await dispatchCommand(deps, orchestrator, req, res);
      if (path === "/control/revisions" && method === "GET") return await listRevisions(deps, res, url);
      const revisionAuthorizeMatch = path.match(/^\/control\/revisions\/([^/]+)\/authorize$/);
      if (revisionAuthorizeMatch && method === "POST") return await authorizeRevision(deps, req, res, decodeURIComponent(revisionAuthorizeMatch[1]));
      const reviewResumeMatch = path.match(/^\/control\/revisions\/([^/]+)\/resume-review$/);
      if (reviewResumeMatch && method === "POST") return await authorizeReviewResume(deps, req, res, decodeURIComponent(reviewResumeMatch[1]));
      if (path === "/control/human-gates" && method === "GET") return await getHumanGates(deps, res, url);
      if (path === "/control/human-gates" && method === "POST") return await updateHumanGate(deps, req, res);
      if (path === "/control/human-gates/reset" && method === "POST") return await resetHumanGate(deps, req, res);
      if (path === "/control/human-gates/events" && method === "GET") return await listHumanGateEvents(deps, res, url);
      const mediaResumeEligibilityMatch = path.match(/^\/control\/media-resumes\/([^/]+)\/eligibility$/);
      if (mediaResumeEligibilityMatch && method === "GET") return await mediaResumeEligibility(deps, res, decodeURIComponent(mediaResumeEligibilityMatch[1]));
      const mediaResumeAuthorizeMatch = path.match(/^\/control\/media-resumes\/([^/]+)\/authorize$/);
      if (mediaResumeAuthorizeMatch && method === "POST") return await authorizeMediaResume(deps, req, res, decodeURIComponent(mediaResumeAuthorizeMatch[1]));
      const mediaResumeStateMatch = path.match(/^\/control\/media-resumes\/([^/]+)\/state$/);
      if (mediaResumeStateMatch && method === "GET") return await mediaResumeState(deps, res, decodeURIComponent(mediaResumeStateMatch[1]));
      if (path === "/control/providers" && method === "GET") return providerDiscovery(res);
      if (path === "/control/telemetry" && method === "GET") return await telemetry(deps, res, url);
      if (path === "/control/reports" && method === "GET") return await reports(deps, res, url);
      if (path === "/control/configuration" && method === "GET") return await effectiveConfiguration(deps, res, url);
      if (path === "/control/configuration" && method === "POST") return await updateConfiguration(deps, req, res);
      if (path === "/control/configuration/history" && method === "GET") return await configurationHistory(deps, res, url);
      if (path === "/control/configuration/map" && method === "GET") return await configurationMap(deps, res, url);
      if (path === "/control/projects" && method === "GET") return await listProjects(deps, res);
      if (path === "/control/workflows" && method === "GET") return await listWorkflows(deps, res, url);
      if (path === "/control/health" && method === "GET") return await platformHealth(deps, res);
      if (path === "/control/costs" && method === "GET") return await costSummary(deps, res, url);
      if (path === "/control/model-intelligence/summary" && method === "GET") return await modelIntelligenceSummary(deps, res);
      if (path === "/control/model-intelligence/models" && method === "GET") return await modelIntelligenceModels(deps, res, url);
      if (path === "/control/model-intelligence/shortlist" && method === "GET") return await modelIntelligenceShortlist(deps, res);
      if (path === "/control/model-intelligence/overview" && method === "GET") return await modelIntelligenceOverview(deps, res);
      if (path === "/control/model-intelligence/providers" && method === "GET") return await modelIntelligenceProviders(deps, res);
      if (path === "/control/model-intelligence/price-history" && method === "GET") return await modelIntelligencePriceHistory(deps, res, url);
      if (path === "/control/model-intelligence/routing" && method === "GET") return await modelIntelligenceRouting(deps, res);
      if (path === "/control/model-intelligence/roles" && method === "GET") return await modelIntelligenceRoles(deps, res);
      if (path === "/control/model-intelligence/candidates" && method === "GET") return await modelIntelligenceCandidates(deps, res);
      if (path === "/control/model-intelligence/benchmark-plan" && method === "GET") return await modelIntelligenceBenchmarkPlan(deps, res);
      if (path === "/control/model-intelligence/benchmark-runtime" && method === "GET") return await modelIntelligenceBenchmarkRuntime(deps, res);
      if (path === "/control/model-intelligence/blind-reviews" && method === "GET") return await modelIntelligenceBlindReviews(deps,res);
      if (path === "/control/model-intelligence/blind-reviews" && method === "POST") return await saveModelIntelligenceBlindReview(deps,req,res);
      if (path === "/control/model-intelligence/executive" && method === "GET") return modelIntelligenceExecutive(res);
      if (path === "/control/model-intelligence/cost" && method === "GET") return await modelIntelligenceCost(deps,res);
      if (path.startsWith("/control/model-intelligence/models/") && method === "GET") return await modelIntelligenceDetail(deps, res, decodeURIComponent(path.slice("/control/model-intelligence/models/".length)));
      if (path === "/control/artifacts" && method === "GET") return await projectArtifacts(deps, res, url);
      if (path === "/control/artifacts/preview" && method === "GET") return await artifactPreview(deps, req, res, url);
      if (path === "/control/publication-readiness" && method === "GET") return await publicationReadiness(deps, res, url);
      if (path === "/control/strategy/entities" && method === "GET") return await strategyEntities(deps, res, url);
      if (path === "/control/strategy/effective" && method === "GET") return await strategyEffective(deps, res, url);
      if (path === "/control/strategy/proposals" && method === "POST") return await strategyPropose(deps, req, res);
      if (path === "/control/strategy/activations" && method === "POST") return await strategyActivate(deps, req, res);
      if (path === "/control/strategy/preview" && method === "GET") return await strategyPreview(deps, res, url);
      const strategySnapshotMatch = path.match(/^\/control\/strategy\/snapshots\/([^/]+)$/);
      if (strategySnapshotMatch && method === "GET") return await strategySnapshot(deps, res, decodeURIComponent(strategySnapshotMatch[1]));
      const strategyLineageMatch = path.match(/^\/control\/strategy\/lineage\/([^/]+)$/);
      if (strategyLineageMatch && method === "GET") return await strategyLineage(deps, res, decodeURIComponent(strategyLineageMatch[1]));
      if (path === "/control/strategy/artifact-lineage" && method === "GET") return await strategyArtifactLineage(deps, res, url);
      if (path === "/control/strategy/review" && method === "GET") return await strategyReview(deps, res, url);
      if (path === "/control/decision-queue" && method === "GET") return await decisionQueue(deps, res, url);
      const approvalActionMatch = path.match(/^\/control\/approvals\/([^/]+)\/actionability$/);
      if (approvalActionMatch && method === "GET") return await approvalActionability(deps, res, decodeURIComponent(approvalActionMatch[1]));
      if (path === "/control/agents" && method === "GET") return await agentRoster(deps, res, url);
      if (path === "/control/agents/roster" && method === "GET") return await agentSelectorRoster(deps, res);
      const commandDetailMatch = path.match(/^\/control\/commands\/([^/]+)$/);
      if (commandDetailMatch && method === "GET") return await commandDetail(deps, res, url, decodeURIComponent(commandDetailMatch[1]));
      if (path === "/control/configuration/options" && method === "GET") return await configurationOptions(deps, res);
      if (path === "/control/lifecycle" && method === "GET") return await lifecycleList(deps, res, url);
      if (path === "/control/learning/summary" && method === "GET") return await learningSummary(deps, res, url);
      if (path === "/control/content" && method === "GET") return await contentList(deps, res, url);
      if (path === "/control/content" && method === "POST") return await contentCreate(deps, req, res);
      const contentBriefMatch = path.match(/^\/control\/content\/([^/]+)\/brief$/);
      if (contentBriefMatch && method === "POST") return await contentBriefUpdate(deps, req, res, decodeURIComponent(contentBriefMatch[1]));
      const contentStartMatch = path.match(/^\/control\/content\/([^/]+)\/start-production$/);
      if (contentStartMatch && method === "POST") return await contentStartProduction(deps, req, res, decodeURIComponent(contentStartMatch[1]));
      const contentRevisionMatch = path.match(/^\/control\/content\/([^/]+)\/revisions$/);
      if (contentRevisionMatch && method === "POST") return await contentRevisionCreate(deps, req, res, decodeURIComponent(contentRevisionMatch[1]));
      const contentVisualReviewMatch = path.match(/^\/control\/content\/([^/]+)\/visual-reviews$/);
      if (contentVisualReviewMatch && method === "POST") return await contentVisualReview(deps, req, res, decodeURIComponent(contentVisualReviewMatch[1]));
      const contentFinalApprovalMatch = path.match(/^\/control\/content\/([^/]+)\/final-approval$/);
      if (contentFinalApprovalMatch && method === "POST") return await contentFinalApproval(deps, req, res, decodeURIComponent(contentFinalApprovalMatch[1]));
      const contentMetadataMatch = path.match(/^\/control\/content\/([^/]+)\/metadata$/);
      if (contentMetadataMatch && method === "POST") return await contentMetadataUpdate(deps, req, res, decodeURIComponent(contentMetadataMatch[1]));
      const contentPublicationMatch = path.match(/^\/control\/content\/([^/]+)\/publication-preparations$/);
      if (contentPublicationMatch && method === "POST") return await contentPublicationPrepare(deps, req, res, decodeURIComponent(contentPublicationMatch[1]));
      const contentPreflightMatch = path.match(/^\/control\/content\/([^/]+)\/preflight$/);
      if (contentPreflightMatch && method === "GET") return await contentPreflight(deps, res, decodeURIComponent(contentPreflightMatch[1]));
      const contentLinkMatch = path.match(/^\/control\/content\/([^/]+)\/link$/);
      if (contentLinkMatch && method === "POST") return await contentLink(deps, req, res, decodeURIComponent(contentLinkMatch[1]));
      const contentMatch = path.match(/^\/control\/content\/([^/]+)$/);
      if (contentMatch && method === "GET") return await contentDetail(deps, res, url, decodeURIComponent(contentMatch[1]));
      if (path === "/control/subjects" && method === "GET") return await subjectList(deps, res, url);
      if (path === "/control/subjects" && method === "POST") return await subjectCreate(deps, req, res);
      const subjectApproveMatch = path.match(/^\/control\/subjects\/([^/]+)\/approve$/);
      if (subjectApproveMatch && method === "POST") return await subjectApprove(deps, req, res, decodeURIComponent(subjectApproveMatch[1]));
      const subjectRefMatch = path.match(/^\/control\/subjects\/([^/]+)\/references$/);
      if (subjectRefMatch && method === "GET") return await subjectReferences(deps, res, url, decodeURIComponent(subjectRefMatch[1]));
      if (subjectRefMatch && method === "POST") return await subjectAttachReference(deps, req, res, decodeURIComponent(subjectRefMatch[1]));
      if (path === "/control/scenes" && method === "GET") return await sceneList(deps, res, url);
      if (path === "/control/scenes" && method === "POST") return await sceneSave(deps, req, res);
      if (path === "/control/analytics/overview" && method === "GET") return await analyticsOverviewRoute(deps, res, url);
      if (path === "/control/analytics/content" && method === "GET") return await analyticsContentRoute(deps, res, url);
      const analyticsContentMatch = path.match(/^\/control\/analytics\/content\/([^/]+)$/);
      if (analyticsContentMatch && method === "GET") return await analyticsContentDetailRoute(deps, res, url, decodeURIComponent(analyticsContentMatch[1]));
      if (path === "/control/analytics/comparisons" && method === "GET") return await analyticsComparisonsRoute(deps, res, url);
      if (path === "/control/analytics/experiments" && method === "GET") return await analyticsExperimentsRoute(deps, res, url);
      if (path === "/control/analytics/insights" && method === "GET") return await analyticsInsightsRoute(deps, res, url);
      if (path === "/control/analytics/availability" && method === "GET") return await analyticsAvailabilityRoute(deps, res, url);
      if (path === "/control/analytics/agent-query" && method === "GET") return await analyticsAgentQueryRoute(deps, res, url);
      if (path === "/control/projects" && method === "POST") return await projectCreate(deps, req, res);
      if (path === "/control/channels" && method === "GET") return await channelList(deps, res, url);
      if (path === "/control/channels" && method === "POST") return await channelCreate(deps, req, res);
      const channelMatch = path.match(/^\/control\/channels\/([^/]+)$/);
      if (channelMatch && method === "GET") return await channelDetail(deps, res, url, decodeURIComponent(channelMatch[1]));
      const channelVerifyMatch = path.match(/^\/control\/channels\/([^/]+)\/verify$/);
      if (channelVerifyMatch && method === "POST") return await channelVerify(deps, req, res, decodeURIComponent(channelVerifyMatch[1]));
      const channelBindMatch = path.match(/^\/control\/channels\/([^/]+)\/bindings$/);
      if (channelBindMatch && method === "POST") return await channelBind(deps, req, res, decodeURIComponent(channelBindMatch[1]));
      const bindingRevokeMatch = path.match(/^\/control\/bindings\/([^/]+)\/revoke$/);
      if (bindingRevokeMatch && method === "POST") return await bindingRevoke(deps, req, res, decodeURIComponent(bindingRevokeMatch[1]));
      if (path === "/control/publishing/route" && method === "GET") return await publishingRouteCheck(deps, res, url);
      // Program 6 governed automation (read-only GETs open; POSTs Owner-gated globally).
      if (path === "/control/automation/policy" && method === "GET") return await automationPolicyGet(deps, res, url);
      if (path === "/control/automation/policy" && method === "POST") return await automationPolicySet(deps, req, res);
      if (path === "/control/automation/status" && method === "GET") return await automationStatus(deps, res, url);
      if (path === "/control/automation/overview" && method === "GET") return await automationOverview(deps, res);
      if (path === "/control/automation/jobs" && method === "GET") return await automationJobsList(deps, res, url);
      if (path === "/control/automation/jobs" && method === "POST") return await automationJobSchedule(deps, req, res);
      const automationCancelMatch = path.match(/^\/control\/automation\/jobs\/([^/]+)\/cancel$/);
      if (automationCancelMatch && method === "POST") return await automationJobCancel(deps, req, res, decodeURIComponent(automationCancelMatch[1]));
      if (path === "/control/automation/events" && method === "GET") return await automationEvents(deps, res, url);
      if (path === "/control/automation/attention" && method === "GET") return await automationAttentionList(deps, res, url);
      const automationResolveMatch = path.match(/^\/control\/automation\/attention\/([^/]+)\/resolve$/);
      if (automationResolveMatch && method === "POST") return await automationAttentionResolve(deps, req, res, decodeURIComponent(automationResolveMatch[1]));
      if (path === "/control/automation/budgets" && method === "GET") return await automationBudgetsGet(deps, res, url);
      if (path === "/control/automation/budgets" && method === "POST") return await automationBudgetSet(deps, req, res);
      if (path === "/control/automation/explain" && method === "POST") return await automationExplain(deps, req, res);
      if (path === "/control/automation/tick" && method === "POST") return await automationTick(deps, req, res);
      if (path === "/control/automation/triggers" && method === "POST") return await automationTrigger(deps, req, res);
      const automationEvalMatch = path.match(/^\/control\/automation\/proposals\/([^/]+)\/evaluate$/);
      if (automationEvalMatch && method === "GET") return await automationProposalEvaluate(deps, res, decodeURIComponent(automationEvalMatch[1]));
      const automationStartMatch = path.match(/^\/control\/automation\/proposals\/([^/]+)\/start$/);
      if (automationStartMatch && method === "POST") return await automationProposalStart(deps, req, res, decodeURIComponent(automationStartMatch[1]));
      if (path === "/control/automation/analytics/measurements" && method === "POST") return await automationMeasurementSchedule(deps, req, res);
      if (path === "/control/automation/learning/chain" && method === "POST") return await automationLearningChain(deps, req, res);
      if (path === "/control/automation/recover" && method === "POST") return await automationRecover(deps, req, res);
      if (path === "/control/owner/onboarding" && method === "GET") return await ownerOnboarding(deps, res, url);
      if (path === "/control/owner/routing" && method === "GET") return await ownerRouting(deps, res, url);
      if (path === "/control/owner/routing/activate" && method === "POST") return await ownerRoutingActivate(deps, req, res);
      if (path === "/control/owner/budgets" && method === "POST") return await ownerBudgetSet(deps, req, res);
      if (path === "/control/owner/next-cycle" && method === "GET") return await ownerNextCycleList(deps, res, url);
      const ownerNextCycleMatch = path.match(/^\/control\/owner\/next-cycle\/([^/]+)\/decision$/);
      if (ownerNextCycleMatch && method === "POST") return await ownerNextCycleDecide(deps, req, res, decodeURIComponent(ownerNextCycleMatch[1]));
      if (path === "/control/owner/audit" && method === "GET") return await ownerAudit(deps, res, url);
      if (path === "/control/owner/operation-matrix" && method === "GET") return await ownerOperationMatrix(deps, res);
      if (path === "/control/owner/credential-health" && method === "GET") return await ownerCredentialHealthList(deps,res,url);
      const credentialHealthMatch=path.match(/^\/control\/owner\/credentials\/([^/]+)\/verify$/);
      if(credentialHealthMatch&&method==="POST")return await ownerCredentialHealthVerify(deps,req,res,decodeURIComponent(credentialHealthMatch[1]));
      if (path === "/control/owner/health" && method === "GET") return await ownerHealth(deps, res, url);
      if (path === "/control/owner/worker" && method === "POST") return await ownerWorkerControl(deps, req, res);
      const lifecycleMatch = path.match(/^\/control\/lifecycle\/([^/]+)$/);
      if (lifecycleMatch && method === "GET") return await lifecycleDetail(deps, res, decodeURIComponent(lifecycleMatch[1]));

      const match = path.match(/^\/workflows\/([^/]+)(\/[a-z]+)?$/);
      if (match !== null && method === "GET") {
        const workflowId = decodeURIComponent(match[1]);
        const sub = match[2] ?? "";
        if (sub === "") return await handleStatus(deps, res, workflowId);
        if (sub === "/artifacts") return await handleList(deps, res, workflowId, "artifacts");
        if (sub === "/lineage") return await handleList(deps, res, workflowId, "lineage");
        if (sub === "/executions") return await handleList(deps, res, workflowId, "executions");
      }

      sendJson(res, 404, { error: "not found" });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  };
}

async function handleCreate(
  deps: WorkflowApiDeps,
  orchestrator: Orchestrator,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const body = (await readBody(req)) as SubmitBody;

  if (typeof body.directive !== "string" || body.directive === "") {
    sendJson(res, 400, { error: "directive is required" });
    return;
  }
  // Validate directive through the Orchestrator (rejects unknown directives).
  try {
    orchestrator.stub(body.directive as never);
  } catch {
    sendJson(res, 400, { error: `unsupported directive: ${body.directive}` });
    return;
  }

  const correlationId =
    typeof body.correlationId === "string" && body.correlationId !== "" ? body.correlationId : generateId("corr");
  // Program 5: every governed execution needs unambiguous project context.
  // Projectless submissions are rejected fail-closed (no silent global bucket).
  const brandId = typeof body.brandId === "string" && body.brandId.trim() !== "" ? body.brandId.trim() : null;
  if (!brandId) {
    sendJson(res, 400, { error: "brandId (project) is required" });
    return;
  }
  const idempotencyKey =
    typeof body.idempotencyKey === "string" && body.idempotencyKey !== "" ? body.idempotencyKey : null;
  const submissionKey = idempotencyKey ?? `directive:${body.directive}:${correlationId}`;
  const workflowId = generateId("wf");

  const definition = directiveToWorkflowDefinition(body.directive as never);

  const { created } = await deps.queue.submit({
    submissionKey,
    workflowId,
    directive: body.directive,
    correlationId,
    brandId,
    definition,
    commandContext: isObject(body.commandContext) ? body.commandContext : undefined,
    status: "submitted",
  });

  if (created) {
    await deps.queue.enqueue(workflowId, submissionKey);
    sendJson(res, 201, { workflowId, correlationId, brandId, directive: body.directive, status: "queued", idempotencyKey: submissionKey });
    return;
  }

  // Duplicate submission identity → return the existing workflow (no duplicate).
  const existing = await deps.queue.loadSubmissionByKey(submissionKey);
  sendJson(res, 200, {
    workflowId: existing?.workflowId ?? workflowId,
    correlationId,
    brandId,
    directive: body.directive,
    status: "already_submitted",
    idempotencyKey: submissionKey,
  });
}

function isObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asText(value: unknown, max = 4000): string | null {
  return typeof value === "string" && value.trim() !== "" && value.length <= max ? value.trim() : null;
}

/** Derive owner-visible authority from target_type/target_id. Decision != authority. */
function approvalAuthority(targetType: string, targetId: string): { scope: string; authority: string; risk: "LOW" | "MEDIUM" | "HIGH"; confirm: string } {
  const t = `${targetType} ${targetId}`.toLowerCase();
  if (t.includes("publication_integration_validation")) return { scope: "PUBLICATION_INTEGRATION_VALIDATION", authority: "VALIDATION-ONLY CONTINUATION — does NOT authorize production or public publish", risk: "MEDIUM", confirm: "This approves validation continuation only. It does not authorize production approval or public publishing." };
  if (t.includes("public_publish") || t.includes("publisher_authorization") || (t.includes("published") && !t.includes("integration_validation"))) return { scope: "PUBLIC_PUBLISH", authority: "AUTHORIZES EXTERNAL PUBLIC PUBLICATION", risk: "HIGH", confirm: "HIGH RISK: this would authorize external public publication. Do not approve unless explicitly authorized." };
  if (t.includes("strategy_activation") || /_(strategy|brand|content_system|objectives|principles|constraints|experiment|decision|learning_memory)_activation/.test(t)) return { scope: "STRATEGY_ACTIVATION", authority: "AUTHORIZES STRATEGIC ACTIVATION — changes future effective strategic context only, never rewrites historical executions", risk: "MEDIUM", confirm: "This activates a strategic version for future context resolution. Historical executions keep their frozen snapshots. It does not start any workflow." };
  if (t.includes("workflow_gate") || t.includes("visual-human-gate") || t.includes("pre-production") || t.includes("pre_production")) return { scope: "WORKFLOW_GATE", authority: "AUTHORIZES WORKFLOW CONTINUATION PAST THIS GATE ONLY", risk: "LOW", confirm: "This releases the workflow past this gate only. No production or publication authority is granted." };
  if (t.includes("production_approval") || t.includes("production-approved") || (t.includes("production") && !t.includes("pre-production"))) return { scope: "PRODUCTION", authority: "AUTHORIZES PRODUCTION-QUALITY USE — not public publish", risk: "MEDIUM", confirm: "This authorizes production use only. It does not authorize public publishing." };
  return { scope: "ARTIFACT_DECISION", authority: "RECORDS OWNER DECISION ON THIS TARGET ONLY — no wider authority", risk: "LOW", confirm: "This records a decision on this target only. No production or publication authority is granted." };
}

function withAuthority(a: Record<string, unknown>): Record<string, unknown> {
  const auth = approvalAuthority(String((a as Record<string, unknown>).targetType ?? ""), String((a as Record<string, unknown>).targetId ?? ""));
  return { ...a, authorityScope: auth.scope, authorityMeaning: auth.authority, risk: auth.risk, confirmCopy: auth.confirm };
}

async function listApprovals(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const approvals = await deps.control.listApprovals(projectId);
  let actionById = new Map<string, { state: string; reason: string }>();
  if (deps.actionability) {
    try {
      const rows = await deps.actionability.projectActionability(projectId);
      actionById = new Map(rows.map((r) => [r.approvalId, { state: r.state, reason: r.reason }]));
    } catch {
      actionById = new Map();
    }
  }
  sendJson(res, 200, {
    approvals: approvals.map((a) => {
      const base = withAuthority(a as unknown as Record<string, unknown>);
      const act = actionById.get(a.approvalId);
      return {
        ...base,
        business: approvalBusiness(a.targetType, a.targetId),
        actionability: act?.state ?? (a.status === "DECIDED" ? "DECIDED" : "ACTION_REQUIRED"),
        actionabilityReason: act?.reason ?? "Actionability service unavailable; failing toward attention.",
      };
    }),
  });
}

async function createApproval(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200); const targetType = asText(body.targetType, 100); const targetId = asText(body.targetId, 500);
  if (!projectId || !targetType || !targetId || body.agentRecommendation === undefined) return sendJson(res, 400, { error: "projectId, targetType, targetId and agentRecommendation are required" });
  const record = await deps.control.createApproval({ approvalId: generateId("approval"), projectId, targetType, targetId, agentRecommendation: body.agentRecommendation, agentConfidence: asText(body.agentConfidence, 100), evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs : [], status: "AWAITING_OWNER", supersedes: asText(body.supersedes, 500), supersededBy: null, createdAt: new Date().toISOString() });
  sendJson(res, 201, { approval: withAuthority(record as unknown as Record<string, unknown>) });
}

async function decideApproval(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, approvalId: string): Promise<void> {
  const body = await readBody(req) as Record<string, unknown>; const action = asText(body.action, 40); const rationale = asText(body.rationale, 2000);
  const supported = new Set<OwnerDecision>(["APPROVE", "MODIFY", "REJECT", "REQUEST_ITERATION", "OVERRIDE"]);
  if (!action || !rationale || !supported.has(action as OwnerDecision)) return sendJson(res, 400, { error: "valid action and rationale are required" });
  const validationAcceptance = body.validationAcceptance === true ? true : undefined;
  let approval;
  try {
    approval = await deps.control.decideApproval(approvalId, action as OwnerDecision, rationale, validationAcceptance === true ? { validationAcceptance: true } : undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/VALIDATION_ACCEPTANCE_(REQUIRES_APPROVE|SCOPE_MISMATCH)/.test(message)) return sendJson(res, 409, { error: message });
    throw error;
  }
  if (!approval) return sendJson(res, 404, { error: "approval not found" });
  sendJson(res, 200, { approval: withAuthority(approval as unknown as Record<string, unknown>) });
}

function withCommandAuthority(command: Record<string, unknown>): Record<string, unknown> {
  const mode = String(command.mode ?? command.taskClassification ?? "ASK_AGENT");
  const authority = commandAuthority(mode);
  const results = Array.isArray(command.visibleResult) ? command.visibleResult as Array<Record<string, unknown>> : [];
  const partialFailure = results.length > 0 && results.some((r) => r.status !== "COMPLETED");
  return { ...command, authority, partialFailure };
}

async function listCommands(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId"); if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const commands = await deps.control.listCommands(projectId);
  sendJson(res, 200, { commands: commands.map((c) => withCommandAuthority(c as unknown as Record<string, unknown>)) });
}

async function commandDetail(deps: WorkflowApiDeps, res: ServerResponse, url: URL, commandId: string): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const commands = await deps.control.listCommands(projectId);
  const found = commands.find((c) => String((c as unknown as Record<string, unknown>).command_id ?? "") === commandId) ?? null;
  if (!found) return sendJson(res, 404, { error: "command not found" });
  sendJson(res, 200, { command: withCommandAuthority(found as unknown as Record<string, unknown>) });
}

/** Revision Cycle V1: list durable revision tasks (owner-action visibility). */
async function listRevisions(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId"); if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, { revisions: await deps.control.listReviewRevisionTasks(projectId) });
}

/** Revision Cycle V1: explicit owner AUTHORIZE_REVISION (durable, idempotent, exactly-once dispatch). */
async function authorizeRevision(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, taskId: string): Promise<void> {
  if (!deps.revisions) return sendJson(res, 503, { error: "revision dispatcher is not configured" });
  const body = await readBody(req) as Record<string, unknown>;
  const rationale = asText(body.rationale);
  const authorizedBy = asText(body.authorizedBy, 200) ?? "owner";
  if (!rationale) return sendJson(res, 400, { error: "rationale is required" });
  try {
    const result = await deps.revisions.authorizeAndDispatch({ taskId, authorizedBy, rationale });
    sendJson(res, 200, { created: result.created, dispatchId: result.dispatchId, revisionVersion: result.revisionVersion, jobId: result.jobId, task: result.task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, /NOT_FOUND|REQUIRED/.test(message) ? 404 : 409, { error: message });
  }
}

/** REVIEW_ONLY_TECHNICAL_RESUME: explicit owner AUTHORIZE_REVIEW_RESUME (durable, idempotent, frozen input package). */
async function authorizeReviewResume(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, taskId: string): Promise<void> {
  if (!deps.reviewResumes) return sendJson(res, 503, { error: "review resume dispatcher is not configured" });
  const body = await readBody(req) as Record<string, unknown>;
  const rationale = asText(body.rationale);
  const authorizedBy = asText(body.authorizedBy, 200) ?? "owner";
  if (!rationale) return sendJson(res, 400, { error: "rationale is required" });
  try {
    const result = await deps.reviewResumes.authorizeAndDispatch({ taskId, authorizedBy, rationale });
    sendJson(res, 200, {
      created: result.created, resumeId: result.resumeId, revisionVersion: result.revisionVersion, resumeAttempt: result.resumeAttempt,
      failedReviewExecutionId: result.failedReviewExecutionId,
      frozenWriterArtifactId: result.frozenWriterArtifactId, frozenSeoArtifactId: result.frozenSeoArtifactId, frozenBrandArtifactId: result.frozenBrandArtifactId,
      jobId: result.jobId, task: result.task,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, /NOT_FOUND|REQUIRED/.test(message) ? 404 : /NOT_ELIGIBLE|FROZEN|INVALID|RESOLUTION/.test(message) ? 409 : 500, { error: message });
  }
}

/** Human-gate governance: effective settings view for the Control Platform. */
async function getHumanGates(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const [view, policy] = await Promise.all([
    deps.control.humanGateSettingsView(projectId),
    deps.control.effectiveHumanGatePolicy(projectId),
  ]);
  sendJson(res, 200, { projectId, gates: view.gates, policy, auditNote: "Changing a gate affects future routing decisions only; existing pending approvals are never released automatically." });
}

/** Human-gate governance: owner-authorized project/global setting change (audited). */
async function updateHumanGate(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const gateKey = asText(body.gateKey, 40);
  const rationale = asText(body.rationale);
  const changedBy = asText(body.changedBy, 200) ?? "owner";
  const enabled = body.enabled === true || body.enabled === "true";
  if (!projectId || !gateKey || !rationale) return sendJson(res, 400, { error: "projectId, gateKey and rationale are required" });
  if (!["pre_production", "visual"].includes(gateKey)) return sendJson(res, 400, { error: "gateKey must be pre_production or visual" });
  try {
    const event = await deps.control.setHumanGateSetting({
      gateKey: gateKey as "pre_production" | "visual", scopeType: "PROJECT", scopeId: projectId,
      enabled, changedBy, rationale, correlationId: asText(body.correlationId, 200),
    });
    const view = await deps.control.humanGateSettingsView(projectId);
    sendJson(res, 200, { event, gates: view.gates });
  } catch (error) {
    sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Human-gate governance: reset a project override so it inherits again (audited). */
async function resetHumanGate(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const gateKey = asText(body.gateKey, 40);
  const rationale = asText(body.rationale);
  const changedBy = asText(body.changedBy, 200) ?? "owner";
  if (!projectId || !gateKey || !rationale) return sendJson(res, 400, { error: "projectId, gateKey and rationale are required" });
  if (!["pre_production", "visual"].includes(gateKey)) return sendJson(res, 400, { error: "gateKey must be pre_production or visual" });
  const event = await deps.control.resetHumanGateSetting({
    gateKey: gateKey as "pre_production" | "visual", scopeType: "PROJECT", scopeId: projectId,
    changedBy, rationale, correlationId: asText(body.correlationId, 200),
  });
  const view = await deps.control.humanGateSettingsView(projectId);
  sendJson(res, 200, { event, gates: view.gates });
}

/** Human-gate governance: durable audit trail. */
async function listHumanGateEvents(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, { events: await deps.control.listHumanGateConfigurationEvents(projectId) });
}

/** Media Technical Resume V1: read-only eligibility inspection for the owner. */
async function mediaResumeEligibility(deps: WorkflowApiDeps, res: ServerResponse, workflowId: string): Promise<void> {
  if (!deps.mediaResumes) return sendJson(res, 503, { error: "media resume dispatcher is not configured" });
  try {
    const eligibility = await deps.mediaResumes.eligibility({ workflowId });
    // MEDIA CAPABILITY PREFLIGHT V1: the provider-free readiness result is
    // surfaced with the eligibility view (safe diagnostics only).
    let preflight: ReturnType<PostgresMediaResumeDispatcher["preflight"]> | { pass: false; failureCodes: string[] };
    try {
      preflight = deps.mediaResumes.preflight();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      preflight = { pass: false, failureCodes: message.replace(/^MEDIA_CAPABILITY_PREFLIGHT_FAILED:/, "").split(",").filter(Boolean) };
    }
    sendJson(res, 200, {
      eligible: eligibility.eligible, reason: eligibility.reason ?? null,
      workflowId, workflowState: eligibility.workflowState ?? null,
      failureClassification: eligibility.failureClassification ?? null,
      resumeStartStage: "tts",
      preservedDirector: eligibility.directorArtifactId ?? null,
      scenes: eligibility.directorSceneIds?.length ?? 0,
      maxProviderSubmissions: eligibility.providerBudget ?? null,
      stopsAt: "Visual Human Approval", publishingAuthorized: false,
      frozenPackage: eligibility.frozenPackage ?? null,
      gatePolicySnapshot: eligibility.gatePolicySnapshot ?? null,
      mediaCapabilityPreflight: preflight,
    });
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Media Technical Resume V1: explicit owner AUTHORIZE_MEDIA_RESUME (durable, idempotent, frozen package). */
async function authorizeMediaResume(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, workflowId: string): Promise<void> {
  if (!deps.mediaResumes) return sendJson(res, 503, { error: "media resume dispatcher is not configured" });
  const body = await readBody(req) as Record<string, unknown>;
  const rationale = asText(body.rationale);
  const authorizedBy = asText(body.authorizedBy, 200) ?? "owner";
  if (!rationale) return sendJson(res, 400, { error: "rationale is required" });
  try {
    const result = await deps.mediaResumes.authorizeAndDispatch({ workflowId, authorizedBy, rationale });
    sendJson(res, 200, {
      created: result.created, resumeId: result.resumeId, resumeAttempt: result.resumeAttempt,
      resumeStartStage: result.resumeStartStage, jobId: result.jobId, maxProviderSubmissions: result.providerBudget,
      preservedDirector: result.frozenPackage?.directorArtifactId ?? null,
      scenes: result.frozenPackage?.directorSceneIds?.length ?? 0,
      stopsAt: "Visual Human Approval", publishingAuthorized: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, /NOT_ELIGIBLE|INVALID|MISSING|DRIFT|EXISTS|ALREADY|PREFLIGHT/.test(message) ? 409 : 500, { error: message });
  }
}

/** Media Technical Resume V1: durable resume state + provider-usage accounting. */
async function mediaResumeState(deps: WorkflowApiDeps, res: ServerResponse, workflowId: string): Promise<void> {
  if (!deps.mediaResumes) return sendJson(res, 503, { error: "media resume dispatcher is not configured" });
  sendJson(res, 200, await deps.mediaResumes.state(workflowId));
}

async function dispatchCommand(deps: WorkflowApiDeps, orchestrator: Orchestrator, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200); const message = asText(body.message); const mode = asText(body.mode, 30) ?? "MULTI_AGENT_REVIEW";
  const directive = asText(body.directive, 30) ?? "research"; const selectedAgents = Array.isArray(body.selectedAgents) ? body.selectedAgents.filter((a): a is string => typeof a === "string") : [];
  const legacyModes: Record<string, "ASK_AGENT" | "MULTI_AGENT_REVIEW" | "START_GOVERNED_TASK"> = { ASK: "ASK_AGENT", ANALYZE: "MULTI_AGENT_REVIEW", ASSIGN_TASK: "START_GOVERNED_TASK" };
  const commandType = mode === "ANALYZE" && selectedAgents.length === 1 ? "ASK_AGENT" : legacyModes[mode] ?? mode;
  if (!projectId || !message || selectedAgents.length === 0 || !["ASK_AGENT", "MULTI_AGENT_REVIEW", "START_GOVERNED_TASK"].includes(commandType)) return sendJson(res, 400, { error: "projectId, message, mode and selectedAgents are required" });
  if (commandType === "MULTI_AGENT_REVIEW" && selectedAgents.length < 2) return sendJson(res, 400, { error: "MULTI_AGENT_REVIEW requires at least two selected agents; use ASK_AGENT for one agent" });
  const registered = new Set(agentCatalog().filter((a) => a.registered).map((a) => a.key));
  const unknown = selectedAgents.find((a) => !registered.has(a));
  if (unknown) return sendJson(res, 400, { error: `unknown agent: ${unknown}. Select only registered AI team members.` });
  try { orchestrator.stub(directive as OrchestratorDirective); } catch { return sendJson(res, 400, { error: "directive is not a governed workflow type" }); }
  const correlationId = generateId("corr"); const workflowId = generateId("wf"); const commandId = generateId("command");
  const context = isObject(body.context) ? body.context : {};
  const definition = directiveToWorkflowDefinition(directive as OrchestratorDirective);
  await deps.queue.submit({ submissionKey: `command:${commandId}`, workflowId, directive, correlationId, brandId: projectId, definition, commandContext: { ownerMessage: message, commandId, selectedAgents, commandType, commandContext: context } });
  await deps.queue.enqueue(workflowId, `command:${commandId}`);
  await deps.control.saveCommand({ commandId, projectId, mode: commandType, ownerMessage: message, selectedAgents, context, taskClassification: commandType, workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  sendJson(res, 201, { commandId, workflowId, status: "QUEUED", authority: commandAuthority(commandType), disclosure: commandType === "START_GOVERNED_TASK" ? "Submitted to the canonical governed workflow." : "Submitted to the governed selected-agent runtime." });
}

function providerDiscovery(res: ServerResponse): void {
  // Deliberately return capability facts and configuration presence only. No
  // credential, endpoint secret, or provider header enters this response.
  const configured = Boolean(process.env.OPENROUTER_API_KEY);
  const model = configured ? process.env.OPENROUTER_DEFAULT_MODEL ?? null : null;
  sendJson(res, 200, { providers: [{ provider: "openrouter", protocol: "https", runtime: "governed-llm", configured, availability: configured ? "configured" : "unconfigured", health: "unknown", defaultModel: model, costMetadataAvailable: configured, contextCapability: "structured-output" }] });
}

async function telemetry(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId=url.searchParams.get("projectId"); if(!projectId)return sendJson(res,400,{error:"projectId is required"});
  sendJson(res,200,{telemetry:await deps.control.telemetry(projectId)});
}

async function reports(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId=url.searchParams.get("projectId"); if(!projectId)return sendJson(res,400,{error:"projectId is required"});
  sendJson(res,200,{reports:await deps.control.reports(projectId)});
}

function configuredModels(): Set<string> {
  return new Set([process.env.OPENROUTER_DEFAULT_MODEL, process.env.OPENROUTER_FALLBACK_MODEL, process.env.AGENT_ROUTER_DEFAULT_MODEL, process.env.AGENTROUTER_DEFAULT_MODEL].filter((v): v is string => typeof v === "string" && v.trim() !== ""));
}

async function effectiveConfiguration(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId=url.searchParams.get("projectId"); const agentId=url.searchParams.get("agentId") ?? undefined;
  if(!projectId)return sendJson(res,400,{error:"projectId is required"});
  sendJson(res,200,{effective:await deps.control.effectiveConfiguration(projectId,agentId)});
}

async function updateConfiguration(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body=await readBody(req) as Record<string,unknown>; const scope=asText(body.scope,20); const projectId=asText(body.projectId,200); const agentId=asText(body.agentId,100); const action=asText(body.action,20); const rationale=asText(body.rationale,2000); const provider=asText(body.provider,100); const model=asText(body.model,300);
  if(!projectId||!rationale||!scope||!action||!["PROJECT","AGENT"].includes(scope)||!["SET","RESET"].includes(action)||(scope==="AGENT"&&!agentId))return sendJson(res,400,{error:"valid scope, action, projectId and rationale are required"});
  if(action==="SET"){const agentRouterConfigured=Boolean(process.env.OPENAI_API_KEY&&process.env.ANTHROPIC_AUTH_TOKEN);const openRouterConfigured=Boolean(process.env.OPENROUTER_API_KEY);if(!model||!configuredModels().has(model)||!((provider==="openrouter"&&openRouterConfigured)||(provider==="agentrouter"&&agentRouterConfigured)))return sendJson(res,400,{error:"provider/model is not an actually configured runtime option"});}
  const scopeId=scope==="PROJECT"?projectId:`${projectId}:${agentId}`;
  await deps.control.saveConfigurationEvent({scopeType:scope as "PROJECT"|"AGENT",scopeId,provider:action==="RESET"?null:provider,model:action==="RESET"?null:model,action:action as "SET"|"RESET",rationale});
  sendJson(res,201,{effective:await deps.control.effectiveConfiguration(projectId,scope==="AGENT"?agentId ?? undefined:undefined)});
}

function requireStrategic(deps: WorkflowApiDeps): StrategicStore {
  if (!deps.strategic) throw new Error("strategic store is not configured");
  return deps.strategic;
}

async function strategyEntities(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const strategic = requireStrategic(deps);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const type = url.searchParams.get("type") ?? undefined;
  const key = url.searchParams.get("key") ?? undefined;
  sendJson(res, 200, {
    entities: await strategic.history(projectId, type, key),
    health: await strategic.strategicHealth(projectId),
  });
}

async function strategyEffective(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const strategic = requireStrategic(deps);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const effective = await strategic.effectiveState(projectId);
  sendJson(res, 200, {
    projectId, active: effective.active, conflicts: effective.conflicts,
    health: await strategic.strategicHealth(projectId),
    note: effective.conflicts.length > 0 ? "STRATEGIC_STATE_CONFLICT: resolution refuses to choose; resolve the conflict before relying on effective context." : undefined,
  });
}

const STRATEGIC_TYPES = new Set(["STRATEGY", "BRAND", "CONTENT_SYSTEM", "OBJECTIVES", "PRINCIPLES", "CONSTRAINTS", "EXPERIMENT", "DECISION", "LEARNING_MEMORY"]);

async function strategyPropose(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const strategic = requireStrategic(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const entityType = asText(body.entityType, 40);
  const payload = body.payload;
  if (!projectId || !entityType || !STRATEGIC_TYPES.has(entityType) || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return sendJson(res, 400, { error: "projectId, valid entityType and object payload are required" });
  }
  const entity = await strategic.propose({
    projectId, entityType: entityType as StrategicEntityType,
    entityKey: asText(body.entityKey, 120) ?? undefined,
    payload: payload as Record<string, unknown>,
    sourceArtifactIds: Array.isArray(body.sourceArtifactIds) ? body.sourceArtifactIds.filter((v): v is string => typeof v === "string") : [],
    createdBy: asText(body.createdBy, 200) ?? "owner",
    draft: body.draft === true,
  });
  sendJson(res, 201, {
    entity,
    disclosure: "Proposal persisted as non-active state. It does NOT affect effective strategic context until Owner-approved activation.",
  });
}

async function strategyActivate(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const strategic = requireStrategic(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const entityId = asText(body.entityId, 300);
  const approvalId = asText(body.approvalId, 300);
  if (!entityId || !approvalId) return sendJson(res, 400, { error: "entityId and approvalId are required" });
  try {
    const result = await strategic.activate({ entityId, approvalId, activatedBy: asText(body.activatedBy, 200) ?? "owner" });
    sendJson(res, 200, {
      ...result,
      disclosure: "Activation changes future effective strategic context only. Historical executions keep their frozen snapshots. No workflow was started.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, /NOT_FOUND/.test(message) ? 404 : 409, { error: message });
  }
}

/** Side-effect-free preview: resolves what WOULD be injected. No LLM, no snapshot write, no mutation. */
async function strategyPreview(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const strategic = requireStrategic(deps);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  try {
    const resolved = await strategic.resolve({
      projectId,
      agentId: url.searchParams.get("agentId") ?? undefined,
      taskClass: url.searchParams.get("taskClass") ?? undefined,
    });
    sendJson(res, 200, { preview: resolved, disclosure: "Preview only: no snapshot persisted, no provider called, no budget consumed." });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, /CONFLICT/.test(message) ? 409 : 500, { error: message });
  }
}

async function strategySnapshot(deps: WorkflowApiDeps, res: ServerResponse, snapshotId: string): Promise<void> {
  const strategic = requireStrategic(deps);
  const snapshot = await strategic.getSnapshot(snapshotId);
  if (!snapshot) return sendJson(res, 404, { error: "snapshot not found" });
  sendJson(res, 200, { snapshot });
}

async function strategyLineage(deps: WorkflowApiDeps, res: ServerResponse, executionId: string): Promise<void> {
  const strategic = requireStrategic(deps);
  sendJson(res, 200, await strategic.lineageForExecution(executionId));
}

async function strategyArtifactLineage(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const strategic = requireStrategic(deps);
  const artifactId = url.searchParams.get("artifactId");
  if (!artifactId) return sendJson(res, 400, { error: "artifactId is required" });
  sendJson(res, 200, await strategic.artifactLineage(artifactId));
}

/**
 * Owner review bundle (read-only): entity + ACTIVE baseline + deterministic
 * diff + related activation approvals + activation eligibility. Eligibility
 * mirrors activate() fail-closed rules without mutating anything.
 */
async function strategyReview(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const strategic = requireStrategic(deps);
  const projectId = url.searchParams.get("projectId");
  const entityId = url.searchParams.get("entityId");
  if (!projectId || !entityId) return sendJson(res, 400, { error: "projectId and entityId are required" });
  let review;
  try {
    review = await strategic.reviewEntity(projectId, entityId);
  } catch (error) {
    return sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
  }
  const all = await deps.control.listApprovals(projectId);
  const related = all
    .filter((a) => a.targetId === entityId)
    .map((a) => withAuthority(a as unknown as Record<string, unknown>));
  const allowed = new Set(["STRATEGY_ACTIVATION", `${review.entity.entityType}_ACTIVATION`]);
  const scoped = related.filter((a) => allowed.has(String(a.targetType)));
  const approved = scoped.find((a) => a.status === "DECIDED" && a.ownerDecision === "APPROVE");
  const pending = scoped.find((a) => a.status !== "DECIDED");
  let eligibility: { canActivate: boolean; reason: string; approvalId: string | null };
  if (review.entity.status === "ACTIVE") {
    eligibility = approved
      ? { canActivate: true, reason: "ALREADY_ACTIVE_IDEMPOTENT", approvalId: String(approved.approvalId) }
      : { canActivate: false, reason: "ALREADY_ACTIVE", approvalId: null };
  } else if (review.entity.status !== "PROPOSED" && review.entity.status !== "DRAFT") {
    eligibility = { canActivate: false, reason: `STATUS_NOT_ACTIVATABLE:${review.entity.status}`, approvalId: null };
  } else if (approved) {
    eligibility = { canActivate: true, reason: "APPROVED_AUTHORITY_AVAILABLE", approvalId: String(approved.approvalId) };
  } else if (pending) {
    eligibility = { canActivate: false, reason: "APPROVAL_PENDING", approvalId: String(pending.approvalId) };
  } else if (scoped.some((a) => a.status === "DECIDED")) {
    eligibility = { canActivate: false, reason: "NO_APPROVED_AUTHORITY", approvalId: null };
  } else {
    eligibility = { canActivate: false, reason: "ACTIVATION_AUTHORITY_REQUIRED", approvalId: null };
  }
  sendJson(res, 200, {
    entity: review.entity,
    baseline: review.baseline,
    baselineConflict: review.baselineConflict,
    diff: review.diff,
    approvals: related,
    eligibility,
    impact: {
      onActivate: [
        "This exact version becomes effective for future strategic context resolution.",
        "Future agent context for relevant task classes may change.",
      ],
      notOnActivate: [
        "Historical executions are not rewritten; frozen snapshots stay unchanged.",
        "No workflow starts merely because strategy is activated.",
        "No production authority is granted.",
        "No publication authority is granted.",
      ],
    },
  });
}

function requireLifecycle(deps: WorkflowApiDeps): LifecycleStore {
  if (!deps.lifecycle) throw new Error("lifecycle store is not configured");
  return deps.lifecycle;
}

async function lifecycleList(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const lifecycle = requireLifecycle(deps);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const limit = Number(url.searchParams.get("limit") ?? 20);
  sendJson(res, 200, { lifecycles: await lifecycle.projectLifecycles(projectId, Number.isFinite(limit) ? limit : 20) });
}

async function lifecycleDetail(deps: WorkflowApiDeps, res: ServerResponse, workflowId: string): Promise<void> {
  const lifecycle = requireLifecycle(deps);
  const resolved = await lifecycle.workflowLifecycle(workflowId);
  if (!resolved) return sendJson(res, 404, { error: `workflow not found: ${workflowId}` });
  sendJson(res, 200, { lifecycle: resolved });
}

/**
 * M2 governed learning loop summary (read-only, bounded). STUBBED-derived
 * learning stays visibly validation-only; nothing here starts, decides,
 * or authorizes anything.
 */
async function learningSummary(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  if (!deps.learning) return sendJson(res, 503, { error: "learning loop store is not configured" });
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const [observations, learnings, recommendations, proposals] = await Promise.all([
    deps.learning.listObservations(projectId, 20),
    deps.learning.listLearnings(projectId, 20),
    deps.learning.listRecommendations(projectId, 20),
    deps.learning.listProposals(projectId, 20),
  ]);
  sendJson(res, 200, { projectId, observations, learnings, recommendations, proposals });
}

/**
 * Program 2 content domain (business objects over canonical truth).
 * Creation and linkage never start execution, never decide, never grant.
 */
function requireContent(deps: WorkflowApiDeps): ContentStore {
  if (!deps.content) throw new Error("content store is not configured");
  return deps.content;
}

async function contentStatusFor(deps: WorkflowApiDeps, item: {
  workflowId: string | null;
}): Promise<{ status: string; detail: string; lifecycle: unknown }> {
  if (!item.workflowId || !deps.lifecycle) {
    return { status: "IDEA", detail: "Idea captured; production planning has not started.", lifecycle: null };
  }
  let lc: Record<string, unknown> | null = null;
  try {
    lc = (await deps.lifecycle.workflowLifecycle(item.workflowId)) as unknown as Record<string, unknown> | null;
  } catch {
    lc = null;
  }
  if (!lc) {
    return { status: "IDEA", detail: "Linked workflow not found; content stays an idea.", lifecycle: null };
  }
  let hasObservation = false, hasLearning = false, hasProposal = false;
  if (deps.learning && item.workflowId) {
    try {
      const wid = item.workflowId;
      const obs = await deps.learning.listObservations((lc.projectId as string) || "", 200);
      const mine = obs.filter((o) => o.workflowId === wid);
      hasObservation = mine.length > 0;
      if (hasObservation) {
        const ids = new Set(mine.map((o) => o.observationId));
        const lrns = await deps.learning.listLearnings((lc.projectId as string) || "", 200);
        const mineL = lrns.filter((l) => l.sourceObservationIds.some((id) => ids.has(id)));
        hasLearning = mineL.length > 0;
        if (hasLearning) {
          const lids = new Set(mineL.map((l) => l.learningId));
          const recs = await deps.learning.listRecommendations((lc.projectId as string) || "", 200);
          const mineR = recs.filter((r) => lids.has(r.learningId));
          if (mineR.length > 0) {
            const rids = new Set(mineR.map((r) => r.recommendationId));
            const props = await deps.learning.listProposals((lc.projectId as string) || "", 200);
            hasProposal = props.some((p) => rids.has(p.recommendationId));
          }
        }
      }
    } catch {
      // Learning evidence is informational; status derivation stays honest without it.
    }
  }
  const derived = deriveContentStatus({
    workflowLinked: true,
    overallState: typeof lc.overallState === "string" ? lc.overallState : null,
    currentPhaseId: typeof lc.currentPhaseId === "string" ? lc.currentPhaseId : null,
    publicStatus: typeof lc.publicStatus === "string" ? lc.publicStatus : null,
    hasObservation, hasLearning, hasProposal,
  });
  return { ...derived, lifecycle: lc };
}

async function contentList(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireContent(deps);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const items = await store.listContent(projectId);
  const out = [];
  for (const item of items) {
    const s = await contentStatusFor(deps, item);
    out.push({ ...item, status: s.status, statusDetail: s.detail });
  }
  sendJson(res, 200, { projectId, contents: out });
}

async function contentDetail(deps: WorkflowApiDeps, res: ServerResponse, url: URL, contentId: string): Promise<void> {
  const store = requireContent(deps);
  const item = await store.getContent(contentId);
  if (!item) return sendJson(res, 404, { error: "content not found" });
  const s = await contentStatusFor(deps, item);
  let artifacts: unknown[] = [];
  let readiness: unknown = null;
  let preMediaReview: unknown = null;
  let phaseCostEvidence: unknown[] = [];
  let latestExecutionFailure: unknown = null;
  if (item.workflowId) {
    try {
      artifacts = await deps.persistence.listArtifacts(item.workflowId);
    } catch { artifacts = []; }
    try {
      readiness = await deps.control.publicationReadiness(item.projectId, item.workflowId);
    } catch { readiness = null; }
    try {
      const submission = await deps.queue.loadSubmissionByWorkflow(item.workflowId);
      const approval = await deps.control.getApproval(`approval-${item.workflowId}-owner-pre-media-gate`);
      preMediaReview = { required: submission?.status === "owner_pre_media_review_required" || approval?.status === "PENDING", status: submission?.status ?? "UNKNOWN", approvalId: approval?.approvalId ?? null, authority: "OWNER_REQUIRED", mediaAuthority: "NOT_GRANTED" };
    } catch { preMediaReview = null; }
    try { phaseCostEvidence = deps.productionCallBudgets ? await deps.productionCallBudgets.workflowEvidence(item.workflowId) : []; } catch { phaseCostEvidence = []; }
    try {
      const executions=await deps.persistence.listExecutionProvenance(item.workflowId);
      const failed=[...executions].reverse().find((entry)=>entry.status==="failed");
      if(failed){const config=isObject(failed.configuration)?failed.configuration:{},response=isObject(config.providerResponse)?config.providerResponse:{},failure=isObject(config.providerFailure)?config.providerFailure:{};latestExecutionFailure={agent:failed.agentId,stage:failed.stage,model:failed.model,transport:typeof response.httpStatus==="number"?`HTTP ${response.httpStatus}`:failed.errorClassification,contract:failed.errorClassification==="LOCAL_EXECUTION_FAILED"?"FAILED":"NOT_REACHED",validationCategory:failure.validationStage??failed.errorClassification,validationCode:failure.validationCode??null,validationPaths:Array.isArray(failure.issuePaths)?failure.issuePaths:[],cost:failed.cost??null,costKind:failed.costKind,retryState:"OWNER_AUTHORIZATION_REQUIRED"};}
    } catch { latestExecutionFailure=null; }
  }
  const [revisions, visualReviews, reviewDecisions, publicationPreparations] = await Promise.all([
    store.listRevisions(contentId), store.listVisualReviews(contentId), store.listReviewDecisions(contentId), store.listPublicationPreparations(contentId),
  ]);
  const preflight = await pilotPreflight(deps, item);
  sendJson(res, 200, {
    content: { ...item, status: s.status, statusDetail: s.detail },
    lifecycle: s.lifecycle, artifacts, readiness, revisions, visualReviews,
    reviewDecisions, publicationPreparations, preflight, preMediaReview, phaseCostEvidence, latestExecutionFailure,
  });
}

async function contentCreate(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireContent(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const title = asText(body.title, 300);
  const objective = asText(body.objective, 2000);
  if (!projectId || !title || !objective) {
    return sendJson(res, 400, { error: "projectId, title and objective are required" });
  }
  const channel = asText(body.channel, 40) ?? "youtube";
  const format = asText(body.format, 40) ?? "short";
  if (!["youtube"].includes(channel)) return sendJson(res, 400, { error: "channel must be youtube" });
  if (!["short"].includes(format)) return sendJson(res, 400, { error: "format must be short" });
  const item = await store.createContent({
    projectId, title, objective, channel, format,
    topic: asText(body.topic, 500), notes: asText(body.notes, 2000),
    constraints: asText(body.constraints, 2000),
    seedArtifactId: asText(body.seedArtifactId, 300),
    experimentId: asText(body.experimentId, 300),
    productionBrief: (typeof body.productionBrief === "object" && body.productionBrief !== null && !Array.isArray(body.productionBrief) ? body.productionBrief : {}) as Record<string, unknown>,
    publicationMetadata: {},
  });
  const s = await contentStatusFor(deps, item);
  sendJson(res, 201, {
    content: { ...item, status: s.status, statusDetail: s.detail },
    disclosure: "Content item created as an idea. No workflow started, nothing decided, no authority granted.",
  });
}

async function contentLink(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, contentId: string): Promise<void> {
  const store = requireContent(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const workflowId = asText(body.workflowId, 300);
  const seedArtifactId = asText(body.seedArtifactId, 300);
  const experimentId = asText(body.experimentId, 300);
  if (!workflowId && !seedArtifactId && !experimentId) {
    return sendJson(res, 400, { error: "workflowId, seedArtifactId or experimentId is required" });
  }
  if (workflowId) {
    const submission = await deps.queue.loadSubmissionByWorkflow(workflowId);
    if (!submission) return sendJson(res, 404, { error: `workflow not found: ${workflowId}` });
  }
  const item = await store.linkRecords(contentId, {
    workflowId: workflowId ?? null, seedArtifactId: seedArtifactId ?? null, experimentId: experimentId ?? null,
  });
  if (!item) return sendJson(res, 404, { error: "content not found" });
  const s = await contentStatusFor(deps, item);
  sendJson(res, 200, {
    content: { ...item, status: s.status, statusDetail: s.detail },
    disclosure: "Linked existing canonical records only. Nothing started, decided, or granted.",
  });
}

const PILOT_BUDGETS: Readonly<Record<string, number>> = { research:1, text_agent:5, image_generation:3, video_generation:3, voice_generation:1, private_upload:1 };
const PILOT_TEXT_MODELS: Readonly<Record<string,string>> = { planner:"glm-5.3",writer:"glm-5.3",seo:"glm-5.3",brand:"glm-5.3",review:"glm-5.3",qa:"deepseek-v4-flash" };
const REVISION_LAYERS = new Set(["SCRIPT","SCENE","IMAGE","VIDEO_CLIP","VOICE","CAPTIONS","FINAL_COMPOSITION","METADATA"]);
const QA_VALUES = new Set(["PASS","FAIL","NOT_APPLICABLE"]);

function productionBriefErrors(item:{projectId:string;productionBrief:Record<string,unknown>}):string[]{
  const b=item.productionBrief??{}, errors:string[]=[];
  const required=["topic","objective","targetPlatform","format","targetAudience","contentType","language","targetDurationSeconds","sceneTarget","researchRequirement","characterRequirement"];
  for(const key of required)if(b[key]===undefined||b[key]===null||b[key]==="")errors.push(`BRIEF_${key.toUpperCase()}_REQUIRED`);
  const duration=Number(b.targetDurationSeconds), scenes=Number(b.sceneTarget);
  if(!Number.isFinite(duration)||duration<1)errors.push("BRIEF_DURATION_INVALID");
  if(!Number.isInteger(scenes)||scenes<1)errors.push("BRIEF_SCENE_TARGET_INVALID");
  if(String(b.targetPlatform).toLowerCase()!=="youtube")errors.push("BRIEF_PLATFORM_UNSUPPORTED");
  if(String(b.format).toLowerCase()!=="short")errors.push("BRIEF_FORMAT_UNSUPPORTED");
  if(b.identityCriticalHuman===true)errors.push("PILOT_IDENTITY_CRITICAL_HUMAN_NOT_ALLOWED");
  if(!item.projectId)errors.push("BRIEF_PROJECT_REQUIRED");
  return [...new Set(errors)];
}

async function pilotPreflight(deps:WorkflowApiDeps,item:{contentId:string;projectId:string;productionBrief:Record<string,unknown>}):Promise<Record<string,unknown>>{
  const briefErrors=productionBriefErrors(item);
  const roles=["orchestrator","research","ceo","planner","hooks","writer","director","visual-director","review","qa"];
  const routes=[] as Record<string,unknown>[]; const routeErrors:string[]=[];
  if(!deps.productionModelRouting) routeErrors.push("CANONICAL_ROUTING_STORE_UNAVAILABLE");
  else for(const role of roles){try{const resolved=await deps.productionModelRouting.resolve(role,{projectId:item.projectId,slot:"primary"});routes.push({agent:role,provider:"openrouter",model:resolved.model,routingVersionId:resolved.routingVersionId,priceSnapshotId:resolved.priceSnapshotId,configurationSource:"ACTIVE_PROJECT_CANONICAL_ROUTING",availability:process.env.OPENROUTER_API_KEY?.trim()?"CONFIGURED_NOT_CALLED":"CREDENTIAL_UNAVAILABLE"});if(!process.env.OPENROUTER_API_KEY?.trim())routeErrors.push("OPENROUTER_CREDENTIAL_UNAVAILABLE");}catch(error){routeErrors.push(`ROUTE_${role.toUpperCase().replace(/-/g,"_")}_UNRESOLVED`);routes.push({agent:role,availability:"UNRESOLVED",reason:error instanceof Error?error.message:String(error)});}}
  const researchConfigured=Boolean(process.env.SEARCH_API_SERPER||process.env.SERPER_API_KEY||process.env.TAVILY_API_KEY||process.env.BRAVE_SEARCH_API_KEY||process.env.EXA_API_KEY);
  if(!researchConfigured)routeErrors.push("RESEARCH_RETRIEVAL_UNAVAILABLE");
  const budgets=deps.productionCallBudgets?await deps.productionCallBudgets.budgets(item.projectId,"PRE_MEDIA_PHASE"):[];
  const budgetBy=new Map(budgets.map(b=>[b.callKind,b]));
  const budgetErrors=[] as string[]; for(const [kind,needed] of Object.entries({research:1,text_agent:10})){const b=budgetBy.get(kind);if(!b)budgetErrors.push(`BUDGET_${kind.toUpperCase()}_MISSING`);else if(!b.active||b.limit<needed)budgetErrors.push(`BUDGET_${kind.toUpperCase()}_BELOW_PHASE_1`);else if(b.remaining<needed)budgetErrors.push(`BUDGET_${kind.toUpperCase()}_EXHAUSTED`);else if(b.maxRetries!==0)budgetErrors.push(`BUDGET_${kind.toUpperCase()}_RETRIES_NOT_ZERO`);}
  return {phase:"PRE_MEDIA_PHASE",terminalState:"OWNER_PRE_MEDIA_REVIEW_REQUIRED",ready:briefErrors.length===0&&budgetErrors.length===0&&routeErrors.length===0,briefErrors,budgetErrors,routeErrors:[...new Set(routeErrors)],routes,researchRetrieval:{configured:researchConfigured,providerCallsMade:0},budgets,mediaReadinessRequired:false,phase2Authorized:false,providerCallsMade:0,disclosure:"Phase-1 preflight only. Media and publication providers are intentionally excluded. No provider was called and no budget was consumed."};
}

async function contentBriefUpdate(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse,contentId:string):Promise<void>{
  const store=requireContent(deps), item=await store.getContent(contentId); if(!item)return sendJson(res,404,{error:"content not found"});
  const body=await readBody(req) as Record<string,unknown>; const brief=(typeof body.brief==="object"&&body.brief!==null&&!Array.isArray(body.brief)?body.brief:{} ) as Record<string,unknown>;
  const merged={...item.productionBrief,...brief,brandProject:item.projectId}; const errors=productionBriefErrors({...item,productionBrief:merged});
  if(errors.length)return sendJson(res,400,{error:"PRODUCTION_BRIEF_INVALID",errors});
  sendJson(res,200,{content:await store.updateProductionBrief(contentId,merged),disclosure:"Brief saved. No workflow or provider started."});
}

async function contentPreflight(deps:WorkflowApiDeps,res:ServerResponse,contentId:string):Promise<void>{const item=await requireContent(deps).getContent(contentId);if(!item)return sendJson(res,404,{error:"content not found"});sendJson(res,200,{contentId,preflight:await pilotPreflight(deps,item)});}

async function contentStartProduction(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse,contentId:string):Promise<void>{
  await readBody(req).catch(()=>({})); const store=requireContent(deps); let item=await store.getContent(contentId);if(!item)return sendJson(res,404,{error:"content not found"});
  if(item.workflowId){const existing=await deps.queue.loadSubmissionByWorkflow(item.workflowId);return sendJson(res,200,{created:false,workflowId:item.workflowId,status:existing?.status??"linked",content:item,disclosure:"Existing bound workflow reused; no duplicate created."});}
  const preflight=await pilotPreflight(deps,item); if(preflight.ready!==true)return sendJson(res,409,{error:"PILOT_PREFLIGHT_BLOCKED",preflight});
  const submissionKey=`content-production:${contentId}`, proposedWorkflowId=generateId("wf"), correlationId=generateId("corr");
  const definition=directiveToWorkflowDefinition("produce-pre-media");
  const b=item.productionBrief;
  const submitted=await deps.queue.submit({submissionKey,workflowId:proposedWorkflowId,directive:"produce-pre-media",correlationId,brandId:item.projectId,definition,commandContext:{source:"OWNER_CONTENT_PRODUCT",projectId:item.projectId,contentId,productionPhase:"PRE_MEDIA_PHASE",phaseAuthority:"OWNER_START_PRE_MEDIA",mediaAuthority:"NOT_GRANTED",publicationAuthority:"NOT_GRANTED",productionBrief:JSON.parse(JSON.stringify(b)),contentTopic:String(b.topic),objective:String(b.objective),platform:String(b.targetPlatform),audience:String(b.targetAudience),format:String(b.format),targetDurationSeconds:Number(b.targetDurationSeconds),sceneTarget:Number(b.sceneTarget),language:String(b.language),researchRequirement:String(b.researchRequirement),characterRequirement:String(b.characterRequirement)},status:"submitted"});
  const canonical=submitted.created?await deps.queue.loadSubmissionByWorkflow(proposedWorkflowId):await deps.queue.loadSubmissionByKey(submissionKey);
  if(!canonical)throw new Error("CONTENT_PRODUCTION_SUBMISSION_MISSING");
  if(submitted.created)await deps.queue.enqueue(canonical.workflowId,submissionKey);
  item=(await store.linkRecords(contentId,{workflowId:canonical.workflowId}))!;
  sendJson(res,submitted.created?201:200,{created:submitted.created,workflowId:canonical.workflowId,status:"QUEUED_PRE_MEDIA_PHASE",content:item,preflight,terminalState:"OWNER_PRE_MEDIA_REVIEW_REQUIRED",mediaAuthority:"NOT_GRANTED",disclosure:"Bounded Phase 1 queued. It ends at Owner pre-media review and cannot execute media or publication."});
}

async function contentRevisionCreate(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse,contentId:string):Promise<void>{
  const store=requireContent(deps),item=await store.getContent(contentId);if(!item)return sendJson(res,404,{error:"content not found"});const body=await readBody(req) as Record<string,unknown>;
  const layer=asText(body.layer,40),feedback=asText(body.ownerFeedback,2000),reason=asText(body.reason,1000);if(!layer||!REVISION_LAYERS.has(layer)||!feedback||!reason)return sendJson(res,400,{error:"layer, ownerFeedback and reason are required; layer must be a supported targeted layer"});
  const action=`REVISE_${layer}`;const revision=await store.createRevision({contentId,projectId:item.projectId,workflowId:item.workflowId,layer,targetArtifactId:asText(body.targetArtifactId,300),previousArtifactId:asText(body.previousArtifactId,300),ownerFeedback:feedback,reason,resultingAction:action});
  sendJson(res,201,{revision,selective:true,unrelatedLayersRegenerated:false,disclosure:"Revision request recorded with lineage. Execution remains behind the workflow and provider-authority boundaries."});
}

async function contentVisualReview(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse,contentId:string):Promise<void>{
  const store=requireContent(deps),item=await store.getContent(contentId);if(!item)return sendJson(res,404,{error:"content not found"});const body=await readBody(req) as Record<string,unknown>;
  const artifactId=asText(body.artifactId,300),semanticQa=asText(body.semanticQa,40),ownerAcceptance=asText(body.ownerAcceptance,40)??"PENDING";const technical=(typeof body.technicalQa==="object"&&body.technicalQa!==null&&!Array.isArray(body.technicalQa)?body.technicalQa:{}) as Record<string,unknown>;
  const checks=["technicalValidity","aspectRatio","resolution","promptAdherence","requirementCoverage","corruptionFree","brandFit"];
  if(!artifactId||!semanticQa||!checks.every(k=>QA_VALUES.has(String(technical[k]))))return sendJson(res,400,{error:"artifactId, semanticQa, and all seven technical QA checks are required"});
  const technicalPass=checks.every(k=>technical[k]!=="FAIL");if(ownerAcceptance==="ACCEPTED"&&!technicalPass)return sendJson(res,409,{error:"OWNER_CANNOT_ACCEPT_FAILED_TECHNICAL_QA"});
  const review=await store.recordVisualReview({contentId,projectId:item.projectId,workflowId:item.workflowId,artifactId,sceneId:asText(body.sceneId,200),technicalQa:{...technical,pass:technicalPass},semanticQa,semanticNotes:asText(body.semanticNotes,2000),ownerAcceptance,ownerFeedback:asText(body.ownerFeedback,2000)});
  sendJson(res,200,{review,technicalQa:technicalPass?"PASS":"FAIL",semanticQa,ownerAcceptance,disclosure:"Technical, semantic, and Owner judgments remain separate. No provider was called."});
}

async function contentFinalApproval(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse,contentId:string):Promise<void>{
  const store=requireContent(deps),item=await store.getContent(contentId);if(!item)return sendJson(res,404,{error:"content not found"});const body=await readBody(req) as Record<string,unknown>;const artifactId=asText(body.finalArtifactId,300),rationale=asText(body.rationale,2000);if(!artifactId||!rationale)return sendJson(res,400,{error:"finalArtifactId and rationale are required"});if(!item.workflowId)return sendJson(res,409,{error:"CONTENT_WORKFLOW_REQUIRED"});
  const artifacts=await deps.persistence.listArtifacts(item.workflowId);const belongs=artifacts.some((a:any)=>(a.artifact_id??a.artifactId)===artifactId&&String(a.kind).includes("final_media"));if(!belongs)return sendJson(res,409,{error:"FINAL_ARTIFACT_NOT_IN_CONTENT_WORKFLOW"});
  const visuals=artifacts.filter((a:any)=>String(a.kind).includes("scene_visual"));const reviews=await store.listVisualReviews(contentId);const accepted=new Set(reviews.filter((r:any)=>r.owner_acceptance==="ACCEPTED"&&(typeof r.technical_qa==="object"?r.technical_qa?.pass:JSON.parse(r.technical_qa??"{}").pass)===true).map((r:any)=>r.artifact_id));if(visuals.some((a:any)=>!accepted.has(a.artifact_id??a.artifactId)))return sendJson(res,409,{error:"VISUAL_OWNER_ACCEPTANCE_INCOMPLETE"});
  if(!artifacts.some((a:any)=>String(a.kind).includes("final_technical_qa")))return sendJson(res,409,{error:"FINAL_TECHNICAL_QA_REQUIRED"});
  sendJson(res,200,{decision:await store.approveFinal({contentId,projectId:item.projectId,workflowId:item.workflowId,finalArtifactId:artifactId,rationale}),disclosure:"Final content accepted. This is not production authority and not publication authority."});
}

async function contentMetadataUpdate(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse,contentId:string):Promise<void>{const store=requireContent(deps),item=await store.getContent(contentId);if(!item)return sendJson(res,404,{error:"content not found"});const body=await readBody(req) as Record<string,unknown>;const title=asText(body.title,300),description=asText(body.description,5000),visibility=asText(body.visibility,20)??"private";if(!title||!description)return sendJson(res,400,{error:"title and description are required"});if(title.length>100)return sendJson(res,400,{error:"YOUTUBE_TITLE_TOO_LONG",maxLength:100,actualLength:title.length});if(visibility!=="private")return sendJson(res,403,{error:"PILOT_PRIVATE_ONLY"});const tags=Array.isArray(body.tags)?body.tags.filter((x):x is string=>typeof x==="string").slice(0,50):[];sendJson(res,200,{content:await store.updatePublicationMetadata(contentId,{title,description,tags,platform:"youtube",visibility}),disclosure:"Canonical metadata saved. Nothing published."});}

async function contentPublicationPrepare(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse,contentId:string):Promise<void>{
  const store=requireContent(deps),item=await store.getContent(contentId);if(!item)return sendJson(res,404,{error:"content not found"});await readBody(req).catch(()=>({}));if(item.finalReviewStatus!=="APPROVED"||!item.canonicalFinalArtifactId||!item.workflowId)return sendJson(res,409,{error:"FINAL_CONTENT_APPROVAL_REQUIRED"});const md=item.publicationMetadata;const title=String(md.title??"");if(!title||title.length>100||md.visibility!=="private")return sendJson(res,409,{error:"CANONICAL_PRIVATE_METADATA_REQUIRED"});
  const channels=deps.channels?await deps.channels.listChannels(item.projectId):[];const channel=channels.find(c=>c.platform==="youtube"&&c.externalChannelId==="UCA5ECzcK_96akfUT5fQUT3A");if(!channel)return sendJson(res,409,{error:"MORROWAY_CHANNEL_REQUIRED"});const bindings=deps.channels?await deps.channels.listBindings(item.projectId):[];const binding=bindings.find(b=>b.channelId===channel.channelId&&b.provider==="youtube"&&b.status==="ACTIVE")??null;
  const approvalId=`publication-authorization:${contentId}:${item.workflowId}`;await deps.control.createApproval({approvalId,projectId:item.projectId,targetType:"publisher_authorization_private",targetId:`private-publication:${item.workflowId}:${contentId}`,agentRecommendation:{action:"PREPARE_PRIVATE_PUBLICATION",visibility:"private",channelId:channel.channelId,bindingState:binding?"BOUND":"BINDING_REQUIRED",executesProvider:false},agentConfidence:"DETERMINISTIC",evidenceRefs:[item.canonicalFinalArtifactId],status:"PENDING",supersedes:null,supersededBy:null,createdAt:new Date().toISOString()});
  const preparation=await store.preparePublication({idempotencyKey:`private-publication:${contentId}:${item.canonicalFinalArtifactId}`,contentId,projectId:item.projectId,workflowId:item.workflowId,channelId:channel.channelId,bindingId:binding?.bindingId??null,artifactId:item.canonicalFinalArtifactId,visibility:"private",metadata:md,routeState:binding?"ROUTABLE_PENDING_AUTHORIZATION":"BINDING_REQUIRED",authorizationApprovalId:approvalId});
  sendJson(res,200,{preparation,channel,bindingState:binding?"BOUND":"BINDING_REQUIRED",authorizationApprovalId:approvalId,providerRequest:{platform:"youtube",privacyStatus:"private",title,description:md.description,tags:md.tags,channelId:channel.externalChannelId,artifactId:item.canonicalFinalArtifactId},executed:false,disclosure:"Private publication request reconstructed and stopped at explicit Owner authorization. No upload or provider call occurred."});
}

/**
 * Program 4 analytics domain routes (read-only).
 * Thin delegation to analytics-api.ts; no persistence or execution here.
 */
function analyticsDeps(deps: WorkflowApiDeps): {
  control: ControlPlaneStore; persistence: PostgresPersistence;
  lifecycle?: LifecycleStore; content?: ContentStore; learning?: LearningLoopStore;
} {
  return {
    control: deps.control, persistence: deps.persistence,
    lifecycle: deps.lifecycle, content: deps.content, learning: deps.learning,
  };
}

async function analyticsOverviewRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, await analyticsOverview(analyticsDeps(deps), projectId));
}

async function analyticsContentRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, await analyticsContent(analyticsDeps(deps), projectId));
}

async function analyticsContentDetailRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL, contentId: string): Promise<void> {
  const projectId = url.searchParams.get("projectId") ?? "";
  const detail = await analyticsContentDetail(analyticsDeps(deps), projectId, contentId);
  if (!detail) return sendJson(res, 404, { error: "content not found" });
  sendJson(res, 200, detail);
}

async function analyticsComparisonsRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId") ?? "";
  const a = url.searchParams.get("a") ?? "";
  const b = url.searchParams.get("b") ?? "";
  const metric = url.searchParams.get("metric") ?? "";
  if (!projectId || !a || !b || !metric) {
    return sendJson(res, 400, { error: "projectId, a, b and metric are required" });
  }
  sendJson(res, 200, await analyticsCompare(analyticsDeps(deps), projectId, a, b, metric));
}

async function analyticsExperimentsRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, await analyticsExperiments(analyticsDeps(deps), projectId));
}

async function analyticsInsightsRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, await analyticsInsights(analyticsDeps(deps), projectId));
}

async function analyticsAvailabilityRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, {
    ...(await analyticsAvailability(analyticsDeps(deps), projectId)),
    metricCatalog: metricCatalog(),
  });
}

async function analyticsAgentQueryRoute(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId") ?? "";
  const question = url.searchParams.get("question") ?? "";
  if (!projectId || !question) return sendJson(res, 400, { error: "projectId and question are required" });
  sendJson(res, 200, await analyticsAgentQuery(analyticsDeps(deps), projectId, question));
}

/**
 * Program 3 subject/scene identity graph (durable metadata only).
 * Approvals record Owner rationale; reference bytes stay in artifacts.
 * Nothing here generates media or grants authority.
 */
function requireSubjects(deps: WorkflowApiDeps): SubjectStore {
  if (!deps.subjects) throw new Error("subject store is not configured");
  return deps.subjects;
}

async function subjectList(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireSubjects(deps);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, { projectId, subjects: await store.listSubjects(projectId) });
}

async function subjectCreate(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireSubjects(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const name = asText(body.name, 200);
  const description = asText(body.description, 2000);
  if (!projectId || !name || !description) {
    return sendJson(res, 400, { error: "projectId, name and description are required" });
  }
  const rec = (v: unknown): Record<string, unknown> =>
    (typeof v === "object" && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {});
  const subject = await store.createSubject({
    projectId, name, description,
    subjectType: asText(body.subjectType, 40) ?? "person",
    traits: rec(body.traits), wardrobe: rec(body.wardrobe),
    negatives: Array.isArray(body.negatives) ? body.negatives.filter((x): x is string => typeof x === "string") : [],
    styleContext: asText(body.styleContext, 1000),
    voiceId: asText(body.voiceId, 200),
    supersedes: asText(body.supersedes, 300),
  });
  sendJson(res, 201, {
    subject,
    disclosure: "Subject profile created as DRAFT. Approval is a separate explicit step.",
  });
}

async function subjectApprove(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, subjectId: string): Promise<void> {
  const store = requireSubjects(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const approvedBy = asText(body.approvedBy, 200) ?? "owner";
  const rationale = asText(body.rationale, 2000);
  if (!rationale) return sendJson(res, 400, { error: "rationale is required" });
  const subject = await store.approveSubject(subjectId, approvedBy, rationale);
  if (!subject) return sendJson(res, 404, { error: "subject not found" });
  sendJson(res, 200, { subject });
}

async function subjectReferences(deps: WorkflowApiDeps, res: ServerResponse, url: URL, subjectId: string): Promise<void> {
  const store = requireSubjects(deps);
  const subject = await store.getSubject(subjectId);
  if (!subject) return sendJson(res, 404, { error: "subject not found" });
  sendJson(res, 200, { subjectId, references: await store.listReferences(subjectId) });
}

async function subjectAttachReference(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, subjectId: string): Promise<void> {
  const store = requireSubjects(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const artifactId = asText(body.artifactId, 300);
  const referenceKind = asText(body.referenceKind, 40);
  if (!projectId || !artifactId || !referenceKind) {
    return sendJson(res, 400, { error: "projectId, artifactId and referenceKind are required" });
  }
  try {
    const ref = await store.attachReference({ subjectId, projectId, artifactId, referenceKind });
    sendJson(res, 201, { reference: ref });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/SUBJECT_REFERENCE_KIND_INVALID/.test(message)) return sendJson(res, 400, { error: message });
    if (/SUBJECT_NOT_FOUND/.test(message)) return sendJson(res, 404, { error: message });
    throw error;
  }
}

async function sceneList(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireSubjects(deps);
  const contentId = url.searchParams.get("contentId");
  if (!contentId) return sendJson(res, 400, { error: "contentId is required" });
  sendJson(res, 200, { contentId, scenes: await store.listScenes(contentId) });
}

async function sceneSave(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireSubjects(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const sceneId = asText(body.sceneId, 200);
  const contentId = asText(body.contentId, 300);
  const projectId = asText(body.projectId, 200);
  const sequence = typeof body.sequence === "number" ? body.sequence : NaN;
  if (!sceneId || !contentId || !projectId || !Number.isInteger(sequence)) {
    return sendJson(res, 400, { error: "sceneId, contentId, projectId and integer sequence are required" });
  }
  const subjects = Array.isArray(body.subjects) ? body.subjects.filter((s): s is { subjectId: string } =>
    typeof s === "object" && s !== null && typeof (s as Record<string, unknown>).subjectId === "string") : [];
  const strings = (v: unknown): string[] =>
    (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const durationMs = typeof body.durationMs === "number" && Number.isFinite(body.durationMs) ? body.durationMs : null;
  try {
    const scene = await store.saveScene({
      sceneId, contentId, projectId, sequence, durationMs,
      purpose: asText(body.purpose, 1000), scriptRef: asText(body.scriptRef, 500),
      visual: asText(body.visual, 2000), subjects,
      environment: asText(body.environment, 500), shot: asText(body.shot, 100),
      cameraAngle: asText(body.cameraAngle, 100), movement: asText(body.movement, 500),
      continuity: strings(body.continuity), references: strings(body.references),
      intent: (typeof body.intent === "object" && body.intent !== null && !Array.isArray(body.intent)
        ? body.intent as Record<string, unknown> : {}),
      audioRef: asText(body.audioRef, 300),
      status: asText(body.status, 40) ?? "PLANNED",
    });
    sendJson(res, 201, { scene });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/SCENE_IDENTITY_REQUIRED|SCENE_SUBJECT_ID_REQUIRED/.test(message)) {
      return sendJson(res, 400, { error: message });
    }
    throw error;
  }
}

/**
 * Program 5 projects + channels (business platform domain).
 * Creation registers workspaces only: never strategy, content, workflows,
 * authority, or execution. All reads are project-scoped server-side.
 */
async function projectCreate(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const displayName = asText(body.displayName, 200);
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const metadata = body.metadata;
  try {
    const result = await deps.control.registerProject({
      projectId,
      displayName: displayName ?? undefined,
      createdBy: asText(body.createdBy, 200) ?? "owner",
      metadata: (typeof metadata === "object" && metadata !== null && !Array.isArray(metadata)
        ? metadata as Record<string, unknown> : {}),
    });
    sendJson(res, result.created ? 201 : 200, {
      project: result.project, created: result.created,
      disclosure: "Project workspace registered. No strategy, content, workflows, or authority created.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/CONTROL_PROJECT_ID_REQUIRED|CONTROL_PROJECT_ID_TOO_LONG|CONTROL_PROJECT_ID_INVALID|CONTROL_PROJECT_NAME_TOO_LONG/.test(message)) {
      return sendJson(res, 400, { error: message });
    }
    throw error;
  }
}

function requireChannels(deps: WorkflowApiDeps): ChannelStore {
  if (!deps.channels) throw new Error("channel store is not configured");
  return deps.channels;
}

async function channelList(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireChannels(deps);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, { projectId, channels: await store.listChannels(projectId) });
}

async function channelDetail(deps: WorkflowApiDeps, res: ServerResponse, url: URL, channelId: string): Promise<void> {
  const store = requireChannels(deps);
  const channel = await store.getChannel(channelId);
  if (!channel) return sendJson(res, 404, { error: "channel not found" });
  const projectId = url.searchParams.get("projectId");
  if (projectId && channel.projectId !== projectId) {
    return sendJson(res, 403, { error: "channel does not belong to the requested project" });
  }
  sendJson(res, 200, {
    channel,
    bindings: (await store.listBindings(channel.projectId)).filter((b) => !b.channelId || b.channelId === channelId).map(redactBinding),
  });
}

async function channelCreate(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireChannels(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const platform = asText(body.platform, 40) ?? "youtube";
  const displayName = asText(body.displayName, 200);
  if (!projectId || !displayName) return sendJson(res, 400, { error: "projectId and displayName are required" });
  const known = await deps.control.getProject(projectId);
  if (!known) return sendJson(res, 404, { error: `unknown project: ${projectId}` });
  try {
    const channel = await store.createChannel({
      projectId, platform, displayName,
      handle: asText(body.handle, 200),
      externalChannelId: asText(body.externalChannelId, 200),
      capabilities: (typeof body.capabilities === "object" && body.capabilities !== null && !Array.isArray(body.capabilities)
        ? body.capabilities as Record<string, unknown> : {}),
    });
    sendJson(res, 201, {
      channel,
      disclosure: "Channel record created as PENDING. Verification and binding are separate explicit steps; nothing uploads.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/CHANNEL_(PROJECT_REQUIRED|PLATFORM_UNKNOWN|PLATFORM_UNSUPPORTED|NAME_REQUIRED)/.test(message)) {
      return sendJson(res, 400, { error: message });
    }
    throw error;
  }
}

async function channelVerify(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, channelId: string): Promise<void> {
  const store = requireChannels(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const externalChannelId = asText(body.externalChannelId, 200);
  const rationale = asText(body.rationale, 2000);
  if (!externalChannelId || !rationale) {
    return sendJson(res, 400, { error: "externalChannelId and rationale are required" });
  }
  try {
    const channel = await store.verifyChannel({
      channelId, externalChannelId,
      handle: asText(body.handle, 200), rationale,
    });
    if (!channel) return sendJson(res, 404, { error: "channel not found" });
    sendJson(res, 200, { channel });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/CHANNEL_(EXTERNAL_ID_REQUIRED|VERIFY_RATIONALE_REQUIRED)/.test(message)) {
      return sendJson(res, 400, { error: message });
    }
    throw error;
  }
}

async function channelBind(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, channelId: string): Promise<void> {
  const store = requireChannels(deps);
  const body = await readBody(req) as Record<string, unknown>;
  const projectId = asText(body.projectId, 200);
  const provider = asText(body.provider, 100);
  const credentialRef = asText(body.credentialRef, 200);
  if (!projectId || !provider || !credentialRef) {
    return sendJson(res, 400, { error: "projectId, provider and credentialRef are required" });
  }
  try {
    const binding = await store.bindCredential({ projectId, channelId, provider, credentialRef });
    sendJson(res, 201, {
      binding: redactBinding(binding),
      disclosure: "Opaque credential reference recorded. Raw secrets never enter this store.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/CHANNEL_BINDING_(PROJECT_REQUIRED|PROVIDER_REQUIRED|REF_INVALID|CHANNEL_MISMATCH)/.test(message)) {
      const code = /CHANNEL_MISMATCH/.test(message) ? 403 : 400;
      return sendJson(res, code, { error: message });
    }
    throw error;
  }
}

async function bindingRevoke(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, bindingId: string): Promise<void> {
  const store = requireChannels(deps);
  await readBody(req).catch(() => ({}));
  const binding = await store.revokeBinding(bindingId);
  if (!binding) return sendJson(res, 404, { error: "binding not found" });
  sendJson(res, 200, { binding: redactBinding(binding) });
}

function redactBinding(binding:{bindingId:string;projectId:string;channelId:string|null;provider:string;status:string;createdAt:string;updatedAt:string}){
  return {bindingId:binding.bindingId,projectId:binding.projectId,channelId:binding.channelId,provider:binding.provider,status:binding.status,createdAt:binding.createdAt,updatedAt:binding.updatedAt,credentialReferencePresent:true};
}

/**
 * Dry-run publication route check (read-only): proves project/channel/
 * binding/visibility agreement WITHOUT executing anything.
 */
async function publishingRouteCheck(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireChannels(deps);
  const projectId = url.searchParams.get("projectId") ?? "";
  const channelId = url.searchParams.get("channelId") ?? "";
  const bindingId = url.searchParams.get("bindingId") ?? "";
  const visibility = url.searchParams.get("visibility") ?? "";
  if (!projectId || !channelId || !bindingId || !visibility) {
    return sendJson(res, 400, { error: "projectId, channelId, bindingId and visibility are required" });
  }
  try {
    const route = await store.resolvePublicationRoute({ projectId, channelId, bindingId, visibility });
    sendJson(res, 200, {
      routable: true, route,
      disclosure: "Dry-run only: agreement proven, nothing executed, no provider contacted.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 409, {
      routable: false, error: message,
      disclosure: "Fail-closed: resolve the mismatch before any publication path.",
    });
  }
}

/**
 * Owner-facing business labels derived from target semantics (generic, never
 * per-approval hardcoded). Technical ids stay available; these are primary.
 */
function approvalBusiness(targetType: string, targetId: string): {
  title: string; why: string; reviewing: string;
  approveEffect: string; notEffects: string[]; rejectEffect: string; doNothing: string;
  impact: "LOW" | "HIGH"; willHappen: string[]; willNotHappen: string[];
} {
  const t = `${targetType} ${targetId}`.toLowerCase();
  const gate = targetId.split(":").slice(-1)[0].replace(/-/g, " ");
  if (t.includes("public_publish") || t.includes("publisher_authorization")) {
    return {
      title: "Authorize public publication", why: "A workflow is asking for permission to publish publicly.",
      reviewing: "The publication request and its target.",
      approveEffect: "Grants authority to publish publicly.",
      notEffects: ["Does not approve production quality by itself.", "Does not alter historical executions."],
      rejectEffect: "Denies publication; the workflow stays unpublished.",
      doNothing: "Nothing is published. The request waits.",
      impact: "HIGH",
      willHappen: ["The publisher is authorized to upload publicly."],
      willNotHappen: ["No silent extras: only the authorized publication proceeds."],
    };
  }
  if (t.includes("publication_integration_validation")) {
    return {
      title: "Review publication validation", why: "Technical checks for a future publication are ready for your review.",
      reviewing: "The validation result (technical only — nothing public).",
      approveEffect: "Accepts the validation result so the workflow can continue.",
      notEffects: ["Does not approve production.", "Does not authorize public publication.", "Does not publish anything."],
      rejectEffect: "Sends the validation back; nothing advances.",
      doNothing: "The workflow waits at validation review.",
      impact: "LOW",
      willHappen: ["The workflow continues past validation review."],
      willNotHappen: ["No production approval.", "No publication.", "No public visibility change."],
    };
  }
  if (t.includes("strategy_activation") || t.includes("_activation")) {
    return {
      title: "Activate strategy change", why: "A proposed strategic change awaits your activation decision.",
      reviewing: "The proposed strategic version and its evidence.",
      approveEffect: "Makes this version effective for future context resolution.",
      notEffects: ["Does not rewrite historical executions.", "Does not start any workflow.", "Does not approve production or publication."],
      rejectEffect: "The proposal stays non-active.",
      doNothing: "Effective strategy stays unchanged.",
      impact: "HIGH",
      willHappen: ["Future agent context resolves against the new version."],
      willNotHappen: ["History untouched.", "No workflow started."],
    };
  }
  if (t.includes("visual-human-gate") || t.includes("visual")) {
    return {
      title: "Review generated visuals", why: "The visual package is complete and needs your review before the workflow can continue.",
      reviewing: "Generated images, scenes and visual checks.",
      approveEffect: "Lets this workflow continue past visual review.",
      notEffects: ["Does not approve production.", "Does not authorize publication.", "Does not alter historical executions."],
      rejectEffect: "Stops the workflow at visual review; a revision path may follow.",
      doNothing: "The workflow waits at visual review.",
      impact: "LOW",
      willHappen: ["The workflow continues past this gate."],
      willNotHappen: ["No production approval.", "No publication."],
    };
  }
  if (t.includes("pre-production") || t.includes("pre_production")) {
    return {
      title: "Review content package", why: "Scripts, research and brand work are ready for review before media production.",
      reviewing: "The content package (script, research, brand direction).",
      approveEffect: "Lets media production begin for this workflow.",
      notEffects: ["Does not approve production.", "Does not authorize publication."],
      rejectEffect: "Returns the package for changes; production does not start.",
      doNothing: "Production does not start.",
      impact: "LOW",
      willHappen: ["Media production is allowed to begin."],
      willNotHappen: ["No production approval.", "No publication."],
    };
  }
  if (t.includes("final")) {
    return {
      title: "Review final video", why: "The finished video and final checks are ready for your review.",
      reviewing: "Final media, technical QA and product review.",
      approveEffect: "Accepts the final result so the workflow can continue.",
      notEffects: ["Does not approve production.", "Does not authorize publication."],
      rejectEffect: "Sends the final result back for changes.",
      doNothing: "The workflow waits at final review.",
      impact: "LOW",
      willHappen: ["The workflow continues past final review."],
      willNotHappen: ["No production approval.", "No publication."],
    };
  }
  return {
    title: `Review requested: ${gate}`,
    why: "An Owner decision was requested on this item.",
    reviewing: "The referenced workflow output.",
    approveEffect: "Records approval within its granted scope.",
    notEffects: ["Does not grant broader authority beyond its scope."],
    rejectEffect: "Records rejection; the item does not advance.",
    doNothing: "The item waits.",
    impact: "LOW",
    willHappen: ["The recorded decision takes effect in its scope."],
    willNotHappen: ["No wider authority is granted."],
  };
}

function requireActionability(deps: WorkflowApiDeps): ApprovalActionabilityStore {
  if (!deps.actionability) throw new Error("actionability store is not configured");
  return deps.actionability;
}

async function approvalActionability(deps: WorkflowApiDeps, res: ServerResponse, approvalId: string): Promise<void> {
  const store = requireActionability(deps);
  const result = await store.approvalActionability(approvalId);
  if (!result) return sendJson(res, 404, { error: "approval not found" });
  sendJson(res, 200, { actionability: result });
}

/**
 * Owner Decision Center queue: one canonical truth shared with Pipeline.
 * ACTION_REQUIRED + CONFLICTED first (needs decision), then pending-but-
 * superseded (no action), then history. Counts derive from actionability,
 * never raw PENDING rows.
 */
async function decisionQueue(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const store = requireActionability(deps);
  const rows = await store.projectActionability(projectId);
  const approvals = await deps.control.listApprovals(projectId);
  const byId = new Map(approvals.map((a) => [a.approvalId, a]));
  const rank = (s: string): number =>
    s === "ACTION_REQUIRED" ? 0 : s === "CONFLICTED" ? 1 : s === "SUPERSEDED" || s === "HISTORICAL" ? 2 : 3;
  const items = rows
    .map((r) => {
      const a = byId.get(r.approvalId);
      if (!a) return null;
      const biz = approvalBusiness(a.targetType, a.targetId);
      return {
        ...withAuthority(a as unknown as Record<string, unknown>),
        business: biz,
        actionability: r.state,
        actionabilityReason: r.reason,
        actionabilityEvidence: r.evidence,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((x, y) => rank(String(x.actionability)) - rank(String(y.actionability)));
  const credentialItems=deps.ownerAutonomy?await deps.ownerAutonomy.credentialDecisionItems(projectId):[];
  const needsDecision = [...items.filter((i) => i.actionability === "ACTION_REQUIRED" || i.actionability === "CONFLICTED"),...credentialItems];
  sendJson(res, 200, {
    projectId,
    needsDecision,
    noAction: items.filter((i) => i.actionability === "SUPERSEDED" || i.actionability === "HISTORICAL"),
    history: items.filter((i) => i.actionability === "DECIDED"),
    counts: {
      needsDecision: needsDecision.length,
      noAction: items.filter((i) => i.actionability === "SUPERSEDED" || i.actionability === "HISTORICAL").length,
      decided: items.filter((i) => i.actionability === "DECIDED").length,
    },
  });
}

function configurationOptions(_deps: WorkflowApiDeps, res: ServerResponse): void {
  // Safe, secret-free option list: only provider names + configured model ids.
  const out: Array<{ provider: string; model: string; available: boolean }> = [];
  const defs: Array<[string, string | undefined, boolean]> = [
    ["openrouter", process.env.OPENROUTER_DEFAULT_MODEL, Boolean(process.env.OPENROUTER_API_KEY)],
    ["openrouter", process.env.OPENROUTER_FALLBACK_MODEL, Boolean(process.env.OPENROUTER_API_KEY)],
    ["agentrouter", process.env.AGENT_ROUTER_DEFAULT_MODEL ?? process.env.AGENTROUTER_DEFAULT_MODEL, Boolean(process.env.OPENAI_API_KEY && process.env.ANTHROPIC_AUTH_TOKEN)],
  ];
  for (const [provider, model, available] of defs) {
    if (model && model.trim() !== "") out.push({ provider, model: model.trim(), available });
  }
  sendJson(res, 200, {
    options: out,
    note: "Models are runtime-configured values, not live availability. Selecting one only changes future effective configuration; nothing executes.",
  });
}

/**
 * Slice 4 canonical agent read model: roster × telemetry × config × outputs.
 * Derived only; no new persistence. Honest statuses (never fake WORKING).
 */
async function agentRoster(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const telemetry = await deps.control.telemetry(projectId);
  const configMap = await deps.control.agentConfigurationMap(projectId);
  const projectEffective = await deps.control.effectiveConfiguration(projectId);
  const reports = await deps.control.reports(projectId);
  const health = await deps.control.platformHealth();
  const byAgent = new Map<string, Array<Record<string, unknown>>>();
  for (const row of telemetry as Array<Record<string, unknown>>) {
    const key = String(row.agent_id ?? "unknown");
    const list = byAgent.get(key) ?? [];
    list.push(row);
    byAgent.set(key, list);
  }
  const histByAgent = new Map<string, Array<Record<string, unknown>>>();
  try {
    const hist = await deps.control.configurationHistory(projectId, undefined, 100);
    for (const h of hist as Array<Record<string, unknown>>) {
      const scope = String(h.scopeType);
      const sid = String(h.scopeId);
      const key = scope === "AGENT" && sid.startsWith(`${projectId}:`) ? sid.slice(projectId.length + 1) : "*";
      const list = histByAgent.get(key) ?? [];
      if (list.length < 5) list.push(h);
      histByAgent.set(key, list);
    }
  } catch {
    // History is supplementary; the roster stands without it.
  }
  const keys = [...new Set([...agentCatalog().map((a) => a.key), ...byAgent.keys()])].filter((k) => k !== "unknown").sort();
  const lcCache = new Map<string, unknown>();
  const lifecycleOf = async (wfId: string): Promise<Record<string, unknown> | null> => {
    if (!wfId || !deps.lifecycle) return null;
    if (lcCache.has(wfId)) return lcCache.get(wfId) as Record<string, unknown> | null;
    try {
      const lc = await deps.lifecycle.workflowLifecycle(wfId);
      lcCache.set(wfId, lc);
      return lc as unknown as Record<string, unknown> | null;
    } catch {
      return null;
    }
  };
  const agents = [];
  for (const key of keys) {
    const meta = catalogEntry(key);
    const runs = (byAgent.get(key) ?? []).slice().sort((a, b) => String(b.started_at ?? "").localeCompare(String(a.started_at ?? "")));
    const latest = runs[0] ?? null;
    const agentCfg = (configMap as Record<string, { provider: string | null; model: string | null; source: string }>)[key]
      ?? (projectEffective.source === "PROJECT" ? { ...projectEffective } : null);
    const effective = agentCfg ?? { provider: null as string | null, model: null as string | null, source: "UNCONFIGURED" as string };
    const sourceLabel = effective.source === "AGENT" ? "Agent override" : effective.source === "PROJECT" ? "Project default" : effective.source === "GLOBAL" ? "Workspace default" : "Not configured";
    const succeeded = runs.filter((r) => r.execution_status === "COMPLETED").length;
    const failed = runs.filter((r) => r.execution_status === "FAILED" || r.execution_status === "BLOCKED").length;
    const last10 = runs.slice(0, 10);
    const last10ok = last10.filter((r) => r.execution_status === "COMPLETED").length;
    const latestFailed = latest !== null && (latest.execution_status === "FAILED" || latest.execution_status === "BLOCKED");
    const laterSuccess = latestFailed ? runs.some((r) => r.execution_status === "COMPLETED" && String(r.started_at ?? "") > String(latest.started_at ?? "")) : false;
    // Owner attention taxonomy reuses canonical workflow lifecycle truth:
    // a failed latest run alone never implies an Owner decision.
    let status = "HEALTHY_IDLE";
    let statusReason = "No active task; nothing waiting on this agent.";
    let attentionKind: "OWNER" | "SYSTEM" | "NONE" = "NONE";
    let attentionWorkflowId: string | null = null;
    if (latest === null) {
      statusReason = "No governed executions recorded yet.";
    } else if (!latestFailed) {
      statusReason = "Last run succeeded; no active task.";
    } else if (laterSuccess) {
      status = "HISTORICAL_FAILURE";
      statusReason = "Latest run did not succeed, but a later successful run superseded it.";
    } else {
      const wfId = String((latest as Record<string, unknown>).workflow_id ?? "");
      const lc = (await lifecycleOf(wfId)) as { overallState?: string; liveWork?: boolean } | null;
      attentionWorkflowId = wfId || null;
      if (lc === null) {
        status = "SYSTEM_ATTENTION";
        statusReason = "Workflow state unavailable; needs investigation. No Owner decision is implied.";
        attentionKind = "SYSTEM";
      } else if (lc.overallState === "NEEDS_OWNER_ATTENTION") {
        status = "OWNER_ACTION_REQUIRED";
        statusReason = "Its workflow waits on an Owner decision that can still change live state.";
        attentionKind = "OWNER";
      } else if (lc.overallState === "STATE_CONFLICT") {
        status = "SYSTEM_ATTENTION";
        statusReason = "Conflicting workflow records need platform review. No Owner decision is implied.";
        attentionKind = "SYSTEM";
      } else if (lc.liveWork) {
        status = "SYSTEM_ATTENTION";
        statusReason = "Its workflow has live queued or running work.";
        attentionKind = "SYSTEM";
      } else {
        status = "HISTORICAL_FAILURE";
        statusReason = "Latest run did not succeed; its workflow is stopped with no live state waiting on it.";
      }
    }
    let knownTotal = 0;
    let knownCount = 0;
    let unknownCount = 0;
    for (const r of runs) {
      if ((r.cost_kind === "UNKNOWN" || r.cost === null || r.cost === undefined) && r.cost_kind !== "FREE") unknownCount++;
      else if (typeof r.cost === "number" && Number.isFinite(r.cost)) { knownTotal += r.cost; knownCount++; }
    }
    const lastSuccess = runs.find((r) => r.execution_status === "COMPLETED") ?? null;
    const outs = (reports as Array<Record<string, unknown>>)
      .filter((a) => String(a.producer_agent) === key)
      .slice(0, 5)
      .map((a) => ({ artifactId: String(a.artifact_id), kind: String(a.kind), status: String(a.status), createdAt: String(a.created_at), workflowId: String(a.workflow_id ?? "") }));
    agents.push({
      agentKey: key,
      displayName: meta.displayName,
      role: meta.role,
      responsibilities: meta.responsibilities,
      registered: meta.registered,
      group: meta.registered ? (meta as unknown as { group?: string }).group ?? "AI Team" : "Runtime components",
      status,
      statusReason,
      attentionKind,
      attentionWorkflowId,
      currentActivity: null,
      currentActivityNote: "No per-agent live signal exists; running work is shown at team level only.",
      lastActiveAt: latest ? String(latest.started_at ?? latest.completed_at ?? "") : null,
      lastActiveAgo: timeAgo(latest ? String(latest.started_at ?? latest.completed_at ?? "") : null),
      recentRuns: runs.slice(0, 5).map((r) => ({
        executionId: String(r.execution_id), status: String(r.execution_status),
        task: String(r.step_id ?? r.stage ?? "governed task"),
        at: String(r.started_at ?? ""), ago: timeAgo(String(r.started_at ?? "")),
        provider: String(r.provider ?? ""), model: String(r.actual_model ?? ""),
        cost: r.cost ?? null, costKind: String(r.cost_kind ?? "UNKNOWN"),
        snapshotId: (r.strategic_snapshot_id as string | null) ?? null,
        workflowId: String(r.workflow_id ?? ""),
      })),
      outputs: outs,
      provider: effective.provider,
      providerDisplay: effective.provider ? friendlyProvider(effective.provider) : "Not configured",
      model: effective.model,
      configurationSource: effective.source,
      configurationLabel: sourceLabel,
      configurationMeaning: effective.source === "AGENT"
        ? "This agent uses its own model instead of the project default."
        : effective.source === "PROJECT"
          ? "This agent inherits the model selected for this project."
          : effective.source === "GLOBAL"
            ? "This agent uses the workspace ambient default."
            : "No model configured for this agent.",
      configurationHistory: histByAgent.get(key) ?? [],
      performance: {
        runs: runs.length, succeeded, failed,
        recentSuccessRate: last10.length ? `${last10ok} of ${last10.length} recent runs succeeded` : "No runs yet",
        qualityNote: "Technical execution success is not creative quality; no quality score exists.",
      },
      cost: {
        knownTotal, knownCount, unknownCount,
        display: knownCount > 0
          ? `$${knownTotal.toFixed(4)} known across ${knownCount} priced run(s); ${unknownCount} run(s) unknown`
          : runs.length === 0 ? "No runs yet" : `Unknown — ${unknownCount} of ${runs.length} runs lack authoritative cost`,
      },
      issues: {
        current: (status === "OWNER_ACTION_REQUIRED" || status === "SYSTEM_ATTENTION") && latest ? [{
          at: String(latest.started_at ?? ""),
          detail: status === "OWNER_ACTION_REQUIRED"
            ? "Its workflow waits on an Owner decision. See Decision Center."
            : "A current technical issue exists, but no Owner business decision is required.",
          workflowId: String(latest.workflow_id ?? ""),
        }] : [],
        historyNote: failed > 0
          ? `${failed} failed run(s) on record; earlier failures may have been superseded by later successful work — see workflow history.`
          : "No failed runs on record.",
      },
      availability: {
        state: "NOT_VERIFIED",
        note: "Only configuration presence is checked; live provider reachability is discovered at execution time.",
        lastUsed: lastSuccess ? {
          provider: String(lastSuccess.provider ?? ""), model: String(lastSuccess.actual_model ?? ""),
          at: String(lastSuccess.started_at ?? ""),
        } : null,
      },
      attention: status === "OWNER_ACTION_REQUIRED",
    });
  }
  const runningWorkflows = (health.queue?.queued ?? 0) + (health.queue?.running ?? 0);
  const team = agents.filter((a) => (a as unknown as { registered: boolean }).registered);
  const runtime = agents.filter((a) => !(a as unknown as { registered: boolean }).registered);
  sendJson(res, 200, {
    projectId,
    summary: {
      total: team.length,
      teamTotal: team.length,
      runtimeComponents: runtime.length,
      working: 0,
      workingNote: "No per-agent live execution signal exists; nothing is presented as working.",
      ownerActionRequired: agents.filter((a) => a.status === "OWNER_ACTION_REQUIRED").length,
      systemAttention: agents.filter((a) => a.status === "SYSTEM_ATTENTION").length,
      idle: agents.filter((a) => a.status === "HEALTHY_IDLE" || a.status === "HISTORICAL_FAILURE").length,
      runningWorkflows,
    },
    agents: team,
    runtimeComponents: runtime,
  });
}

async function listProjects(deps: WorkflowApiDeps, res: ServerResponse): Promise<void> {
  const projects = await deps.control.listProjects();
  if (deps.actionability) {
    // Owner attention counts genuinely actionable approvals, never raw PENDING rows.
    for (const p of projects) {
      try {
        const rows = await deps.actionability.projectActionability(p.projectId);
        p.pendingApprovals = rows.filter((r) => r.state === "ACTION_REQUIRED" || r.state === "CONFLICTED").length;
      } catch {
        // Keep the durable count when classification itself errors (fail toward attention).
      }
    }
  }
  sendJson(res, 200, { projects });
}

async function listWorkflows(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const limit = Number(url.searchParams.get("limit") ?? 20);
  sendJson(res, 200, { workflows: await deps.control.listWorkflows(projectId, Number.isFinite(limit) ? limit : 20) });
}

async function platformHealth(deps: WorkflowApiDeps, res: ServerResponse): Promise<void> {
  sendJson(res, 200, { health: await deps.control.platformHealth() });
}

async function costSummary(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, { costs: await deps.control.costSummary(projectId) });
}
function requireModelIntelligence(deps: WorkflowApiDeps): ModelIntelligenceStore { if (!deps.modelIntelligence) throw new Error("model intelligence unavailable"); return deps.modelIntelligence; }
function requireBenchmarkRuntime(deps: WorkflowApiDeps): ModelBenchmarkRuntimeStore { if (!deps.modelBenchmarkRuntime) throw new Error("model benchmark runtime unavailable"); return deps.modelBenchmarkRuntime; }
async function modelIntelligenceSummary(deps: WorkflowApiDeps, res: ServerResponse): Promise<void> { sendJson(res, 200, { provider: "openrouter", catalog: await requireModelIntelligence(deps).summary(), evaluationState: "NOT_EVALUATED", inferenceExecuted: false }); }
async function modelIntelligenceModels(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> { const value=(k:string)=>url.searchParams.get(k)??undefined;const result=await requireModelIntelligence(deps).query("openrouter",{priceClass:value("priceClass") as any,search:value("q"),providerAuthor:value("provider"),capability:value("capability") as any,evaluation:value("evaluation"),availability:value("availability"),sort:value("sort") as any,direction:value("direction") as any,page:Number(value("page")||1),pageSize:Number(value("pageSize")||25)}); sendJson(res,200,{provider:"openrouter",...result,readOnly:true}); }
async function modelIntelligenceShortlist(deps: WorkflowApiDeps, res: ServerResponse): Promise<void> { sendJson(res, 200, await requireModelIntelligence(deps).shortlist()); }
async function modelIntelligenceOverview(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const store=requireModelIntelligence(deps);const [catalog,shortlist,changes,providers]=await Promise.all([store.summary(),store.shortlist(),store.recentChanges(),store.providers()]);const routing=currentRoutingEvidence();sendJson(res,200,{catalog,routingSummary:{configured:routing.filter(x=>x.model).length,total:routing.length},shortlistPreview:{free:shortlist.freeCandidates.slice(0,2),paid:shortlist.costEfficientPaidCandidates.slice(0,2),reference:shortlist.higherCapabilityReferenceCandidates.slice(0,2)},changes,providers,benchmarkStatus:"NOT_EXECUTED",inferenceExecuted:false});}
async function modelIntelligenceProviders(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{sendJson(res,200,{providers:await requireModelIntelligence(deps).providers()});}
async function modelIntelligenceDetail(deps:WorkflowApiDeps,res:ServerResponse,modelId:string):Promise<void>{const model=await requireModelIntelligence(deps).detail("openrouter",modelId);if(!model)return sendJson(res,404,{error:"model not found"});sendJson(res,200,{model,priceHistory:await requireModelIntelligence(deps).priceHistory("openrouter",modelId,20)});}
async function modelIntelligencePriceHistory(deps:WorkflowApiDeps,res:ServerResponse,url:URL):Promise<void>{sendJson(res,200,{history:await requireModelIntelligence(deps).priceHistory("openrouter",url.searchParams.get("modelId")??undefined,Number(url.searchParams.get("limit")||100)),changes:await requireModelIntelligence(deps).recentChanges()});}
function currentRoutingEvidence(){const defaultAgent=process.env.AGENT_ROUTER_DEFAULT_MODEL??process.env.AGENTROUTER_DEFAULT_MODEL??null,openrouter=process.env.OPENROUTER_DEFAULT_MODEL??null;return [{role:"Research",provider:"agentrouter",model:defaultAgent,source:defaultAgent?"AGENT_ROUTER_DEFAULT_MODEL / AGENTROUTER_DEFAULT_MODEL":"UNRESOLVED",evaluationState:"NOT_EVALUATED"},{role:"Planner",provider:"agentrouter",model:defaultAgent,source:defaultAgent?"AGENT_ROUTER_DEFAULT_MODEL / AGENTROUTER_DEFAULT_MODEL":"UNRESOLVED",evaluationState:"NOT_EVALUATED"},{role:"Writer",provider:"agentrouter",model:defaultAgent,source:defaultAgent?"AGENT_ROUTER_DEFAULT_MODEL / AGENTROUTER_DEFAULT_MODEL":"UNRESOLVED",evaluationState:"NOT_EVALUATED"},{role:"SEO",provider:"agentrouter",model:defaultAgent,source:defaultAgent?"AGENT_ROUTER_DEFAULT_MODEL / AGENTROUTER_DEFAULT_MODEL":"UNRESOLVED",evaluationState:"NOT_EVALUATED"},{role:"OpenRouter fallback",provider:"openrouter",model:openrouter,source:openrouter?"OPENROUTER_DEFAULT_MODEL":"UNRESOLVED",evaluationState:"NOT_EVALUATED"}];}
const modelProfiles=()=>buildAgentTaskProfiles(agentCatalog());
const benchmarkProfiles=()=>buildBenchmarkRoleProfiles(agentCatalog());
async function modelIntelligenceRouting(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const active=deps.productionModelRouting?await deps.productionModelRouting.active("PROJECT","morroway"):null;sendJson(res,200,{activeRouting:active,routing:currentRoutingEvidence(),proposals:routingProposals(benchmarkProfiles()),readOnly:true,productionRoutingChanged:Boolean(active),researchArchitecture:{retrieval:"Governed Search + Social Tools",synthesisRole:"research"},ceoSafety:{authoritySafeBenchmarkStatus:"PASS",excludedModel:"openai/gpt-oss-20b",reason:"CEO authority-boundary benchmark hard failure"},balancedModelCostPerShortEstimateUsd:.0024,shortlist:await requireModelIntelligence(deps).shortlist()});}
async function modelIntelligenceRoles(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const profiles=modelProfiles();sendJson(res,200,{profiles,count:profiles.length,registeredRosterCount:agentCatalog().filter(x=>x.registered).length,complete:true,benchmarkStatus:BENCHMARK_STATUS});}
async function modelIntelligenceCandidates(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const models=await requireModelIntelligence(deps).catalog();sendJson(res,200,buildRoleCandidatePools(models,benchmarkProfiles()));}
async function modelIntelligenceBenchmarkPlan(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const models=await requireModelIntelligence(deps).catalog(),pools=buildRoleCandidatePools(models,benchmarkProfiles());sendJson(res,200,{...benchmarkDataset,executionPlan:buildBenchmarkExecutionPlan(pools),structuredUtilityClassification,benchmarkCalls:0,spendUsd:0,inferenceAuthorized:false});}
async function modelIntelligenceBenchmarkRuntime(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const contracts=validateBenchmarkContracts(),runtime=await requireBenchmarkRuntime(deps).readinessEvidence(benchmarkDataset.version),requiredTables=["model_benchmark_runs","model_benchmark_fixtures","model_benchmark_executions","model_benchmark_artifacts","model_benchmark_evidence","model_benchmark_blind_candidates","model_benchmark_owner_reviews","model_benchmark_finalists"],blockers=[...contracts.blockers];for(const t of requiredTables)if(!runtime.tables.includes(t))blockers.push(`MISSING_TABLE:${t}`);if(runtime.fixtureCount!==benchmarkFixtures.length)blockers.push(`PERSISTED_FIXTURE_COUNT:${runtime.fixtureCount}/${benchmarkFixtures.length}`);const credentialAvailable=Boolean(process.env.OPENROUTER_API_KEY?.trim());if(!credentialAvailable)blockers.push("OPENROUTER_CREDENTIAL_UNAVAILABLE");const readiness=await requireBenchmarkRuntime(deps).run("amf-mrb-v1.1.1-readiness"),inferenceAuthorized=readiness?.authorization_state==="AUTHORIZED";sendJson(res,200,{datasetVersion:benchmarkDataset.version,preflight:{readyForRuntime:blockers.length===0,readyForInference:blockers.length===0&&inferenceAuthorized,blockers,checks:{credentialAvailable,datasetComplete:contracts.ready,fixturesPersisted:runtime.fixtureCount===benchmarkFixtures.length,researchFixturePresent:Boolean(benchmarkFixtures.find(x=>x.taskId==="research-01")?.structuredInputs?.researchEvidence),ledgerOperational:requiredTables.every(t=>runtime.tables.includes(t)),artifactPersistenceOperational:runtime.tables.includes("model_benchmark_artifacts"),atomicReservationImplemented:true,hardCapUsd:Number(readiness?.hard_spend_cap_usd??.32),evaluatorsComplete:contracts.evaluatorCount===benchmarkFixtures.length,weightsValid:contracts.blockers.every(x=>!x.startsWith("INVALID_WEIGHT_SUM")),blindReviewReady:true,finalistResolverDeterministic:resolveFinalists([{modelId:"a",hardFail:false,taskCoverage:1,weightedScore:80,reliability:90,calculableCost:.01,latencyMs:100}],1).finalists[0]?.modelId==="a",productionRoutingIsolated:true,inferenceAuthorizationExplicit:true}},fixtureCount:contracts.fixtureCount,evaluatorCount:contracts.evaluatorCount,evaluatorVersion:BENCHMARK_EVALUATOR_VERSION,latestRun:readiness?{benchmarkRunId:readiness.benchmark_run_id,status:readiness.status,authorizationState:readiness.authorization_state,hardCapUsd:Number(readiness.hard_spend_cap_usd),reservedSpendUsd:Number(readiness.reserved_spend_usd),calculableSpendUsd:Number(readiness.calculable_spend_usd)}:null,latestCompletedSimulation:runtime.latestCompletedSimulation,inferenceAuthorized,productionRoutingChanged:false,providerCalls:0});}
async function modelIntelligenceBlindReviews(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const store=requireBenchmarkRuntime(deps),runtime=await store.readinessEvidence(benchmarkDataset.version),latest=await store.latestRun(),realRun=latest?.authorization_state==="AUTHORIZED"?latest:null,runId=realRun?.benchmark_run_id??runtime.latestCompletedSimulation?.benchmark_run_id,reviews=runId?await store.blindQueue(runId):[],real=Boolean(realRun);sendJson(res,200,{...benchmarkDataset.blindReview,status:reviews.some((x:any)=>!x.finalized)?"OWNER_REVIEW_REQUIRED":reviews.length?(real?"OWNER_REVIEW_COMPLETE":"SIMULATION_COMPLETE"):"READY_NO_OUTPUTS",reviews,modelIdentityExposed:false,benchmarkRunId:runId??null,simulation:!real});}
async function saveModelIntelligenceBlindReview(deps:WorkflowApiDeps,req:IncomingMessage,res:ServerResponse):Promise<void>{const b=await readBody(req) as any,runId=String(b.benchmarkRunId||""),taskId=String(b.taskId||""),blindCandidateId=String(b.blindCandidateId||""),scores=b.dimensionScores;if(!runId||!taskId||!blindCandidateId||!scores||typeof scores!=="object"||Array.isArray(scores))return sendJson(res,422,{error:"benchmarkRunId, taskId, blindCandidateId and dimensionScores are required"});if(Object.values(scores).some(v=>typeof v!=="number"||v<0||v>5))return sendJson(res,422,{error:"blind scores must be numeric values from 0 to 5"});await requireBenchmarkRuntime(deps).saveOwnerReview({reviewId:`owner-review-${randomUUID()}`,runId,taskId,blindCandidateId,dimensionScores:scores,notes:typeof b.notes==="string"?b.notes.slice(0,2000):null,reviewerType:"OWNER",finalized:Boolean(b.finalized),provenance:{source:"OWNER_UI"}});sendJson(res,201,{status:b.finalized?"FINALIZED":"RECORDED",modelIdentityExposed:false,productionRoutingChanged:false});}
function modelIntelligenceExecutive(res:ServerResponse):void{sendJson(res,200,{ceo:executiveArchitecture,orchestrator:orchestratorArchitecture,governance:{productionAuthority:"NOT_GRANTED",publicationAuthority:"NOT_GRANTED",ownerBoundaryPreserved:true}});}
async function modelIntelligenceCost(deps:WorkflowApiDeps,res:ServerResponse):Promise<void>{const models=await requireModelIntelligence(deps).catalog(),pools=buildRoleCandidatePools(models,benchmarkProfiles());sendJson(res,200,{...costArchitecture,executionPlan:buildBenchmarkExecutionPlan(pools)});}

async function projectArtifacts(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  const workflowId = url.searchParams.get("workflowId");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
  if (!projectId && !workflowId) return sendJson(res, 400, { error: "projectId or workflowId is required" });
  if (workflowId) {
    const submission = await deps.queue.loadSubmissionByWorkflow(workflowId);
    if (!submission) return sendJson(res, 404, { error: `workflow not found: ${workflowId}` });
    // Program 5: when a project scope is claimed alongside a workflow ID,
    // the workflow must belong to that project (fail closed on mismatch).
    // Bare workflow-ID access remains a direct canonical reference.
    const submissionBrand = (submission as unknown as Record<string, unknown>).brandId;
    if (projectId && typeof submissionBrand === "string" && submissionBrand !== projectId) {
      return sendJson(res, 403, { error: "workflow does not belong to the requested project" });
    }
    const artifacts = await deps.persistence.listArtifacts(workflowId);
    return sendJson(res, 200, { workflowId, artifacts: artifacts.slice(0, limit) });
  }
  const reports = await deps.control.reports(projectId as string);
  sendJson(res, 200, { projectId, artifacts: reports.slice(0, limit) });
}

/**
 * Slice 7 — safe artifact inspection delivery (read-only, no mutation).
 *
 * The browser references a canonical artifact ID only. The server resolves
 * the inspection bytes from durable artifact metadata and streams them
 * from explicitly permitted storage roots. Every rejection path returns a
 * generic message: local absolute paths never reach the browser.
 * Inspection bytes are derivative (decoded data URLs or confined file
 * reads); canonical artifact identity, digest, and lineage are untouched.
 */
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_\-.:]{0,200}$/;
const PREVIEW_MAX_BYTES = 256 * 1024 * 1024;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PREVIEW_ROOTS = [path.join(REPO_ROOT, "output"), path.join(REPO_ROOT, "artifacts")];

interface ArtifactPreviewSpec {
  /** Payload field holding a file reference or data: URL. */
  readonly field: string;
  /** Allowed file extensions mapped to served content types. */
  readonly extensions: Readonly<Record<string, string>>;
  /** Payload fields holding a hex sha256 of the inspection bytes (verified when present). */
  readonly shaFields: readonly string[];
}

const ARTIFACT_PREVIEW_SPECS: Readonly<Record<string, ArtifactPreviewSpec>> = {
  final_media_artifact: { field: "finalFileReference", extensions: { ".mp4": "video/mp4" }, shaFields: ["sha256"] },
  scene_video_clip: { field: "videoPathOrReference", extensions: { ".mp4": "video/mp4" }, shaFields: ["videoSha256"] },
  scene_visual_artifact: { field: "artifactPathOrReference", extensions: { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }, shaFields: ["imageSha256"] },
  narration_audio_artifact: { field: "path", extensions: { ".wav": "audio/wav", ".mp3": "audio/mpeg" }, shaFields: ["sha256"] },
  chunk_audio_artifact: { field: "path", extensions: { ".wav": "audio/wav", ".mp3": "audio/mpeg" }, shaFields: ["sha256"] },
};

const PREVIEW_DATA_MEDIA_TYPES: Readonly<Record<string, string>> = {
  "video/mp4": ".mp4",
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".mp4",
};

const DATA_URL_PATTERN = /^data:([A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+)(?:;[A-Za-z0-9-]+)*;base64,([\s\S]*)$/;
const HEX64_PATTERN = /^[0-9a-fA-F]{64}$/;

function previewDeny(res: ServerResponse, status: 400 | 404 | 403 | 413 | 416 | 500, size?: number): void {
  if (status === 416) {
    res.writeHead(416, {
      "Content-Range": `bytes */${size ?? 0}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    });
    res.end();
    return;
  }
  sendJson(res, status, {
    error: status === 400 ? "artifactId is required"
      : status === 403 ? "preview forbidden"
        : "preview unavailable",
  });
}

function parsePreviewRange(header: string | string[] | undefined, size: number): { start: number; end: number } | { invalid: true } | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined || raw === null || raw === "") return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw.trim());
  if (!m || (m[1] === "" && m[2] === "")) return { invalid: true };
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    if (!Number.isSafeInteger(start)) return { invalid: true };
    end = m[2] === "" ? size - 1 : Number(m[2]);
    if (!Number.isSafeInteger(end)) return { invalid: true };
  }
  if (start >= size || end < start) return { invalid: true };
  return { start, end: Math.min(end, size - 1) };
}

function previewHeaders(contentType: string, filename: string, size: number, range: { start: number; end: number } | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String((range ? range.end - range.start : size - 1) + 1),
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename="${filename}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };
  if (range) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
  return headers;
}

/** Resolve a payload file reference to an absolute path inside a permitted root. Never throws. */
function resolvePreviewFile(raw: string): { ok: true; abs: string; size: number } | { ok: false; status: 403 | 404 | 413 } {
  if (raw.length === 0 || raw.length > 1024 || raw.includes("\0")) return { ok: false, status: 403 };
  // Scheme injection (http:, file: — data: never reaches this file branch).
  // A bare Windows drive prefix ("D:\…") is a local path, not a scheme:
  // schemes require at least two leading name characters here.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]+:/.test(raw)) return { ok: false, status: 403 };
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(REPO_ROOT, raw);
  const inside = PREVIEW_ROOTS.some((root) => abs === root || abs.startsWith(root + path.sep));
  if (!inside) return { ok: false, status: 403 };
  let st;
  try {
    st = lstatSync(abs);
  } catch {
    return { ok: false, status: 404 };
  }
  if (st.isSymbolicLink() || !st.isFile()) return { ok: false, status: 403 };
  if (st.size > PREVIEW_MAX_BYTES) return { ok: false, status: 413 };
  return { ok: true, abs, size: st.size };
}

async function artifactPreview(deps: WorkflowApiDeps, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const artifactId = url.searchParams.get("artifactId") ?? "";
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) return previewDeny(res, 400);
  let artifact;
  try {
    artifact = await deps.persistence.getArtifactById(artifactId);
  } catch {
    return previewDeny(res, 404);
  }
  if (!artifact) return previewDeny(res, 404);
  const spec = ARTIFACT_PREVIEW_SPECS[artifact.kind];
  if (!spec) return previewDeny(res, 404);
  const payload = artifact.payload !== null && typeof artifact.payload === "object" && !Array.isArray(artifact.payload)
    ? artifact.payload as Record<string, unknown>
    : {};
  const raw = payload[spec.field];
  if (typeof raw !== "string" || raw.length === 0) return previewDeny(res, 404);
  const filename = `${artifactId}`;
  // Branch 1: embedded data: URL — decode deterministically, verify digest when recorded.
  if (raw.startsWith("data:")) {
    const m = DATA_URL_PATTERN.exec(raw);
    const ext = m ? PREVIEW_DATA_MEDIA_TYPES[m[1].toLowerCase()] : undefined;
    if (!m || !ext) return previewDeny(res, 404);
    const compact = m[2].replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=]*$/.test(compact) || compact.length % 4 !== 0) return previewDeny(res, 404);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(compact, "base64");
    } catch {
      return previewDeny(res, 404);
    }
    if (bytes.length > PREVIEW_MAX_BYTES) return previewDeny(res, 413);
    for (const field of spec.shaFields) {
      const recorded = payload[field];
      if (typeof recorded === "string" && HEX64_PATTERN.test(recorded)) {
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== recorded.toLowerCase()) return previewDeny(res, 500);
      }
    }
    return servePreviewBytes(req, res, bytes, m[1].toLowerCase(), `${filename}${ext}`);
  }
  // Branch 2: file reference confined to permitted storage roots.
  const resolved = resolvePreviewFile(raw);
  if (!resolved.ok) {
    if (resolved.status === 413) return previewDeny(res, 413);
    return previewDeny(res, resolved.status);
  }
  const ext = path.extname(resolved.abs).toLowerCase();
  const contentType = spec.extensions[ext];
  if (!contentType) return previewDeny(res, 404);
  return servePreviewFile(req, res, resolved.abs, resolved.size, contentType, `${filename}${ext}`);
}

function servePreviewBytes(
  req: IncomingMessage, res: ServerResponse, bytes: Buffer, contentType: string, filename: string,
): void {
  const range = parsePreviewRange(req.headers.range, bytes.length);
  if (range && "invalid" in range) return previewDeny(res, 416, bytes.length);
  const status = range ? 206 : 200;
  res.writeHead(status, previewHeaders(contentType, filename, bytes.length, range));
  res.end(bytes.subarray(range ? range.start : 0, (range ? range.end : bytes.length - 1) + 1));
}

function servePreviewFile(
  req: IncomingMessage, res: ServerResponse, abs: string, size: number, contentType: string, filename: string,
): void {
  const range = parsePreviewRange(req.headers.range, size);
  if (range && "invalid" in range) return previewDeny(res, 416, size);
  const status = range ? 206 : 200;
  res.writeHead(status, previewHeaders(contentType, filename, size, range));
  const stream = createReadStream(abs, range ? { start: range.start, end: range.end } : {});
  stream.on("error", () => {
    try {
      res.destroy();
    } catch {
      // Response already heading out; nothing further to report safely.
    }
  });
  stream.pipe(res);
}

async function publicationReadiness(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const workflowId = url.searchParams.get("workflowId") ?? undefined;
  sendJson(res, 200, { readiness: await deps.control.publicationReadiness(projectId, workflowId) });
}

async function configurationHistory(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const agentId = url.searchParams.get("agentId") ?? undefined;
  sendJson(res, 200, { history: await deps.control.configurationHistory(projectId, agentId) });
}

async function configurationMap(deps: WorkflowApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const projectId = url.searchParams.get("projectId");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  sendJson(res, 200, {
    project: await deps.control.effectiveConfiguration(projectId),
    agents: await deps.control.agentConfigurationMap(projectId),
    precedence: ["Global Default", "Project Override", "Agent Override"],
    note: "GLOBAL writes are not exposed in V1; PROJECT overrides fall back to built-in UNCONFIGURED when absent.",
  });
}

async function handleStatus(deps: WorkflowApiDeps, res: ServerResponse, workflowId: string): Promise<void> {
  const submission = await deps.queue.loadSubmissionByWorkflow(workflowId);
  if (submission === null) {
    sendJson(res, 404, { error: `workflow not found: ${workflowId}` });
    return;
  }
  const instance = await deps.persistence.loadWorkflow(workflowId);
  const jobs = await deps.queue.listJobsByWorkflow(workflowId);
  sendJson(res, 200, {
    workflowId,
    directive: submission.directive,
    correlationId: submission.correlationId,
    brandId: submission.brandId,
    submissionStatus: submission.status,
    // Generalized command executions do not create workflow-step instances;
    // their durable queue submission is the terminal-state authority.
    state: instance?.state ?? (submission.status === "completed" ? "COMPLETED" : submission.status === "failed" ? "FAILED" : "queued"),
    steps: instance?.steps ?? [],
    jobs,
    createdAt: submission.createdAt,
    updatedAt: submission.updatedAt,
  });
}

async function handleList(
  deps: WorkflowApiDeps,
  res: ServerResponse,
  workflowId: string,
  kind: "artifacts" | "lineage" | "executions"
): Promise<void> {
  const submission = await deps.queue.loadSubmissionByWorkflow(workflowId);
  if (submission === null) {
    sendJson(res, 404, { error: `workflow not found: ${workflowId}` });
    return;
  }
  if (kind === "artifacts") {
    const artifacts = await deps.persistence.listArtifacts(workflowId);
    sendJson(res, 200, { workflowId, artifacts });
    return;
  }
  if (kind === "lineage") {
    const artifacts = await deps.persistence.listArtifacts(workflowId);
    sendJson(res, 200, {
      workflowId,
      lineage: artifacts.map((a) => ({
        artifactId: a.artifactId,
        kind: a.kind,
        producerAgent: a.producerAgent,
        parentArtifact: a.parentArtifact ?? null,
      })),
    });
    return;
  }
  const executions = await deps.persistence.listCapabilityExecutions(workflowId);
  sendJson(res, 200, { workflowId, executions });
}
