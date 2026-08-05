# Analytics Agent — Evaluation

How the Analytics agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

Analytics is evaluated offline against recorded `PublishingFinished` events paired with reconciled ground-truth performance and finance-confirmed revenue. Because Analytics is the evidentiary base for the whole feedback layer, evaluation weights measurement accuracy and honesty about gaps over speed.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted reports conform to `output.schema.json` | 100% |
| Metric accuracy | Computed metrics match ground truth within tolerance | >= 98% |
| Attribution accuracy | Attributed revenue agrees with finance reconciliation | >= 95% |
| Coverage completeness | Required metrics present when the feed is available | >= 99% |
| Gap honesty | Missing/unverifiable data flagged, never fabricated | 100% (hard) |
| Insight actionability | Insights that inform a downstream decision on labeled set | >= 70% |

## Regression

Prompt, model, or attribution-method changes re-run the full labeled set. Any drop in gap honesty or a regression in attribution accuracy blocks release regardless of other gains, because corrupted evidence propagates into Finance's margin gate.
