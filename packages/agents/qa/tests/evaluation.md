# QA Agent — Evaluation

How the QA agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

QA is evaluated offline against a labeled corpus of finished assets — some clean, some with injected defects (corrupt or truncated renders, out-of-bounds durations, missing captions, malformed input envelopes). Because QA is a gate, evaluation weights defect containment and schema discipline over throughput.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted `QAReviewed` events conform to `output.schema.json` | 100% |
| Input validation catch | Malformed `VideoFinished` inputs correctly held | 100% |
| Defect escape rate | Injected defects that wrongly PASS the gate | <= 1% |
| False-hold rate | Clean assets wrongly HELD | <= 5% |
| Defect localization | Held assets carry a correct, actionable defect list | >= 95% |
| Gate latency | Time from `VideoFinished` to `QAReviewed` within budget | >= 95% within SLA |

## Regression

Any prompt or model change re-runs the full labeled corpus. A rise in defect escape rate blocks release regardless of other gains — a gate that leaks defects is worse than no gate.
