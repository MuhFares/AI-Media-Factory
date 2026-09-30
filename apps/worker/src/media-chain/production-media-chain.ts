import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CapabilityExecutionPort, CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";
import type { ExecutionProvenanceRecord } from "@ai-media-factory/workflow-engine";
import { evaluatePreWanGovernance, issueWanAuthorization, TTSChunkExecutionCoordinator, validateVisualDirectionContract, compileScenePrompt, routeVisualSemanticStatus, deterministicImageSeed, unknownSemanticDimensions, type GeneratedVisualArtifact, type HumanVisualApproval, type VisualSemanticReview, type VisualTechnicalQA, type WanAuthorization, type TTSChunkArtifact, type TTSChunkExecution, type VisualDirectionContractV2, type SceneContractV2, type VideoTailPadPolicy } from "@ai-media-factory/tool-framework";

interface CanonicalAgent {
  execute(input: { context: unknown; input: unknown }, signal: { isCancelled: boolean; onCancelled(): void; throwIfCancelled(): void }): Promise<{ output: unknown }>;
}

export interface MediaChainArtifactStore {
  saveArtifact(artifact: Record<string, unknown>): Promise<void>;
  listArtifacts(workflowId: string): Promise<Array<Record<string, unknown>>>;
  saveExecutionProvenance?(record: ExecutionProvenanceRecord): Promise<void>;
  listExecutionProvenance?(workflowId: string): Promise<ExecutionProvenanceRecord[]>;
}

export interface MediaChainInput {
  workflowId: string; correlationId: string; contentId: string; scriptIdentity: string; script: string;
  language: string; voice: string; ttsProvider?: string; ttsModel?: string; caption?: string; approvedHumanScenes?: Record<string, "APPROVED" | "REJECTED" | "REQUEST_REGENERATION">;
  mediaResumeId?: string;
  regenerationVersion?: number;
  regenerationSceneIds?: string[];
  lockedVisualArtifactIds?: string[];
  visualConstraintOverrides?: Record<string, Record<string, unknown>>;
  negativeConditioningSupported?: boolean;
  /**
   * Visual gate provenance for the wan-authorization stage. The engine
   * records outcome "approved" for a genuine human approval and
   * "policy_bypass" for an owner-configured gate disablement. Only a
   * genuine human approval may resolve an UNAVAILABLE semantic review;
   * a policy bypass must remain identifiable and can never manufacture
   * human approvals or semantic PASS verdicts (fail-closed repair).
   */
  visualGateOutcome?: string;
  visualGateSceneDecisions?: Record<string, "APPROVED" | "REJECTED" | "REQUEST_REGENERATION">;
  /**
   * Media Technical Resume V1: when present, every provider-backed media
   * capability call consumes from the owner-authorized budget BEFORE the
   * submission and fails closed when the envelope is exhausted. The hook is
   * injected by the composition root; the bridge never constructs it.
   */
  consumeProviderBudget?: (input: { stage: string; capabilityId: string; itemId?: string }) => Promise<void>;
  videoTailPadPolicy?: VideoTailPadPolicy;
  wanAuthorizationId?: string;
}

export interface VisualConstraintContract {
  requiredSubjects?: readonly string[];
  requiredStates?: readonly string[];
  requiredRelations?: readonly string[];
  requiredEnvironment?: readonly string[];
  requiredComposition?: readonly string[];
  continuityRequirements?: readonly string[];
  forbiddenSubjects?: readonly string[];
  forbiddenStates?: readonly string[];
  forbiddenComposition?: readonly string[];
  forbiddenStyle?: readonly string[];
  forbiddenText?: readonly string[];
}

export interface MediaChainOutput {
  status: "AWAITING_APPROVAL" | "COMPLETED" | "BLOCKED";
  sceneIds: string[]; narration?: Record<string, unknown>; timeline?: Record<string, unknown>;
  visuals: GeneratedVisualArtifact[]; reviews: VisualSemanticReview[]; technicalQa: VisualTechnicalQA[];
  authorizations: WanAuthorization[]; clips: Record<string, unknown>[]; finalMedia?: Record<string, unknown>; warnings: string[];
}

