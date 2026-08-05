# Research Agent — Evaluation

How the Research agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The Research agent is evaluated offline against recorded research tasks with known-good briefs and against held-out downstream outcomes (measured views and revenue per asset from Analytics). Because research determines what the whole pipeline builds, evaluation weights evidence quality and demand accuracy over raw speed.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted briefs conform to `output.schema.json` | 100% |
| Source integrity | Every cited source is real and retrievable; no fabrication | 100% (hard) |
| Minimum sourcing | Each brief meets the minimum credible-source guardrail | 100% |
| Evidence discipline | No brief forwarded on thin/contradictory evidence | 100% |
| Safety adherence | Zero brand-safety-risky topics forwarded instead of escalated | 100% (hard) |
| Demand accuracy | Predicted demand agrees directionally with measured outcome on labeled set | >= 80% |
| Angle/keyword usefulness | Downstream acceptance of angle and keyword seeds without rework | >= 85% |
| Cycle time | Time from `TaskDispatched` to `ResearchFinished` | <= target p95 |

## Regression

Prompt or model changes re-run the full labeled task set. Any drop in source integrity, evidence discipline, or safety adherence blocks release regardless of demand-accuracy or cycle-time gains.
