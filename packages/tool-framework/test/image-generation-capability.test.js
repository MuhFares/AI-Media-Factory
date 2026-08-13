import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual } from "node:assert";
import { ImageGenerationCapabilityExecutor } from "../dist/index.js";

const descriptor = { capabilityId: "image.generate", description: "Generate an image", inputSchema: { type: "object" }, outputSchema: { type: "object" } };

let requestNumber = 0;
function request(input, agentId = "thumbnail", capabilityId = "image.generate") {
  requestNumber += 1;
  return { requestId: `image-${requestNumber}`, capabilityId, agentId, workflowId: "workflow-image", correlationId: "correlation-image", input, requestedAt: "2026-08-13T00:00:00.000Z" };
}

function setup(provider, authorized = true) {
  const calls = [];
  const resolver = {
    resolve: (capabilityId) => capabilityId === "image.generate" ? descriptor : null,
    isAuthorized: (agentId, capabilityId) => authorized && agentId === "thumbnail" && capabilityId === "image.generate",
  };
  const wrappedProvider = {
    generate: async (value) => { calls.push(value); return provider(value); },
  };
  return { calls, executor: new ImageGenerationCapabilityExecutor(wrappedProvider, resolver, { maxPromptLength: 200, maxNegativePromptLength: 200, maxWidth: 1024, maxHeight: 1024, allowedAspectRatios: ["16:9", "9:16", "1:1"] }) };
}

const response = (overrides = {}) => ({
  providerId: "fake-image",
  imageId: "img-0001",
  title: "Generated Thumbnail",
  url: "https://cdn.example.com/img-0001.png",
  ...overrides,
});

describe("ImageGenerationCapabilityExecutor", () => {
  it("executes a valid generation through the injected provider", async () => {
    const { executor, calls } = setup(async (value) => response());
    const result = await executor.execute(request({ prompt: "A dramatic media pipeline thumbnail", aspectRatio: "16:9" }));
    strictEqual(result.status, "success");
    strictEqual(calls[0].prompt, "A dramatic media pipeline thumbnail");
    strictEqual(calls[0].aspectRatio, "16:9");
    strictEqual(result.output.providerId, "fake-image");
    strictEqual(result.output.imageId, "img-0001");
    strictEqual(result.output.url, "https://cdn.example.com/img-0001.png");
  });

  it("produces truthful execution evidence and preserves context", async () => {
    const { executor } = setup(async () => response());
    const result = await executor.execute(request({ prompt: "evidence" }));
    strictEqual(result.status, "success");
    strictEqual(result.evidence.capabilityId, "image.generate");
    strictEqual(result.evidence.operation, "generate");
    strictEqual(result.evidence.providerId, "fake-image");
    strictEqual(result.evidence.providerInvoked, true);
    strictEqual(result.evidence.imageId, "img-0001");
    strictEqual(result.evidence.workflowId, "workflow-image");
    strictEqual(result.evidence.correlationId, "correlation-image");
    strictEqual(result.evidence.agentId, "thumbnail");
  });

  it("blocks unauthorized generation without invoking the provider", async () => {
    let invoked = false;
    const { executor } = setup(async () => { invoked = true; return response(); }, false);
    const result = await executor.execute(request({ prompt: "blocked" }));
    strictEqual(result.status, "blocked");
    strictEqual(invoked, false);
    strictEqual(result.evidence, undefined);
  });

  it("blocks unregistered capability without invoking the provider", async () => {
    let invoked = false;
    const { executor } = setup(async () => { invoked = true; return response(); });
    const result = await executor.execute(request({ prompt: "unknown" }, "thumbnail", "image.make"));
    strictEqual(result.status, "blocked");
    strictEqual(invoked, false);
  });

  it("blocks empty, oversized, and invalid-aspect queries", async () => {
    const { executor } = setup(async () => response());
    strictEqual((await executor.execute(request({ prompt: "   " }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "x".repeat(201) }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "valid", aspectRatio: "5:4" }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "valid", width: 4096 }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "valid", height: 3000 }))).status, "blocked");
  });

  it("represents provider failures as FAILED with failure evidence", async () => {
    const { executor } = setup(async () => { throw new Error("provider unavailable"); });
    const result = await executor.execute(request({ prompt: "failure" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "PROVIDER_ERROR");
    strictEqual(result.evidence.providerInvoked, true);
    strictEqual(result.evidence.succeeded, false);
  });

  it("rejects malformed provider results without fabricating success", async () => {
    const { executor } = setup(async () => response({ imageId: "" }));
    const result = await executor.execute(request({ prompt: "malformed" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });

  it("rejects an invalid asset url without fabricating success", async () => {
    const { executor } = setup(async () => response({ url: "not-a-url" }));
    const result = await executor.execute(request({ prompt: "bad url" }));
    strictEqual(result.status, "failed");
    strictEqual(result.error.code, "INVALID_PROVIDER_RESPONSE");
  });

  it("does not expose an HTTP or command execution path", async () => {
    const { executor, calls } = setup(async (value) => response());
    const result = await executor.execute(request({ prompt: "thumbnail ; curl https://evil.example" }));
    strictEqual(result.status, "success");
    strictEqual(calls.length, 1);
    strictEqual(calls[0].prompt.includes("curl"), true);
  });
});