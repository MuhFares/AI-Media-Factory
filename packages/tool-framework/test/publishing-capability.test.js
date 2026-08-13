import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { PublishingCapabilityExecutor, PUBLISH_CAPABILITY_ID, PUBLISH_PLATFORM, idempotencyKeyFor } from "../dist/index.js";

const descriptor = { capabilityId: PUBLISH_CAPABILITY_ID, description: "Publish content", inputSchema: { type: "object" }, outputSchema: { type: "object" } };

let requestNumber = 0;
function request(input, agentId = "publisher") {
  requestNumber += 1;
  return { requestId: `publish-${requestNumber}`, capabilityId: PUBLISH_CAPABILITY_ID, operation: "publish", agentId, workflowId: "workflow-publish", correlationId: "correlation-publish", input, requestedAt: "2026-08-14T00:00:00.000Z" };
}

function memoryStore() {
  const map = new Map();
  return {
    get: async (key) => map.get(key) ?? null,
    save: async (key, entry) => { map.set(key, entry); },
    map,
  };
}

const baseInput = (overrides = {}) => ({
  assetId: "vid-0001",
  title: "Modern Media Pipelines",
  description: "A published explainer on media pipelines.",
  options: { visibility: "public" },
  ...overrides,
});

const completed = (overrides = {}) => ({
  providerId: "fake-publish",
  status: "completed",
  publicationId: "pub-0001",
  url: "https://youtube.com/watch?v=pub-0001",
  publishedAt: "2026-08-14T01:00:00.000Z",
  ...overrides,
});

function setup(provider, authorized = true, storeOverride) {
  const calls = [];
  const store = storeOverride ?? memoryStore();
  const resolver = {
    resolve: (capabilityId) => capabilityId === PUBLISH_CAPABILITY_ID ? descriptor : null,
    isAuthorized: (agentId, capabilityId) => authorized && agentId === "publisher" && capabilityId === PUBLISH_CAPABILITY_ID,
  };
  const wrappedProvider = {
    publish: async (value) => { calls.push(value); return provider(value); },
  };
  return { calls, store, resolver, executor: new PublishingCapabilityExecutor(wrappedProvider, store, resolver, { maxTitleLength: 200, maxDescriptionLength: 1000, maxAssetIdLength: 500, maxTags: 30, maxTagLength: 30, allowedVisibility: ["public", "unlisted", "private"] }) };
}

describe("PublishingCapabilityExecutor", () => {
  it("authorized publish succeeds through the injected provider", async () => {
    const { executor, calls } = setup(async () => completed());
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "success");
    strictEqual(calls[0].assetId, "vid-0001");
    strictEqual(calls[0].title, "Modern Media Pipelines");
    strictEqual(result.output.providerId, "fake-publish");
    strictEqual(result.output.publicationId, "pub-0001");
    strictEqual(result.output.url, "https://youtube.com/watch?v=pub-0001");
    strictEqual(result.output.deduplicated, false);
  });

  it("unauthorized publish is blocked", async () => {
    const { executor } = setup(async () => completed(), false);
    const result = await executor.execute(request(baseInput(), "other-agent"));
    strictEqual(result.status, "blocked");
  });

  it("provider failure is reported as failed with truthful evidence", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-publish", status: "failed", error: { code: "RATE_LIMIT", message: "Quota exceeded" } }));
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "RATE_LIMIT");
    strictEqual(result.evidence.succeeded, false);
    strictEqual(result.evidence.resultStatus, "failed");
  });

  it("blocked request: malformed input is blocked before provider invocation", async () => {
    const { executor, calls } = setup(async () => completed());
    const result = await executor.execute(request({ ...baseInput(), title: "" }));
    strictEqual(result.status, "blocked");
    strictEqual(calls.length, 0);
  });

  it("produces truthful completion evidence with idempotency context", async () => {
    const { executor } = setup(async () => completed());
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "success");
    const evidence = result.evidence;
    strictEqual(typeof evidence.evidenceId, "string");
    strictEqual(evidence.capabilityId, PUBLISH_CAPABILITY_ID);
    strictEqual(evidence.platform, PUBLISH_PLATFORM);
    strictEqual(evidence.agentId, "publisher");
    strictEqual(evidence.workflowId, "workflow-publish");
    strictEqual(evidence.correlationId, "correlation-publish");
    strictEqual(evidence.idempotencyKey, result.output.idempotencyKey);
    strictEqual(evidence.publicationId, "pub-0001");
    strictEqual(evidence.publishedUrl, "https://youtube.com/watch?v=pub-0001");
    strictEqual(evidence.succeeded, true);
    strictEqual(typeof evidence.executedAt, "string");
  });

  it("derives a deterministic idempotency key from stable inputs", () => {
    const key = idempotencyKeyFor("workflow-1", "vid-0001", "youtube");
    strictEqual(key, idempotencyKeyFor("workflow-1", "vid-0001", "youtube"));
    ok(key.includes("assetId=vid-0001"));
    ok(key.includes("workflowId=workflow-1"));
    ok(key.includes("platform=youtube"));
  });

  it("duplicate publish returns the existing successful result without re-publishing", async () => {
    let providerCalls = 0;
    const { executor, calls } = setup(async (value) => { providerCalls += 1; return completed(); });
    const first = await executor.execute(request(baseInput()));
    strictEqual(first.status, "success");
    const second = await executor.execute(request(baseInput()));
    strictEqual(second.status, "success");
    strictEqual(second.output.deduplicated, true);
    strictEqual(second.output.publicationId, "pub-0001");
    strictEqual(calls.length, 1);
    strictEqual(providerCalls, 1);
  });

  it("a failed publish is persisted and can be retried safely", async () => {
    let failed = true;
    const { executor, store } = setup(async () => failed
      ? { providerId: "fake-publish", status: "failed", error: { code: "PROVIDER_TRANSIENT", message: "temporary" } }
      : completed());
    const first = await executor.execute(request(baseInput()));
    strictEqual(first.status, "failed");
    ok(store.map.size === 1);
    failed = false;
    const second = await executor.execute(request(baseInput()));
    strictEqual(second.status, "success");
    strictEqual(second.output.publicationId, "pub-0001");
  });

  it("never fabricates a publication: provider without a confirmed publication is failed", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-publish", status: "pending" }));
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "PUBLISH_NOT_COMPLETED");
    ok(result.output === undefined || result.output.publicationId === undefined);
  });

  it("rejects a provider that returns an invalid URL as failed, not success", async () => {
    const { executor } = setup(async () => ({ providerId: "fake-publish", status: "completed", publicationId: "pub-x", url: "not-a-url" }));
    const result = await executor.execute(request(baseInput()));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });

  it("accepts an explicit matching idempotencyKey and rejects a mismatched one as blocked", async () => {
    const { executor } = setup(async () => completed());
    const good = await executor.execute(request({ ...baseInput(), idempotencyKey: idempotencyKeyFor("workflow-publish", "vid-0001", "youtube") }));
    strictEqual(good.status, "success");
    const bad = await executor.execute(request({ ...baseInput(), idempotencyKey: "publish:fake" }));
    strictEqual(bad.status, "blocked");
  });
});