# Cairo Visual Grounding V2

Status: local planning artifact only. No fresh search or media-provider call was made in the visual-direction hardening phase.

## Scope

This artifact separates visual grounding from textual topic research. It is intended to constrain contemporary Cairo street imagery without turning the city into a stereotype or tourism postcard.

## Reusable grounding cues

- Contemporary Cairo neighborhood: mid-rise concrete residential buildings, balconies, shaded shopfronts, mixed old-and-new facades.
- Street edge: dense narrow sidewalks, active storefronts, practical awnings, metal shutters, stools, tables, utility poles, and believable pedestrian flow.
- Everyday commerce: compact sidewalk shops, vendor tables, ordinary goods, and local market activity at street level.
- Materials and palette: plaster, dusty concrete, faded paint, wood, metal, warm daylight, and natural urban color.
- Mobility: bicycles and motorcycles only where the narration calls for them; no hero-car framing or invented readable branding.
- People: ordinary contemporary Egyptian residents and vendors in natural everyday clothing; no Gulf thobe or pan-Arab costume shorthand.
- Signage: ambient signs may exist as background shapes, but no generated letters, readable words, captions, subtitles, logos, or watermarks.
- Composition: one coherent documentary shot; no split frame, collage, contact sheet, grid, duplicated major subjects, or artificial panels.

## Evidence boundary

Existing textual research supports the topic direction but is not sufficient to claim a current 2026 visual survey. A later approved visual-research pass may add dated, source-linked references for current Cairo architecture, storefronts, transport mix, wardrobe, and lighting. Until then, the planner uses the conservative local grounding above and requires human review before Wan.

## Implementation

The structured contract is implemented in `packages/tool-framework/src/timeline/visual-brief.ts` and is attached to each Cairo-sensitive `TimelineScene`. The planner no longer creates a technology-creator character or generic workspace prompt for Cairo-sensitive scenes.
