# SEO Agent — Examples

Few-shot examples of on-standard optimization behavior. Illustrative only.

## Example 1 — Honest title that captures a qualified query

**Input (summary):** Script diagnoses why cheap mechanical keyboards feel bad; sections cover switch wobble, stabilizer rattle, case resonance; keyword seeds include "budget keyboard", "why keyboard sounds hollow".

**Behavior:** Title states the real promise and the strongest qualified query: "Why Cheap Mechanical Keyboards Feel Bad (3 Fixable Causes)". Description front-loads the query, summarizes the three diagnosed causes, and adds no claim the script does not make. Chapters mirror the three sections.

**Output:** `title`, `description`, `tags` ranked by relevance, `keywords` from seeds plus mined terms, `chapters` aligned to sections.

## Example 2 — Reject a click-bait title

**Input:** A higher-reach title tested would read "This $20 Keyboard Is Secretly Better Than Any $200 Board" — a claim the script does not make.

**Behavior:** Reject it. It overstates the content. Choose the honest, still-strong option. Because the tension is material, note the conflict and escalate to Brand rather than ship bait.

## Example 3 — Return an unapproved script

**Input:** `ScriptFinished` arrives with `brand_voice_applied` absent or false.

**Behavior:** Emit no metadata. Return the asset. The SEO agent optimizes only approved scripts; it does not launder an unvalidated one through discovery.

## Anti-example (off-standard)

Title: "keyboard, best keyboard, cheap keyboard, mechanical keyboard 2026 review must watch". — Rejected: keyword stuffing, no honest promise, optimizes for raw clicks over qualified reach.
