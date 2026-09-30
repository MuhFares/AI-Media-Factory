/** Shared test utilities for the database package integration tests. */

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (process.env.DATABASE_URL) {
    // Test-only, process-local derivation.  Credentials and all connection
    // options remain untouched; only the database path is changed.
    const derived = new URL(process.env.DATABASE_URL);
    derived.pathname = "/ai_media_factory_test";
    return derived.toString();
  }
  return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
}

export const TEST_DATABASE_URL = testDatabaseUrl();

export function assertTestDatabaseIsolation() {
  if (TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  }
}
