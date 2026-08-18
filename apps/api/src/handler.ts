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
import type { PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { directiveToWorkflowDefinition, Orchestrator } from "@ai-media-factory/orchestrator";

export interface WorkflowApiDeps {
  readonly persistence: PostgresPersistence;
  readonly queue: PostgresQueue;
}

export interface SubmitBody {
  readonly directive?: unknown;
  readonly correlationId?: unknown;
  readonly brandId?: unknown;
  readonly idempotencyKey?: unknown;
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
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

      if (method === "POST" && path === "/workflows") {
        return await handleCreate(deps, orchestrator, req, res);
      }

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
  const brandId = typeof body.brandId === "string" ? body.brandId : null;
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
    state: instance?.state ?? "queued",
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
