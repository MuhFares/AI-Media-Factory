/**
 * timeline.plan capability — governed planning, deterministic-v2, zero external calls.
 */

import type { CapabilityExecutorPort, CapabilityRequest, CapabilityResult, CapabilityResolver, ExecutionEvidence } from "../capabilities.js";
import { DeterministicTimelinePlanner, canonicalNormalize } from "./timeline-planner.js";
import type { TimelinePlan, TimelinePlanner, TimelinePlannerInput } from "./timeline-planner.js";

export const TIMELINE_PLAN_CAPABILITY_ID = "timeline.plan";

export interface TimelinePlanCapabilityInput {
  script: string;
  narrationDurationMs: number;
  language?: string;
  dialect?: string;
  audience?: string;
  culturalContext?: string;
  visualStyle?: string;
  visualMode?: import("../visual-capability/visual-capability.js").VisualMode;
  referenceStrategy?: import("../visual-capability/visual-capability.js").ReferenceStrategy;
  maxSceneDurationMs?: number;
  minSceneDurationMs?: number;
  preferredClipDurationMs?: number;
  allowPeople?: boolean;
  allowTalkingHead?: boolean;
  videoGenerationProfile?: { preferredClipDurationMs?: number; maxClipDurationMs?: number; oneClipPerScene?: boolean; providerFamily?: string };
}

export interface TimelinePlanCapabilityOutput extends TimelinePlan {}

export interface TimelinePlanCapabilityPolicy {
  maxScriptLength: number;
  maxNarrationDurationMs: number;
  minNarrationDurationMs: number;
  maxSceneDurationMs: number;
  minSceneDurationMs: number;
  defaultPreferredClipDurationMs: number;
}

type TimelinePlanRequest = CapabilityRequest<TimelinePlanCapabilityInput>;
type TimelinePlanResult = CapabilityResult<TimelinePlanCapabilityOutput>;

const ALLOWED_VISUAL_TYPES: readonly string[] = ["broll", "environment", "person", "product", "ui", "code", "infographic", "abstract"];

export class TimelinePlanCapabilityExecutor implements CapabilityExecutorPort<TimelinePlanCapabilityInput, TimelinePlanCapabilityOutput> {
  private readonly policy: TimelinePlanCapabilityPolicy;
  private readonly planner: TimelinePlanner;

  constructor(
    private readonly resolver: CapabilityResolver,
    planner: TimelinePlanner | undefined,
    policy: Partial<TimelinePlanCapabilityPolicy>,
  ) {
    this.planner = planner ?? new DeterministicTimelinePlanner();
    const defaults: TimelinePlanCapabilityPolicy = {
      maxScriptLength: 10000,
      maxNarrationDurationMs: 300_000,
      minNarrationDurationMs: 500,
      maxSceneDurationMs: 10000,
      minSceneDurationMs: 1000,
      defaultPreferredClipDurationMs: 5000,
    };
    this.policy = { ...defaults, ...policy };
  }

  async execute(request: TimelinePlanRequest): Promise<TimelinePlanResult> {
    const startedAt = Date.now();
    const descriptor = this.resolver.resolve(request.capabilityId);
    if (request.capabilityId !== TIMELINE_PLAN_CAPABILITY_ID || descriptor === null || !this.resolver.isAuthorized(request.agentId, request.capabilityId)) {
      return this.blocked(request, "timeline.plan capability is not authorized");
    }
    const validation = this.validateInput(request.input);
    if (validation !== null) return this.blocked(request, validation);

    const plannerInput: TimelinePlannerInput = {
      script: request.input.script.trim(),
      narrationDurationMs: request.input.narrationDurationMs,
      ...(request.input.language ? { language: request.input.language } : {}),
      ...(request.input.dialect ? { dialect: request.input.dialect } : {}),
      ...(request.input.audience ? { audience: request.input.audience } : {}),
      ...(request.input.culturalContext ? { culturalContext: request.input.culturalContext } : {}),
      ...(request.input.visualStyle ? { visualStyle: request.input.visualStyle } : {}),
      ...(request.input.visualMode ? { visualMode: request.input.visualMode } : {}),
      ...(request.input.referenceStrategy ? { referenceStrategy: request.input.referenceStrategy } : {}),
      ...(request.input.maxSceneDurationMs !== undefined ? { maxSceneDurationMs: request.input.maxSceneDurationMs } : {}),
      ...(request.input.minSceneDurationMs !== undefined ? { minSceneDurationMs: request.input.minSceneDurationMs } : {}),
      ...(request.input.preferredClipDurationMs !== undefined ? { preferredClipDurationMs: request.input.preferredClipDurationMs } : {}),
      ...(request.input.allowPeople !== undefined ? { allowPeople: request.input.allowPeople } : {}),
      ...(request.input.allowTalkingHead !== undefined ? { allowTalkingHead: request.input.allowTalkingHead } : {}),
      ...(request.input.videoGenerationProfile ? { videoGenerationProfile: request.input.videoGenerationProfile } : {}),
    };

    let plan: TimelinePlan;
    try {
      plan = this.planner.plan(plannerInput);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.failed(request, "PLANNER_ERROR", msg, startedAt);
    }

    const invariantError = this.validatePlan(plan, plannerInput);
    if (invariantError !== null) {
      return this.failed(request, "INVALID_PLAN", invariantError, startedAt);
    }

    return {
      status: "success",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      output: plan,
      evidence: this.evidence(request, plan, true, startedAt, true),
    };
  }

