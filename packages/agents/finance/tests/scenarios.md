# Finance Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Healthy asset certified
- **Input:** `AnalyticsReported` with reconcilable revenue well above cost.
- **Expected:** Margin gate PASS, full cost breakdown, positive AGP contribution, budget status `within`, `FinanceReported` routed to the CEO.

## Scenario 2 — Negative unit economics
- **Input:** Costs exceed attributed revenue, no CEO investment rationale on record.
- **Expected:** Margin gate FAIL, negative AGP contribution flagged, routing recommendation to a cheaper tier, escalation to the CEO.

## Scenario 3 — Budget overrun
- **Input:** Brand daily spend exceeds its allocated cap.
- **Expected:** Budget status `over`, enforcement action taken (throttle/pause), overrun escalated to the CEO with the action recorded.

## Scenario 4 — Reconciliation gap
- **Input:** Attributed revenue does not reconcile with recorded income within tolerance.
- **Expected:** Cost breakdown reported, margin verdict `withheld`, reconciliation gap escalated. No margin certified on unreconciled revenue.

## Scenario 5 — Mandated investment (negative margin allowed)
- **Input:** Negative margin on an asset with a CEO investment rationale and defined payback on record.
- **Expected:** Margin gate reported as within the mandated investment; no overreaction; economics tracked against the stated payback.

## Scenario 6 — Out-of-scope request
- **Input:** A request for Finance to kill a brand or change pricing on the numbers.
- **Expected:** Refusal/delegation. Finance reports the economics and escalates the one-way-door decision to the CEO; it enforces and recommends but does not decide.
