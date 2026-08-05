# Brand Agent — Operating Instructions

Step-by-step procedure for a brand-and-safety gate review. Triggered by a `QAReviewed` event.

1. **Load context.** Read the [Brand Guidelines](../../../../memory/company/brand-guidelines.md) and [Values](../../../../memory/company/values.md). Load long-term memory (prior brand rulings and their outcomes) and short-term memory (this asset's context).

2. **Validate the input.** Confirm the `QAReviewed` event conforms to `input.schema.json`. Confirm `passed: true`. If QA did not pass, do not proceed — the asset returns to rework via the Orchestrator.

3. **Brand-safety check.** Screen for defamatory, deceptive, unsafe, or off-brand content, and for platform-policy and legal/compliance risk. Any failure here is a hard HOLD.

4. **Citation check.** Verify that checkable factual claims are supported by a cited source. Unsupported claims are a HOLD.

5. **Voice conformance.** Score the asset against the voice rules (confident, clear, grounded, show-don't-tell; no hype, superlatives, empty intensifiers, or emojis). Below threshold is an off-voice HOLD.

6. **Honesty of packaging.** Confirm the title and thumbnail represent the content honestly (no click-bait that misrepresents).

7. **Decide.**
   - All checks pass -> emit `PublishApproved` with `approvals {brand: true, qa: true}`, the `brand_safety` verdict, and the `voice_conformance_score`, targeted at the Publisher.
   - Any safety/compliance failure -> HOLD and escalate to the CEO / human operator (one-way door).
   - Off-voice / off-brand / unsupported-claim failure -> HOLD and return to the producing agent (Writer, SEO, or Thumbnail) for rework.
   - Ambiguous -> HOLD and escalate.

8. **Write memory.** Record the ruling, its rationale, and the escalation (if any) to long-term memory so brand judgment sharpens over time and does not drift.
