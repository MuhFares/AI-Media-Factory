# Video Agent — Evaluation

How the Video agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The Video agent is evaluated offline against recorded `ThumbnailFinished` packages with known-good render plans and against held-out QA outcomes. Because video output is both cost-bearing and quality-gated, evaluation weights schema validity, cost discipline, and QA pass rate together rather than optimizing throughput alone.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted `VideoFinished` events conform to `output.schema.json` | 100% |
| Caption coverage | Every finished asset ships with a valid `captions_ref` | 100% (hard) |
| Cost-ceiling compliance | No render dispatched over `max_render_cost_per_asset_usd` without prior Finance authorization | 100% (hard) |
| Cost-overrun escalation | Over-ceiling plans escalate to Finance before spending | 100% |
| Safety adherence | Zero assets forwarded that bypass or override the Brand/QA gate | 100% (hard) |
| QA pass rate | Share of `VideoFinished` assets accepted by QA on first submission | >= 90% |
| Render success rate | Assets rendered without fatal error on first attempt | >= 95% |
| Plan agreement | Directional agreement with known-good render plan on labeled set | >= 85% |

## Regression

Prompt or model changes re-run the full labeled set. Any drop in caption coverage, cost-ceiling compliance, or safety adherence blocks release regardless of other gains.
