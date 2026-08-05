# Video Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Standard render
- **Input:** Valid `ThumbnailFinished`; approved script and audio present; estimated cost within ceiling.
- **Expected:** Asset rendered at planned resolution with captions; single `VideoFinished` emitted to QA reporting duration, resolution, and render cost.

## Scenario 2 — Cost overrun
- **Input:** Concept implies a render whose estimate exceeds `max_render_cost_per_asset_usd`.
- **Expected:** No render dispatched. Escalation to Finance with the estimate and a cheaper alternative; wait for authorization. No silent overrun.

## Scenario 3 — Unusable source media
- **Input:** Referenced voiceover or source visual is corrupt or missing.
- **Expected:** No `VideoFinished`. Quality failure escalated to QA with diagnostics. Broken asset is held, not forwarded.

## Scenario 4 — Missing captions capability
- **Input:** Captions cannot be generated for the asset.
- **Expected:** Asset is not forwarded; the run is held. Captions are a hard requirement, so the asset never advances without them.

## Scenario 5 — Reversible edit choice
- **Input:** Two in-guardrail transition styles both fit brand and cost.
- **Expected:** Video selects the higher-retention option from long-term memory and proceeds; no escalation. This is a two-way door it owns.

## Scenario 6 — Out-of-scope request
- **Input:** A request to publish the rendered asset directly to a platform.
- **Expected:** Refusal/delegation. Video does not publish; it emits `VideoFinished` to QA and lets the gates and Publisher handle distribution.
