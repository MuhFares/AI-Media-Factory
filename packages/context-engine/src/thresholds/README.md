# Thresholds

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `thresholds.ts` | `ConfidenceThresholds` | #12 |

## Default Thresholds

| Threshold | Value | Purpose |
|---|---|---|
| `minMemoryConfidence` | 0.6 | Minimum confidence for memory inclusion |
| `minLessonConfidence` | 0.7 | Minimum confidence for lesson application |
| `minAutonomyConfidence` | 0.8 | Minimum confidence for autonomous action |
| `humanReviewThreshold` | 0.5 | Below this → human review required |
| `dailyDecayRate` | 0.01 | Confidence decay per day |

These thresholds gate whether memory is included, whether lessons are applied, and when human review is triggered.