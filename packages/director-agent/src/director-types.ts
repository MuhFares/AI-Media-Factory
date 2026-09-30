import type { Json } from "@ai-media-factory/tool-framework";
import type { ReferenceStrategy, VisualMode } from "@ai-media-factory/tool-framework";

interface DirectorAgentBaseInput {
  requestId: string;
  objective: string;
  script: string;
  language?: string;
  dialect?: string;
  audience?: string;
  culturalContext?: string;
  visualStyle?: string;
  visualMode?: VisualMode;
  referenceStrategy?: ReferenceStrategy;
  maxSceneDurationMs?: number;
  minSceneDurationMs?: number;
  preferredClipDurationMs?: number;
  allowPeople?: boolean;
  allowTalkingHead?: boolean;
  workflowId?: string;
  correlationId?: string;
  taskDescription?: string;
}

/** Pre-TTS production mode: semantic scene planning only. */
export interface DirectorScenePlanInput extends DirectorAgentBaseInput {
  mode: "PRE_TTS_SCENE_PLAN";
}

/** Legacy compatibility mode: retain the former timeline-planning contract. */
export interface DirectorTimelineInput extends DirectorAgentBaseInput {
  mode?: "LEGACY_TIMELINE";
  narrationDurationMs: number;
}

export type DirectorAgentInput = DirectorScenePlanInput | DirectorTimelineInput;

export interface DirectorAgentConfig {
  model: string;
  systemPrompt: string;
}

export interface DirectorAgentDependencies {
  execute?: unknown;
  capabilityExecution?: import("@ai-media-factory/runtime").CapabilityExecutionPort;
  config: DirectorAgentConfig;
}

export type DirectorReportStatus = "completed" | "blocked";

export interface DirectorReport {
  reportId: string;
  taskDescription: string;
  objective: string;
  status: DirectorReportStatus;
  summary: string;
  timelineId: string;
  sceneCount: number;
  plannedVisualDurationMs: number;
  coverageRatio: number;
  executionEvidencePresent: boolean;
  metadata: { createdAt: string; agentVersion: string; providerId: string };
  scenePlan?: { planId: string; workflowId: string; scenes: readonly SceneVisualBrief[] };
}

export interface SceneVisualBrief {
  sceneId: string;
  narrationSegment: string;
  visualIntent: string;
  subject: string;
  environment: string;
  style: string;
  continuityRequirements: readonly string[];
  forbiddenElements: readonly string[];
  motionIntent: string;
  referenceStrategy: string;
}

export function isDirectorAgentInput(v: unknown): v is DirectorAgentInput {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const base = typeof r["requestId"] === "string" && r["requestId"].length > 0
    && typeof r["objective"] === "string" && r["objective"].length > 0
    && typeof r["script"] === "string" && r["script"].length > 0;
  if (!base) return false;
  if (r["mode"] === "PRE_TTS_SCENE_PLAN") return true;
  return (r["mode"] === undefined || r["mode"] === "LEGACY_TIMELINE")
    && typeof r["narrationDurationMs"] === "number" && Number.isFinite(r["narrationDurationMs"]);
}

export function isPreTtsScenePlanInput(input: DirectorAgentInput): input is DirectorScenePlanInput {
  return input.mode === "PRE_TTS_SCENE_PLAN";
}

export function toCapabilityRequest(input: DirectorAgentInput, agentId: string, workflowId: string, correlationId: string): { requestId: string; capabilityId: string; agentId: string; workflowId: string; correlationId: string; input: Json; requestedAt: string } {
  if (isPreTtsScenePlanInput(input)) throw new Error("PRE_TTS_SCENE_PLAN does not invoke timeline.plan");
  return {
    requestId: `timeline-plan-${input.requestId}`,
    capabilityId: "timeline.plan",
    agentId,
    workflowId,
    correlationId,
    input: {
      script: input.script,
      narrationDurationMs: input.narrationDurationMs,
      ...(input.language ? { language: input.language } : {}),
      ...(input.dialect ? { dialect: input.dialect } : {}),
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.culturalContext ? { culturalContext: input.culturalContext } : {}),
      ...(input.visualStyle ? { visualStyle: input.visualStyle } : {}),
      ...(input.visualMode ? { visualMode: input.visualMode } : {}),
      ...(input.referenceStrategy ? { referenceStrategy: input.referenceStrategy } : {}),
      ...(input.maxSceneDurationMs !== undefined ? { maxSceneDurationMs: input.maxSceneDurationMs } : {}),
      ...(input.minSceneDurationMs !== undefined ? { minSceneDurationMs: input.minSceneDurationMs } : {}),
      ...(input.preferredClipDurationMs !== undefined ? { preferredClipDurationMs: input.preferredClipDurationMs } : {}),
      ...(input.allowPeople !== undefined ? { allowPeople: input.allowPeople } : {}),
      ...(input.allowTalkingHead !== undefined ? { allowTalkingHead: input.allowTalkingHead } : {}),
    } as unknown as Json,
    requestedAt: new Date().toISOString(),
  };
}
