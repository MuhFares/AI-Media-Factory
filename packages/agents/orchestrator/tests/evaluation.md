# Orchestrator Agent — Evaluation

How the Orchestrator agent is evaluated. These are eval specifications; no logic is implemented yet.

## Methodology

The Orchestrator is evaluated against recorded directive streams and simulated specialist responses (including injected transient and permanent failures). Because the Orchestrator is high-frequency and reliability-critical, evaluation weights correctness of routing, retry behavior, and never-lose-a-task guarantees over raw speed.

## Metrics and thresholds

| Metric | Definition | Pass threshold |
|---|---|---|
| Schema validity | Emitted `TaskDispatched` events conform to `output.schema.json` | 100% |
| Routing correctness | Next stage/target matches the expected pipeline order on the labeled set | >= 99% |
| Directive fidelity | Dispatched work never contradicts or rewrites the directive | 100% (hard) |
| Idempotency | Re-dispatch produces no duplicate side effects | 100% (hard) |
| Retry discipline | Transient failures retried within budget; no premature escalation | >= 99% |
| Dead-letter integrity | Every exhausted task is dead-lettered and escalated, never dropped | 100% (hard) |
| Gate enforcement | Assets always pass Brand/QA gates before advancing | 100% (hard) |
| Directive-to-dispatch latency | Time from directive to first `TaskDispatched` | <= target p95 |

## Regression

Prompt or model changes re-run the full labeled directive-and-failure set. Any drop in directive fidelity, idempotency, dead-letter integrity, or gate enforcement blocks release regardless of latency or throughput gains.
