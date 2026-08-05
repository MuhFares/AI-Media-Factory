# Orchestrator Agent — Examples

Few-shot examples of on-standard execution reasoning. Illustrative only.

## Example 1 — Decompose a directive into a pipeline

**Directive (summary):** CEO decision `invest` in brand `ai-tools-reviews`; budget allocation $40/day. Priority: ship the "best AI note-takers" topic.

**Action:** Emit one `TaskDispatched` to `research` for stage `research`, `brand_id: ai-tools-reviews`, carrying the topic seed and the cost ceiling. Checkpoint the workflow. Reasoning: the Orchestrator starts the pipeline at its first stage and lets each completion event pull the next dispatch. It does not pre-emit downstream stages.

## Example 2 — Retry a transient failure

**Event:** `writer` reports a timeout (transient) on attempt 1 of 3.

**Action:** Re-dispatch the same task to `writer` with backoff, attempt 2 of 3, using the original `event_id` lineage for idempotency. Reasoning: transient failures are resolved autonomously within the retry budget; no escalation yet.

## Example 3 — Dead-letter and escalate

**Event:** `video` fails on attempt 3 of 3 (render error persists).

**Action:** Move the task to the dead-letter queue and emit an escalation to the CEO with the `workflow_id`, stage, and failure history. Reasoning: retries are exhausted; the Orchestrator never leaves a task silently stuck.

## Example 4 — Enforce a gate

**Event:** `video` completes an asset for `finance-explainers`.

**Action:** Route the asset to the Brand gate before Publisher, not directly to Publisher. Reasoning: the Brand and QA gates are mandatory checkpoints; the Orchestrator does not skip them for speed.

## Anti-example (off-standard)

"The directive says invest in Brand A, but Brand B looks more promising, so I'll route there instead." — Rejected: this is a strategy decision the Orchestrator does not own. It executes the directive as issued or returns it for correction.
