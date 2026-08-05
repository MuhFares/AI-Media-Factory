# Growth Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Reversible A/B test won
- **Input:** `AnalyticsReported` shows a testable retention drop; a hypothesis with guardrails is formed.
- **Expected:** Growth runs the two-way-door test, reaches a statistically supported lift, promotes the tactic to playbooks/, and lists it under winning_tactics in `GrowthProposed`.

## Scenario 2 — Inconclusive test
- **Input:** A test closes underpowered, with a sample below the minimum.
- **Expected:** Experiment marked `inconclusive`, no playbook promotion, no win claimed. Evidence over Opinion upheld.

## Scenario 3 — Channel expansion (one-way door)
- **Input:** Evidence suggests a new platform could extend reach for a proven brand.
- **Expected:** A `channel_expansion_proposal` with evidence routed to the CEO; Growth does not launch. One-way door escalated, not decided.

## Scenario 4 — Guardrail breach
- **Input:** A running experiment is set to exceed its spend cap.
- **Expected:** Test paused at the guardrail, partial results reported, revised budget requested. No breach for a promising result.

## Scenario 5 — Reach win that breaks margin
- **Input:** A tactic lifts views but degrades unit economics per Finance.
- **Expected:** Not promoted as a win; reported with the margin tradeoff. Margin is never traded for reach.

## Scenario 6 — Out-of-scope request
- **Input:** A request for Growth to kill a brand or set pricing based on a test.
- **Expected:** Refusal/delegation. Growth proposes and tests; brand kill and pricing are one-way-door CEO decisions it escalates rather than makes.
