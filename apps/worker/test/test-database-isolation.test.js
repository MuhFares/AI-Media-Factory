import test from "node:test";
import assert from "node:assert/strict";

test("destructive cleanup refuses the application database before SQL", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousTestDatabaseUrl = process.env.TEST_DATABASE_URL;
  const applicationUrl = "postgresql://example.invalid:5432/ai_media_factory";
  process.env.DATABASE_URL = applicationUrl;
  process.env.TEST_DATABASE_URL = applicationUrl;

  try {
    const { truncateAll } = await import(`./helpers.js?isolation-guard=${Date.now()}`);
    let queryCalled = false;
    const fakePool = { query: () => { queryCalled = true; } };
    assert.throws(() => truncateAll(fakePool), /TEST_DATABASE_URL must not reference DATABASE_URL/);
    assert.equal(queryCalled, false);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousTestDatabaseUrl === undefined) delete process.env.TEST_DATABASE_URL;
    else process.env.TEST_DATABASE_URL = previousTestDatabaseUrl;
  }
});
