# Analytics Intelligence V1 (canonical)

**Date:** 2026-09-24. **Mode:** PLATFORM_VALIDATION_MODE.
Authority unchanged: NOT_GRANTED / NOT_GRANTED / NOT_PUBLISHED.
Zero provider calls, zero uploads in this program.

## Architecture

Raw provider metrics → normalized observations (existing
performance_observations) → content/artifact/strategy lineage → comparable
dimensions → KPI computation → trend detection → experiment evaluation
(existing M2 evaluate path) → evidence-backed insights → canonical M2
learning → recommendation → Owner decision boundary. No second
recommendation engine, no autonomous start, no LLM required.

## Metric definitions

Canonical registry (`metricDefinition`): views, likes, comments, shares
(COUNT/sum), watchTimeSeconds, averageViewDuration (DURATION sum/mean),
revenue (CURRENCY, excluded from validation proofs), cost (UNKNOWN unless
authoritative metadata exists). Unknown names stay unsupported, never
assumed. Future: impressions, clicks, CTR, retention, completion,
subscribers/followers gained, engagement, conversion.

## KPI semantics

engagementInteractions = likes + comments + shares (all required).
engagementRate = interactions / views (views=0 with engagement is
incoherent data, not zero). averageWatchPercentage needs content duration.
viewsPerDay needs windowDays > 0. windowGrowth needs nonzero baseline.
Every KPI returns a state: OK, INSUFFICIENT_DATA, NOT_APPLICABLE,
NOT_YET_AVAILABLE, INCOMPATIBLE_WINDOW, UNSUPPORTED_METRIC.

## Comparison and window semantics

Comparisons require same day-count, same provenance class, same platform;
anything else yields PARTIALLY_COMPARABLE (direction only),
INCOMPATIBLE, or INSUFFICIENT_DATA with the reason stated. LIVE and
STUBBED are never equivalent.

## Trend semantics

First-half vs second-half mean; ±10% shift over ≥3 points is UP/DOWN,
else FLAT; fewer than 3 finite points or zero baseline is
INSUFFICIENT_DATA. Rule travels with every verdict.

## Insight semantics

Deterministic builders only (comparison, sparseness, provider gaps,
experiment evaluability). Every insight carries evidence refs, metric
refs, window, and confidence. Insights describe; they never prescribe
authority and never claim causality. Contributors use fixed vocabulary:
OBSERVED_ASSOCIATION, POSSIBLE_CONTRIBUTOR, INSUFFICIENT_EVIDENCE,
NOT_EVALUABLE.

## Agent consumption contract

Stable read endpoints under /control/analytics/* (overview, content,
content/:id, comparisons, experiments, insights, availability,
agent-query). Factual queries answered with evidence + quality flags:
best_by_views, format comparisons (honest INSUFFICIENT_DATA),
experiments_tracked, project_overview fallback. Narrative synthesis may
come later; never required for correctness.

## Owner experience

Analytics workspace: overview cards, content performance with KPIs,
server-side comparisons, experiments with evaluability, insights with
evidence, learning via canonical summary, availability states (AVAILABLE,
NOT_YET_AVAILABLE, INSUFFICIENT_DATA, INCOMPATIBLE, UNKNOWN). Sparse data
renders sparse on purpose. Drill-down reuses Content Item.

## Proof evidence

Engines 7/7, endpoints 3/3, UI 3/3, M2 learning chain reused (no new
recommendation system), cost rollup preserves UNKNOWN, no-execution
assertions green, V1.1 + Program 1–3 regressions green.
