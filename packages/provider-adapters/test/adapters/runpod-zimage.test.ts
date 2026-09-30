import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok, rejects } from "node:assert";
import http from "node:http";
import { RunPodZImageAdapter } from "@ai-media-factory/provider-adapters";

async function mock(mode: "ok" | "legacy" | "failed" | "missing" | "badmime" | "unexpected" = "ok") {
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const requests: Array<{ path: string; body?: string; auth?: string }> = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => {
      requests.push({ path: req.url ?? "", body: Buffer.concat(chunks).toString(), auth: req.headers.authorization });
      if (req.url?.endsWith("/runsync")) {
        const host = req.headers.host ?? "127.0.0.1";
        const body = mode === "failed" ? { id: "j", status: "FAILED", error: "no" } : { id: "j", status: "COMPLETED", delayTime: 10, executionTime: 20, output: mode === "missing" ? {} : mode === "unexpected" ? { result: { value: "x" } } : mode === "legacy" ? { image_url: `http://${host}/image.png`, cost: 0.005 } : { result: `http://${host}/image.png`, cost: 0.005 } };
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(body)); return;
      }
      if (req.url === "/image.png") { res.writeHead(200, { "content-type": mode === "badmime" ? "text/plain" : "image/png" }); res.end(png); return; }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("mock address unavailable");
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

function adapter(baseUrl: string) { return new RunPodZImageAdapter({ apiKey: "secret-test-key", endpointId: "z-image-turbo", baseUrl, timeoutMs: 2000 }); }

describe("RunPodZImageAdapter", () => {
  it("maps T2I request to runsync and downloads durable bytes", async (t) => {
    const m = await mock(); t.after(() => m.close());
    const result = await adapter(m.baseUrl).generate({ prompt: "test prompt", seed: 123456, size: "720*1280", outputFormat: "png", safetyChecker: true });
    const request = JSON.parse(m.requests[0].body ?? "{}");
    strictEqual(m.requests[0].path, "/z-image-turbo/runsync"); strictEqual(m.requests[0].auth, "Bearer secret-test-key");
    deepStrictEqual(request.input, { prompt: "test prompt", size: "720*1280", seed: 123456, output_format: "png", enable_safety_checker: true });
    ok(result.url.startsWith("data:image/png;base64,")); strictEqual(result.metadata?.outputCost, 0.005); ok(String(result.metadata?.imageSha256).length === 64); ok(!JSON.stringify(result).includes("secret-test-key"));
  });
  it("supports valid sizes, seeds, formats and safety values", async () => {
    for (const size of ["1024*1024", "720*1280"]) { const m = await mock(); await adapter(m.baseUrl).generate({ prompt: "x", size, seed: -1, outputFormat: "webp", safetyChecker: false }); await m.close(); }
  });
  it("retains documented image_url fallback", async () => { const m = await mock("legacy"); const r = await adapter(m.baseUrl).generate({ prompt: "legacy" }); ok(r.url.startsWith("data:image/png")); await m.close(); });
  it("rejects unsupported size, seed and format", async () => {
    const m = await mock();
    await rejects(adapter(m.baseUrl).generate({ prompt: "x", size: "768*1344" }), /unsupported size/);
    await rejects(adapter(m.baseUrl).generate({ prompt: "x", seed: -2 }), /seed/);
    // @ts-expect-error intentionally invalid provider format
    await rejects(adapter(m.baseUrl).generate({ prompt: "x", outputFormat: "bmp" }), /output/);
    await m.close();
  });
  it("maps URL references and strength, but requires accessible URL", async () => {
    const m = await mock(); const result = await adapter(m.baseUrl).generate({ prompt: "x", referenceImageUrl: "https://example.invalid/ref.png", referenceImageMimeType: "image/png", strength: 0.8 });
    strictEqual(JSON.parse(m.requests[0].body ?? "{}").input.image, "https://example.invalid/ref.png"); strictEqual(JSON.parse(m.requests[0].body ?? "{}").input.strength, 0.8); await m.close();
    const m2 = await mock(); await rejects(adapter(m2.baseUrl).generate({ prompt: "x", referenceImageBase64: "abc", referenceImageMimeType: "image/png" }), /REFERENCE_IMAGE_URL_REQUIRED/); strictEqual(m2.requests.length, 0); await m2.close();
    void result;
  });
  it("fails closed for provider failure, missing output and invalid mime", async () => {
    for (const mode of ["failed", "missing", "badmime", "unexpected"] as const) { const m = await mock(mode); await rejects(adapter(m.baseUrl).generate({ prompt: "x" }), mode === "unexpected" ? /Unexpected Z-Image response shape/ : undefined); await m.close(); }
  });
});
