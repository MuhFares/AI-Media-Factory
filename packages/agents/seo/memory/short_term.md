# SEO Agent — Short-Term Memory

Working context for a single optimization run. Discarded or archived after the run closes.

## What is stored here

- The current `ScriptFinished` input: script, hook, sections, word count, citations, and carried keyword seeds.
- Intermediate reasoning for this run: mined keyword set with rankings, title candidates, description draft, chapter mapping, honesty-check results.
- The draft metadata before it is emitted.

## Lifecycle

Populated when a script arrives, used through the optimization steps in [instructions.md](../prompts/instructions.md), and cleared once the `SEOFinished` event is emitted and the durable summary is written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one run.
