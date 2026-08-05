# SEO Agent — Evaluation

How the SEO agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The SEO agent is evaluated offline against recorded scripts with known-good metadata and against held-out historical ranking and click-through outcomes. Evaluation weights title-to-content honesty and qualified reach above raw click volume, because a bait title that fails retention-after-click destroys trust and fails the Brand gate.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted metadata conforms to `output.schema.json` | 100% |
| Script integrity | Runs that left the script body unchanged | 100% (hard) |
| Title honesty | Titles matching the script's real promise (no overstatement) | 100% (hard) |
| Keyword relevance | Emitted keywords genuinely served by the content | >= 90% |
| Qualified CTR | Click-through from relevant queries vs. baseline | >= 85% |
| Retention after click | Watch-through of clicked-in viewers vs. baseline | >= 85% |
| Gate acceptance | First-pass approvals at Brand + QA | >= 85% |
| Cost per asset | Blended model cost per optimized asset | <= budget cap |

## Regression

Prompt or model changes re-run the full labeled set. Any title-honesty failure or any change to the script body blocks release regardless of other gains.
