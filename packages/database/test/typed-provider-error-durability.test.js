import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPool, migrate, PostgresPersistence } from "../dist/index.js";
import { createTTSGenerationCapability, sanitizeProviderFailureMetadata } from "../../tool-framework/dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

const { Pool } = pg;
const url = TEST_DATABASE_URL;

function resolver() {
  return {
    resolve: (id) => id === "tts.generate" ? { capabilityId: id } : null,
    isAuthorized: () => true,
  };
}

function record(workflowId, result, executionId) {
  return {
    executionId, workflowId, correlationId: "typed-error-test-correlation", agentId: "tts", stage: "tts",
    capability: "tts.generate", provider: "groq", model: "canopylabs/orpheus-v1-english", runtime: null,
    promptVersion: null, configurationFingerprint: "test", startedAt: new Date(0).toISOString(),
    completedAt: new Date(1).toISOString(), latencyMs: 527, status: "failed", usage: null, costKind: "UNKNOWN",
    cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1,
    providerRequestId: null, providerJobId: null, errorClassification: "PROVIDER_ERROR", configuration: { voice: "hannah" },
    failureMetadata: result.error.failureMetadata,
  };
}

test("typed provider failure survives canonical capability and PostgreSQL reload", async (t) => {
  assertTestDatabaseIsolation();
  const pool = createPool({ connectionString: url, max: 2 });
  const workflowId = `typed-error-test-${Date.now()}`;
  try {
    await migrate(pool);
    const persistence = new PostgresPersistence(pool);
    const typedError = Object.assign(new Error("rate limited; Authorization: Bearer SECRET_VALUE"), {
      providerId: "groq", model: "canopylabs/orpheus-v1-english", statusCode: 429,
      providerErrorCode: "rate_limit_exceeded", providerErrorType: "rate_limit",
      detail: "sanitized test detail; api_key=SECRET_VALUE; nested provider error follows",
      retryable: true, category: "TRANSIENT", providerError: { password: "SECRET_VALUE", detail: "safe context" },
    });
    const executor = createTTSGenerationCapability({
      provider: { generate: async () => { throw typedError; } }, resolver: resolver(),
    });
    const result = await executor.execute({ requestId: "typed-http-request", capabilityId: "tts.generate", agentId: "tts", workflowId, correlationId: "typed-error-test-correlation", input: { text: "test", voice: "hannah", format: "wav" }, requestedAt: new Date(0).toISOString() });
    assert.equal(result.status, "failed");
    assert.deepEqual(result.error.failureMetadata, {
      httpStatus: 429, providerErrorCode: "rate_limit_exceeded", providerErrorType: "rate_limit",
      detail: "sanitized test detail; api_key=[REDACTED]; nested provider error follows", retryable: true,
      classification: "TRANSIENT", provider: "groq", model: "canopylabs/orpheus-v1-english",
      capability: "tts.generate", executionId: null, attemptNumber: null, latencyMs: result.error.failureMetadata.latencyMs, costKind: null,
      errorName: "Error", safeCauseCode: null, transportDiagnostic: null, transportPhase: null, providerReceiptStatus: null,
    });
    assert.equal(JSON.stringify(result.error.failureMetadata).includes("SECRET_VALUE"), false);
    const executionId = `${workflowId}-execution`;
    await persistence.saveExecutionProvenance(record(workflowId, result, executionId));
    assert.equal((await pool.query("SELECT count(*)::int AS count FROM execution_provenance WHERE workflow_id = $1", [workflowId])).rows[0].count, 1);

    const nonHttpError = Object.assign(new Error("network context"), { providerId: "groq", providerErrorCode: "socket_reset", providerErrorType: "network", detail: "sanitized network detail", retryable: true, category: "TRANSIENT" });
    const nonHttpExecutor = createTTSGenerationCapability({ provider: { generate: async () => { throw nonHttpError; } }, resolver: resolver() });
    const nonHttp = await nonHttpExecutor.execute({ requestId: "typed-network-request", capabilityId: "tts.generate", agentId: "tts", workflowId, correlationId: "typed-error-test-correlation", input: { text: "test", voice: "hannah", format: "wav" }, requestedAt: new Date(0).toISOString() });
    assert.equal(nonHttp.status, "failed");
    assert.equal(nonHttp.error.failureMetadata.httpStatus, null);
    assert.equal(nonHttp.error.failureMetadata.providerErrorCode, "socket_reset");
    assert.equal(nonHttp.error.failureMetadata.providerErrorType, "network");
    assert.equal(nonHttp.error.failureMetadata.retryable, true);
    assert.deepEqual(sanitizeProviderFailureMetadata({ providerId: "groq", detail: { nested: { password: "SECRET_VALUE" }, message: "safe" }, retryable: false }), {
      httpStatus: null, providerErrorCode: null, providerErrorType: null, detail: '{"nested":{"password":"[REDACTED]"},"message":"safe"}', retryable: false, classification: null,
      provider: "groq", model: null, capability: null, executionId: null, attemptNumber: null, latencyMs: null, costKind: null,
      errorName: null, safeCauseCode: null, transportDiagnostic: null, transportPhase: null, providerReceiptStatus: null,
    });
    const reloaded = (await persistence.listExecutionProvenance(workflowId))[0];
    assert.ok(reloaded, "provenance row must reload");
    assert.ok(reloaded.failureMetadata, "failure metadata must reload");
    assert.equal(reloaded.failureMetadata.httpStatus, 429);
    assert.equal(reloaded.failureMetadata.providerErrorCode, "rate_limit_exceeded");
    assert.equal(reloaded.failureMetadata.providerErrorType, "rate_limit");
    assert.equal(reloaded.failureMetadata.retryable, true);
    assert.equal(JSON.stringify(reloaded.failureMetadata).includes("SECRET_VALUE"), false);
    assert.equal(JSON.stringify(reloaded.failureMetadata).includes("sanitized test detail"), true);
  } catch (error) {
    if (error?.code === "ECONNREFUSED" || error?.code === "28P01" || error?.code === "3D000") {
      t.skip(`PostgreSQL unavailable: ${error.code}`);
      return;
    }
    console.error("typed durability test failure", error);
    throw error;
  } finally {
    await pool.query("DELETE FROM execution_provenance WHERE workflow_id = $1", [workflowId]).catch(() => undefined);
    await pool.end();
  }
});
