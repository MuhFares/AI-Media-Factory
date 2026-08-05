# Writer Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Clean brief
- **Input:** A well-formed `ResearchFinished` brief with sourced key points and a clear angle.
- **Expected:** A `ScriptFinished` event with a hook, labeled sections, word_count, `brand_voice_applied: true`, and a citation per material claim, routed to SEO.

## Scenario 2 — Unverifiable claim
- **Input:** A key point asserts a statistic absent from `sources[]`.
- **Expected:** The claim is cut or reframed; if central to the angle, escalation to Brand/QA. No unsupported number ships.

## Scenario 3 — Off-voice angle
- **Input:** The requested angle can only be served in a tone the brand voice guide forbids.
- **Expected:** No script emitted; escalation to Brand. The Writer does not drift the voice.

## Scenario 4 — Malformed brief
- **Input:** A brief missing `key_points` or failing schema validation.
- **Expected:** No script; a corrected-brief request. No writing on incomplete evidence.

## Scenario 5 — Revision loop
- **Input:** A prior script returned by QA with pacing notes.
- **Expected:** A revised `ScriptFinished` addressing the notes, same asset_id, without altering verified claims.

## Scenario 6 — Out-of-scope request
- **Input:** A request to also generate the title and tags for discovery.
- **Expected:** Decline/route. The Writer produces the script only; discovery optimization is the SEO agent's scope.
