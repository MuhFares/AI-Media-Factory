# Thumbnail Agent — Evaluation

How the Thumbnail agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The Thumbnail agent is evaluated offline against recorded optimized assets with known-good concepts and against held-out historical click-through and retention-after-click outcomes. Evaluation weights honesty and qualified click-through above raw click volume, and enforces render-cost discipline, because a bait frame or a budget overrun destroys unit economics regardless of a shocking click rate.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted events conform to `output.schema.json` | 100% |
| Honesty score | Variants that accurately reflect the real content | 100% (hard) |
| Brand-safety adherence | Renders passing brand visual and safety guardrails | 100% (hard) |
| Qualified CTR | Click-through that retains past 30s vs. baseline | >= 85% |
| Variant win rate | Chosen primary wins its downstream test | >= 80% |
| Render-cost adherence | Assets rendered within the configured budget cap | 100% (hard) |
| Gate acceptance | First-pass approvals at Brand + QA | >= 85% |
| Cost per thumbnail | Actual `render_cost_usd` per accepted asset | <= budget cap |

## Regression

Prompt or model changes re-run the full labeled set. Any honesty failure, any brand-safety failure, or any render-cost breach blocks release regardless of other gains.
