import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RunPodZImageAdapter } from "@ai-media-factory/provider-adapters";
import { createCapabilityRegistry, createImageGenerationCapability, evaluatePreWanImage, IMAGE_GENERATION_CAPABILITY_ID } from "@ai-media-factory/tool-framework";
import { RuntimeCapabilityExecutor } from "@ai-media-factory/runtime";
import { DEFAULT_PROVIDER_GRANTS, PROVIDER_CAPABILITIES } from "@ai-media-factory/provider-adapters";

const contentId = "content-cairo-everyday-life-v2";
const artifactPath = "output/full-content-e2e-v2/content-cairo-everyday-life-v2/visual-direction-v2/visual-briefs.json";
const outputDir = "output/full-content-e2e-v2/content-cairo-everyday-life-v2/visual-direction-v2/z-image-regeneration/attempt-2";
const contactDir = join(outputDir, "contact-sheet");

const artifact = JSON.parse(await (await import("node:fs/promises")).readFile(artifactPath, "utf8"));
const scenes = artifact.scenes;
if (scenes.length !== 5) throw new Error(`Expected exactly 5 approved scenes, found ${scenes.length}`);
if (artifact.providerCalls?.zImage !== 0) throw new Error("Refusing to run: artifact already records Z-Image calls");
if (scenes.some((scene) => scene.preWanGate?.canEnterWan === true)) throw new Error("Refusing to run: a source image is already marked eligible for Wan");

const apiKey = process.env.RUNPOD_API_KEY?.trim();
if (!apiKey) throw new Error("Missing RUNPOD_API_KEY");
const endpointId = process.env.RUNPOD_ZIMAGE_ENDPOINT_ID?.trim() || "z-image-turbo";
const adapter = new RunPodZImageAdapter({ apiKey, endpointId, baseUrl: process.env.RUNPOD_BASE_URL?.trim() || undefined, timeoutMs: 120_000 });
const transportChecks = [];
const observedProvider = {
  providerId: "runpod-zimage",
  generate: async (request) => {
    transportChecks.push({ promptLength: request.prompt.length, promptSha256: createHash("sha256").update(request.prompt).digest("hex"), negativePromptLength: request.negativePrompt?.length ?? 0, negativePromptSha256: request.negativePrompt ? createHash("sha256").update(request.negativePrompt).digest("hex") : null });
    return adapter.generate(request);
  },
};
const resolver = createCapabilityRegistry({ capabilities: PROVIDER_CAPABILITIES, grants: DEFAULT_PROVIDER_GRANTS });
const imageExecutor = createImageGenerationCapability({
  provider: observedProvider,
  resolver,
  policy: { maxPromptLength: Number.parseInt(process.env.RUNPOD_ZIMAGE_MAX_PROMPT_LENGTH?.trim() || "4000", 10), maxNegativePromptLength: 1000, maxWidth: 2048, maxHeight: 2048, allowedAspectRatios: ["9:16"] },
});
const boundary = new RuntimeCapabilityExecutor({ resolver, executor: imageExecutor });

await mkdir(outputDir, { recursive: true });
await mkdir(contactDir, { recursive: true });
const results = [];
for (const scene of scenes) {
  const sceneId = scene.sceneId;
  const seed = Number.parseInt(createHash("sha256").update(`${contentId}:${sceneId}:visual-direction-v2`).digest("hex").slice(0, 8), 16) % 1_000_000_000;
  const promptLength = scene.imagePrompt.length;
  const promptSha256 = createHash("sha256").update(scene.imagePrompt).digest("hex");
  const startedAt = new Date().toISOString();
  const response = await boundary.executeCapability({
    requestId: `zimage-v2-${contentId}-${sceneId}`,
    capabilityId: IMAGE_GENERATION_CAPABILITY_ID,
    agentId: "thumbnail",
    workflowId: `wf-zimage-v2-${contentId}`,
    correlationId: `corr-zimage-v2-${contentId}`,
    input: { prompt: scene.imagePrompt, negativePrompt: scene.negativeConstraints, width: 768, height: 1024, aspectRatio: "9:16", outputFormat: "png", seed },
    requestedAt: startedAt,
  });
  const finishedAt = new Date().toISOString();
  if (response.status !== "success") {
    results.push({ contentId, sceneId, status: response.status, promptLength, promptSha256, negativePromptLength: scene.negativeConstraints.length, startedAt, finishedAt, seed, error: response.status === "failed" ? response.error : response.reason });
    continue;
  }
  const output = response.output;
  const comma = output.url.indexOf(",");
  const mime = output.url.slice(5, comma).split(";", 1)[0];
  const bytes = Buffer.from(output.url.slice(comma + 1), "base64");
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
  const imagePath = join(outputDir, `${sceneId}.${ext}`);
  await writeFile(imagePath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const width = bytes[0] === 0x89 && bytes[1] === 0x50 ? bytes.readUInt32BE(16) : null;
  const height = bytes[0] === 0x89 && bytes[1] === 0x50 ? bytes.readUInt32BE(20) : null;
  const transport = transportChecks.at(-1);
  results.push({ contentId, sceneId, status: "success", visualBriefVersion: artifact.schemaVersion, prompt: scene.imagePrompt, promptLength, promptSha256, transportedPromptLength: transport?.promptLength, transportedPromptSha256: transport?.promptSha256, negativeConstraints: scene.negativeConstraints, provider: output.providerId, model: "z-image-turbo", endpointId, jobId: output.imageId, seed, startedAt, finishedAt, imagePath, dimensions: { width, height }, bytes: bytes.length, sha256, providerCost: Number(output.metadata?.outputCost ?? 0), preWanGate: evaluatePreWanImage() });
}

const evidence = { schemaVersion: "z-image-v2-regeneration.local.1", contentId, provider: "runpod-zimage", model: "z-image-turbo", endpointId, callCount: results.length, successfulCount: results.filter((r) => r.status === "success").length, failedCount: results.filter((r) => r.status !== "success").length, wanCalls: 0, voiceTutCalls: 0, agentRouterCalls: 0, researchCalls: 0, fluxCalls: 0, results, note: "Images are candidates for human pre-Wan review only; no Wan call is authorized or performed." };
await writeFile(join(outputDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputDir, callCount: results.length, successfulCount: evidence.successfulCount, failedCount: evidence.failedCount, wanCalls: 0 }, null, 2));
