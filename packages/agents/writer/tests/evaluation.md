# Writer Agent — Evaluation

How the Writer agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The Writer is evaluated offline against recorded research briefs with known-good scripts and against held-out historical retention outcomes. Evaluation weights voice fidelity and factual integrity above raw throughput, because an off-voice or unsupported script fails the Brand and QA gates regardless of speed.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted scripts conform to `output.schema.json` | 100% |
| Citation integrity | Material claims with a traceable brief source | 100% (hard) |
| Voice fidelity | Scripts passing brand-voice check without revision | >= 90% |
| Hook strength | Hook retention proxy vs. historical baseline | >= 85% |
| Gate acceptance | First-pass approvals at Brand + QA | >= 80% |
| No fabrication | Scripts containing an invented, unsupported claim | 0% (hard) |
| Cost per script | Blended model cost per accepted script | <= budget cap |

## Regression

Prompt or model changes re-run the full labeled set. Any drop in citation integrity or any fabrication instance blocks release regardless of other gains.
