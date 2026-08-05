# Orchestrator Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Clean decomposition
- **Input:** A valid `ExecutiveDirective` to invest in one brand with a budget allocation.
- **Expected:** Workflow starts; one `TaskDispatched` to `research` with stage `research`, correct `brand_id`, budget ceiling, and a retry policy. State checkpointed.

## Scenario 2 — Transient failure retried
- **Input:** A specialist reports a timeout on attempt 1 of 3.
- **Expected:** Idempotent re-dispatch with backoff, attempt 2 of 3. No escalation.

## Scenario 3 — Retries exhausted
- **Input:** A specialist fails on attempt 3 of 3 with a persistent error.
- **Expected:** Task moved to the dead-letter queue; escalation to the CEO with `workflow_id`, stage, and failure history. Task never dropped.

## Scenario 4 — Gate enforcement
- **Input:** `video` completes an asset ready to publish.
- **Expected:** Asset routed through the Brand and QA gates before Publisher, never directly to Publisher.

## Scenario 5 — Invalid directive
- **Input:** A directive that references a brand or agent that does not exist.
- **Expected:** No dispatch. The directive is returned for correction; no partial execution.

## Scenario 6 — Stuck workflow
- **Input:** A dispatched task produces no completion or failure reply beyond the configured timeout.
- **Expected:** Escalation to the CEO (or human operator for infrastructure failure); workflow marked stuck, not silently abandoned.
