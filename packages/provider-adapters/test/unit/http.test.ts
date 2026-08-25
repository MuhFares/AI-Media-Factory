/** Unit tests: HTTP transport classification, timeout and retry semantics. */

import { describe, it, after } from "node:test";
import { strictEqual, ok } from "node:assert";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { sendHttp, sendHttpWithRetry, isRetryable } from "@ai-media-factory/provider-adapters";
import {
  ProviderAuthorizationError,
  ProviderTransientError,
  ProviderTimeoutError,
  ProviderValidationError,
} from "@ai-media-factory/provider-adapters";

function listen(handler: http.RequestListener): Promise<{ url: string; server: http.Server }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

const OPTS = { providerId: "test", operation: "op", timeoutMs: 2000 };

describe("http transport", () => {
  it("classifies 401 as authorization failure", async (t) => {
    const { url, server } = await listen((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
    t.after(() => server.close());
    try {
      await sendHttp({ method: "GET", url }, OPTS);
      ok(false, "expected throw");
    } catch (error) {
      ok(error instanceof ProviderAuthorizationError);
      strictEqual(error.category, "AUTHORIZATION");
      strictEqual(error.retryable, false);
      ok(String(error.detail).includes("unauthorized"));
    }
  });

  it("classifies 429 and 5xx as retryable transient failures", async (t) => {
    for (const status of [429, 500, 503]) {
      const { url, server } = await listen((_req, res) => {
        res.writeHead(status);
        res.end();
      });
      t.after(() => server.close());
      try {
        await sendHttp({ method: "GET", url }, OPTS);
        ok(false, "expected throw");
      } catch (error) {
        ok(error instanceof ProviderTransientError, `status ${status}`);
        strictEqual(error.category, "TRANSIENT");
        strictEqual(error.retryable, true);
      }
    }
  });

  it("classifies 400 as validation failure", async (t) => {
    const { url, server } = await listen((_req, res) => {
      res.writeHead(400);
      res.end("bad request");
    });
    t.after(() => server.close());
    try {
      await sendHttp({ method: "GET", url }, OPTS);
      ok(false, "expected throw");
    } catch (error) {
      ok(error instanceof ProviderValidationError);
      strictEqual(error.category, "VALIDATION");
    }
  });

  it("times out when the provider never responds", async (t) => {
    const { url, server } = await listen((_req, res) => {
      setTimeout(() => {
        res.writeHead(200);
        res.end();
      }, 5000);
    });
    t.after(() => server.close());
    try {
      await sendHttp({ method: "GET", url }, { ...OPTS, timeoutMs: 150 });
      ok(false, "expected throw");
    } catch (error) {
      ok(error instanceof ProviderTimeoutError);
      strictEqual(error.category, "TIMEOUT");
      strictEqual(error.retryable, true);
    }
  });

  it("retries transient failures and succeeds on a later attempt", async (t) => {
    let attempts = 0;
    const { url, server } = await listen((_req, res) => {
      attempts += 1;
      if (attempts < 3) {
        res.writeHead(500);
        res.end();
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      }
    });
    t.after(() => server.close());
    const res = await sendHttpWithRetry(
      { method: "GET", url },
      { ...OPTS, maxRetries: 3, retryDelayBaseMs: 5 },
    );
    strictEqual(res.status, 200);
    strictEqual(attempts, 3);
  });

  it("does NOT retry a side-effecting call (no maxRetries given)", async (t) => {
    let attempts = 0;
    const { url, server } = await listen((_req, res) => {
      attempts += 1;
      res.writeHead(500);
      res.end();
    });
    t.after(() => server.close());
    try {
      await sendHttp({ method: "POST", url, body: "{}" }, OPTS);
      ok(false, "expected throw");
    } catch (error) {
      ok(error instanceof ProviderTransientError);
      strictEqual(attempts, 1, "side-effecting POST must not be auto-retried");
    }
  });

  it("exhausts retries and throws the classified error", async (t) => {
    let attempts = 0;
    const { url, server } = await listen((_req, res) => {
      attempts += 1;
      res.writeHead(429);
      res.end();
    });
    t.after(() => server.close());
    try {
      await sendHttpWithRetry(
        { method: "GET", url },
        { ...OPTS, maxRetries: 2, retryDelayBaseMs: 5 },
      );
      ok(false, "expected throw");
    } catch (error) {
      ok(error instanceof ProviderTransientError);
      strictEqual(attempts, 3, "1 attempt + 2 retries");
    }
  });

  it("exposes isRetryable classification", () => {
    strictEqual(isRetryable(new ProviderTransientError("t", "o", "x")), true);
    strictEqual(isRetryable(new ProviderValidationError("t", "o", "x")), false);
    strictEqual(isRetryable(new Error("boom")), false);
  });
});
