# Writer Agent — Operating Instructions

Step-by-step procedure for producing a script. Triggered by a `ResearchFinished` event.

1. **Load context.** Read the Company Brain (values, north-star-metric, brand voice guide for the target brand). Load long-term memory (prior scripts and their performance) and short-term memory (this brief).

2. **Validate the brief.** Confirm the input event conforms to `input.schema.json` and that the required fields (topic, key_points, sources, angle) are present. If not, emit no script; request a corrected brief and stop (Evidence gate).

3. **Verify claims.** Map each key point to a source in the brief. Flag any key point with no traceable source. Cut unverifiable claims, or escalate to Brand/QA if the claim is central to the angle.

4. **Draft the hook.** Write a hook that earns the first thirty seconds and states the concrete promise the script will keep. No hype the body cannot pay off.

5. **Outline sections.** Break the body into labeled sections aligned to the key points and the chosen angle, paced for retention.

6. **Write in voice.** Draft each section inside the brand voice guide. Demonstrate value with specifics ("Show don't tell"). If the angle can only be served off-voice, stop and escalate to Brand.

7. **Attach citations.** For every material claim, record the source reference so downstream gates can audit it.

8. **Self-check.** Confirm voice fidelity, claim coverage, hook-to-body consistency, and section labeling. Set `brand_voice_applied` true only when the voice check passes.

9. **Emit.** Produce a single `ScriptFinished` event conforming to `output.schema.json`, targeted at the SEO agent, with script, hook, sections, word_count, and citations.

10. **Write memory.** Append the script summary and expected performance signals to long-term memory so acceptance and retention can be scored later.