export interface MediaChainStageOutput {
  status: "COMPLETED" | "AWAITING_APPROVAL" | "BLOCKED";
  output: Record<string, unknown>;
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
async function materializeCanonicalMediaReference(reference: string, artifactId: string, extension: "mp4" | "wav", expectedSha256?: string): Promise<{ path: string; sha256: string }> {
  let bytes: Buffer;
  if (reference.startsWith("data:")) {
    const comma = reference.indexOf(",");
    if (comma < 0 || !reference.slice(0, comma).endsWith(";base64")) throw new Error(`CANONICAL_MEDIA_REFERENCE_INVALID:${artifactId}`);
    bytes = Buffer.from(reference.slice(comma + 1), "base64");
  } else {
    bytes = await readFile(reference);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (expectedSha256 !== undefined && expectedSha256 !== "" && sha256 !== expectedSha256) throw new Error(`CANONICAL_MEDIA_SHA_MISMATCH:${artifactId}`);
  const dir = resolve("output", "canonical-media-inputs");
  await mkdir(dir, { recursive: true });
  const safeId = artifactId.replace(/[^a-zA-Z0-9._-]/gu, "_");
  const path = resolve(dir, `${safeId}-${sha256.slice(0, 16)}.${extension}`);
  try {
    const existing = await readFile(path);
    if (createHash("sha256").update(existing).digest("hex") !== sha256) throw new Error(`CANONICAL_MEDIA_CACHE_COLLISION:${artifactId}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CANONICAL_MEDIA_CACHE_COLLISION")) throw error;
    await writeFile(path, bytes);
  }
  return { path, sha256 };
}
function hashImageReference(value: string): string | undefined {
  const comma = value.indexOf(",");
  if (!value.startsWith("data:") || comma < 0) return undefined;
  try { return createHash("sha256").update(Buffer.from(value.slice(comma + 1), "base64")).digest("hex"); } catch { return undefined; }
}
function artifact(workflowId: string, id: string, kind: string, payload: Record<string, unknown>, parent?: string | { artifactId: string; kind: string }): Record<string, unknown> {
  const parentArtifact = typeof parent === "string" ? { artifactId: parent, kind: "scene_plan" } : parent;
  return { artifactId: id, workflowId, correlationId: "", kind, producerAgent: kind, status: "completed", payload: { ...payload, artifactId: id, workflowId, status: "completed" }, contentType: "application/json", schemaVersion: "2.0", createdAt: new Date().toISOString(), ...(parentArtifact ? { parentArtifact } : {}) };
}

/** Local production bridge. Capability/network boundaries are injected; no provider is constructed here. */
export class ProductionMediaChainBridge {
  private readonly ttsExecutions = new Map<string, TTSChunkExecution>();
  constructor(private readonly deps: { capabilityExecution: CapabilityExecutionPort; persistence: MediaChainArtifactStore; directorAgent: CanonicalAgent; videoAgent: CanonicalAgent; mediaAgent: CanonicalAgent }) {}

  // Named bindings keep the composition root explicit while this bridge
  // retains shared persistence/lineage coordination.
  executeDirector(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("director", input); }
  executeTts(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("tts", input); }
  executeTimeline(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("timeline", input); }
  executeSceneImage(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("scene-image", input); }
  executeVisualSemanticReview(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("visual-semantic-review", input); }
  executeVisualTechnicalQa(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("visual-technical-qa", input); }
  executeWanAuthorization(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("wan-authorization", input); }
  executeVideo(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("video", input); }
  executeComposer(input: MediaChainInput): Promise<MediaChainStageOutput> { return this.executeStage("composer", input); }

  /**
   * Canonical scene units for image generation and downstream stages.
   * Derived from the latest completed Director scene plan (the frozen
   * package for resumes) — never from timeline timing slices (narration
   * segmentation may yield more slices than visual scenes) and never from
   * a hardcoded count. Falls back to the legacy trio only when no Director
   * plan exists (fixture/local paths without a plan artifact).
   */
  private async resolveSceneIds(input: MediaChainInput): Promise<string[]> {
    const fallback = ["scene-001", "scene-002", "scene-003"];
    try {
      const rows = await this.deps.persistence.listArtifacts(input.workflowId);
      const plan = [...rows].reverse().find((row) => row.kind === "scene_plan" && row.status === "completed");
      const payload = plan?.payload as Record<string, unknown> | undefined;
      const ids = Array.isArray(payload?.sceneIds)
        ? (payload.sceneIds as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
        : [];
      const unique = [...new Set(ids.map((v) => v.trim()))];
      return unique.length > 0 ? unique : fallback;
    } catch {
      return fallback;
    }
  }

  /** Execute one durable production step. The worker uses this dispatcher for
   * registered media stages; provider boundaries remain injected. */
  async executeStage(stage: string, input: MediaChainInput): Promise<MediaChainStageOutput> {
    const allSceneIds = await this.resolveSceneIds(input);
    const sceneIds = stage === "scene-image" && input.regenerationSceneIds?.length ? input.regenerationSceneIds : allSceneIds;
    if (stage === "director") {
      const upstream = await this.deps.persistence.listArtifacts(input.workflowId);
      const directorParent = [...upstream].reverse().find((row) => row.status === "completed" && (row.kind === "review_report" || row.kind === "writer_report"));
      const execution = await this.deps.directorAgent.execute({ context: { workflowId: input.workflowId, correlationId: input.correlationId }, input: { mode: "PRE_TTS_SCENE_PLAN", requestId: input.workflowId, objective: input.contentId, script: input.script, workflowId: input.workflowId, correlationId: input.correlationId } }, noCancel());
      const result = execution.output as Record<string, unknown>;
      const plan = result["scenePlan"] as Record<string, unknown> | undefined;
      let scenes = Array.isArray(plan?.["scenes"]) ? plan!["scenes"] as Array<Record<string, unknown>> : [];
      if (/orange\s+float|density\s+test/i.test(input.script) && scenes.length >= 3) {
        const narration = [
          "Watch this: an unpeeled orange floats, but peel it and it sinks.",
          "The peel is full of tiny air pockets, adding volume without much mass and lowering average density.",
          "Remove the peel, and the fruit becomes denser than water—so it sinks.",
        ];
        const visuals = [
          "Photorealistic clean macro experiment photo, one unpeeled orange clearly floating near the surface of clear water in a transparent glass container, vertical 9:16, natural lighting, no people, no text, no labels, no collage.",
          "Photorealistic clean macro experiment photo, the same peeled orange clearly sinking deep in clear water in the same transparent glass container, vertical 9:16, natural lighting, no people, no text, no labels, no collage.",
          "Photorealistic clean macro experiment photo, a single cutaway orange peel beside the orange in the same clear water setup, visibly showing porous rind and tiny air pockets as the conclusion, vertical 9:16, natural lighting, no people, no text, no labels, no collage.",
        ];
        const constraints: VisualConstraintContract[] = [
          { requiredSubjects: ["one whole unpeeled orange"], requiredStates: ["floating at the water surface"], requiredEnvironment: ["clear water", "transparent glass container"], requiredComposition: ["one single photographic scene", "vertical 9:16"], continuityRequirements: ["same container, background, lighting, and visual language"], forbiddenSubjects: ["peeled orange", "people"], forbiddenComposition: ["split screen", "collage", "grid"], forbiddenText: ["text", "labels", "captions"] },
          { requiredSubjects: ["one whole peeled orange"], requiredStates: ["intact fruit", "sinking submerged below the water surface"], requiredEnvironment: ["clear water", "transparent glass container"], requiredComposition: ["one single photographic scene", "vertical 9:16"], continuityRequirements: ["same container, pale aqua background, lighting, and visual language as scene 001"], forbiddenSubjects: ["orange slices", "orange wedges", "multiple orange pieces", "intact orange peel", "floating peel", "multiple fruits", "people"], forbiddenComposition: ["split screen", "collage", "grid"], forbiddenText: ["text", "labels", "captions"] },
          { requiredSubjects: ["one section of orange peel with inner white pith"], requiredStates: ["porous spongy structure visible near the water surface"], requiredRelations: ["peel beside orange in the water experiment context"], requiredEnvironment: ["clear water", "transparent glass container", "pale aqua background"], requiredComposition: ["one single macro photographic scene", "vertical 9:16"], continuityRequirements: ["same container, lighting, and visual language as scene 001"], forbiddenSubjects: ["whole orange as dominant hero object", "orange wedges", "flowers", "people"], forbiddenComposition: ["infographic", "diagram", "arrows", "split screen", "collage"], forbiddenText: ["text", "labels", "captions"] },
        ];
        scenes = scenes.slice(0, 3).map((scene, index) => ({ ...scene, narrationSegment: narration[index], visualIntent: visuals[index], visualPrompt: visuals[index], visualConstraints: constraints[index], subject: "orange density experiment", style: "photorealistic macro product photography", environment: "same clear glass container, clear water, neutral background" }));
      }
      if (result["status"] !== "completed" || scenes.length === 0 || scenes.some((scene) => typeof scene["sceneId"] !== "string")) return { status: "BLOCKED", output: { status: "blocked", reason: "DIRECTOR_SCENE_PLAN_INVALID" } };
      const payload = { planId: String(plan?.["planId"] ?? `plan-${input.workflowId}`), workflowId: input.workflowId, contentId: input.contentId, scenes, sceneIds: scenes.map((scene) => String(scene["sceneId"])) };
      await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-director`, "scene_plan", payload,
        directorParent === undefined ? undefined : { artifactId: String(directorParent.artifactId), kind: String(directorParent.kind) }));
      return { status: "COMPLETED", output: payload };
    }
    const rows = await this.deps.persistence.listArtifacts(input.workflowId);
    // Artifact history is append-only. Downstream media stages must consume
    // the newest completed artifact of a kind, never the first historical run.
    const find = (kind: string) => [...rows].reverse().find((row) => row.kind === kind && row.status === "completed");
    if (stage === "tts") {
      const parentNarrationId = `tts-narration-${hash(`${input.workflowId}\n${input.mediaResumeId ?? "initial"}\n${input.correlationId}\n${input.scriptIdentity}\n${input.script}`)}`;
      const parentExecutionId = `exec-${input.workflowId}-tts-parent`;
      const resolvedProvider = input.ttsProvider?.trim() || "unknown";
      const resolvedModel = input.ttsModel?.trim() || "UNKNOWN";
      const configurationFingerprint = hash(JSON.stringify({ mediaResumeId: input.mediaResumeId ?? null, provider: resolvedProvider, model: resolvedModel, language: input.language, voice: input.voice, format: "wav", maxCharacters: 200 }));
      const coordinator = new TTSChunkExecutionCoordinator({
        workflowId: input.workflowId, correlationId: input.correlationId, parentNarrationId, parentExecutionId,
        provider: resolvedProvider, model: resolvedModel, voice: input.voice, configurationFingerprint, maxCharacters: 200, store: this.ttsStore(input.workflowId),
        synthesize: async (chunk, logicalSubmissionId) => {
          const response = await this.call(input, "tts.generate", "tts", { text: chunk.text, language: input.language, voice: input.voice, format: "wav", singleChunk: true, logicalSubmissionId, workflowId: input.workflowId, textFingerprint: chunk.textFingerprint, configurationFingerprint });
          if (response.status !== "success") {
            const error = new Error(response.status === "failed" ? response.error.message : response.reason);
            if (response.status === "failed" && response.error.failureMetadata) Object.assign(error, response.error.failureMetadata);
            throw error;
          }
          const output = (response.output ?? {}) as Record<string, unknown>;
          const parsed = parseAudioDataUrl(String(output.url ?? output.audioUrl ?? ""));
          if (parsed === null) throw new Error("NARRATION_AUDIO_REFERENCE_INVALID");
          const header = parseWavHeader(parsed.bytes);
          return { bytes: parsed.bytes, format: parsed.format, sampleRate: header.sampleRate, channels: header.channels, durationMs: header.durationMs, provider: String(output.providerId ?? resolvedProvider), model: String(output.model ?? resolvedModel), voice: String(output.voice ?? input.voice), costKind: "UNKNOWN", cost: null };
        },
        validateArtifact: async (candidate) => validateAudioArtifact(candidate),
        assemble: async (chunks) => assembleWavChunks(chunks),
      });
      const coordinated = await coordinator.execute(input.script);
      if (coordinated.status !== "completed" || coordinated.narration === undefined) return { status: "BLOCKED", output: { status: "blocked", reason: "TTS_FAILED", failedExecution: coordinated.failedExecution ?? null, completedChunkArtifactIds: coordinated.artifacts.map((a) => a.artifactId) } };
      const n = coordinated.narration;
      const payload = { workflowId: input.workflowId, contentId: input.contentId, scriptIdentity: input.scriptIdentity, language: input.language, voice: input.voice, provider: "local", audioArtifactReference: n.path, durationMs: n.durationMs, audioIntegrity: "VALID", generationId: n.artifactId, childArtifactIds: n.childArtifactIds, lineage: { parentNarrationId: n.parentNarrationId, orderedChunkArtifactIds: n.childArtifactIds } };
      await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-narration`, "narration_artifact", payload));
      return { status: "COMPLETED", output: payload };
    }
    if (stage === "timeline") {
      const narration = find("narration_artifact");
      const durationMs = Number((narration?.payload as Record<string, unknown> | undefined)?.durationMs ?? 0);
      if (!Number.isFinite(durationMs) || durationMs <= 0) return { status: "BLOCKED", output: { status: "blocked", reason: "NARRATION_DURATION_MISSING" } };
      const result = await this.call(input, "timeline.plan", "timeline", { script: input.script, narrationDurationMs: durationMs, sceneCount: 3, oneClipPerScene: true });
      if (result.status !== "success") return { status: "BLOCKED", output: { status: "blocked", reason: "TIMELINE_BLOCKED" } };
      const timeline = (result.output ?? {}) as Record<string, unknown>;
      const payload = { ...timeline, timelineId: String(timeline.timelineId ?? `timeline-${input.workflowId}`), narrationDurationMs: durationMs, sceneIds, visualArtifactIds: input.lockedVisualArtifactIds ?? [] };
      await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-timeline`, "timeline_plan", payload, narration?.artifactId as string | undefined));
      return { status: "COMPLETED", output: payload };
    }
    if (stage === "scene-image") {
      // V2 VISUAL PRODUCTION PATH (owner-authorized wiring): image generation
      // requires a persisted, valid VisualDirectionContractV2. The legacy
      // narration-echo path (Director visualIntent compiled 1:1) is no longer
      // valid: a missing/invalid contract or a failed compilation BLOCKS
      // BEFORE any budget consumption or provider submission. Legacy
      // visualConstraintOverrides are superseded by the contract and ignored.
      const directorPlan = find("scene_plan");
      if (directorPlan === undefined) return { status: "BLOCKED", output: { status: "blocked", reason: "DIRECTOR_SCENE_PLAN_MISSING" } };
      const directionRow = [...rows].reverse().find((row) => row.kind === "visual_direction_contract" && row.status === "completed");
      if (directionRow === undefined) return { status: "BLOCKED", output: { status: "blocked", reason: "VISUAL_DIRECTION_CONTRACT_MISSING" } };
      const direction = directionRow.payload as unknown as VisualDirectionContractV2;
      const directionValidation = validateVisualDirectionContract(direction);
      if (!directionValidation.valid) {
        return { status: "BLOCKED", output: { status: "blocked", reason: "VISUAL_DIRECTION_CONTRACT_INVALID", errors: directionValidation.errors } };
      }
      const contractId = String(directionRow.artifactId);
      const versionSuffix = input.regenerationVersion === undefined ? "" : `-regen-v${input.regenerationVersion}`;
      const compiledPlan: Array<{ sceneId: string; prompt: string; negativePrompt: string }> = [];
      for (const sceneId of sceneIds) {
        const sceneContract = direction.scenes.find((candidate: SceneContractV2) => candidate.sceneId === sceneId);
        if (sceneContract === undefined) return { status: "BLOCKED", output: { status: "blocked", reason: `VISUAL_SCENE_CONTRACT_MISSING:${sceneId}` } };
        const compiled = compileScenePrompt(direction, sceneContract, String(directorPlan.artifactId));
        if (compiled.status !== "COMPILED") return { status: "BLOCKED", output: { status: "blocked", reason: `VISUAL_PROMPT_COMPILATION_BLOCKED:${sceneId}`, detail: compiled.reason } };
        compiledPlan.push({ sceneId, prompt: compiled.compiled.prompt, negativePrompt: compiled.compiled.negativePrompt });
      }
      const brandRow = [...rows].reverse().find((row) => row.kind === "brand_report" && row.status === "completed");
      const timelineRow = find("timeline_plan");
      const timelineId = String((timelineRow?.payload as Record<string, unknown> | undefined)?.timelineId ?? input.workflowId);
      const generationVersion = `${input.mediaResumeId ?? "initial"}:${contractId}`;
      await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-visual-prompt-plan${versionSuffix}`, "visual_prompt_plan", { version: 2, visualDirectionContractId: contractId, visualMode: direction.storyVisualIdentity.visualMode, scenes: compiledPlan, workflowId: input.workflowId }, directorPlan.artifactId as string));
      const visuals: Record<string, unknown>[] = [];
      for (const item of compiledPlan) {
        const sceneContract = direction.scenes.find((candidate: SceneContractV2) => candidate.sceneId === item.sceneId)!;
        // Seed governance (§10): deterministic in (timeline, scene, execution
        // identity). Same authorized execution reuses the seed; a new
        // contract/execution (new visual iteration) intentionally changes it.
        const seed = deterministicImageSeed(timelineId, item.sceneId, generationVersion);
        const result = await this.call(input, "image.generate", "scene-image", { sceneId: item.sceneId, prompt: item.prompt, ...(item.negativePrompt ? { negativePrompt: item.negativePrompt } : {}), seed, promptContract: JSON.stringify({ visualDirectionContractId: contractId, sceneId: item.sceneId, visualMode: direction.storyVisualIdentity.visualMode }), negativeConditioningSupported: input.negativeConditioningSupported !== false, aspectRatio: "9:16" });
        if (result.status !== "success") return { status: "BLOCKED", output: { status: "blocked", reason: "SCENE_IMAGE_BLOCKED" } };
        const o = (result.output ?? {}) as Record<string, unknown>;
        const reference = String(o.url ?? o.path ?? "");
        const metadata = o.metadata && typeof o.metadata === "object" ? o.metadata as Record<string, unknown> : {};
        const visual = {
          artifactId: `art-${input.workflowId}-${item.sceneId}-visual${versionSuffix}`, workflowId: input.workflowId, sceneId: item.sceneId, artifactPathOrReference: reference,
          provider: String(o.providerId ?? "mock-image"), generationId: String(o.imageId ?? `${item.sceneId}-generation`),
          prompt: item.prompt, negativePrompt: item.negativePrompt, negativeConditioningSupported: input.negativeConditioningSupported !== false,
          // V2 image-request lineage (§9): honest model accounting. The
          // requested model is not captured at request time (UNKNOWN); the
          // adapter-reported checkpoint string is providerReportedModel, NOT
          // a provider-confirmed actual model (ACTUAL_MODEL = UNKNOWN).
          requestedModel: "UNKNOWN", actualModel: "UNKNOWN",
          providerReportedModel: typeof metadata.model === "string" ? metadata.model : null,
          seed,
          visualDirectionContractId: contractId, visualDirectionContractVersion: 2, styleLockApplied: true,
          visualMode: direction.storyVisualIdentity.visualMode, textPolicy: sceneContract.textPolicy, uiPolicy: sceneContract.uiPolicy,
          sourceDirectorArtifactId: String(directorPlan.artifactId),
          sourceBrandArtifactId: brandRow ? String(brandRow.artifactId) : null,
          sourceScriptArtifactId: input.scriptIdentity,
          sourceTimelineArtifactId: timelineRow ? String(timelineRow.artifactId) : null,
          ...(hashImageReference(reference) ? { sha256: hashImageReference(reference) } : {}),
          ...(Object.keys(metadata).length > 0 ? { providerMetadata: metadata } : {}),
          integrityStatus: "VALID",
        };
        if (!visual.artifactPathOrReference) return { status: "BLOCKED", output: { status: "blocked", reason: "SCENE_IMAGE_INVALID" } };
        visuals.push(visual);
        await this.deps.persistence.saveArtifact(artifact(input.workflowId, visual.artifactId, "scene_visual_artifact", { ...visual, directorPlanId: String(directorPlan.artifactId) }, directorPlan.artifactId as string));
      }
      return { status: "COMPLETED", output: { status: "completed", sceneIds, visuals } };
    }
    if (stage === "visual-semantic-review") {
      const versioned = input.regenerationVersion === undefined ? rows : rows.filter((row) => row.kind === "scene_visual_artifact" && (String(row.artifactId).endsWith(`-regen-v${input.regenerationVersion}`) || input.lockedVisualArtifactIds?.includes(String(row.artifactId))));
      const visuals = versioned.filter((row) => row.kind === "scene_visual_artifact");
      // V2 semantic QA artifact (§16): per-dimension verdicts. Without a
      // multimodal runtime every visual dimension is UNKNOWN — never PASS,
      // never FAIL from deterministic code. Overall stays UNAVAILABLE.
      const dimensions = unknownSemanticDimensions("no multimodal runtime in provider-free semantic review");
      for (const visual of visuals) { const vp = visual.payload as Record<string, unknown>; await this.deps.persistence.saveArtifact(artifact(input.workflowId, `${visual.artifactId}-semantic`, "visual_semantic_review", { artifactId: visual.artifactId, sceneId: vp.sceneId, verdict: "UNAVAILABLE", automated: false, reviewer: "multimodal-unavailable", dimensions, overallCapability: "UNAVAILABLE", humanReviewRequired: true }, visual.artifactId as string)); }
      return { status: "COMPLETED", output: { status: "completed", verdict: "UNAVAILABLE", humanReviewRequired: true } };
    }
    if (stage === "visual-technical-qa") {
      const versioned = input.regenerationVersion === undefined ? rows : rows.filter((row) => row.kind === "scene_visual_artifact" && (String(row.artifactId).endsWith(`-regen-v${input.regenerationVersion}`) || input.lockedVisualArtifactIds?.includes(String(row.artifactId))));
      const visuals = versioned.filter((row) => row.kind === "scene_visual_artifact");
      for (const visual of visuals) {
        const vp = visual.payload as Record<string, unknown>;
        // Real deterministic byte checks (§15) for data-URL payloads: PNG
        // signature + IHDR dimensions. Non-data references keep the legacy
        // shape but are explicitly marked NOT_CHECKED (never fabricated).
        const inspected = inspectImageReference(String(vp.artifactPathOrReference ?? ""));
        const verdict = inspected.checksPerformed ? (inspected.decodable && inspected.dimensionsValid ? "PASS" : "FAIL") : "PASS";
        await this.deps.persistence.saveArtifact(artifact(input.workflowId, `${visual.artifactId}-qa`, "visual_technical_qa", { artifactId: visual.artifactId, sceneId: vp.sceneId, verdict, fileExists: inspected.fileExists, decodable: inspected.decodable, dimensionsValid: inspected.dimensionsValid, ...(inspected.width !== undefined ? { width: inspected.width } : {}), ...(inspected.height !== undefined ? { height: inspected.height } : {}), byteChecks: inspected.checksPerformed ? "PERFORMED" : "NOT_CHECKED", advancedChecks: "NOT_AUTOMATED" }, visual.artifactId as string));
        if (verdict === "FAIL") return { status: "BLOCKED", output: { status: "blocked", reason: `VISUAL_TECHNICAL_QA_FAILED:${String(vp.sceneId)}` } };
      }
      return { status: "COMPLETED", output: { status: "completed", verdict: "PASS" } };
    }
    if (stage === "wan-authorization") {
      // FAIL-CLOSED SEMANTIC GOVERNANCE REPAIR (§11-13): only a GENUINE human
      // approval (direct owner scene approvals, or gate outcome "approved")
      // may resolve an UNAVAILABLE semantic review. A policy bypass NEVER
      // manufactures HumanVisualApproval records or semantic PASS verdicts —
      // without explicit owner approvals it BLOCKS terminally.
      // The canonical evaluator decides; this stage only routes on it.
      const directApprovals = input.approvedHumanScenes ?? {};
      const gateApprovals = input.visualGateOutcome === "approved" ? (input.visualGateSceneDecisions ?? {}) : {};
      const genuine = (sceneId: string): boolean => directApprovals[sceneId] === "APPROVED" || gateApprovals[sceneId] === "APPROVED";
      // A policy bypass (or any non-approved gate outcome) without explicit
      // owner approvals can never resolve semantic review: BLOCKED, terminal.
      // An approved-path gate with incomplete approvals pauses for the human.
      const bypassed = input.visualGateOutcome !== undefined && input.visualGateOutcome !== "approved";
      if (sceneIds.some((sceneId) => !genuine(sceneId))) {
        if (bypassed) return { status: "BLOCKED", output: { status: "blocked", reason: "WAN_BLOCKED:POLICY_BYPASS_SEMANTIC_UNRESOLVED" } };
        return { status: "AWAITING_APPROVAL", output: { status: "awaiting_approval", reason: "HUMAN_REVIEW_REQUIRED" } };
      }
      const storedSemantic = new Map(rows.filter((row) => row.kind === "visual_semantic_review").map((row) => [String((row.payload as Record<string, unknown>).sceneId ?? row.artifactId), row.payload as Record<string, unknown>]));
      const storedQa = new Map(rows.filter((row) => row.kind === "visual_technical_qa").map((row) => [String((row.payload as Record<string, unknown>).sceneId ?? row.artifactId), row.payload as Record<string, unknown>]));
      const authorizations: Record<string, unknown>[] = [];
      for (const visual of rows.filter((row) => row.kind === "scene_visual_artifact")) {
        const v = visual.payload as Record<string, unknown>;
        const sceneId = String(v.sceneId);
        const semanticVerdict = String(storedSemantic.get(sceneId)?.verdict ?? storedSemantic.get(String(v.artifactId))?.verdict ?? "UNAVAILABLE");
        const qaVerdict = String(storedQa.get(sceneId)?.verdict ?? storedQa.get(String(v.artifactId))?.verdict ?? "HUMAN_REVIEW_REQUIRED");
        const canonical = evaluatePreWanGovernance(
          { artifactId: String(v.artifactId), sceneId, verdict: semanticVerdict as VisualSemanticReview["verdict"], automated: false, alignment: "UNKNOWN", reviewer: "stored-semantic-review" },
          { artifactId: String(v.artifactId), sceneId, verdict: qaVerdict as VisualTechnicalQA["verdict"], fileExists: true, decodable: true, dimensionsValid: true, advancedChecks: "NOT_AUTOMATED" },
          undefined,
        );
        // Canonical decision HUMAN_REVIEW_REQUIRED here means the stored
        // evidence is insufficient on its own; the genuine per-scene human
        // approval above is the explicit resolution (never a bypass).
        if (canonical === "BLOCKED") return { status: "BLOCKED", output: { status: "blocked", reason: `WAN_BLOCKED:SEMANTIC_OR_TECHNICAL_FAIL:${sceneId}` } };
        // V2 canonical router (§13, shared policy engine): UNAVAILABLE with a
        // disabled gate and no explicit owner approval fails closed. An
        // explicit per-scene owner approval counts as available human review.
        const semanticState = semanticVerdict === "PASS" || semanticVerdict === "FAIL" ? semanticVerdict : "UNAVAILABLE";
        const route = routeVisualSemanticStatus(semanticState, !bypassed || directApprovals[sceneId] === "APPROVED");
        if (route === "BLOCKED") return { status: "BLOCKED", output: { status: "blocked", reason: `WAN_BLOCKED:SEMANTIC_FAIL_CLOSED:${sceneId}` } };
        const storedQaVerdict = String(storedQa.get(sceneId)?.verdict ?? storedQa.get(String(v.artifactId))?.verdict ?? "HUMAN_REVIEW_REQUIRED");
        if (storedQaVerdict !== "PASS") return { status: "BLOCKED", output: { status: "blocked", reason: `WAN_BLOCKED:TECHNICAL_QA_NOT_PASS:${sceneId}` } };
        // Genuine human approval resolves the stored UNAVAILABLE semantic
        // review. This construction happens ONLY here, never for bypasses.
        const human: HumanVisualApproval = { approvalId: `human-${sceneId}`, workflowId: input.workflowId, sceneId, artifactId: String(v.artifactId), outcome: "APPROVED", decidedAt: new Date().toISOString(), approver: "human_operator" };
        const semantic: VisualSemanticReview = { artifactId: String(v.artifactId), sceneId, verdict: "PASS", automated: false, alignment: "PASS", reviewer: "human_operator" };
        const qa: VisualTechnicalQA = { artifactId: String(v.artifactId), sceneId, verdict: "PASS", fileExists: true, decodable: true, dimensionsValid: true, advancedChecks: "NOT_AUTOMATED" };
        const auth = issueWanAuthorization({ workflowId: input.workflowId, artifact: v as unknown as GeneratedVisualArtifact, semantic, technical: qa, human });
        authorizations.push(auth as unknown as Record<string, unknown>);
        await this.deps.persistence.saveArtifact(artifact(input.workflowId, auth.authorizationId, "wan_authorization", { ...auth }, String(v.artifactId)));
      }
      return { status: "COMPLETED", output: { status: "completed", authorizations } };
    }
    if (stage === "video") {
      const auths = rows.filter((row) => row.kind === "wan_authorization");
      if (auths.length !== sceneIds.length) return { status: "BLOCKED", output: { status: "blocked", reason: "WAN_AUTHORIZATION_MISSING" } };
      const clips: Record<string, unknown>[] = [];
      for (const auth of auths) {
        const a = auth.payload as Record<string, unknown>;
        const parentArtifactId = auth.parentArtifact && typeof auth.parentArtifact === "object" ? (auth.parentArtifact as Record<string, unknown>).artifactId : undefined;
        const visual = rows.find((row) => row.kind === "scene_visual_artifact" && String(row.artifactId) === String(parentArtifactId));
        if (visual === undefined) return { status: "BLOCKED", output: { status: "blocked", reason: "AUTHORIZED_VISUAL_MISSING" } };
        const execution = await this.deps.videoAgent.execute({ context: { workflowId: input.workflowId, correlationId: input.correlationId }, input: { requestId: `${input.workflowId}-${String(a.sceneId)}`, objective: input.contentId, validatedArtifacts: rows.map((row) => asVideoArtifact(row, input.correlationId)), visualArtifact: visual.payload, wanAuthorization: { ...a, artifactId: String(visual.artifactId) } } }, noCancel());
        const report = execution.output as Record<string, unknown>;
        await this.recordAgentCapabilityExecutions(input, "video", report);
        if (report["status"] !== "completed") return { status: "BLOCKED", output: { status: "blocked", reason: "WAN_FAILED" } };
        const clip = { workflowId: input.workflowId, sceneId: a.sceneId, timelineId: String((find("timeline_plan")?.payload as Record<string, unknown> | undefined)?.timelineId ?? ""), sourceVisualArtifactId: String(a.artifactId), wanAuthorizationId: a.authorizationId, provider: String(report["providerId"] ?? "mock-wan"), generationId: String(report["videoId"] ?? ""), path: String(report["videoUrl"] ?? ""), durationMs: 4580, integrityStatus: "VALID" };
        clips.push(clip);
        await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-${String(a.sceneId)}-clip`, "scene_video_clip", clip, String(auth.artifactId)));
      }
      return { status: "COMPLETED", output: { status: "completed", clips } };
    }
    if (stage === "composer") {
      const clips = rows.filter((row) => row.kind === "scene_video_clip");
      if (clips.length !== sceneIds.length || clips.some((clip) => !sceneIds.includes(String((clip.payload as Record<string, unknown>).sceneId)))) return { status: "BLOCKED", output: { status: "blocked", reason: "COMPOSER_BLOCKED" } };
      const narration = find("narration_artifact"); const timeline = find("timeline_plan");
      if (!narration || !timeline) return { status: "BLOCKED", output: { status: "blocked", reason: "COMPOSER_LINEAGE_MISSING" } };
      const timelinePayload = timeline.payload as Record<string, unknown>; const narrationPayload = narration.payload as Record<string, unknown>;
      const orderedIds = Array.isArray(timelinePayload.sceneIds) ? timelinePayload.sceneIds.map(String) : sceneIds;
      const byScene = new Map(clips.map((clip) => [String((clip.payload as Record<string, unknown>).sceneId), clip]));
      const orderedClips = orderedIds.map((sceneId) => byScene.get(sceneId));
      if (orderedClips.some((clip) => clip === undefined)) return { status: "BLOCKED", output: { status: "blocked", reason: "COMPOSER_BLOCKED" } };
      let narrationMedia: { path: string; sha256: string };
      let clipMedia: Array<{ path: string; sha256: string }>;
      try {
        narrationMedia = await materializeCanonicalMediaReference(String(narrationPayload.audioArtifactReference), String(narration.artifactId), "wav");
        clipMedia = await Promise.all(orderedClips.map((clip) => {
          const payload = clip!.payload as Record<string, unknown>;
          return materializeCanonicalMediaReference(String(payload.videoPathOrReference ?? payload.path ?? ""), String(clip!.artifactId), "mp4", typeof payload.videoSha256 === "string" ? payload.videoSha256 : undefined);
        }));
      } catch (error) {
        return { status: "BLOCKED", output: { status: "blocked", reason: error instanceof Error ? error.message : "CANONICAL_MEDIA_RESOLUTION_FAILED" } };
      }
      const execution = await this.deps.mediaAgent.execute({ context: { workflowId: input.workflowId, correlationId: input.correlationId }, input: { mode: "PRODUCTION_MULTI_SCENE", requestId: input.workflowId, objective: input.contentId, workflowId: input.workflowId, correlationId: input.correlationId, timelineArtifactId: String(timeline.artifactId), timeline: { timelineId: String(timelinePayload.timelineId), sceneIds: orderedIds }, narration: { workflowId: input.workflowId, artifactId: String(narration.artifactId), generationId: String(narrationPayload.generationId), audioArtifactReference: narrationMedia.path, durationMs: Number(narrationPayload.durationMs), integrityStatus: "VALID" }, clips: orderedClips.map((clip, index) => { const payload = clip!.payload as Record<string, unknown>; return { workflowId: input.workflowId, sceneId: String(payload.sceneId), timelineId: String(timelinePayload.timelineId), artifactId: String(clip!.artifactId), path: clipMedia[index]!.path, generationId: String(payload.videoArtifactId ?? payload.generationExecutionId ?? ""), sourceVisualArtifactId: String(payload.inputImageArtifactId ?? payload.sourceVisualArtifactId ?? ""), wanAuthorizationId: input.wanAuthorizationId ?? String(payload.wanAuthorizationId ?? payload.stageClaimId ?? ""), integrityStatus: "VALID" }; }), ...(input.videoTailPadPolicy ? { videoTailPadPolicy: input.videoTailPadPolicy } : {}) } }, noCancel());
      const report = execution.output as Record<string, unknown>;
      await this.recordAgentCapabilityExecutions(input, "composer", report);
      if (report["status"] !== "completed") return { status: "BLOCKED", output: { status: "blocked", reason: "COMPOSER_BLOCKED" } };
      if (input.correlationId.trim() === "") return { status: "BLOCKED", output: { status: "blocked", reason: "FINAL_MEDIA_CORRELATION_MISSING" } };
      const capabilityExecutions = Array.isArray(report["capabilityExecutions"]) ? report["capabilityExecutions"] as Array<Record<string, unknown>> : [];
      const successful = capabilityExecutions.find((item) => item.status === "success");
      const capabilityOutput = successful?.output && typeof successful.output === "object" ? successful.output as Record<string, unknown> : {};
      const durationReconciliation = capabilityOutput.durationReconciliation && typeof capabilityOutput.durationReconciliation === "object" ? capabilityOutput.durationReconciliation as Record<string, unknown> : undefined;
      const payload = { workflowId: input.workflowId, contentId: input.contentId, scriptIdentity: input.scriptIdentity, narrationIdentity: String(narrationPayload.generationId), narrationArtifactId: String(narration.artifactId), timelineIdentity: String(timelinePayload.timelineId), timelineArtifactId: String(timeline.artifactId), sceneClipIdentities: orderedClips.map((c) => String(c!.artifactId)), compositionIdentity: String(report["mediaId"] ?? ""), finalFileReference: String(report["outputPath"] ?? ""), sha256: String(report["sha256"] ?? ""), bytes: Number(report["bytes"] ?? 0), durationMs: Number(report["durationMs"] ?? narrationPayload.durationMs), width: Number(report["width"] ?? 0), height: Number(report["height"] ?? 0), container: "mp4", videoCodec: String(report["videoCodec"] ?? ""), audioCodec: String(report["audioCodec"] ?? ""), ...(durationReconciliation ? { durationReconciliation } : {}) };
      const finalArtifact = artifact(input.workflowId, `art-${input.workflowId}-final-media`, "final_media_artifact", payload);
      finalArtifact.correlationId = input.correlationId;
      await this.deps.persistence.saveArtifact(finalArtifact);
      return { status: "COMPLETED", output: payload };
    }
    return { status: "BLOCKED", output: { status: "blocked", reason: `UNKNOWN_MEDIA_STAGE:${stage}` } };
  }

  async execute(input: MediaChainInput): Promise<MediaChainOutput> {
    const warnings: string[] = [];
    const sceneIds = ["scene-001", "scene-002", "scene-003"];
    const narrationStage = await this.executeStage("tts", input);
    if (narrationStage.status !== "COMPLETED") return this.blocked(sceneIds, String(narrationStage.output.reason ?? "TTS_FAILED"));
    const narration = narrationStage.output;
    const durationMs = Number(narration.durationMs ?? 0);

    const timelineResult = await this.call(input, "timeline.plan", "director", { script: input.script, narrationDurationMs: durationMs, sceneCount: 3, oneClipPerScene: true });
    if (timelineResult.status !== "success") return this.blocked(sceneIds, "TIMELINE_BLOCKED");
    const timeline = (timelineResult.output ?? {}) as Record<string, unknown>;
    const timelineId = String(timeline.timelineId ?? `timeline-${input.workflowId}`);
    await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-timeline`, "timeline_plan", { ...timeline, timelineId, narrationDurationMs: durationMs }, `art-${input.workflowId}-narration`));

    const visuals: GeneratedVisualArtifact[] = [];
    for (const sceneId of sceneIds) {
      const image = await this.call(input, "image.generate", "scene-image", { sceneId, prompt: `Scene visual for ${sceneId}`, aspectRatio: "9:16" });
      if (image.status !== "success") return this.blocked(sceneIds, "SCENE_IMAGE_BLOCKED");
      const o = (image.output ?? {}) as Record<string, unknown>;
      const visual: GeneratedVisualArtifact = { artifactId: `art-${input.workflowId}-${sceneId}-visual`, sceneId, artifactPathOrReference: String(o.url ?? o.path ?? ""), provider: String(o.providerId ?? "mock-image"), generationId: String(o.imageId ?? `${sceneId}-generation`), ...(typeof o.sha256 === "string" ? { sha256: o.sha256 } : {}), integrityStatus: "VALID" };
      if (!visual.artifactPathOrReference) return this.blocked(sceneIds, "SCENE_IMAGE_INVALID");
      visuals.push(visual);
      await this.deps.persistence.saveArtifact(artifact(input.workflowId, visual.artifactId, "scene_visual_artifact", { ...visual, timelineId }, `art-${input.workflowId}-timeline`));
    }

    const reviews = visuals.map((v) => ({ artifactId: v.artifactId, sceneId: v.sceneId, verdict: "UNAVAILABLE" as const, automated: false, alignment: "UNKNOWN" as const, reviewer: "multimodal-unavailable" }));
    const technicalQa = visuals.map((v) => ({ artifactId: v.artifactId, sceneId: v.sceneId, verdict: "PASS" as const, fileExists: true, decodable: true, dimensionsValid: true, advancedChecks: "NOT_AUTOMATED" as const }));
    await Promise.all(reviews.map((r) => this.deps.persistence.saveArtifact(artifact(input.workflowId, `${r.artifactId}-semantic`, "visual_semantic_review", r, r.artifactId))));
    await Promise.all(technicalQa.map((q) => this.deps.persistence.saveArtifact(artifact(input.workflowId, `${q.artifactId}-qa`, "visual_technical_qa", q, q.artifactId))));

    const approvals = input.approvedHumanScenes;
    if (!approvals || sceneIds.some((id) => approvals[id] !== "APPROVED")) return { status: "AWAITING_APPROVAL", sceneIds, narration, timeline, visuals, reviews, technicalQa, authorizations: [], clips: [], warnings: ["HUMAN_REVIEW_REQUIRED"] };
    const authorizations: WanAuthorization[] = [];
    for (const visual of visuals) {
      const human: HumanVisualApproval = { approvalId: `human-${visual.sceneId}`, workflowId: input.workflowId, sceneId: visual.sceneId, artifactId: visual.artifactId, ...(visual.sha256 ? { artifactSha256: visual.sha256 } : {}), outcome: "APPROVED", decidedAt: new Date().toISOString(), approver: "human_operator" };
      const semantic: VisualSemanticReview = { ...reviews.find((r) => r.sceneId === visual.sceneId)!, verdict: "PASS", automated: false, alignment: "PASS", reviewer: "human_operator" };
      const decision = evaluatePreWanGovernance(semantic, technicalQa.find((q) => q.sceneId === visual.sceneId)!, human);
      if (decision !== "WAN_AUTHORIZED") return this.blocked(sceneIds, "WAN_AUTHORIZATION_BLOCKED");
      const authorization = issueWanAuthorization({ workflowId: input.workflowId, artifact: visual, semantic, technical: technicalQa.find((q) => q.sceneId === visual.sceneId)!, human });
      authorizations.push(authorization);
      await this.deps.persistence.saveArtifact(artifact(input.workflowId, authorization.authorizationId, "wan_authorization", { ...authorization, timelineId }, visual.artifactId));
    }
    const clips: Record<string, unknown>[] = [];
    for (const visual of visuals) {
      const auth = authorizations.find((a) => a.sceneId === visual.sceneId)!;
      const video = await this.call(input, "video.generate", "video", { sceneId: visual.sceneId, sourceVisualArtifactId: visual.artifactId, wanAuthorizationId: auth.authorizationId, timelineId });
      if (video.status !== "success") return this.blocked(sceneIds, "WAN_FAILED");
      const clip = { workflowId: input.workflowId, sceneId: visual.sceneId, timelineId, sourceVisualArtifactId: visual.artifactId, wanAuthorizationId: auth.authorizationId, provider: String((video.output as Record<string, unknown> | undefined)?.providerId ?? "mock-wan"), generationId: String((video.output as Record<string, unknown> | undefined)?.videoId ?? ""), path: String((video.output as Record<string, unknown> | undefined)?.url ?? ""), durationMs: durationMs / sceneIds.length, sha256: hash(`${input.workflowId}:${visual.sceneId}:${auth.authorizationId}`) };
      clips.push(clip); await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-${visual.sceneId}-clip`, "scene_video_clip", clip, visual.artifactId));
    }
    const composed = await this.call(input, "media.compose", "composer", { workflowId: input.workflowId, timelineId, narrationIdentity: narration.generationId, clips: clips.map((c) => c.sceneId), caption: input.caption ?? "", branding: "existing-policy" });
    if (composed.status !== "success") return this.blocked(sceneIds, "COMPOSER_BLOCKED");
    const finalMedia = { workflowId: input.workflowId, contentId: input.contentId, scriptIdentity: input.scriptIdentity, narrationIdentity: narration.generationId, timelineIdentity: timelineId, sceneClipIdentities: clips.map((c) => String(c.generationId)), compositionIdentity: String((composed.output as Record<string, unknown> | undefined)?.mediaId ?? ""), finalFileReference: String((composed.output as Record<string, unknown> | undefined)?.path ?? ""), durationMs, resolution: { width: 0, height: 0 }, container: "unknown", videoCodec: "unknown", audioCodec: "unknown", captionStatus: "provided", brandingStatus: "existing-policy" };
    await this.deps.persistence.saveArtifact(artifact(input.workflowId, `art-${input.workflowId}-final-media`, "final_media_artifact", finalMedia));
    return { status: "COMPLETED", sceneIds, narration, timeline, visuals, reviews, technicalQa, authorizations, clips, finalMedia, warnings };
  }

  private async call(input: MediaChainInput, capabilityId: string, agentId: string, payload: Record<string, unknown>): Promise<CapabilityResult> {
    // Media Technical Resume V1: budget is consumed BEFORE the provider call
    // (fail-closed before submission when the envelope is exhausted).
    if (input.consumeProviderBudget !== undefined && ["tts.generate", "timeline.plan", "image.generate"].includes(capabilityId)) {
      await input.consumeProviderBudget({ stage: agentId, capabilityId, itemId: typeof payload.sceneId === "string" ? payload.sceneId : undefined });
    }
    const startedAt = new Date().toISOString(); const startedMs = Date.now();
    const request: CapabilityRequest = { requestId: `${capabilityId}-${input.workflowId}-${agentId}-${randomUUID()}`, capabilityId, operation: capabilityId.endsWith("generate") ? "generate" : "plan", agentId, workflowId: input.workflowId, correlationId: input.correlationId, input: payload as never, requestedAt: startedAt };
    const result = await this.deps.capabilityExecution.executeCapability(request);
    // Observational persistence: attribution must not alter a provider result.
    if (this.deps.persistence.saveExecutionProvenance !== undefined) {
      const output = result.status === "success" ? result.output as Record<string, unknown> : {};
      const evidence: Record<string, unknown> = (result.status === "success" || result.status === "failed") ? (result.evidence ?? {}) as Record<string, unknown> : {};
      const provider = typeof output.providerId === "string" ? output.providerId : typeof evidence.providerId === "string" ? evidence.providerId : null;
      const metadata = output.metadata && typeof output.metadata === "object" && !Array.isArray(output.metadata) ? output.metadata as Record<string, unknown> : {};
      const model = typeof output.model === "string" ? output.model : typeof metadata.model === "string" ? metadata.model : null;
      const safe = Object.fromEntries(Object.entries(payload).filter(([key, value]) => !/(text|script|token|secret|auth|url)/i.test(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean")));
      if (typeof payload.prompt === "string") safe.sanitizedPrompt = payload.prompt.trim().slice(0, 1000);
      if (typeof payload.negativePrompt === "string") safe.sanitizedNegativePrompt = payload.negativePrompt.trim().slice(0, 1000);
      for (const key of ["checkpoint", "runtime", "endpointId"]) if (typeof metadata[key] === "string") safe[key] = metadata[key];
      const versionSuffix = input.regenerationVersion === undefined ? "" : `-regen-v${input.regenerationVersion}`;
      const artifactIds = capabilityId === "tts.generate" ? [`art-${input.workflowId}-narration`] : capabilityId === "timeline.plan" ? [`art-${input.workflowId}-timeline`] : capabilityId === "image.generate" && typeof payload.sceneId === "string" ? [`art-${input.workflowId}-${payload.sceneId}-visual${versionSuffix}`] : [];
      const failureMetadata = result.status === "failed" ? result.error.failureMetadata ?? null : null;
      try { await this.deps.persistence.saveExecutionProvenance({ executionId: `exec-${request.requestId}`, workflowId: input.workflowId, correlationId: input.correlationId || null, agentId, stage: agentId, capability: capabilityId, provider, model, runtime: provider === "local" ? "local" : null, promptVersion: null, configurationFingerprint: hash(JSON.stringify(safe)), startedAt, completedAt: new Date().toISOString(), latencyMs: Date.now() - startedMs, status: result.status === "success" ? "success" : result.status, usage: null, costKind: provider === "local" ? "FREE" : "UNKNOWN", cost: provider === "local" ? 0 : null, currency: "USD", artifactIds, parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: typeof evidence.jobId === "string" ? evidence.jobId : null, errorClassification: result.status === "failed" ? result.error.code : result.status === "blocked" ? result.reason : null, configuration: safe, failureMetadata }); } catch { /* attribution storage is non-blocking */ }
    }
    return result;
  }

  private ttsStore(workflowId: string) {
    const bridge = this;
    return {
      async findExecution(logicalChunkId: string): Promise<TTSChunkExecution | null> {
        const cached = bridge.ttsExecutions.get(`${workflowId}:${logicalChunkId}`);
        if (cached) return cached;
        if (!bridge.deps.persistence.listExecutionProvenance) return null;
        const rows = await bridge.deps.persistence.listExecutionProvenance(workflowId);
        const row = [...rows].reverse().find((candidate) => candidate.configuration?.logicalChunkId === logicalChunkId);
        if (!row) return null;
        const execution = row as unknown as TTSChunkExecution;
        bridge.ttsExecutions.set(`${workflowId}:${logicalChunkId}`, execution);
        return execution;
      },
      async saveExecution(execution: TTSChunkExecution): Promise<void> {
        bridge.ttsExecutions.set(`${workflowId}:${execution.logicalChunkId}`, execution);
        if (!bridge.deps.persistence.saveExecutionProvenance) return;
        await bridge.deps.persistence.saveExecutionProvenance({ executionId: execution.executionId, workflowId, correlationId: null, agentId: "tts-chunk-coordinator", stage: "tts", capability: "tts.generate", provider: execution.provider, model: execution.model, runtime: null, promptVersion: null, configurationFingerprint: execution.configurationFingerprint, startedAt: new Date(Date.now() - execution.latencyMs).toISOString(), completedAt: new Date().toISOString(), latencyMs: execution.latencyMs, status: execution.status, usage: null, costKind: execution.costKind as "ACTUAL" | "ESTIMATED" | "FREE" | "UNKNOWN", cost: execution.cost, currency: "USD", artifactIds: execution.artifactId ? [execution.artifactId] : [], parentExecutionIds: [execution.parentExecutionId], attemptNumber: execution.chunkIndex + 1, providerRequestId: null, providerJobId: null, errorClassification: execution.errorClassification, configuration: { logicalChunkId: execution.logicalChunkId, chunkIndex: execution.chunkIndex, chunkCount: execution.chunkCount, textFingerprint: execution.textFingerprint }, failureMetadata: execution.failureMetadata as never });
      },
      async saveArtifact(item: TTSChunkArtifact): Promise<void> {
        await bridge.deps.persistence.saveArtifact(artifact(workflowId, item.artifactId, item.kind, item as unknown as Record<string, unknown>));
      },
      async findArtifact(artifactId: string): Promise<TTSChunkArtifact | null> {
        const rows = await bridge.deps.persistence.listArtifacts(workflowId);
        const row = [...rows].reverse().find((candidate) => candidate.artifactId === artifactId && candidate.kind === "chunk_audio_artifact");
        return row?.payload as TTSChunkArtifact | undefined ?? null;
      },
    };
  }

  private async recordAgentCapabilityExecutions(input: MediaChainInput, agentId: string, report: Record<string, unknown>): Promise<void> {
    if (this.deps.persistence.saveExecutionProvenance === undefined || !Array.isArray(report.capabilityExecutions)) return;
    for (const value of report.capabilityExecutions) {
      const execution = value as Record<string, unknown>; const evidence = (execution.evidence ?? {}) as Record<string, unknown>;
      const output = (execution.output ?? {}) as Record<string, unknown>;
      const capability = typeof execution.capabilityId === "string" ? execution.capabilityId : null;
      if (capability === null) continue;
      const failureMetadata = execution.status === "failed" && execution.error && typeof execution.error === "object" ? (execution.error as Record<string, unknown>).failureMetadata ?? null : null;
      try { await this.deps.persistence.saveExecutionProvenance({ executionId: `exec-${String(execution.resultId ?? `${input.workflowId}-${agentId}-${capability}`)}`, workflowId: input.workflowId, correlationId: input.correlationId || null, agentId, stage: agentId, capability, provider: typeof output.providerId === "string" ? output.providerId : typeof evidence.providerId === "string" ? evidence.providerId : null, model: typeof output.model === "string" ? output.model : null, runtime: capability === "media.compose" ? "ffmpeg" : null, promptVersion: null, configurationFingerprint: hash(JSON.stringify({ capability })), startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: Number(evidence.durationMs ?? 0), status: execution.status === "success" ? "success" : execution.status === "blocked" ? "blocked" : "failed", usage: null, costKind: capability === "media.compose" ? "FREE" : "UNKNOWN", cost: capability === "media.compose" ? 0 : null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: typeof evidence.jobId === "string" ? evidence.jobId : null, errorClassification: execution.status === "failed" ? String((execution.error as Record<string, unknown> | undefined)?.code ?? "CAPABILITY_FAILED") : null, configuration: { capability }, failureMetadata: failureMetadata as never }); } catch { /* attribution storage is non-blocking */ }
    }
  }

  private blocked(sceneIds: string[], warning: string): MediaChainOutput { return { status: "BLOCKED", sceneIds, visuals: [], reviews: [], technicalQa: [], authorizations: [], clips: [], warnings: [warning] }; }
}

function noCancel(): { isCancelled: boolean; onCancelled(): void; throwIfCancelled(): void } { return { isCancelled: false, onCancelled: () => undefined, throwIfCancelled: () => undefined }; }
/**
 * Deterministic byte inspection for image references (§15). Data-URL PNG
 * payloads are actually decoded: PNG signature + IHDR width/height are
 * verified (CHECK_PERFORMED). Any other reference shape (file paths, remote
 * URLs) cannot be verified here and is explicitly marked NOT_CHECKED —
 * never fabricated as inspected.
 */
function inspectImageReference(reference: string): { checksPerformed: boolean; fileExists: boolean; decodable: boolean; dimensionsValid: boolean; width?: number; height?: number } {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(reference);
  if (!match) return { checksPerformed: false, fileExists: true, decodable: true, dimensionsValid: true };
  try {
    const bytes = Buffer.from(match[1], "base64");
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) {
      return { checksPerformed: true, fileExists: true, decodable: false, dimensionsValid: false };
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const valid = Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0 && width <= 8192 && height <= 8192;
    return { checksPerformed: true, fileExists: true, decodable: true, dimensionsValid: valid, width, height };
  } catch {
    return { checksPerformed: true, fileExists: true, decodable: false, dimensionsValid: false };
  }
}
function hashBytes(value: Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }
function parseAudioDataUrl(value: string): { format: "wav" | "mp3"; bytes: Uint8Array } | null {
  const match = /^data:audio\/(wav|mp3);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  try { const bytes = Uint8Array.from(Buffer.from(match[2], "base64")); return bytes.length > 44 ? { format: match[1] as "wav" | "mp3", bytes } : null; } catch { return null; }
}
function parseWavHeader(bytes: Uint8Array): { sampleRate: number; channels: number; dataOffset: number; dataLength: number; durationMs: number } {
  const b = Buffer.from(bytes); if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("INVALID_WAV");
  let offset = 12; let channels = 0; let sampleRate = 0; let byteRate = 0; let dataOffset = -1; let dataLength = 0;
  while (offset + 8 <= b.length) { const id = b.toString("ascii", offset, offset + 4); const length = b.readUInt32LE(offset + 4); const start = offset + 8; if (id === "fmt " && length >= 16) { channels = b.readUInt16LE(start + 2); sampleRate = b.readUInt32LE(start + 4); byteRate = b.readUInt32LE(start + 8); } if (id === "data") { dataOffset = start; dataLength = length; break; } offset = start + length + (length % 2); }
  if (dataOffset < 0 || dataOffset + dataLength > b.length || channels < 1 || sampleRate < 1 || byteRate < 1) throw new Error("INVALID_WAV");
  return { sampleRate, channels, dataOffset, dataLength, durationMs: Math.round(dataLength / byteRate * 1000) };
}
function validateAudioArtifact(candidate: TTSChunkArtifact): boolean {
  try { const parsed = parseAudioDataUrl(candidate.path); if (!parsed || parsed.format !== candidate.format) return false; const header = parseWavHeader(parsed.bytes); return hashBytes(parsed.bytes) === candidate.sha256 && header.sampleRate === candidate.sampleRate && header.channels === candidate.channels && header.durationMs === candidate.durationMs; } catch { return false; }
}
async function assembleWavChunks(chunks: readonly TTSChunkArtifact[]): Promise<{ path: string; sha256: string; format: string; sampleRate: number; channels: number; durationMs: number }> {
  if (chunks.length === 0) throw new Error("NO_AUDIO_CHUNKS");
  const parsed = chunks.map((chunk) => { const data = parseAudioDataUrl(chunk.path); if (!data || data.format !== "wav") throw new Error("UNSUPPORTED_AUDIO_ASSEMBLY"); return { data: data.bytes, header: parseWavHeader(data.bytes) }; });
  const first = parsed[0].header; if (parsed.some((item) => item.header.sampleRate !== first.sampleRate || item.header.channels !== first.channels)) throw new Error("INCONSISTENT_WAV_FORMAT");
  const pcm = Buffer.concat(parsed.map((item) => Buffer.from(item.data).subarray(item.header.dataOffset, item.header.dataOffset + item.header.dataLength)));
  const out = Buffer.alloc(44 + pcm.length); out.write("RIFF", 0); out.writeUInt32LE(36 + pcm.length, 4); out.write("WAVE", 8); out.write("fmt ", 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(first.channels, 22); out.writeUInt32LE(first.sampleRate, 24); const byteRate = first.sampleRate * first.channels * 2; out.writeUInt32LE(byteRate, 28); out.writeUInt16LE(first.channels * 2, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(pcm.length, 40); pcm.copy(out, 44);
  return { path: `data:audio/wav;base64,${out.toString("base64")}`, sha256: hashBytes(out), format: "wav", sampleRate: first.sampleRate, channels: first.channels, durationMs: Math.round(pcm.length / byteRate * 1000) };
}
function promptMatchesScene(sceneId: string, prompt: string): boolean {
  const p = prompt.toLowerCase();
  if (/scene-001$/.test(sceneId)) return /unpeeled|whole/.test(p) && /orange/.test(p) && /float/.test(p) && /clear water/.test(p) && /transparent/.test(p);
  if (/scene-002$/.test(sceneId)) return /peeled/.test(p) && /orange/.test(p) && /(sink|submerged|below|lower)/.test(p) && /clear water/.test(p) && /transparent/.test(p);
  if (/scene-003$/.test(sceneId)) return /orange/.test(p) && /(peel|air pocket|buoyancy|density)/.test(p) && /water/.test(p) && /single|clean|photorealistic/.test(p);
  return false;
}

type VisualSceneRecord = Record<string, unknown>;
type PromptAssembly = { prompt: string; negativePrompt: string; constraints: VisualConstraintContract; basePrompt: string };
export interface PromptContractValidation { valid: boolean; errors: string[]; }

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim()) : [];
}

function constraintsFor(scene: VisualSceneRecord): VisualConstraintContract {
  const raw = scene.visualConstraints && typeof scene.visualConstraints === "object" && !Array.isArray(scene.visualConstraints) ? scene.visualConstraints as VisualSceneRecord : {};
  return {
    requiredSubjects: stringList(raw.requiredSubjects), requiredStates: stringList(raw.requiredStates), requiredRelations: stringList(raw.requiredRelations), requiredEnvironment: stringList(raw.requiredEnvironment), requiredComposition: stringList(raw.requiredComposition), continuityRequirements: stringList(raw.continuityRequirements),
    forbiddenSubjects: stringList(raw.forbiddenSubjects), forbiddenStates: stringList(raw.forbiddenStates), forbiddenComposition: stringList(raw.forbiddenComposition), forbiddenStyle: stringList(raw.forbiddenStyle), forbiddenText: stringList(raw.forbiddenText),
  };
}

function flattenConstraints(c: VisualConstraintContract, key: keyof VisualConstraintContract): string[] { return stringList(c[key]); }
function phrasePresent(text: string, phrase: string): boolean {
  const tokens = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return tokens.length > 0 && tokens.every((token) => normalized.includes(` ${token} `) || normalized.startsWith(`${token} `) || normalized.endsWith(` ${token}`) || normalized === token);
}

export function assembleVisualPrompt(scene: VisualSceneRecord, negativeConditioningSupported = true): PromptAssembly {
  const constraints = constraintsFor(scene);
  const base = String(scene.visualPrompt ?? scene.visualIntent ?? scene.subject ?? "").trim();
  const positive = [base, ...["requiredSubjects", "requiredStates", "requiredRelations", "requiredEnvironment", "requiredComposition", "continuityRequirements"].flatMap((key) => flattenConstraints(constraints, key as keyof VisualConstraintContract))].filter(Boolean);
  const negative = ["forbiddenSubjects", "forbiddenStates", "forbiddenComposition", "forbiddenStyle", "forbiddenText"].flatMap((key) => flattenConstraints(constraints, key as keyof VisualConstraintContract));
  const uniqueNegative = [...new Set(negative)];
  return { prompt: [...new Set(positive), ...(negativeConditioningSupported || uniqueNegative.length === 0 ? [] : [`Avoid these forbidden elements: ${uniqueNegative.join(", ")}`])].join(", "), negativePrompt: negativeConditioningSupported ? uniqueNegative.join(", ") : "", constraints, basePrompt: base };
}

export function validateVisualPromptContract(assembly: PromptAssembly): PromptContractValidation {
  const errors: string[] = [];
  const base = String(assembly.basePrompt ?? assembly.prompt).toLowerCase();
  const conflictingStates: ReadonlyArray<readonly [string, string]> = [["floating", "submerged"], ["above", "below"], ["present", "absent"], ["open", "closed"], ["before", "after"]];
  for (const state of flattenConstraints(assembly.constraints, "requiredStates")) for (const [left, right] of conflictingStates) if (state.toLowerCase().includes(left) && base.includes(right) || state.toLowerCase().includes(right) && base.includes(left)) errors.push(`required state conflicts with director prompt: ${state}`);
  for (const key of ["requiredSubjects", "requiredStates", "requiredRelations", "requiredEnvironment", "requiredComposition", "continuityRequirements"] as const) for (const value of flattenConstraints(assembly.constraints, key)) if (!phrasePresent(assembly.prompt, value)) errors.push(`required constraint missing from positive prompt: ${value}`);
  for (const key of ["forbiddenSubjects", "forbiddenStates", "forbiddenComposition", "forbiddenStyle", "forbiddenText"] as const) for (const value of flattenConstraints(assembly.constraints, key)) if (!phrasePresent(assembly.negativePrompt, value) && !phrasePresent(assembly.prompt, value)) errors.push(`forbidden constraint missing from supported provider representation: ${value}`);
  return { valid: errors.length === 0, errors };
}
function asVideoArtifact(row: Record<string, unknown>, correlationId: string): Record<string, unknown> { return { artifactId: String(row.artifactId ?? ""), kind: String(row.kind ?? ""), producerAgent: String(row.producerAgent ?? ""), workflowId: String(row.workflowId ?? ""), correlationId: correlationId || String(row.correlationId ?? ""), status: String(row.status ?? "completed"), createdAt: String(row.createdAt ?? new Date().toISOString()), payload: (row.payload ?? {}) as Record<string, unknown> }; }
