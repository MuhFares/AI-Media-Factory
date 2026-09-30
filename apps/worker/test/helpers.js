/** Shared test utilities for the worker app integration tests. */

// Integration tests must never fall back to the application database. The
// test target is derived through the established safe mechanism (same as the
// database package helper): an explicit TEST_DATABASE_URL wins, otherwise the
// database path of DATABASE_URL (loaded from the repo .env via
// `node --env-file=.env`) is swapped to the isolated test database while
// credentials and connection options stay untouched.
function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (process.env.DATABASE_URL) {
    const derived = new URL(process.env.DATABASE_URL);
    derived.pathname = "/ai_media_factory_test";
    return derived.toString();
  }
  return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
}

export const TEST_DATABASE_URL = testDatabaseUrl();

export function truncateAll(pool) {
  assertTestDatabaseIsolation();
  return pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
            workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions
     RESTART IDENTITY CASCADE`
  );
}

export function assertTestDatabaseIsolation() {
  if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  }
}
