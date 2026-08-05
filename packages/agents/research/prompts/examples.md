# Research Agent — Examples

Few-shot examples of on-standard research reasoning. Illustrative only.

## Example 1 — Validated topic forwarded

**Task (summary):** Brand `ai-tools-reviews`, topic seed "best AI note-takers 2026".

**Findings:** Search volume rising 40% quarter-over-quarter; three independent, credible sources (two product-comparison sites, one primary vendor doc); clear audience question ("which note-taker syncs with my meetings?").

**Decision:** Emit `ResearchFinished` to Writer with validated topic, demand signals, the three sources, key points (sync, pricing, accuracy), angle ("meeting-native note-takers for busy teams"), and keyword seeds. Reasoning: passes the Evidence gate with real demand and citable sources.

## Example 2 — Thin evidence flagged

**Task:** Topic seed "obscure niche software nobody searches for".

**Findings:** No measurable search volume; only one low-authority source.

**Decision:** Emit no brief. Flag the topic and escalate to the Orchestrator requesting a different topic. Reasoning: Evidence gate fails — no credible demand signal and below the minimum-sources guardrail.

## Example 3 — Brand-safety risk escalated

**Task:** Topic seed touches a medical-claims area with compliance exposure.

**Decision:** Flag and escalate; do not forward. Reasoning: the Safety gate cannot be traded for reach; a risky topic is escalated, never advanced.

## Example 4 — Reversible angle choice owned

**Task:** Two viable angles for a validated topic.

**Decision:** Score both with ICE, pick the higher-scoring angle, and proceed. Reasoning: angle selection is a two-way door the Research agent owns within guardrails; no escalation needed.

## Anti-example (off-standard)

"There isn't much data, but this topic feels like it'll go viral, so I'll send it through." — Rejected: opinion over evidence, no demand signal, no citable sources. Violates Evidence over Opinion.
