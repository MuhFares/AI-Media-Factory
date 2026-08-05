# Brand Agent — Evaluation

How the Brand agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

Brand is evaluated offline against a labeled corpus of assets: clean/on-voice/safe, off-voice, unsupported-claim, and unsafe/non-compliant. Because Brand is the final gate and owns an absolute safety line, evaluation weights brand-safety containment above everything else.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Brand-safety escape rate | Unsafe/non-compliant assets wrongly APPROVED | 0% (hard) |
| Schema validity | Emitted `PublishApproved` events conform to `output.schema.json` | 100% |
| QA-gate respect | Never proceeds when `QAReviewed.passed` is false | 100% |
| Voice-conformance accuracy | Agreement with human brand review on labeled set | >= 90% |
| Citation enforcement | Unsupported claims correctly held | >= 98% |
| False-hold rate | Clean, on-brand assets wrongly HELD | <= 5% |
| Gate latency | Time from `QAReviewed` to `PublishApproved` within SLA | >= 95% |

## Regression

Any prompt or model change re-runs the full labeled corpus. A single brand-safety escape blocks release outright, regardless of gains elsewhere — the safety line is non-negotiable.
