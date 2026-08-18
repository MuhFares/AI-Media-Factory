/**
 * WorkflowWorker — consumes durable queue jobs and runs them to completion
 * through the durable Workflow Engine.
 *
 * Flow (per job):
 *   claim next job  →  load submission  →  build durable engine
 *   →  start (new) OR resume (crash re-run)  →  wait for terminal state
 *   →  acknowledge (succeeded / failed)  →  update submission status.
 *
 * Crash safety: a killed worker leaves its job `running`. On restart,
 * recoverOrphans() re-queues stale running jobs; engine.resume() reloads the
 * checkpoint, skips completed stages and re-runs only in-flight steps
 * idempotently (no duplicated artifacts / evidence / lineage).
 */

import type { PersistencePort, WorkflowDefinition, DefaultWorkflowEngine } from "@ai-media-factory/workflow-engine";
import type { AgentExecutorPort } from "@ai-media-factory/shared";
import type { PostgresQueue, WorkflowJob } from "@ai-media-factory/database";
import { buildDefaultEngine } from "./engine.js";
import { waitForTerminalState } from "./engine.js";

export interface WorkflowWorkerDeps {
  readonly queue: PostgresQueue;
  readonly persistence: PersistencePort;
  readonly executor: AgentExecutorPort;
  /** Reclaim a running job older than this (ms) after a worker crash. */
  readonly orphanStaleMs?: number;
  readonly pollMs?: number;
  readonly buildEngine?: (definition: WorkflowDefinition) => DefaultWorkflowEngine;
}

export class WorkflowWorker {
  private readonly staleMs: number;
  private readonly pollMs: number;
  private readonly buildEngine: (definition: WorkflowDefinition) => DefaultWorkflowEngine;
  private stopped = false;

  constructor(private readonly deps: WorkflowWorkerDeps) {
    this.staleMs = deps.orphanStaleMs ?? 10_000;
    this.pollMs = deps.pollMs ?? 100;
    this.buildEngine =
      deps.buildEngine ??
      ((definition) =>
        buildDefaultEngine({
          persistence: deps.persistence,
          executor: deps.executor,
          definitionLoader: async () => definition,
        }));
  }

  /** Requeue stale running jobs left by a crashed worker. Returns count. */
  async recoverOrphans(): Promise<number> {
    return this.deps.queue.recoverOrphanedJobs(this.staleMs);
  }

  /**
   * Claim + process one job. Returns true if a job was handled, false if the
   * queue was empty. Used directly by tests; runLoop() drives it continuously.
   */
  async runOnce(): Promise<boolean> {
    const job = await this.deps.queue.claimNextJob();
    if (job === null) return false;
    await this.process(job);
    return true;
  }

  async runLoop(): Promise<void> {
    await this.recoverOrphans();
    while (!this.stopped) {
      const handled = await this.runOnce();
      if (!handled) await new Promise((r) => setTimeout(r, this.pollMs));
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private async process(job: WorkflowJob): Promise<void> {
    const submission = await this.deps.queue.loadSubmissionByWorkflow(job.workflowId);
    if (submission === null) {
      await this.deps.queue.acknowledge(job.jobId, "failed", "submission not found");
      return;
    }

    const engine = this.buildEngine(submission.definition);
    const existing = await this.deps.persistence.loadWorkflow(job.workflowId);

    try {
      if (existing === null) {
        await engine.start({
          definition: submission.definition,
          trigger: { directive: submission.directive },
          correlationId: submission.correlationId ?? undefined,
          brandId: submission.brandId ?? undefined,
          workflowId: job.workflowId,
        });
      } else {
        await engine.resume(job.workflowId);
      }

      const state = await waitForTerminalState(
        this.deps.persistence,
        job.workflowId,
        this.pollMs
      );
      if (state === "COMPLETED") {
        await this.deps.queue.updateSubmissionStatus(job.workflowId, "completed");
        await this.deps.queue.acknowledge(job.jobId, "succeeded");
      } else {
        await this.deps.queue.updateSubmissionStatus(job.workflowId, state.toLowerCase());
        await this.deps.queue.acknowledge(job.jobId, "failed", `workflow ended ${state}`);
      }
    } catch (error) {
      await this.deps.queue.updateSubmissionStatus(job.workflowId, "failed");
      await this.deps.queue.acknowledge(
        job.jobId,
        "failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }
}
