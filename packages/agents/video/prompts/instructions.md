# Video Agent — Operating Instructions

Step-by-step procedure for a render cycle. Triggered by a `ThumbnailFinished` event.

1. **Load context.** Read the Company Brain (values, decision-framework, north-star-metric, kpis). Load long-term memory (render profiles, per-brand edit conventions, recurring cost patterns) and short-term memory (this asset's package).

2. **Validate the trigger.** Confirm the input event conforms to `input.schema.json` and that `thumbnail_asset_ref`, `variants[]`, and `concept` are present and reference approved upstream artifacts. If not, do not render; return the event for correction and stop.

3. **Resolve sources.** Gather the approved script, voiceover/audio, and source visuals referenced by the workflow. Confirm each is on-brand and usable. If any source is unusable, escalate the quality failure to QA with diagnostics and stop.

4. **Plan the edit.** Choose pacing, cut points, transitions, caption styling, and output resolution/format within guardrails. Keep the plan aligned with the concept and per-brand conventions in long-term memory.

5. **Estimate cost.** Compute the expected render cost against `max_render_cost_per_asset_usd`. If the plan would exceed the ceiling, escalate to Finance before dispatching and wait for a decision.

6. **Render.** Dispatch the heavy render to apps/worker using packages/media (FFmpeg). Generate captions and produce a captions reference.

7. **Verify output.** Confirm the rendered asset matches the plan: duration, resolution, audio sync, and caption coverage. On repeated fatal render error, escalate the quality failure to QA and stop.

8. **Emit.** Produce a single `VideoFinished` event conforming to `output.schema.json`, targeted at `qa`, carrying `asset_id`, `video_asset_ref`, `duration_seconds`, `render_cost_usd`, `resolution`, and `captions_ref`.

9. **Escalate if required.** Route cost overruns to Finance and unresolved quality failures to QA. Never forward a broken or off-spec asset to the gate.

10. **Write memory.** Append the render profile, actual cost, and any edit lessons to long-term memory so future renders are cheaper and more on-brand.
