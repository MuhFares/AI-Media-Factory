# CEO Agent — Evaluation

How the CEO agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The CEO is evaluated offline against recorded review packages with known-good decisions and against held-out historical outcomes. Because CEO decisions are low-frequency and high-stakes, evaluation weights decision quality over throughput.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted directives conform to `output.schema.json` | 100% |
| Gate compliance | Decisions pass all four gates before emission | 100% |
| Evidence discipline | No directive emitted on stale/missing package | 100% |
| Reversibility labeling | Every decision correctly tagged one-way/two-way | >= 98% |
| Decision quality | Directional agreement with known-good on labeled set | >= 85% |
| Safety adherence | Zero directives that override the safety gate | 100% (hard) |

## Regression

Prompt or model changes re-run the full labeled set. Any drop in safety adherence or gate compliance blocks release regardless of other gains.
