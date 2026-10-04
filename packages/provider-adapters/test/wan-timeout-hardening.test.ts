import { describe, it } from "node:test";
import { ok, strictEqual } from "node:assert";
import { RunPodWanVideoAdapter } from "@ai-media-factory/provider-adapters";
import { createRunPodVideoMock } from "./helpers/mock-servers.ts";

const IMAGE = Buffer.alloc(600, 7).toString("base64");
const request = (id: string) => ({
  prompt: "restrained Cairo motion",
  imageBase64: IMAGE,
  clientExecutionId: id,
  idempotencyKey: `idem-${id}`,
  sourceInputHash: "a".repeat(64),
  configurationFingerprint: "b".repeat(64),
});

function adapter(url: string, extra: Record<string, unknown> = {}) {
  return new RunPodWanVideoAdapter({
    apiKey: "test", endpointId: "wan", baseUrl: url,
    submissionAckTimeoutMs: 200, generationTimeoutMs: 500,
    pollIntervalMs: 2, statusRequestTimeoutMs: 50,
    resultDownloadTimeoutMs: 75, pollRetries: 0, ...extra,
  });
}

describe("Wan submission timeout and cold-start hardening", () => {
  it("A warm provider acknowledges before generation polling", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close());
    const result = await adapter(mock.url).generate(request("warm-1"));
    strictEqual(result.status, "completed"); strictEqual(mock.state.runRequests, 1);
  });

  it("B cold provider returns a durable job id before simulated warm-up completes", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close());
    mock.state.pollsBeforeComplete = 20;
    const result = await adapter(mock.url, { generationTimeoutMs: 2_000 }).generate(request("cold-1"));
    strictEqual(result.status, "completed"); strictEqual(mock.state.runRequests, 1); ok(mock.state.pollRequests > 20);
  });

  it("C configurable acknowledgement timeout tolerates a slow control-plane response", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close()); mock.state.ackDelayMs = 60;
    const result = await adapter(mock.url, { submissionAckTimeoutMs: 100 }).generate(request("slow-ack"));
    strictEqual(result.status, "completed");
  });

  it("D long generation polling is independent from submission acknowledgement", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close()); mock.state.pollsBeforeComplete = 40;
    const result = await adapter(mock.url, { submissionAckTimeoutMs: 20, generationTimeoutMs: 2_000 }).generate(request("long-generation"));
    strictEqual(result.status, "completed");
  });

  it("E generation timeout terminates polling without a second POST", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close()); mock.state.pollsBeforeComplete = 10_000;
    await adapter(mock.url, { generationTimeoutMs: 15 }).generate(request("generation-timeout")).then(() => ok(false), (error) => ok(String(error).includes("timed out")));
    strictEqual(mock.state.runRequests, 1);
  });

  it("F acknowledgement loss can reconcile by clientExecutionId receipt", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close());
    mock.state.receiptByClientExecutionId.set("lost-ack", { status: "COMPLETED", client_execution_id: "lost-ack", provider_job_id: "job-original", source_input_hash: "a".repeat(64) });
    const receipt = await adapter(mock.url).lookupByClientExecutionId("lost-ack");
    strictEqual(receipt?.provider_job_id, "job-original");
  });

  it("G completed receipt remains retrievable from durable history", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close());
    mock.state.receiptByClientExecutionId.set("history-1", { status: "COMPLETED", client_execution_id: "history-1", provider_job_id: "expired-status-job" });
    strictEqual((await adapter(mock.url).lookupByClientExecutionId("history-1"))?.status, "COMPLETED");
  });

  it("H missing active status does not make durable receipt lookup fabricate a result", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close());
    strictEqual(await adapter(mock.url).lookupByClientExecutionId("not-found"), null);
  });

  it("I replay of one clientExecutionId maps to one provider generation job", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close()); const a = adapter(mock.url);
    const first = await a.generate(request("same-id")); const second = await a.generate(request("same-id"));
    strictEqual(first.jobId, second.jobId); strictEqual(mock.state.generationJobsByClientExecutionId.size, 1);
  });

  it("J ambiguous acknowledgement never triggers an adapter retry", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close()); mock.state.ackDelayMs = 150;
    // Leave enough local scheduling time for the mock server to observe the
    // request while still forcing an acknowledgement timeout.  A 5ms window was
    // timing-sensitive under the full workspace matrix and could abort before
    // the local server accepted the socket, testing scheduler contention rather
    // than the one-POST ambiguity invariant.
    await adapter(mock.url, { submissionAckTimeoutMs: 50 }).generate(request("ambiguous")).then(() => ok(false), (error) => ok((error as { reconciliationRequired?: boolean }).reconciliationRequired));
    strictEqual(mock.state.runRequests, 1);
  });

  it("K polling the acknowledged job does not create another generation POST", async (t) => {
    const mock = await createRunPodVideoMock(); t.after(() => mock.close()); mock.state.pollsBeforeComplete = 8;
    await adapter(mock.url).generate(request("poll-only")); strictEqual(mock.state.runRequests, 1); ok(mock.state.pollRequests > 1);
  });

  it("L result download timeout is independently configurable", () => {
    const policy = adapter("http://127.0.0.1:1", { submissionAckTimeoutMs: 11, generationTimeoutMs: 22, pollIntervalMs: 3, statusRequestTimeoutMs: 4, resultDownloadTimeoutMs: 55 }).getTimingPolicy();
    strictEqual(policy.submissionAckTimeoutMs, 11); strictEqual(policy.generationTimeoutMs, 22); strictEqual(policy.statusRequestTimeoutMs, 4); strictEqual(policy.resultDownloadTimeoutMs, 55);
  });
});
