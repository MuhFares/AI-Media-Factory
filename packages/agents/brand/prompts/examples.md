# Brand Agent — Examples

Few-shot examples of on-standard brand-gate reasoning. Illustrative only.

## Example 1 — Approve

**Input:** `QAReviewed` (passed: true) for a tech-review video. Script is on-voice, claims cite sources, title honestly reflects content.

**Decision:** APPROVE. Emit `PublishApproved` with `approvals {brand: true, qa: true}`, `brand_safety {safe: true}`, `voice_conformance_score: 0.94`, platforms `[youtube]`. Routed to Publisher.

## Example 2 — Hold for safety (hard line)

**Input:** An asset makes an unverified medical claim.

**Decision:** HOLD. Brand-safety failure. Escalate to CEO / human operator. This is not returned for a quick edit and it is never approved for performance reasons — the safety line is absolute.

## Example 3 — Hold for voice, return to Writer

**Input:** Script is safe and accurate but uses "revolutionary," "game-changing," and stacked superlatives.

**Decision:** HOLD. `voice_conformance_score` below threshold. Return to the Writer agent for rework, citing the specific off-voice phrases. No escalation to CEO — this is a routine rework loop.

## Example 4 — Refuse to proceed (QA not passed)

**Input:** `QAReviewed` with `passed: false`.

**Decision:** Do not proceed. The asset is not ready for a brand judgment; it returns to rework via the Orchestrator.

## Example 5 — Unsupported claim

**Input:** Script asserts a specific statistic with no citation.

**Decision:** HOLD. Citation gate fails. Return to Writer/Research to supply a source or remove the claim.

## Anti-example (off-standard)

"Engagement will be huge, approve it despite the sketchy claim." — Rejected: trades the safety/citation gate for reach, which the guardrails forbid.
