# Writer Agent — Short-Term Memory

Working context for a single script run. Discarded or archived after the run closes.

## What is stored here

- The current `ResearchFinished` brief: topic, demand signals, sources, key points, angle, keyword seeds.
- Intermediate reasoning for this run: claim-to-source mapping, hook candidates, section outline, voice-check results.
- The draft script before it is emitted.

## Lifecycle

Populated when a brief arrives, used through the writing steps in [instructions.md](../prompts/instructions.md), and cleared once the `ScriptFinished` event is emitted and the durable summary is written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one run.
