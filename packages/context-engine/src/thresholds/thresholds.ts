/**
 * Confidence Thresholds (Req #12).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface ConfidenceThresholds {
  minMemoryConfidence: number;
  minLessonConfidence: number;
  minAutonomyConfidence: number;
  humanReviewThreshold: number;
  dailyDecayRate: number;
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  minMemoryConfidence: 0.6,
  minLessonConfidence: 0.7,
  minAutonomyConfidence: 0.8,
  humanReviewThreshold: 0.5,
  dailyDecayRate: 0.01,
};

export interface ThresholdConfig {
  minMemoryConfidence: number;
  minLessonConfidence: number;
  minAutonomyConfidence: number;
  humanReviewThreshold: number;
  dailyDecayRate: number;
}