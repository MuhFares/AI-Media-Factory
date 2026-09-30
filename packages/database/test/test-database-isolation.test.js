import test from "node:test";
import assert from "node:assert/strict";

test("database integration helpers reject an application database URL", async () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;
  const applicationUrl = "postgresql://example.invalid:5432/ai_media_factory";
  process.env.DATABASE_URL = applicationUrl;
  process.env.TEST_DATABASE_URL = applicationUrl;

  try {
    const { assertTestDatabaseIsolation } = await import(`./helpers.js?isolation-guard=${Date.now()}`);
    assert.throws(assertTestDatabaseIsolation, /TEST_DATABASE_URL must not reference DATABASE_URL/);
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalTestDatabaseUrl === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
  }
});
