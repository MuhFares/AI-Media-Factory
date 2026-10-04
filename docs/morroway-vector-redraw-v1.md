# Morroway Manual Vector Redraw V1 — Preparation Spec

**Brand:** Morroway | **Status:** PREPARED (no redraw performed, no auto-trace)
**Sources:** `artifacts/brand/morroway/v1/master/raster/` (logo-primary-clean, wordmark, symbol) + `master/` icons
**Method:** manual controlled redraw only (Figma / Illustrator / Inkscape / Affinity — not chosen/installed here; no paid actions)

## 1. Vector deliverables required

`artifacts/brand/morroway/v1/master/vector/`:
- morroway-logo-primary.svg
- morroway-wordmark.svg
- morroway-symbol-primary.svg
- morroway-icon-01.svg
- morroway-icon-02.svg

Optional later: PDF, EPS (only if supported by the redraw tool without quality loss).

## 2. Geometry reconstruction (symbol + icons)

- Preserve approved silhouette, proportions, negative space exactly (arc blade + ember slit + gap; icon compositions as approved).
- Remove raster softness and anti-aliased edge artifacts; convert to clean geometric curves; minimize anchors; maintain intended asymmetry.
- WCAG-relevant: N/A. Effects policy: metallic gradient + ember glow are raster effects, NOT geometry — redraw paths flat; re-apply glow/gradient only as documented separate effect layers, never baked into master paths.
- Raster ambiguity: none material in silhouette; edge softness is the only ambiguity → resolved by geometric cleanup (no OWNER_VISUAL_DECISION_REQUIRED on geometry).
- No speculative redesign.

## 3. Wordmark reconstruction

- Current wordmark: rounded geometric sans, clean letterforms, off-white on black — approved directionally.
- TYPEFACE_SOURCE_UNKNOWN = YES: the exact family cannot be definitively identified from the raster, and no font may be falsely named. Reconstruct visible letterforms as vector outlines ONLY (fidelity tracing of drawn shapes, not a font claim).
- WORDMARK_REDRAW_READY = WAIT_FOR_TYPOGRAPHY: interim outline trace permitted as reference; final wordmark master waits for the typography-selection workstream. Preserve raster `morroway-wordmark.png` as reference until then.

## 4. Icons

- ICON_01_REDRAW_READY = YES (app-icon composition redraws directly; rounded-square container + mark as separate layers).
- ICON_02_REDRAW_READY = YES with caution: thin line-art strokes must be converted to outlined strokes (not hairlines) to survive scaling.
- SMALL_SIZE_OPTICAL_VARIANT_MAY_BE_REQUIRED = YES: icon-02 thin lines at 32/64px must be render-tested at 512/256/128/64/32; if strokes collapse, a separate stroke-weight-adjusted optical variant is allowed ONLY with owner approval.

## 5. Fidelity policy

Target VISUAL_FIDELITY = HIGH. Allowed: edge cleanup, anchor reduction, curve smoothing, optical alignment corrections. Forbidden: new symbol concept, different proportions, new letter style, new icon concept, new decorative effects.

## 6. Validation matrix (future redraw)

- Small-size test: 512/256/128/64/32px — silhouette integrity, line survival (icon-02!), negative space, recognizability.
- Monochrome test (MANDATORY): 100% black AND 100% white, no gradients/glow — all 5 assets must pass.
- Dark/light test: dark (Abyssal context) + light backgrounds; no final palette required.
- Per-asset QA: dimensions/viewBox, no embedded raster, paths only, no accidental clipping, no invalid masks, no unnecessary filters, no hidden layers with alternate concepts, no unapproved tagline, no baked-in background, no external font dependency unless documented (wordmark outlines carry no font dependency by construction).

## 7. Master export policy

Vector masters are source-of-truth under `master/vector/`; raster PNG/JPG become derivatives. No auto-traced file may be presented as final.

## 8. Key visuals manual edit (unchanged, parallel track)

KEY_VISUAL_1_MANUAL_EDIT = REQUIRED. KEY_VISUAL_2_MANUAL_EDIT = REQUIRED. No further automated delogo attempts.

## 9. Open decisions for owner/designer

- Confirm flat-vs-gradient treatment of symbol (recommended: flat master + optional glow effect layer).
- Confirm interim wordmark outline vs waiting for typography selection.
- Approve optical variant policy for icon-02 small sizes.

---
**Next:** OWNER_OR_DESIGNER_PERFORMS_MANUAL_VECTOR_REDRAW → then MORROWAY_FINAL_PALETTE_AND_TYPOGRAPHY_V1. No auto-trace, no font choice, no palette finalization in this phase.
## Execution Attempt Result
Environment lacks fonts, text-to-path, vector tools, potrace � genuine execution impossible without faking. All 5 targets MANUAL_REQUIRED. Owner/designer performs redraw in Figma/Illustrator/Inkscape/Affinity per this spec.

## Validated Vector Production Supersession (2026-09-11)

This preparation-only record is historical. The five specified SVG masters are now path-only, validated production masters: `VECTOR_MASTER_STATUS = PRODUCTION_READY`. The primary-logo descender clipping defect was corrected and re-rendered. The strengthened Icon 02 remains a separate small-size-only recommendation pending owner approval. See `docs/morroway-vector-supersession-reconciliation-v1.md`.
