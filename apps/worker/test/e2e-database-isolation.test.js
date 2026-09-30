import test from "node:test";
import assert from "node:assert/strict";
import { assertIsolatedE2eDatabase } from "../e2e/database-target-guard.mjs";

test("destructive E2E cleanup rejects a production-equivalent target before SQL", () => {
  const productionUrl = "postgresql://example.invalid:5432/ai_media_factory";
  assert.throws(
    () => assertIsolatedE2eDatabase(productionUrl, productionUrl),
    /E2E_DATABASE_URL must not reference DATABASE_URL/,
  );
  assert.doesNotThrow(() => assertIsolatedE2eDatabase(
    "postgresql://example.invalid:5432/ai_media_factory_test",
    productionUrl,
  ));
});
