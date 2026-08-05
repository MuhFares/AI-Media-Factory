# Orchestrator Agent — Workflow

How the Orchestrator agent executes within the event-driven pipeline. The Orchestrator sits between the CEO and every specialist agent; it is the control plane of the entire production loop.

## Position in the pipeline

```
CEO(ExecutiveDirective) -> Orchestrator(TaskDispatched) -> Research
   -> Writer -> SEO -> Thumbnail -> Video
   -> [Brand + QA gates] -> Publisher -> Analytics -> Finance
   -> Orchestrator assembles CEO review package -> CEO(CEOReviewRequested)
```

The Orchestrator never produces or publishes an asset. It routes every stage, waits on each completion event, and pulls the next dispatch. It also assembles the review package that triggers the next CEO cycle.

## Trigger

- **Directive-driven:** the CEO emits `ExecutiveDirective`; the Orchestrator decomposes it and dispatches the first task.
- **Event-driven:** a specialist agent emits a completion or failure event; the Orchestrator advances or retries the workflow.

## Execution steps

1. Consume the trigger event and validate it against `input.schema.json` (for directives) or the specialist's completion contract.
2. For a directive, confirm every referenced brand, agent, and budget exists; decompose into a stage sequence.
3. Determine the single next stage and target agent for the `workflow_id`.
4. Emit exactly one `TaskDispatched` (validated against `output.schema.json`) with stage, `brand_id`, and retry policy. Checkpoint state.
5. On completion, route the asset through the Brand and QA gates where required, then advance to the next stage (repeat from step 3).
6. On failure, retry with backoff up to the configured limit using idempotent re-dispatch.

## Failure handling

- Transient failure: retry with backoff within the per-task budget; no escalation.
- Exhausted retries: move the task to the dead-letter queue and escalate to the CEO with the failure history.
- Stuck workflow (no reply beyond timeout): escalate to the CEO; onward to the human operator for infrastructure-level failures.
- Invalid or inconsistent directive: dispatch nothing; return the directive for correction (no partial execution).
