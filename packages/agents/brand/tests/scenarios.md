# Brand Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Clean asset approved
- **Input:** `QAReviewed` (passed: true); asset is on-voice, safe, claims cited, honest packaging.
- **Expected:** `PublishApproved` with `approvals {brand: true, qa: true}`, `brand_safety.safe: true`, high `voice_conformance_score`. Routed to Publisher.

## Scenario 2 — Unsafe content (hard hold)
- **Input:** Asset contains a deceptive or unsafe claim.
- **Expected:** HOLD; escalate to CEO / human operator; never approved for performance reasons. Brand-safety line is absolute.

## Scenario 3 — Off-voice
- **Input:** Safe, accurate asset that uses hype and stacked superlatives.
- **Expected:** HOLD; `voice_conformance_score` below threshold; returned to Writer for rework; no CEO escalation.

## Scenario 4 — QA did not pass
- **Input:** `QAReviewed` with `passed: false`.
- **Expected:** Brand does not proceed; asset returns to rework via Orchestrator.

## Scenario 5 — Unsupported claim
- **Input:** A checkable statistic with no citation.
- **Expected:** HOLD; citation gate fails; returned to Writer/Research to supply a source or cut the claim.

## Scenario 6 — Misleading packaging
- **Input:** Accurate script but a click-bait title/thumbnail that misrepresents the content.
- **Expected:** HOLD; packaging-honesty failure; returned to SEO/Thumbnail for rework.

## Anti-scenario (off-standard)
- Approving an unsafe asset because it is projected to perform well. Rejected: trades the absolute safety line for reach, which the guardrails forbid.
