# Morroway Brand Assets V1 — Owner-Approved Asset System

**Brand:** Morroway | **Status:** OWNER_APPROVED (visual direction + supplied files, `OWNER_DIRECT_VISUAL_DECISION`)
**Governance artifact:** `art-brand-morroway-assets-v1-392be50a-a7b2-4a86-9abd-73593f8d2da2` (`morroway_approved_brand_assets`, completed)
**Manifest:** `artifacts/brand/morroway/v1/brand-assets-manifest.json` (also `manifests/` copy)
**Source of truth:** `artifacts/Brand identity/` (owner files untouched; SHA-256 recorded)

## Asset hierarchy

| Role | Source file | Canonical copy | Dims | Alpha |
|---|---|---|---|---|
| PRIMARY_LOGO | Logo.png (359KB) | master/morroway-logo-primary.png | 1235×563 | yes |
| SECONDARY_ICON_1 | Icon1.png (96KB) | master/morroway-icon-01.png | 643×370 | yes |
| SECONDARY_ICON_2 | icon2.png (46KB) | master/morroway-icon-02.png | 248×343 | yes |
| KEY_VISUAL_1 | brand visual 1.png (1.37MB) | key-visuals/morroway-key-visual-01.png | 1541×696 | yes |
| KEY_VISUAL_2 | brand visual 2.png (652KB) | key-visuals/morroway-key-visual-02.png | 941×687 | yes |

All PNG truecolor+alpha. Icons are non-square (01: 643×370, 02: 248×343) — derivatives use aspect-preserving scale + transparent padding (never distorted).

## Primary logo use

Main website/header identity, social channel banners, presentations, end cards, partnership/business-facing consumer materials. Lockup includes threshold-arc mark + "morroway" wordmark + "A WORLD BEYOND TOMORROW" line — that line is baked-in lockup content, NOT an approved standalone tagline (tagline approval remains PENDING per governance).

## Icon use

Social avatar, watermark, favicon/app-like compact contexts, profile alternatives, motion-logo compact use. Icon-01 (app-icon style, rounded-square composition) for avatar/profile surfaces; icon-02 (thin line-art) for watermark/mono/small contexts. Derivatives: `social/morroway-icon-0{1,2}-{512,256,128}.png`.

## Key visual use

Hero sections, YouTube banners, launch creatives, campaign backgrounds, social covers, storytelling surfaces. Never as logos. Visual 1 (threshold vista + wordmark lockup) suits banners/heroes; visual 2 ("Stories Beyond Tomorrow" typographic) suits covers/editorial surfaces. Its text is lockup content, not approved messaging.

## Dark / light guidance

System is dark-first (Abyssal). All masters carry alpha — place on dark cinematic backgrounds. No light-mode masters exist; light use requires future owner-approved adaptation (do not invert/flatten ad hoc).

## Spacing principles

Preserve proportions and clear space around the mark (≥ height of the arc slit on all sides as working rule); never stretch, rotate, recolor, add glow/effects, add play buttons, or append unapproved taglines ("AI VIDEOS • ENDLESS POSSIBILITIES" explicitly forbidden). Icons only in compact contexts.

## Small-scale guidance

icon2 line-art holds to small sizes; icon-01 app-icon composition holds as avatar; primary logo lockup (1235×563 incl. tagline line) is NOT for sub-200px use — use icons instead. 128px derivatives provided for preview; judge 32px favicon use in situ before production.

## Forbidden modifications

Stretch, rotate, random recolor, play buttons, unapproved taglines, key-visual-as-logo, icon distortion, extra glow/effects, prominent AMF corporate identity mixed into Morroway hero assets.

## AMF endorsement separation

Morroway hero assets carry no AMF marks. AMF appears only LIGHT: About/footer/legal/B2B/copyright (`© AI Media Factory`), per Brand Architecture V1.

## File locations

Masters: `artifacts/brand/morroway/v1/master/` + `key-visuals/`. Derivatives: `social/`, `previews/`. Manifests: `manifests/` + root copy. Originals: `artifacts/Brand identity/` (untouched).

## Technical limitations

Raster PNG only (no vector/SVG masters — future trace needs justification + QC). Tagline-in-lockup ≠ approved tagline. No light-mode masters. Icon sources non-square (padding, not crops, used for square derivatives).
## Master Asset Cleanup V1 (PARTIAL)
Clean masters: master/raster/morroway-logo-primary-clean.png (tagline delogo verified clean), morroway-wordmark.png + morroway-symbol-primary.png (deterministic crops verified). Key visuals: CLEANUP_REQUIRES_MANUAL_EDIT (v1 detailed scenery infeasible; v2 delogo attempt left ghost strokes, discarded). Legacy tagline lockups copied to legacy/ as REFERENCE_OR_LEGACY_LOCKUP. Vector: NONE, MANUAL redraw required (spec in vector-pending/). Cleanup record art-brand-morroway-cleanup-v1-9f647751.
## Vector Redraw Preparation (PREPARED, not performed)
Spec docs/morroway-vector-redraw-v1.md: 5 SVGs required under master/vector/; symbol ready (flat paths, glow as separate layer); wordmark WAIT_FOR_TYPOGRAPHY (TYPEFACE_SOURCE_UNKNOWN=YES, interim outlines only); icon-02 small-size optical variant may be required; mono 100% black/white mandatory; no auto-trace accepted.
## Palette and Typography Approval (OWNER_APPROVED)
Palette + typography + Arabic + wordmark approach OWNER_APPROVED per OWNER_DIRECT_DECISION (artifact art-brand-morroway-palette-approval-b5db9a15). Tagline NOT_APPROVED. Vector masters still MANUAL_REQUIRED.

## Vector supersession and lineage (2026-09-11)

`VECTOR_MASTER_STATUS = PRODUCTION_READY`. The validated source-of-truth for the primary logo, wordmark, symbol, Icon 01, and Icon 02 is now `master/vector/`. Lineage: `OWNER_APPROVED_RASTER → CONTROLLED_LOCAL_VECTOR_RECONSTRUCTION → VALIDATED_VECTOR_MASTER`. Earlier raster masters remain preserved as `OWNER_APPROVED_REFERENCE / LEGACY_RASTER_MASTER`; no owner visual direction changed and no original file was mutated. Validation and supersession record: `manifests/morroway-vector-supersession-and-channel-kit-reconciliation-v1.json`.
