/**
 * Program 6 — Governed Automation API surface (Node control plane).
 *
 * Read-only GETs stay open for inspection surfaces. All POSTs are Owner-gated
 * by the global requireOwner() check in handler.ts. Nothing here calls live
 * providers, publishes, spends, or grants authority: the store enforces the
 * L2 boundary and every automatic action is audited to automation_events.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AutomationStore } from "@ai-media-factory/database";

export interface AutomationApiDeps {
  readonly automation?: AutomationStore;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Cache-Control": "no-store" });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw.length === 0 ? {} : (JSON.parse(raw) as Record<string, unknown>));
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function requireAutomation(deps: AutomationApiDeps): AutomationStore {
  if (!deps.automation) throw new Error("automation store is not configured");
  return deps.automation;
}

export async function automationPolicyGet(deps: AutomationApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireAutomation(deps);
  const projectId = url.searchParams.get("projectId") ?? url.searchParams.get("project");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const policy = await store.getPolicy(projectId);
  const budgets = await store.getCallBudgets(projectId);
  sendJson(res, 200, { policy, budgets });
}

export async function automationPolicySet(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  try {
    const policy = await store.setPolicy({
      projectId: body.projectId,
      enabled: body.enabled === true,
      level: String(body.level ?? "L0_MANUAL"),
      allowedOps: Array.isArray(body.allowedOps) ? body.allowedOps.map(String) : [],
      humanGatedOps: Array.isArray(body.humanGatedOps) ? body.humanGatedOps.map(String) : [],
      providerPolicy: (body.providerPolicy as { mode: "DENY_ALL" | "ALLOW_INTERNAL_ONLY" | "ALLOW_LISTED"; allowedProviderOps?: string[] } | undefined) ?? { mode: "DENY_ALL" },
      publicationPolicy: body.publicationPolicy as "PREPARE_ONLY" | "OWNER_APPROVAL_REQUIRED" | "PREAUTHORIZED_PRIVATE_VALIDATION" | "PREAUTHORIZED_DESTINATION_SCOPE" | undefined,
      nextCyclePolicy: body.nextCyclePolicy as "OWNER_START_ONLY" | "AUTO_START_AFTER_OWNER_APPROVAL" | "L2_PREAUTHORIZED_INTERNAL_CYCLE" | undefined,
      updatedBy: typeof body.updatedBy === "string" ? body.updatedBy : "owner",
    });
    sendJson(res, 200, { policy });
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function automationStatus(deps: AutomationApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireAutomation(deps);
  const projectId = url.searchParams.get("projectId") ?? url.searchParams.get("project");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const status = await store.getAutomationStatus(projectId);
  const attention = await store.listAttention(projectId, { status: "OPEN", limit: 20 });
  sendJson(res, 200, { ...status, openAttention: attention });
}

export async function automationOverview(deps: AutomationApiDeps, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const projects = await store.getPlatformOverview();
  sendJson(res, 200, { projects, count: projects.length });
}

export async function automationJobsList(deps: AutomationApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireAutomation(deps);
  const projectId = url.searchParams.get("projectId") ?? url.searchParams.get("project");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const jobs = await store.listJobs(projectId, {
    state: url.searchParams.get("state") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 50),
  });
  sendJson(res, 200, { projectId, jobs, count: jobs.length });
}

export async function automationJobSchedule(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  if (typeof body.jobType !== "string" || !body.jobType) return sendJson(res, 400, { error: "jobType is required" });
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) return sendJson(res, 400, { error: "idempotencyKey is required" });
  try {
    const { job, created } = await store.scheduleJob({
      projectId: body.projectId,
      jobType: body.jobType,
      dueAt: typeof body.dueAt === "string" ? body.dueAt : undefined,
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
      idempotencyKey: body.idempotencyKey,
      maxAttempts: typeof body.maxAttempts === "number" ? body.maxAttempts : undefined,
    });
    sendJson(res, 200, { job, created });
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function automationJobCancel(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse, jobId: string): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  const job = await store.cancelJob(jobId, body.projectId, typeof body.reason === "string" ? body.reason : "owner-cancelled");
  sendJson(res, 200, { job });
}

export async function automationEvents(deps: AutomationApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireAutomation(deps);
  const projectId = url.searchParams.get("projectId") ?? url.searchParams.get("project");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const events = await store.listEvents(projectId, Number(url.searchParams.get("limit") ?? 50));
  sendJson(res, 200, { projectId, events, count: events.length });
}

export async function automationAttentionList(deps: AutomationApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireAutomation(deps);
  const projectId = url.searchParams.get("projectId") ?? url.searchParams.get("project");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const items = await store.listAttention(projectId, {
    status: url.searchParams.get("status") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 50),
  });
  sendJson(res, 200, { projectId, attention: items, count: items.length });
}

export async function automationAttentionResolve(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse, attentionId: string): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  const attention = await store.resolveAttention(attentionId, body.projectId, typeof body.resolvedBy === "string" ? body.resolvedBy : "owner");
  if (!attention) return sendJson(res, 404, { error: "attention not found" });
  sendJson(res, 200, { attention });
}

export async function automationBudgetsGet(deps: AutomationApiDeps, res: ServerResponse, url: URL): Promise<void> {
  const store = requireAutomation(deps);
  const projectId = url.searchParams.get("projectId") ?? url.searchParams.get("project");
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const budgets = await store.getCallBudgets(projectId);
  sendJson(res, 200, { projectId, budgets });
}

export async function automationBudgetSet(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  if (typeof body.callKind !== "string" || !body.callKind) return sendJson(res, 400, { error: "callKind is required" });
  if (typeof body.limitCount !== "number") return sendJson(res, 400, { error: "limitCount is required" });
  try {
    const budget = await store.setCallBudget({ projectId: body.projectId, callKind: body.callKind, limitCount: body.limitCount,
      maxRetries: typeof body.maxRetries === "number" ? body.maxRetries : 0,
      limitKind: body.limitKind === "SOFT" ? "SOFT" : "HARD",
      costKind: body.costKind === "KNOWN" ? "KNOWN" : "UNKNOWN",
      knownUnitCostUsd: typeof body.knownUnitCostUsd === "number" ? body.knownUnitCostUsd : null });
    sendJson(res, 200, { budget });
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function automationExplain(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const explanation = await store.explain(projectId);
  sendJson(res, 200, { ...explanation, executed: false });
}

export async function automationTick(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (!projectId) return sendJson(res, 400, { error: "projectId is required" });
  const result = await store.tick(projectId, {
    maxActions: typeof body.maxActions === "number" ? body.maxActions : 5,
    actor: typeof body.actor === "string" ? body.actor : "owner-tick",
  });
  sendJson(res, 200, result);
}

export async function automationTrigger(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  if (typeof body.triggerKind !== "string" || !body.triggerKind) return sendJson(res, 400, { error: "triggerKind is required" });
  try {
    const result = await store.recordTrigger({
      projectId: body.projectId,
      triggerKind: body.triggerKind,
      subjectType: typeof body.subjectType === "string" ? body.subjectType : null,
      subjectId: typeof body.subjectId === "string" ? body.subjectId : null,
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
    });
    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function automationProposalEvaluate(deps: AutomationApiDeps, res: ServerResponse, proposalId: string): Promise<void> {
  const store = requireAutomation(deps);
  const evaluation = await store.evaluateNextCycleProposal(proposalId);
  sendJson(res, 200, evaluation);
}

export async function automationProposalStart(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse, proposalId: string): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  const result = await store.startNextCycle(proposalId, typeof body.actor === "string" ? body.actor : "owner");
  sendJson(res, 200, result);
}

export async function automationMeasurementSchedule(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) return sendJson(res, 400, { error: "idempotencyKey is required" });
  try {
    const { job, created } = await store.scheduleAnalyticsMeasurement({
      projectId: body.projectId,
      publicationId: typeof body.publicationId === "string" ? body.publicationId : null,
      channelId: typeof body.channelId === "string" ? body.channelId : null,
      windowStart: typeof body.windowStart === "string" ? body.windowStart : null,
      windowEnd: typeof body.windowEnd === "string" ? body.windowEnd : null,
      dueAt: typeof body.dueAt === "string" ? body.dueAt : undefined,
      idempotencyKey: body.idempotencyKey,
    });
    sendJson(res, 200, { job, created });
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function automationLearningChain(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  if (typeof body.observationId !== "string" || !body.observationId) return sendJson(res, 400, { error: "observationId is required" });
  try {
    const result = await store.progressLearningChain({ projectId: body.projectId, observationId: body.observationId, actor: "owner-api" });
    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function automationRecover(deps: AutomationApiDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const store = requireAutomation(deps);
  const body = await readBody(req);
  if (typeof body.projectId !== "string" || !body.projectId) return sendJson(res, 400, { error: "projectId is required" });
  const result = await store.recoverAfterRestart(body.projectId);
  sendJson(res, 200, result);
}
