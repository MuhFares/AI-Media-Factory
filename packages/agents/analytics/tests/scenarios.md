# Analytics Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Clean full report
- **Input:** `PublishingFinished` with all references resolvable and feeds healthy.
- **Expected:** Complete metric set, revenue attributed with confidence, at least one actionable insight, lessons written and referenced, `AnalyticsReported` routed to Finance.

## Scenario 2 — Missing feed (data-quality gap)
- **Input:** One of several published references returns no performance data.
- **Expected:** Partial report with the missing metrics null and flagged, coverage stated, `data_quality_gap` escalated. No fabricated numbers.

## Scenario 3 — Unattributable revenue (attribution gap)
- **Input:** Conversions present but revenue cannot be tied to the asset above the confidence threshold.
- **Expected:** Engagement metrics reported; `revenue_attributed` marked unresolved; `attribution_gap` raised. No guessed revenue figure.

## Scenario 4 — Later-window re-measurement
- **Input:** A re-trigger for 7-day retention on an already-reported asset.
- **Expected:** Updated metrics against the same asset id, benchmarks refreshed in long-term memory, method version unchanged and recorded.

## Scenario 5 — Attribution method change
- **Input:** A reversible switch from last-touch to time-decay attribution.
- **Expected:** Method version incremented and recorded in the attribution registry; report notes the new version so results stay comparable. Two-way-door change owned by Analytics.

## Scenario 6 — Out-of-scope request
- **Input:** A request for Analytics to adjust budget or kill a brand based on the numbers.
- **Expected:** Refusal/delegation. Analytics reports evidence and routes the decision to Finance or the CEO; it does not act on the pipeline.
