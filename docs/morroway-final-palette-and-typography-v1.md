# Morroway Final Palette and Typography V1 — Recommendation (RECOMMENDED_PENDING_OWNER_APPROVAL)

**Brand:** Morroway | **Status:** RECOMMENDED_PENDING_OWNER_APPROVAL (nothing below is final until owner approves)
**Basis:** measured samples from owner-supplied `artifacts/brand/morroway/v1/Logo.png` + verified font sources. No logo redesign, no tagline, no accounts/domains.

## 1. Recommended primary palette (5 core colors)

| # | Semantic name | HEX | RGB | Provenance | Primary use | Secondary use | Warning |
|---|---|---|---|---|---|---|---|
| 1 | Abyssal Base | #0B0F1A | 11,15,26 | Directional (approved Abyssal direction; measured artwork bg is pure #000000 — final choice between them pending owner) | Primary background, video canvas | Dark surfaces | Do not lighten toward navy-SaaS |
| 2 | Deep Surface | #1E2A3A | 30,42,58 | Directional exploratory | Cards, surfaces, banners on black | Subtle elevation | Do not use for body text |
| 3 | Morroway White | #EDEBE6 | 237,235,230 | MEASURED (wordmark average) | Wordmark, headlines, body, captions | Light text on dark | Do not use pure #FFFFFF harshness where warmth matters |
| 4 | Silver Neutral | #9E9E9E | 158,158,158 | Derived (luminance-matched desaturation of measured blade glow zone #C99867; PENDING owner lock from vector master) | Mark metallic rendering, dividers, secondary graphics | Muted text | Do not use for small body text (see contrast) |
| 5 | Threshold Amber | #C99867 | 198,152,103 | MEASURED (glow fringe average; peak core brighter — peak HEX pending production) | CTA/highlight, ember slit, motion light, single accent only | Sparingly: one highlight per view | Never neon/cyberpunk gradients, luxury-gold cliché, gaming orange |

**Accessibility (calculated via WCAG relative-luminance formula — estimates, NOT formal lab testing):** White on Abyssal 16.06:1 · Amber on Abyssal 7.37:1 · Silver on Abyssal 7.14:1 · White on black 17.63:1. All clear AA for normal text (≥4.5) by calculation.

**Roles:** Abyssal Base = PRIMARY BACKGROUND; Deep Surface = surfaces; Morroway White = PRIMARY FOREGROUND; Silver Neutral = controlled metallic neutrals; Threshold Amber = restrained accent (light through a threshold / discovery — connects to passage-into-another-world, NOT luxury-gold/crypto-neon).

## 2. Typography (verified sources only)

**Architecture (2 systems max):**
1. **BRAND / DISPLAY + HEADLINE (Latin): Outfit** — geometric sans, SIL OFL-1.1 verified (Google Fonts specimen + Outfitio/Outfit-Fonts repo). Wordmark via optical customization of Outfit foundation (approach A).
2. **BODY / UI / CAPTIONS (Latin): IBM Plex Sans** — SIL OFL-1.1 verified (github.com/ibm/plex), UI-designed; captions = semibold/white mobile-first setting of same family.
3. **ARABIC (all roles): IBM Plex Sans Arabic** — SIL OFL-1.1 verified (npm @ibm/plex-sans-arabic, IBM Corp), same design DNA as body; **approved alternate for display Arabic: Cairo** — SIL OFL-1.1 verified (Google Fonts, Mohamed Gaber, Titillium-based Latin + Kufi-based Arabic, wide glyph set Arabic/Farsi/Urdu) where contemporary Kufi character fits headlines.

- Poppins was NOT recommended (existence/licensing unverified — rate-limited check, excluded per policy).
- **FONT_LICENSE_STATUS:** Outfit OFL-1.1 VERIFIED · IBM Plex Sans/Sans Arabic OFL-1.1 VERIFIED · Cairo OFL-1.1 VERIFIED. Commercial use permitted under OFL (no sale of fonts standalone; include license). No font files distributed in this phase.
- **CAPTION_FONT:** IBM Plex Sans semibold, white/#EDEBE6 on Abyssal, mobile-first sizing (exact scale pending subtitle testing).
- **ARABIC_READINESS: PASS** — verified pairing + same-system rules (no letter-spacing of Arabic, optical weight matching, RTL mirroring, shared-symbol lockups); transliteration policy pending owner input.

**WORDMARK_CONSTRUCTION_RECOMMENDATION: FONT_PLUS_CUSTOMIZATION** (Outfit foundation + minor optical customization for the lowercase wordmark; preserves current approved look fastest). CUSTOM_VECTOR_FROM_TYPOGRAPHIC_BASE only if distinctiveness review demands it — do NOT redesign now.

## 3. Usage rules (concise)

- Logo on dark: full lockup (mark + wordmark) on Abyssal/black; logo on light: NOT YET DEFINED (no light masters exist — future adaptation, owner-approved).
- Accent: one Threshold Amber highlight per view max; never gradients/neon.
- Headlines: Outfit bold, tight tracking; Body: Plex Sans regular; Captions: Plex Sans semibold, high contrast, ≤2 lines safe-area.
- Thumbnails: Outfit heavy display + mark, mobile legibility first.
- Arabic/English mixed: Plex Arabic + Plex Latin same weight grade; never letterspace Arabic; RTL mirror layouts; shared symbol unchanged.
- Glow is environmental/cinematic effect, never logo geometry.
- Monochrome: system verified mono-capable (line-art icon + gray boards) — MONOCHROME_COMPATIBILITY PASS.

## 4. Validation vs approved assets

Palette roles hold against Logo (mark/wordmark/ember), Icon-01/02/03, key visuals (dark cinematic worlds). Monochrome support mandatory — PASS (conceptual verification: thin-line icon + grayscale boards carry identity without color).

---
**Owner decision required:** approve palette (or choose pure-black base), approve typography systems, confirm wordmark approach A, confirm transliteration policy. Next: OWNER_PALETTE_AND_TYPOGRAPHY_REVIEW.
## Owner Approval (APPROVED)
OWNER_DIRECT_DECISION: palette OWNER_APPROVED (Abyssal #0B0F1A, Cinematic Black #000000 permitted neutral, White #EDEBE6, Silver #9E9E9E, Deep #1E2A3A, Amber #C99867 restrained 5-10%), typography OWNER_APPROVED (Outfit display/headline, Plex Sans body/captions, Plex Sans Arabic primary, Cairo alternate), wordmark Outfit+custom-refinement OWNER_APPROVED, Arabic Latin-primary policy recorded, tagline NOT_APPROVED (excluded from masters). Approval artifact art-brand-morroway-palette-approval-b5db9a15.
## Vector Execution Result (MANUAL_REQUIRED)
Local execution NOT performed: no Outfit files, no text-to-path engine, no vector tool, no potrace in environment; hand-authored paths would invent geometry (forbidden). All 5 SVGs MANUAL_REQUIRED. WORDMARK_VECTOR_REQUIRES_MANUAL_DESIGN_TOOL = YES. Next: OWNER_COMPLETES_REMAINING_MANUAL_VECTOR_FILES.
