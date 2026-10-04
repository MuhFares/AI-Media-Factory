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
// Make the derived, isolated URL visible to tests that explicitly require the
// environment variable after importing this shared guard.
process.env.TEST_DATABASE_URL ??= TEST_DATABASE_URL;

export function assertTestDatabaseIsolation() {
  const testUrl = new URL(TEST_DATABASE_URL);
  const productionUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  const testDatabase = decodeURIComponent(testUrl.pathname.replace(/^\//, ""));
  if (productionUrl && testUrl.origin === productionUrl.origin && testUrl.pathname === productionUrl.pathname) {
    throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  }
  if (!/(?:^|[_-])test(?:$|[_-])/i.test(testDatabase)) {
    throw new Error(`TEST_DATABASE_URL must name an explicitly isolated test database; received ${testDatabase || "<empty>"}`);
  }
}