  private validateInput(input: TimelinePlanCapabilityInput): string | null {
    if (typeof input.script !== "string" || input.script.trim().length === 0) return "script must not be empty";
    if (input.script.trim().length > this.policy.maxScriptLength) return `script exceeds max length ${this.policy.maxScriptLength}`;
    if (typeof input.narrationDurationMs !== "number" || !Number.isFinite(input.narrationDurationMs)) return "narrationDurationMs must be a finite number";
    if (input.narrationDurationMs < this.policy.minNarrationDurationMs) return `narrationDurationMs must be >= ${this.policy.minNarrationDurationMs}`;
    if (input.narrationDurationMs > this.policy.maxNarrationDurationMs) return `narrationDurationMs must be <= ${this.policy.maxNarrationDurationMs}`;
    if (input.maxSceneDurationMs !== undefined && (!Number.isFinite(input.maxSceneDurationMs) || input.maxSceneDurationMs <= 0)) return "maxSceneDurationMs must be positive";
    if (input.minSceneDurationMs !== undefined && (!Number.isFinite(input.minSceneDurationMs) || input.minSceneDurationMs <= 0)) return "minSceneDurationMs must be positive";
    if (input.minSceneDurationMs !== undefined && input.maxSceneDurationMs !== undefined && input.minSceneDurationMs > input.maxSceneDurationMs) return "minSceneDurationMs must not exceed maxSceneDurationMs";
    if (input.preferredClipDurationMs !== undefined && (!Number.isFinite(input.preferredClipDurationMs) || input.preferredClipDurationMs <= 0)) return "preferredClipDurationMs must be positive";
    if (input.videoGenerationProfile !== undefined) {
      const p = input.videoGenerationProfile as Record<string, unknown>;
      if (p["preferredClipDurationMs"] !== undefined && (!Number.isFinite(p["preferredClipDurationMs"] as number) || (p["preferredClipDurationMs"] as number) <= 0)) return "videoGenerationProfile.preferredClipDurationMs must be positive";
      if (p["maxClipDurationMs"] !== undefined && (!Number.isFinite(p["maxClipDurationMs"] as number) || (p["maxClipDurationMs"] as number) <= 0)) return "videoGenerationProfile.maxClipDurationMs must be positive";
    }
    if (input.allowTalkingHead !== undefined && typeof input.allowTalkingHead !== "boolean") return "allowTalkingHead must be a boolean";
    if (input.allowPeople !== undefined && typeof input.allowPeople !== "boolean") return "allowPeople must be a boolean";
    const raw = input as unknown as Record<string, unknown>;
    if ("visualType" in raw || "imagePrompt" in raw) return "visualType/imagePrompt are planner outputs, not inputs";
    return null;
  }

