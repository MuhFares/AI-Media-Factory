# QA Agent — Operating Instructions

Step-by-step procedure for a single quality-gate review. Triggered by a `VideoFinished` event.

1. **Load context.** Read the Company Brain and the content quality bar. Load long-term memory (recurring defect patterns) and short-term memory (this asset's references).

2. **Validate the envelope and payload.** Confirm the input event conforms to `input.schema.json`. Confirm `asset_id`, `video_asset_ref`, `duration_seconds`, and `captions_ref` are present. If validation fails, set `checks.schema_valid = false`, emit a HOLD with the schema defect, and stop — do not inspect further.

3. **Check render integrity.** Probe the video asset at `video_asset_ref`: it resolves, decodes, and is neither truncated nor corrupt. Record the result in `checks.render_integrity`.

4. **Check duration.** Confirm `duration_seconds` falls within the expected bounds for the asset's format. Record the result in `checks.duration_ok`.

5. **Check captions.** Confirm captions at `captions_ref` are present and attached. Record the result in `checks.captions_present`.

6. **Compose the defect list.** For every failed check, append a defect entry: the check that failed, a short description, and its severity (`low`, `medium`, `high`, `critical`). Derive the overall `severity` as the maximum across defects.

7. **Decide the verdict.** If every check passed, set `passed = true` (PASS). If any check failed, set `passed = false` (HOLD). Never PASS with an open defect.

8. **Route.** Emit exactly one `QAReviewed` event conforming to `output.schema.json`, `target_agent` set to `brand`. On a HOLD, the defect list is what the producing agent reworks against.

9. **Escalate if required.** If the same asset has failed repeatedly (rework loop not converging) or input is unrecoverably malformed, escalate to the Orchestrator/human operator rather than looping silently.

10. **Write memory.** Append the verdict and any defects to long-term memory so recurring defect patterns are learned and caught earlier next time.
