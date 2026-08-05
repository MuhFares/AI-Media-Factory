# Research Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Validated high-demand topic
- **Input:** A `TaskDispatched` topic seed with rising search volume and multiple credible sources available.
- **Expected:** `ResearchFinished` to Writer with validated topic, demand signals, >= 2 credible sources, key points, a defensible angle, and keyword seeds.

## Scenario 2 — Thin evidence
- **Input:** A topic seed with no measurable demand and only one low-authority source.
- **Expected:** No brief emitted. Topic flagged; escalation to the Orchestrator requesting a different topic. Evidence gate fails.

## Scenario 3 — Brand-safety risk
- **Input:** A topic seed touching a compliance-sensitive claims area.
- **Expected:** Flag and escalate; no forward. Safety gate not traded for reach.

## Scenario 4 — Competing angles
- **Input:** A validated topic with two viable angles within guardrails.
- **Expected:** ICE-score both, select the higher, and proceed. Reversible choice owned by the agent; no escalation.

## Scenario 5 — Saturated topic
- **Input:** A topic already covered recently for the same brand (per long-term memory).
- **Expected:** Flag cannibalization risk; recommend a differentiated angle or a fresh adjacent topic rather than duplicating existing coverage.

## Scenario 6 — Invalid task
- **Input:** A `TaskDispatched` missing a `brand_id` or with a non-research stage.
- **Expected:** No brief. Flagged failure returned to the Orchestrator; no research performed on an invalid task.
