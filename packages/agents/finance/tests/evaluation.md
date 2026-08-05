# Finance Agent — Evaluation

How the Finance agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

Finance is evaluated offline against recorded `AnalyticsReported` events paired with reconciled ground-truth costs, revenue, and known-good margin verdicts. Because Finance owns the Margin gate and enforces every budget, evaluation weights margin-verdict correctness and budget-enforcement reliability over throughput.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted reports conform to `output.schema.json` | 100% |
| Margin-gate accuracy | Correct pass/fail/withheld verdict vs known-good | >= 98% |
| Cost-breakdown accuracy | Computed costs match ground truth within tolerance | >= 98% |
| Budget-enforcement reliability | Overruns detected and enforced when a cap is breached | 100% (hard) |
| Escalation correctness | Negative unit economics and overruns escalated | 100% (hard) |
| Reconciliation discipline | No margin verdict certified on unreconciled revenue | 100% |
| Routing efficiency | Contribution preserved per dollar on labeled routing set | >= 85% |

## Regression

Prompt, model, or cost-model changes re-run the full labeled set. Any drop in budget-enforcement reliability or escalation correctness blocks release regardless of other gains, because a miss here lets negative unit economics reach the North Star unchecked.