  private validatePlan(plan: TimelinePlan, input: TimelinePlannerInput): string | null {
    if (plan.scenes.length === 0) return "plan must have at least one scene";
    if (plan.scenes[0].startMs !== 0) return "first scene must start at 0";
    if (plan.scenes[plan.scenes.length - 1].endMs !== input.narrationDurationMs) return "final scene must cover narration end";
    // Timeline coverage (narration completeness)
    if (plan.timelineCoverageDurationMs < input.narrationDurationMs) return `timeline coverage violated: ${plan.timelineCoverageDurationMs} < ${input.narrationDurationMs}`;
    if (plan.timelineCoverageRatio < 1.0) return "timelineCoverageRatio must be >= 1.0";
    // Generated visual coverage (generation completeness)
    if (plan.estimatedGeneratedVideoDurationMs < input.narrationDurationMs) return `generated visual coverage violated: ${plan.estimatedGeneratedVideoDurationMs} < ${input.narrationDurationMs}`;
    if (plan.generatedVisualCoverageRatio < 1.0) return "generatedVisualCoverageRatio must be >= 1.0";
    // Generation-aware: each scene's generation target must cover its narration slice
    for (const s of plan.scenes) {
      if (s.generation.targetDurationMs < s.durationMs) return `scene ${s.sceneId} generation target ${s.generation.targetDurationMs} < scene duration ${s.durationMs}`;
    }
    // One-clip-per-scene: scene duration must not exceed max clip duration (100ms tolerance for rounding)
    if (plan.generationProfile.oneClipPerScene) {
      const toleranceMs = 100;
      for (const s of plan.scenes) {
        if (s.durationMs > plan.generationProfile.maxClipDurationMs + toleranceMs) return `scene ${s.sceneId} duration ${s.durationMs} exceeds maxClipDuration ${plan.generationProfile.maxClipDurationMs}`;
      }
      if (plan.sceneCount < plan.requiredVideoClipCount) return `sceneCount ${plan.sceneCount} < requiredVideoClipCount ${plan.requiredVideoClipCount} under oneClipPerScene`;
      if (plan.generationSummary.videoClipCount !== plan.sceneCount) return `generationSummary.videoClipCount ${plan.generationSummary.videoClipCount} != sceneCount ${plan.sceneCount}`;
    }
    for (let i = 0; i < plan.scenes.length; i++) {
      const s = plan.scenes[i];
      if (s.durationMs <= 0) return `scene ${s.sceneId} has non-positive duration`;
      if (s.startMs >= s.endMs) return `scene ${s.sceneId} start >= end`;
      if (i > 0 && s.startMs !== plan.scenes[i - 1].endMs) return `gap/overlap between ${plan.scenes[i - 1].sceneId} and ${s.sceneId}`;
      if (!ALLOWED_VISUAL_TYPES.includes(s.visualType)) return `scene ${s.sceneId} has invalid visualType ${s.visualType}`;
      if (input.allowTalkingHead === false || input.allowTalkingHead === undefined) {
        if (s.speakingMode === "talking_head") return `scene ${s.sceneId} has talking_head but allowTalkingHead is false`;
        if (/speaking to camera|presenter narrating|man saying|woman saying/iu.test(s.imagePrompt)) return `scene ${s.sceneId} imagePrompt implies talking head`;
      }
      if (typeof s.imagePrompt !== "string" || s.imagePrompt.trim().length === 0) return `scene ${s.sceneId} missing imagePrompt`;
      if (typeof s.motionPrompt !== "string" || s.motionPrompt.trim().length === 0) return `scene ${s.sceneId} missing motionPrompt`;
      if (typeof s.sceneConcept !== "string" || s.sceneConcept.trim().length === 0) return `scene ${s.sceneId} missing sceneConcept`;
      if (typeof s.purpose !== "string" || s.purpose.trim().length === 0) return `scene ${s.sceneId} missing purpose`;
    }
    // 100% narration preservation: canonical normalize must match exactly
    const joined = plan.scenes.map((s) => s.narration.text).join(" ");
    const normalizedOriginal = canonicalNormalize(input.script);
    const normalizedJoined = canonicalNormalize(joined);
    if (normalizedJoined !== normalizedOriginal) {
      return `narration not preserved 100%: original ${normalizedOriginal.length} chars vs joined ${normalizedJoined.length} chars`;
    }
    return null;
  }

  private blocked(request: TimelinePlanRequest, reason: string): TimelinePlanResult {
    return { status: "blocked", resultId: this.resultId(request), capabilityId: request.capabilityId, reason };
  }

  private failed(request: TimelinePlanRequest, code: string, message: string, startedAt: number): TimelinePlanResult {
    return {
      status: "failed",
      resultId: this.resultId(request),
      capabilityId: request.capabilityId,
      error: { code, message, retryable: false },
      evidence: this.evidence(request, null, false, startedAt, true, { code, message }),
    };
  }

  private evidence(request: TimelinePlanRequest, plan: TimelinePlan | null, succeeded: boolean, startedAt: number, providerInvoked: boolean, error?: { code: string; message: string }): ExecutionEvidence {
    return {
      evidenceId: `evidence-${this.resultId(request)}`,
      capabilityId: request.capabilityId,
      providerId: (this as unknown as { planner: { id?: string } }).planner?.id ?? "deterministic-v2",
      providerInvoked,
      workflowId: request.workflowId,
      correlationId: request.correlationId,
      agentId: request.agentId,
      executedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt),
      succeeded,
      resultStatus: succeeded ? "success" : "failed",
      ...(plan ? { timelineId: (plan as unknown as Record<string, unknown>)["timelineId"] as string } : {}),
      ...(error ? { error } : {}),
    } as unknown as ExecutionEvidence;
  }

  private resultId(request: TimelinePlanRequest): string {
    return `timeline-plan-result-${request.requestId}`;
  }
}

export interface CreateTimelinePlanCapabilityOptions {
  resolver: CapabilityResolver;
  planner?: TimelinePlanner;
  policy?: Partial<TimelinePlanCapabilityPolicy>;
}

export function createTimelinePlanCapability(options: CreateTimelinePlanCapabilityOptions): TimelinePlanCapabilityExecutor {
  return new TimelinePlanCapabilityExecutor(options.resolver, options.planner, options.policy ?? {});
}
