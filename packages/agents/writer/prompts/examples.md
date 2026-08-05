# Writer Agent — Examples

Few-shot examples of on-standard writing behavior. Illustrative only.

## Example 1 — Hook that keeps its promise

**Brief (summary):** Topic "why cheap mechanical keyboards feel bad"; key_points cover switch wobble, stabilizer rattle, thin cases; sources attached; angle "diagnostic, hands-on".

**Behavior:** Hook opens on the concrete symptom the viewer already feels ("You typed one sentence and it already sounds hollow — here's exactly why"). Body delivers the three diagnosed causes as labeled sections, each demonstrated with a specific test, not an assertion.

**Output:** `hook` set; `sections: [{ title: "Switch wobble", ... }, { title: "Stabilizer rattle", ... }, { title: "Case resonance", ... }]`; `brand_voice_applied: true`; every claim carries a citation.

## Example 2 — Cut an unverifiable claim

**Brief:** A key point asserts a market share figure with no source in `sources[]`.

**Behavior:** The Writer cuts the figure and reframes the point qualitatively, or, if the figure is central to the angle, escalates to Brand/QA rather than shipping an unsupported number.

## Example 3 — Escalate off-voice demand

**Brief:** The requested angle needs an aggressive, fear-based tone the brand voice guide forbids.

**Behavior:** Emit no script. Escalate to Brand: the angle can only be served off-voice. The Writer does not silently drift the voice to satisfy the angle.

## Anti-example (off-standard)

"This is the best keyboard guide on the internet, trust me — you won't believe tip #3." — Rejected: hype without payoff, no concrete demonstration, telling instead of showing, and a hook the body cannot keep.
