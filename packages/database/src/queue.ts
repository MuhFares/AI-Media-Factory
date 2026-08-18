/**
 * PostgresQueue — durable, at-least-once async job queue backed by PostgreSQL.
 *
 * Phase 1: the API enqueues workflow jobs; a worker claims, executes and acks
 * them. The queue guarantees:
 *  - idempotent submission (workflow_submissions unique on submission_key) so a
 *    duplicate POST never creates a second workflow;
 *  - exactly-once-per-claim claim semantics (FOR UPDATE SKIP LOCKED) so two
 *    workers never run the same job concurrently;
 *  - crash recovery: jobs left in `running` past a staleness window are
 *    reclaimed as `queued` so a restarted worker re-processes them idempotently
 *    (the Workflow Engine resumes from its checkpoint — no duplicated work).
 */

import type pg from "pg";
import type { Json, Uuid } from "@ai-media-factory/shared";
import type { WorkflowDefinition } from "@ai-media-factory/workflow-engine";

/** A workflow that was submitted for asynchronous execution. */
export interface WorkflowSubmission {
  readonly submissionKey: string;
  readonly workflowId: Uuid;
  readonly directive: string;
  readonly correlationId: string | null;
  readonly brandId: string | null;
  readonly definition: WorkflowDefinition;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** A claimed (running) or queued workflow job. */
export interface WorkflowJob {
  readonly jobId: number;
  readonly workflowId: Uuid;
  readonly submissionKey: string;
  readonly status: "queued" | "running" | "succeeded" | "failed";
  readonly attempts: number;
  readonly claimedAt: string | null;
  readonly error: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubmitWorkflowInput {
  readonly submissionKey: string;
  readonly workflowId: Uuid;
  readonly directive: string;
  readonly correlationId: string | null;
  readonly brandId: string | null;
  readonly definition: WorkflowDefinition;
  readonly status?: string;
}

const JSON_PARSE = (v: unknown): any => {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return JSON.parse(v);
  return v;
};

export class PostgresQueue {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Insert a submission record idempotently. Returns `created: false` when the
   * same submission_key already exists (a duplicate request reuses the workflow).
   */
  async submit(input: SubmitWorkflowInput): Promise<{ created: boolean }> {
    const now = new Date().toISOString();
    const res = await this.pool.query(
      `INSERT INTO workflow_submissions
         (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       ON CONFLICT (submission_key) DO NOTHING
       RETURNING submission_key`,
      [
        input.submissionKey,
        input.workflowId,
        input.directive,
        input.correlationId,
        input.brandId,
        JSON.stringify(input.definition),
        input.status ?? "submitted",
        now,
      ]
    );
    return { created: res.rowCount !== null && res.rowCount > 0 };
  }

  async loadSubmissionByWorkflow(workflowId: Uuid): Promise<WorkflowSubmission | null> {
    const res = await this.pool.query(
      `SELECT submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at
       FROM workflow_submissions WHERE workflow_id = $1`,
      [workflowId]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      submissionKey: r.submission_key,
      workflowId: r.workflow_id,
      directive: r.directive,
      correlationId: r.correlation_id,
      brandId: r.brand_id,
      definition: JSON_PARSE(r.definition),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async loadSubmissionByKey(submissionKey: string): Promise<WorkflowSubmission | null> {
    const res = await this.pool.query(
      `SELECT submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at
       FROM workflow_submissions WHERE submission_key = $1`,
      [submissionKey]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      submissionKey: r.submission_key,
      workflowId: r.workflow_id,
      directive: r.directive,
      correlationId: r.correlation_id,
      brandId: r.brand_id,
      definition: JSON_PARSE(r.definition),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async updateSubmissionStatus(workflowId: Uuid, status: string): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_submissions SET status = $2, updated_at = $3 WHERE workflow_id = $1`,
      [workflowId, status, new Date().toISOString()]
    );
  }

  /** Enqueue a job for a submitted workflow. Returns the new job id. */
  async enqueue(workflowId: Uuid, submissionKey: string): Promise<number> {
    const now = new Date().toISOString();
    const res = await this.pool.query(
      `INSERT INTO workflow_jobs (workflow_id, submission_key, status, attempts, created_at, updated_at)
       VALUES ($1,$2,'queued',0,$3,$3)
       RETURNING job_id`,
      [workflowId, submissionKey, now]
    );
    return Number(res.rows[0].job_id);
  }

  /**
   * Atomically claim the next queued job. Returns null when the queue is empty.
   * Concurrency-safe: only one worker claims a given job (FOR UPDATE SKIP LOCKED).
   */
  async claimNextJob(): Promise<WorkflowJob | null> {
    const now = new Date().toISOString();
    const res = await this.pool.query(
      `UPDATE workflow_jobs SET status = 'running', claimed_at = $1::text, attempts = attempts + 1, updated_at = $1::text
       WHERE job_id = (
         SELECT job_id FROM workflow_jobs
         WHERE status = 'queued'
         ORDER BY job_id
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING job_id, workflow_id, submission_key, status, attempts, claimed_at, error, created_at, updated_at`,
      [now]
    );
    if (res.rowCount === 0) return null;
    return this.mapJob(res.rows[0]);
  }

  /** Acknowledge a job as succeeded (or failed with an error). */
  async acknowledge(jobId: number, status: "succeeded" | "failed", error?: string): Promise<void> {
    await this.pool.query(
      `UPDATE workflow_jobs SET status = $2::text, error = $3::text, updated_at = $4::text WHERE job_id = $1::bigint`,
      [jobId, status, error ?? null, new Date().toISOString()]
    );
  }

  /**
   * Reclaim jobs left `running` past the staleness window (worker crash). They
   * return to `queued` so a restarted worker re-processes them; engine.resume()
   * makes the re-run idempotent. Returns the number reclaimed.
   */
  async recoverOrphanedJobs(staleMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const res = await this.pool.query(
      `UPDATE workflow_jobs SET status = 'queued', claimed_at = NULL, updated_at = $1::text
       WHERE status = 'running' AND (claimed_at IS NULL OR claimed_at < $1::text)
       RETURNING job_id`,
      [cutoff]
    );
    return res.rowCount ?? 0;
  }

  async listJobsByWorkflow(workflowId: Uuid): Promise<WorkflowJob[]> {
    const res = await this.pool.query(
      `SELECT job_id, workflow_id, submission_key, status, attempts, claimed_at, error, created_at, updated_at
       FROM workflow_jobs WHERE workflow_id = $1 ORDER BY job_id`,
      [workflowId]
    );
    return res.rows.map((r: any) => this.mapJob(r));
  }

  async getJob(jobId: number): Promise<WorkflowJob | null> {
    const res = await this.pool.query(
      `SELECT job_id, workflow_id, submission_key, status, attempts, claimed_at, error, created_at, updated_at
       FROM workflow_jobs WHERE job_id = $1::bigint`,
      [jobId]
    );
    if (res.rowCount === 0) return null;
    return this.mapJob(res.rows[0]);
  }

  private mapJob(r: any): WorkflowJob {
    return {
      jobId: Number(r.job_id),
      workflowId: r.workflow_id,
      submissionKey: r.submission_key,
      status: r.status,
      attempts: r.attempts,
      claimedAt: r.claimed_at,
      error: r.error,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}

export type { Json };
