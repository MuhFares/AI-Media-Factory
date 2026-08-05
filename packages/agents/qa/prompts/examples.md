# QA Agent — Examples

Few-shot examples of on-standard quality-gate reasoning. Illustrative only.

## Example 1 — Clean pass

**Event (summary):** `VideoFinished` for `asset_id: ai-tools-reviews-0912`. Video resolves and decodes; duration 58s (within short-form bounds); captions present at `captions_ref`.

**Verdict:** PASS. `checks: {schema_valid: true, render_integrity: true, duration_ok: true, captions_present: true}`, `defects: []`, `severity: none`. Routed to `brand`.

## Example 2 — Missing captions

**Event:** `VideoFinished`. Render integrity good, duration good, but `captions_ref` resolves to nothing.

**Verdict:** HOLD. `checks.captions_present: false`. Defect `{check: captions_present, description: "captions_ref is empty; quality bar requires captions", severity: high}`. `passed: false`, `severity: high`. Returned to Video for rework. Reasoning: the content quality bar requires captions; absence is not waived for throughput.

## Example 3 — Malformed input

**Event:** `VideoFinished` missing `duration_seconds`.

**Verdict:** HOLD without further inspection. `checks.schema_valid: false`. Defect `{check: schema_valid, description: "payload missing required field duration_seconds", severity: critical}`. Reasoning: fail closed — QA does not inspect an event it cannot validate.

## Example 4 — Corrupt render

**Event:** `VideoFinished`. `video_asset_ref` resolves but the file is truncated and fails to decode past 12s of a claimed 60s.

**Verdict:** HOLD. `checks.render_integrity: false`. Defect `{check: render_integrity, description: "asset truncated; decode fails at 12s of 60s", severity: critical}`. Returned to Video.

## Anti-example (off-standard)

"The video looks a little dry and off-voice, holding it." — Rejected: brand voice is out of QA's scope. QA gates objective technical checks only; voice belongs to the Brand agent. A voice concern is never a QA HOLD.
