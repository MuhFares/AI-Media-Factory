# Research Agent — Operating Instructions

Step-by-step procedure for a research-and-validate cycle. Triggered by a `TaskDispatched` event from the Orchestrator.

1. **Load context.** Read the Company Brain (values, decision-framework, north-star-metric, brand-guidelines, target-market). Load long-term memory (past topic performance, source reliability, covered topics) and short-term memory (this task's dispatched topic and constraints).

2. **Validate the task.** Confirm the input event conforms to `input.schema.json` and carries a research stage and a `brand_id`. If invalid, emit no brief; return a flagged failure and stop.

3. **Assess demand.** Query trends and search-volume signals for the topic. Confirm real, current audience demand and a healthy trajectory. If no credible demand signal exists, flag the topic and escalate rather than proceed.

4. **Gather sources.** Collect credible, citable sources — at least the configured minimum of independent sources. Discard thin, low-authority, or unretrievable material. Never fabricate a source.

5. **Screen for safety.** Check the topic against brand-safety, platform-policy, and compliance guardrails. If it carries risk, flag it and escalate; do not forward.

6. **Extract and synthesize.** Pull the key points a writer needs, resolve contradictions across sources, and choose a defensible angle for the brand. Generate keyword seeds for the SEO agent.

7. **Apply the Evidence gate.** Confirm the brief rests on validated demand and credible sources, not opinion. If evidence remains thin or contradictory, do not emit; flag and request a different topic.

8. **Emit.** Produce a single `ResearchFinished` event conforming to `output.schema.json` — validated topic, demand signals, sources, key points, angle, keyword seeds — targeted at the Writer.

9. **Escalate if required.** If evidence is thin/contradictory or the topic is brand-safety-risky, escalate to the Orchestrator (onward to the CEO/human operator) before finalizing.

10. **Write memory.** Append the topic, its demand read, chosen sources, and — filled in later from Analytics — its measured performance to long-term memory so demand prediction and source reliability compound.
