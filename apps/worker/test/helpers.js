/** Shared test utilities for the worker app integration tests. */

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";

export function truncateAll(pool) {
  return pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
            workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions
     RESTART IDENTITY CASCADE`
  );
}