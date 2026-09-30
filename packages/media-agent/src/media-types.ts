import type { Json, MediaComposeCapabilityInput, VideoTailPadPolicy } from "@ai-media-factory/tool-framework";

interface MediaAgentBaseInput {
  requestId: string;
  objective: string;
  workflowId?: string;
  correlationId?: string;
  taskDescription?: string;
}

/** Existing single-video compatibility input. */
export interface LegacyMediaAgentInput extends MediaAgentBaseInput, MediaComposeCapabilityInput {
  mode?: "LEGACY_SINGLE_VIDEO";
}

export interface ProductionSceneVideoClip {
  workflowId: string;
  sceneId: string;
  timelineId: string;
  artifactId: string;
  path: string;
  generationId: string;
  sourceVisualArtifactId: string;
  wanAuthorizationId: string;
  integrityStatus: "VALID";
}

/** Canonical production composition input sourced from durable workflow lineage. */
export interface ProductionMediaCompositionInput extends MediaAgentBaseInput {
  mode: "PRODUCTION_MULTI_SCENE";
  workflowId: string;
  timeline: { timelineId: string; sceneIds: readonly string[] };
  narration: { workflowId: string; artifactId: string; generationId: string; audioArtifactReference: string; durationMs: number; integrityStatus: "VALID" };
  clips: readonly ProductionSceneVideoClip[];
  timelineArtifactId: string;
  videoTailPadPolicy?: VideoTailPadPolicy;
  captionInstructions?: Record<string, Json>;
  brandingInstructions?: Record<string, Json>;
}

export type MediaAgentInput = LegacyMediaAgentInput | ProductionMediaCompositionInput;

export interface MediaAgentConfig {
  model: string;
  systemPrompt: string;
}

export interface MediaAgentDependencies {
  execute?: unknown;
  capabilityExecution?: import("@ai-media-factory/runtime").CapabilityExecutionPort;
  config: MediaAgentConfig;
}

export type MediaReportStatus = "completed" | "blocked";

export interface MediaReport {
  reportId: string;
  taskDescription: string;
  objective: string;
  status: MediaReportStatus;
  summary: string;
  video: string;
  audio: string;
  mediaId: string;
  outputPath: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  durationMs: number;
  width: number;
  height: number;
  videoCodec: string;
  audioCodec: string;
  strategy: string;
  videoCopied: boolean;
  executionEvidencePresent: boolean;
  metadata: { createdAt: string; agentVersion: string; providerId: string };
}

export function isProductionMediaCompositionInput(value: unknown): value is ProductionMediaCompositionInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>; const timeline = v["timeline"] as Record<string, unknown> | undefined;
  const narration = v["narration"] as Record<string, unknown> | undefined; const clips = v["clips"];
  if (v["mode"] !== "PRODUCTION_MULTI_SCENE" || typeof v["requestId"] !== "string" || typeof v["objective"] !== "string" || typeof v["workflowId"] !== "string") return false;
  if (!timeline || typeof timeline["timelineId"] !== "string" || !Array.isArray(timeline["sceneIds"]) || !timeline["sceneIds"].every((id) => typeof id === "string")) return false;
  if (!narration || narration["workflowId"] !== v["workflowId"] || typeof narration["generationId"] !== "string" || typeof narration["audioArtifactReference"] !== "string" || typeof narration["durationMs"] !== "number" || narration["durationMs"] <= 0 || narration["integrityStatus"] !== "VALID") return false;
  if (!Array.isArray(clips) || clips.length !== timeline["sceneIds"].length) return false;
  const expected = timeline["sceneIds"] as string[]; const seen = new Set<string>();
  for (const clip of clips as Array<Record<string, unknown>>) {
    if (clip["workflowId"] !== v["workflowId"] || clip["timelineId"] !== timeline["timelineId"] || typeof clip["sceneId"] !== "string" || !expected.includes(clip["sceneId"] as string) || seen.has(clip["sceneId"] as string) || typeof clip["artifactId"] !== "string" || typeof clip["path"] !== "string" || typeof clip["generationId"] !== "string" || typeof clip["sourceVisualArtifactId"] !== "string" || typeof clip["wanAuthorizationId"] !== "string" || clip["integrityStatus"] !== "VALID") return false;
    seen.add(clip["sceneId"] as string);
  }
  return expected.every((id, index) => (clips[index] as Record<string, unknown>)["sceneId"] === id);
}

export function isMediaAgentInput(value: unknown): value is MediaAgentInput {
  if (isProductionMediaCompositionInput(value)) return true;
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (v["mode"] === undefined || v["mode"] === "LEGACY_SINGLE_VIDEO") && typeof v["requestId"] === "string" && v["requestId"].length > 0
    && typeof v["objective"] === "string" && v["objective"].length > 0
    && typeof v["video"] === "string" && v["video"].length > 0
    && typeof v["audio"] === "string" && v["audio"].length > 0;
}

export function mediaInputPaths(input: MediaAgentInput): { video: string; audio: string } {
  return isProductionMediaCompositionInput(input) ? { video: input.clips[0]!.path, audio: input.narration.audioArtifactReference } : { video: input.video, audio: input.audio };
}

export function toCapabilityRequest(input: MediaAgentInput, agentId: string, workflowId: string, correlationId: string): { requestId: string; capabilityId: string; agentId: string; workflowId: string; correlationId: string; input: Json; requestedAt: string } {
  const paths = mediaInputPaths(input);
  return {
    requestId: `media-compose-${input.requestId}`,
    capabilityId: "media.compose" as const,
    agentId,
    workflowId,
    correlationId,
    input: {
      video: paths.video,
      audio: paths.audio,
      ...(isProductionMediaCompositionInput(input)
        ? { audioStrategy: "pad", productionComposition: { workflowId: input.workflowId, timelineArtifactId: input.timelineArtifactId, narrationArtifactId: input.narration.artifactId, sceneIds: [...input.timeline.sceneIds], clipArtifactIds: input.clips.map((clip) => clip.artifactId), clipPaths: input.clips.map((clip) => clip.path), narrationIdentity: input.narration.generationId, ...(input.videoTailPadPolicy ? { videoTailPadPolicy: input.videoTailPadPolicy } : {}) } }
        : { ...(input.outputFormat ? { outputFormat: input.outputFormat } : {}), ...(input.audioStrategy ? { audioStrategy: input.audioStrategy } : {}), ...(input.preserveVideoAudio !== undefined ? { preserveVideoAudio: input.preserveVideoAudio } : {}) }),
    } as Json,
    requestedAt: new Date().toISOString(),
  };
}
