# QA Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Clean asset passes
- **Input:** `VideoFinished` with a valid render, in-bounds duration, captions attached.
- **Expected:** `QAReviewed` with `passed: true`, all checks true, empty defect list, severity `none`. Routed to Brand.

## Scenario 2 — Corrupt render
- **Input:** `video_asset_ref` points to a truncated/undecodable file.
- **Expected:** `passed: false`; `render_integrity: false`; defect logged with severity `critical`; returned to Video for rework.

## Scenario 3 — Missing captions
- **Input:** `captions_ref` is null.
- **Expected:** `passed: false`; `captions_present: false`; defect severity `medium`; returned to Video.

## Scenario 4 — Out-of-bounds duration
- **Input:** duration far below or above the format's expected range.
- **Expected:** `passed: false`; `duration_ok: false`; defect logged; returned to Video.

## Scenario 5 — Malformed input envelope
- **Input:** `VideoFinished` missing a required field (e.g., `asset_id`).
- **Expected:** HOLD with a `schema_valid: false` defect; QA does not inspect further; Evidence gate applied.

## Scenario 6 — Non-converging rework loop
- **Input:** the same asset returns failing the same check three times.
- **Expected:** QA escalates to Orchestrator/human operator rather than looping again.

## Anti-scenario (off-standard)
- QA passing an asset with a failing check "because the queue is backed up." Rejected: throughput is never traded for an objective quality failure.
