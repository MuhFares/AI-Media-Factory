/** Image generation adapter tests against the OpenAI Images mock. */

import { describe, it } from "node:test";
import { strictEqual, ok } from "node:assert";
import { OpenAIImagesAdapter } from "@ai-media-factory/provider-adapters";
import { createImageMock } from "../helpers/mock-servers.ts";
import { isProviderError } from "@ai-media-factory/provider-adapters";

describe("OpenAIImagesAdapter", () => {
  it("returns a provider-confirmed image with a data: url and stable imageId", async (t) => {
    const mock = await createImageMock();
    t.after(() => mock.close());
    const adapter = new OpenAIImagesAdapter({ apiKey: "k", baseUrl: `${mock.url}/v1` });
    const response = await adapter.generate({ prompt: "a red cube", aspectRatio: "16:9" });
    strictEqual(response.providerId, "openai-image");
    strictEqual(response.imageId, "openai-1700000000-0");
    ok(response.url.startsWith("data:image/png;base64,"), "b64 payload becomes a data url");
    ok(new URL(response.url), "data url parses");
    strictEqual(response.parameters?.prompt, "a red cube");
  });

  it("sends the mapped size for the requested aspect ratio", async (t) => {
    const mock = await createImageMock();
    t.after(() => mock.close());
    const adapter = new OpenAIImagesAdapter({ apiKey: "k", baseUrl: `${mock.url}/v1` });
    await adapter.generate({ prompt: "x", aspectRatio: "9:16" });
    const body = mock.state.lastBody as { size: string };
    strictEqual(body.size, "1024x1792");
  });

  it("classifies an unauthorized provider response", async (t) => {
    const mock = await createImageMock();
    t.after(() => mock.close());
    mock.state.mode = "unauthorized";
    const adapter = new OpenAIImagesAdapter({ apiKey: "bad", baseUrl: `${mock.url}/v1` });
    try {
      await adapter.generate({ prompt: "x" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "AUTHORIZATION");
    }
  });

  it("classifies a provider-side 400 as validation", async (t) => {
    const mock = await createImageMock();
    t.after(() => mock.close());
    mock.state.mode = "provider-error";
    const adapter = new OpenAIImagesAdapter({ apiKey: "k", baseUrl: `${mock.url}/v1` });
    try {
      await adapter.generate({ prompt: "x" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("rejects a provider response with no generated image", async (t) => {
    const mock = await createImageMock();
    t.after(() => mock.close());
    mock.state.mode = "no-data";
    const adapter = new OpenAIImagesAdapter({ apiKey: "k", baseUrl: `${mock.url}/v1` });
    try {
      await adapter.generate({ prompt: "x" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });

  it("rejects a non-JSON provider response", async (t) => {
    const mock = await createImageMock();
    t.after(() => mock.close());
    mock.state.mode = "non-json";
    const adapter = new OpenAIImagesAdapter({ apiKey: "k", baseUrl: `${mock.url}/v1` });
    try {
      await adapter.generate({ prompt: "x" });
      ok(false, "expected throw");
    } catch (error) {
      ok(isProviderError(error));
      strictEqual((error as { category: string }).category, "VALIDATION");
    }
  });
});