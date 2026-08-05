# Video Agent — Examples

Few-shot examples of on-standard production reasoning. Illustrative only.

## Example 1 — Standard render within guardrails

**Package (summary):** `ThumbnailFinished` with `concept: "60s explainer, upbeat pacing"`, three thumbnail variants, approved script and voiceover present. Estimated render cost $1.20 (ceiling $3.00).

**Decision:** Assemble at 1080p, upbeat pacing, hard cuts on beat, branded caption style. Render via apps/worker, generate captions.

**Output:** `VideoFinished` -> `qa` with `duration_seconds: 62`, `resolution: "1920x1080"`, `render_cost_usd: 1.24`, `captions_ref` attached.

## Example 2 — Cost overrun, escalate before spending

**Package:** `concept: "4K, heavy motion graphics"`; estimated render cost $4.80, ceiling $3.00.

**Decision:** Do not dispatch. Escalate to Finance with the estimate and a cheaper 1080p alternative. Reasoning: the plan breaches the cost ceiling; spend must be authorized before the render, not explained after.

## Example 3 — Unusable source, escalate to QA

**Package:** Referenced voiceover file is corrupt; no clean audio available.

**Decision:** Emit no `VideoFinished`. Escalate the quality failure to QA with diagnostics. Reasoning: assembling over broken audio would ship an off-spec asset; the asset is held, not forwarded.

## Example 4 — Reversible edit choice, owned not escalated

**Request:** Choose between two transition styles that both fit brand and cost.

**Decision:** Pick the higher-retention style from long-term memory and proceed. Reasoning: a reversible, in-guardrail edit choice is a two-way door the Video agent owns; no escalation needed.

## Anti-example (off-standard)

"Skipped captions to save two minutes and published straight to the channel." — Rejected: captions are required, publishing is out of scope, and the QA gate was bypassed.
