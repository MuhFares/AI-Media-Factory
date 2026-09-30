/** M1 stubbed-analytics transport freeze (deterministic fixtures only, no live provider). */

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { YouTubeAnalyticsAdapter } from "@ai-media-factory/provider-adapters";
import { createAnalyticsMock } from "./helpers/mock-servers.ts";

/**
 * Frozen M1 proof-record shape. Transport is ALWAYS "STUBBED" here: a
 * stubbed success must never be labeled a live-provider success.
 */
const M1_STUB_MAX_READS = 2;
const M1_STUB_RETRIES = 0;
function m1StubProofRecord(response) {
  return {
    transport: "STUBBED",
    liveProviderClaim: false,
    providerId: response.providerId,
    publicationId: response.publicationId,
    metrics: response.metrics,
  };
}

describe("M1 stubbed-analytics transport freeze", () => {
  it("two bounded reads return shaped metrics, always labeled STUBBED", async (t) => {
    const mock = await createAnalyticsMock();
    t.after(() => mock.close());
    const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", baseUrl: mock.url, windowDays: 30 });
    const reads = [];
    reads.push(m1StubProofRecord(await adapter.fetch({ publicationId: "vid-1", platform: "youtube" })));
    mock.state.mode = "empty";
    reads.push(m1StubProofRecord(await adapter.fetch({ publicationId: "vid-empty", platform: "youtube" })));
    strictEqual(reads.length, M1_STUB_MAX_READS);
    strictEqual(mock.state.requests, M1_STUB_MAX_READS, "exactly one request per read, no retries");
    deepStrictEqual(reads.map((r) => r.transport), ["STUBBED", "STUBBED"]);
    deepStrictEqual(reads.map((r) => r.liveProviderClaim), [false, false]);
    strictEqual(reads[0].providerId, "youtube-analytics");
    strictEqual(reads[0].metrics.views, 1234);
    deepStrictEqual(reads[1].metrics, {}, "empty fixture shapes to empty metrics");
    ok(!JSON.stringify(reads).match(/LIVE_YOUTUBE|live-provider success/i), "no live-provider claim possible");
  });

  it("budget constants match the approved M1 hard budget", () => {
    strictEqual(M1_STUB_MAX_READS, 2);
    strictEqual(M1_STUB_RETRIES, 0);
  });
});
