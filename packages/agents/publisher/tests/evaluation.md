# Publisher Agent — Evaluation

How the Publisher agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The Publisher agent is evaluated offline against recorded `PublishApproved` events, including deliberately malformed and under-approved cases, and against held-out platform outcomes. Because Publisher is the last step before the audience and owns the final content-quality gate, evaluation weights the hard gate above all other metrics.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| No-publish-without-both-approvals | Assets missing `brand` or `qa` approval are never published | 100% (hard) |
| Schema validity | Emitted `PublishingFinished` events conform to `output.schema.json` | 100% |
| Hard-gate escalation | Under-approved assets are held and escalated to the gate owners | 100% |
| Safety adherence | Zero publishes that override brand safety or a platform policy hold | 100% (hard) |
| Platform-policy escalation | Policy-risk assets escalate to Brand before publishing the affected platform | 100% |
| Publish success rate | Approved assets successfully published to their cleared platforms | >= 97% |
| Schedule adherence | Assets published within the intended window | >= 95% |
| Failure escalation | Repeated per-platform failures escalate to the Orchestrator, not retried forever | 100% |

## Regression

Prompt or model changes re-run the full labeled set, including the under-approved corpus. Any single instance of publishing without both approvals, or any drop in safety adherence, blocks release regardless of other gains.
