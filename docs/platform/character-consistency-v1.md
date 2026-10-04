# Character Consistency V1 (contract)

Honest product wording: **reference-guided character consistency**.
Never claim guaranteed identity without verified technology + evidence.

Distinguish always: transport image input, image-to-image, reference
guidance, composition reference, style reference, pose/control, identity
conditioning, identity preservation. They are not synonyms; UNKNOWN and
UNPROVEN are valid states.

Correction note (2026-09-24): FLUX worker transport supports
`input.images[]`, but the wired AMF workflow consumes no input image, so
FLUX reference guidance stays NOT_IMPLEMENTED (a compatible workflow or
custom deployment is a future path, not built). Z-Image strict identity
is UNPROVEN (never FAILED); Z-Image stays eligible for realistic and
reference-guided scenes.

## Subject profile model

`subject_profiles` (project-scoped metadata): subject_id, name, type,
description, traits, wardrobe, negatives, style context, voice, status
(DRAFT → APPROVED with Owner rationale), supersession chain. Image bytes
are NEVER stored here.

## Reference asset model

`subject_reference_assets`: subject → canonical artifact ID + kind
(front_portrait, three_quarter, side_profile, full_body, expression,
wardrobe, style) + approval flag. References are never silently replaced;
re-attach is idempotent to the same canonical row.

## Scene binding

`scene_specs`: (content, scene) rows with sequence, purpose, visual,
subjects[] (subjectId + pose/expression/wardrobe), environment, shot,
camera, movement, continuity, reference IDs, provider-neutral intent,
audio ref, status. Scene-to-subject resolution is exact ID equality.

## Provider-neutral intent

Workflow expresses GENERATE_IMAGE with subject profile, reference assets,
scene, and consistency flags. Adapters translate. Capability routing
(`resolveConsistencyRoute` over canonical profiles) fails closed when:
identity is critical (no verified route), references are missing but
required, or counts exceed verified maxima.

## Provider capabilities (verified)

- FLUX: text-to-image only; no image input in AMF.
- Z-Image: single reference + strength; composition guidance only.
- Identity/style/pose conditioning: none verified.

## QA semantics

NOT_REQUIRED / UNVERIFIED / REFERENCE_LINKED / HUMAN_APPROVED, plus
AUTOMATED_CHECK_PASS/FAIL only with a real measured signal. Automated
identity similarity is not implemented — label accordingly.

## Fallback policy

Identity-required generation never silently downgrades to plain
text-to-image. Incompatible requests fail closed with Owner-readable
reasons.

## Long-form usage

Recurring subjects resolve to the same profile + reference set across
any scene count. Per-scene shot/environment/angle vary; identity rows
do not.

## Future real-provider proof plan

Reference: one approved character image. Generate close portrait, medium
shot, full body, side angle, new environment, new lighting per eligible
model. Compare identity/face/hair/wardrobe/style continuity plus prompt
adherence. NOT executed (no Owner authorization for paid calls).
