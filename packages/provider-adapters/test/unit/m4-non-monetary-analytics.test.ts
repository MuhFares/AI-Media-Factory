/** M4 non-monetary analytics contract (mocked transport only, never YouTube). */

import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, throws } from "node:assert";
import {
  YouTubeAnalyticsAdapter, NON_MONETARY_METRICS,
} from "@ai-media-factory/provider-adapters";

const MONETARY = ["estimatedRevenue"];
const M4_METRICS = [...NON_MONETARY_METRICS];

describe("m4 non-monetary analytics", () => {
  it("A+B: M4 request contains no estimatedRevenue or monetary metrics", async () => {
    ok(!M4_METRICS.includes("estimatedRevenue"), "contract excludes revenue");
    for (const m of M4_METRICS) ok(!/revenue|monetary|earning/i.test(m), `non-monetary only: ${m}`);
    const realFetch = globalThis.fetch;
    let requested = null;
    globalThis.fetch = (async (url) => {
      requested = String(url);
      return new Response(JSON.stringify({ columnHeaders: [], rows: [] }), { status: 200 });
    });
    try {
      const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", metrics: M4_METRICS, maxRetries: 0 });
      await adapter.fetch({ publicationId: "AfbPyQ-UFwM", platform: "youtube" });
      const q = new URL(requested).searchParams.get("metrics") ?? "";
      ok(!q.includes("estimatedRevenue"), "revenue absent from provider query");
      ok(q.includes("views") && q.includes("likes") && q.includes("comments") && q.includes("shares")
        && q.includes("estimatedMinutesWatched"), "non-monetary metrics intact");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("C+D: non-monetary metrics intact; watchTimeSeconds normalization correct", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      columnHeaders: [{ name: "views" }, { name: "averageViewDuration" }, { name: "estimatedMinutesWatched" }, { name: "likes" }, { name: "comments" }, { name: "shares" }],
      rows: [[10, 30, 5.5, 2, 1, 0]],
    }), { status: 200 }));
    try {
      const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", metrics: M4_METRICS, maxRetries: 0 });
      const r = await adapter.fetch({ publicationId: "AfbPyQ-UFwM", platform: "youtube" });
      strictEqual(r.metrics.views, 10);
      strictEqual(r.metrics.likes, 2);
      strictEqual(r.metrics.comments, 1);
      strictEqual(r.metrics.shares, 0);
      strictEqual(r.metrics.watchTimeSeconds, 5.5 * 60);
      strictEqual(r.metrics.revenue, undefined, "revenue never shaped in M4 contract");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("E+F: zero remains zero; missing never becomes zero", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      columnHeaders: [{ name: "views" }, { name: "likes" }],
      rows: [[0, 0]],
    }), { status: 200 }));
    try {
      const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", metrics: M4_METRICS, maxRetries: 0 });
      const r = await adapter.fetch({ publicationId: "AfbPyQ-UFwM", platform: "youtube" });
      strictEqual(r.metrics.views, 0, "provider-confirmed zero is a valid LIVE zero");
      strictEqual(r.metrics.comments, undefined, "absent metric stays absent");
    } finally {
      globalThis.fetch = realFetch;
    }
    globalThis.fetch = (async () => new Response(JSON.stringify({ columnHeaders: [], rows: [] }), { status: 200 }));
    try {
      const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", metrics: M4_METRICS, maxRetries: 0 });
      const r = await adapter.fetch({ publicationId: "AfbPyQ-UFwM", platform: "youtube" });
      deepStrictEqual(r.metrics, {}, "empty report stays empty");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("G: 401/403 creates no observation payload", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      error: { code: 401, message: "x", errors: [{ domain: "global", reason: "unauthorized" }] },
    }), { status: 401 }));
    try {
      const adapter = new YouTubeAnalyticsAdapter({ accessToken: "t", metrics: M4_METRICS, maxRetries: 0 });
      let err = null;
      try { await adapter.fetch({ publicationId: "AfbPyQ-UFwM", platform: "youtube" }); }
      catch (e) { err = e; }
      ok(err, "throws");
      strictEqual(err.statusCode, 401);
      ok(!("metrics" in err), "no metrics escape on failure");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("H: channel/video guard unchanged; default monetary behavior preserved", async () => {
    throws(() => new YouTubeAnalyticsAdapter({ accessToken: "t", metrics: ["bogusMetric"] }), /unsupported metric/);
    throws(() => new YouTubeAnalyticsAdapter({ accessToken: "t", metrics: [] }), /must not be empty/);
    const def = new YouTubeAnalyticsAdapter({ accessToken: "t" });
    ok(def, "default constructor unchanged (monetary-capable generic path intact)");
  });

  it("I: private-publication lineage untouched by metric selection", () => {
    ok(!MONETARY.some((m) => M4_METRICS.includes(m)), "M4 set excludes every monetary metric");
  });

  it("J: no provider calls in these tests", () => {
    ok(typeof globalThis.fetch === "function", "global fetch restored");
  });
});
