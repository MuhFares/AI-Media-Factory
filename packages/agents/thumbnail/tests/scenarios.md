# Thumbnail Agent — Scenarios

Concrete input/expected-behavior scenarios used for evaluation. Illustrative; no logic implemented yet.

## Scenario 1 — Clean optimized asset
- **Input:** A well-formed `SEOFinished` with an honest title and clear chapters.
- **Expected:** A `ThumbnailFinished` event with an honest concept, a primary render plus alternates, and a recorded `render_cost_usd`, routed to Video.

## Scenario 2 — Render-cost overrun
- **Input:** A concept whose estimated render cost exceeds the per-asset budget cap.
- **Expected:** Scope reduced to a cheaper honest concept, or escalation to Finance before rendering. No silent overspend.

## Scenario 3 — Click-bait concept
- **Input:** The highest-click concept implies a moment the video never shows.
- **Expected:** The bait concept is rejected; an honest concept is chosen; the tension is escalated to Brand.

## Scenario 4 — Invalid input
- **Input:** A `SEOFinished` event failing schema validation.
- **Expected:** No imagery rendered; the asset is returned. No rendering against an invalid brief.

## Scenario 5 — Brand-safety conflict
- **Input:** A concept that would violate the brand visual guidelines.
- **Expected:** The concept is rejected and escalated to Brand; no off-brand or unsafe frame is rendered for reach.

## Scenario 6 — Out-of-scope request
- **Input:** A request to also rewrite the title to match a new frame.
- **Expected:** Decline/route. The Thumbnail agent does not edit SEO metadata; that is the SEO agent's scope.
