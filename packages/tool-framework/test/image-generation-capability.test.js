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

  it("transports a bounded approved-size prompt unchanged while still rejecting pathological payloads", async () => {
    let received;
    const longPrompt = ("Cairo street documentary; " + "grounded detail; ".repeat(120)).trim();
    const resolver = { resolve: () => descriptor, isAuthorized: () => true };
    const executor = new ImageGenerationCapabilityExecutor({
      generate: async (value) => { received = value; return response(); },
    }, resolver, { maxPromptLength: 4000, maxNegativePromptLength: 1000, maxWidth: 2048, maxHeight: 2048, allowedAspectRatios: ["9:16"] });
    strictEqual(longPrompt.length > 1000, true);
    strictEqual((await executor.execute(request({ prompt: longPrompt, aspectRatio: "9:16" }))).status, "success");
    strictEqual(received.prompt, longPrompt);
    strictEqual((await executor.execute(request({ prompt: "x".repeat(4001), aspectRatio: "9:16" }))).status, "blocked");
  });

  it("passes a validated reference URL unchanged to the provider", async () => {
    let received;
    const referenceImageUrl = "https://cdn.example.com/reference.png?sig=redacted";
    const { executor } = setup(async (value) => { received = value; return response(); });
    const result = await executor.execute(request({ prompt: "controlled variation", referenceImageUrl, referenceImageMimeType: "image/png", strength: 0.55 }));
    strictEqual(result.status, "success");
    strictEqual(received.referenceImageUrl, referenceImageUrl);
    strictEqual(received.referenceImageMimeType, "image/png");
    strictEqual(received.strength, 0.55);
  });

  it("rejects local, non-HTTPS, ambiguous, and untyped reference transports before provider", async () => {
    const { executor, calls } = setup(async () => response());
    strictEqual((await executor.execute(request({ prompt: "x", referenceImageUrl: "C:\\local\\ref.png", referenceImageMimeType: "image/png" }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "x", referenceImageUrl: "http://cdn.example/ref.png", referenceImageMimeType: "image/png" }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "x", referenceImageUrl: "https://cdn.example/ref.png" }))).status, "blocked");
    strictEqual((await executor.execute(request({ prompt: "x", referenceImageUrl: "https://cdn.example/ref.png", referenceImageBase64: "abc", referenceImageMimeType: "image/png" }))).status, "blocked");
    strictEqual(calls.length, 0);
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

  it("enforces the evidence-backed 3000-char AMF prompt budget fail-closed", async () => {
    const { IMAGE_PROMPT_MAX_CHARS, IMAGE_NEGATIVE_PROMPT_MAX_CHARS } = await import("../dist/image-generation/image-generation-capability.js");
    strictEqual(IMAGE_PROMPT_MAX_CHARS, 3000);
    strictEqual(IMAGE_NEGATIVE_PROMPT_MAX_CHARS, 1000);
    let received;
    const resolver = { resolve: () => descriptor, isAuthorized: () => true };
    const executor = new ImageGenerationCapabilityExecutor({
      generate: async (value) => { received = value; return response(); },
    }, resolver, { maxPromptLength: IMAGE_PROMPT_MAX_CHARS, maxNegativePromptLength: IMAGE_NEGATIVE_PROMPT_MAX_CHARS, maxWidth: 2048, maxHeight: 2048, allowedAspectRatios: ["9:16"] });
    const within = `scene ${"x".repeat(2900)}`;
    strictEqual((await executor.execute(request({ prompt: within, aspectRatio: "9:16" }))).status, "success");
    strictEqual(received.prompt, within, "within-budget prompts pass byte-exactly, never sliced");
    strictEqual((await executor.execute(request({ prompt: "x".repeat(3001), aspectRatio: "9:16" }))).status, "blocked");
  });
});
