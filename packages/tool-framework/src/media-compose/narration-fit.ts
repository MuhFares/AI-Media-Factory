export type NarrationFitStatus = "PASS" | "BOUNDED_TEMPO_REQUIRED" | "VIDEO_TAIL_PAD_REQUIRED" | "BLOCK" | "NARRATION_DURATION_MISMATCH" | "AUDIO_WOULD_BE_CUT";

export interface VideoTailPadPolicy {
  policyId: string;
  classification: "PLATFORM_VALIDATION_ONLY" | "PRODUCTION";
  enabled: boolean;
  mode: "LAST_FRAME_HOLD";
  maximumExtensionMs: number;
  maximumExtensionRatio: number;
  safetyTailMs: number;
  measurementToleranceMs: number;
}

export interface NarrationFitPolicy {
  speechSafetyTailMs: number;
  maxTempoSpeedup: number;
  videoTailPad?: VideoTailPadPolicy;
}

export interface VideoTailPadDecision {
  mode: "LAST_FRAME_HOLD";
  requiredDurationMs: number;
  targetVideoDurationMs: number;
  reason: "NARRATION_LONGER_THAN_VIDEO_WITHIN_DETERMINISTIC_PAD_POLICY";
  policyId: string;
}

export interface NarrationFitResult {
  fitStatus: NarrationFitStatus;
  videoDurationMs: number;
  actualNarrationDurationMs: number;
  maximumNarrationDurationMs: number;
  excessMs: number;
  requiredTempoFactor?: number;
  videoPad?: VideoTailPadDecision;
  blockReason?: "VIDEO_TAIL_PAD_DISABLED" | "VIDEO_TAIL_PAD_POLICY_EXCEEDED";
  measurementToleranceAppliedMs?: number;
}

export const DEFAULT_NARRATION_FIT_POLICY: NarrationFitPolicy = {
  speechSafetyTailMs: 300,
  maxTempoSpeedup: 1.15,
};

/** Validate speech before composition; composition must never be the first truncation guard. */
export function assessNarrationFit(
  videoDurationMs: number,
  actualNarrationDurationMs: number,
  policy: NarrationFitPolicy = DEFAULT_NARRATION_FIT_POLICY,
): NarrationFitResult {
  if (videoDurationMs <= 0 || actualNarrationDurationMs < 0 || policy.speechSafetyTailMs < 0 || policy.maxTempoSpeedup < 1) {
    throw new Error("Narration fit inputs are invalid");
  }
  const maximumNarrationDurationMs = Math.max(0, videoDurationMs - policy.speechSafetyTailMs);
  const excessMs = Math.max(0, actualNarrationDurationMs - maximumNarrationDurationMs);
  if (excessMs === 0) return { fitStatus: "PASS", videoDurationMs, actualNarrationDurationMs, maximumNarrationDurationMs, excessMs };
  const measurementToleranceMs = policy.videoTailPad?.measurementToleranceMs ?? 0;
  if (excessMs <= measurementToleranceMs && actualNarrationDurationMs <= videoDurationMs) {
    return { fitStatus: "PASS", videoDurationMs, actualNarrationDurationMs, maximumNarrationDurationMs, excessMs, measurementToleranceAppliedMs: excessMs };
  }
  const requiredTempoFactor = actualNarrationDurationMs / maximumNarrationDurationMs;
  if (requiredTempoFactor <= policy.maxTempoSpeedup) {
    return { fitStatus: "BOUNDED_TEMPO_REQUIRED", videoDurationMs, actualNarrationDurationMs, maximumNarrationDurationMs, excessMs, requiredTempoFactor };
  }
  if (policy.videoTailPad !== undefined) {
    const pad = policy.videoTailPad;
    if (!pad.enabled) {
      return { fitStatus: "BLOCK", videoDurationMs, actualNarrationDurationMs, maximumNarrationDurationMs, excessMs, requiredTempoFactor, blockReason: "VIDEO_TAIL_PAD_DISABLED" };
    }
    if (pad.safetyTailMs !== policy.speechSafetyTailMs || pad.maximumExtensionMs < 0 || pad.maximumExtensionRatio < 0 || pad.measurementToleranceMs < 0 || pad.policyId.trim() === "") {
      throw new Error("Narration fit video-tail-pad policy is invalid");
    }
    const targetVideoDurationMs = actualNarrationDurationMs + pad.safetyTailMs;
    const requiredDurationMs = Math.max(0, targetVideoDurationMs - videoDurationMs);
    const extensionRatio = requiredDurationMs / videoDurationMs;
    if (requiredDurationMs > pad.maximumExtensionMs || extensionRatio > pad.maximumExtensionRatio) {
      return { fitStatus: "BLOCK", videoDurationMs, actualNarrationDurationMs, maximumNarrationDurationMs, excessMs, requiredTempoFactor, blockReason: "VIDEO_TAIL_PAD_POLICY_EXCEEDED" };
    }
    return {
      fitStatus: "VIDEO_TAIL_PAD_REQUIRED",
      videoDurationMs,
      actualNarrationDurationMs,
      maximumNarrationDurationMs,
      excessMs,
      requiredTempoFactor,
      videoPad: {
        mode: pad.mode,
        requiredDurationMs,
        targetVideoDurationMs,
        reason: "NARRATION_LONGER_THAN_VIDEO_WITHIN_DETERMINISTIC_PAD_POLICY",
        policyId: pad.policyId,
      },
    };
  }
  return { fitStatus: "NARRATION_DURATION_MISMATCH", videoDurationMs, actualNarrationDurationMs, maximumNarrationDurationMs, excessMs, requiredTempoFactor };
}

export function assertNarrationWillNotBeCut(videoDurationMs: number, finalNarrationDurationMs: number, safetyTailMs = 300): void {
  if (finalNarrationDurationMs > videoDurationMs - safetyTailMs) throw new Error("AUDIO_WOULD_BE_CUT");
}
