# Morroway Production Enablement V1

Date: 2026-09-24  
Result: **PASS**  
Scope: provider-free enablement of Morroway Short-form Pilot 1

## Product outcome

The normal Owner Content journey now connects a content item to the canonical
governed production workflow without workflow-ID copying, SQL, scripts, or the
Command Room. A complete production brief is collected in Content, the start
action is idempotent, and the linked workflow is visible from the content
workspace. New production runs stop at an initial Owner authority gate before
the first provider call.

The same Content workspace now presents production state, brief, script,
scene/media artifacts, technical and semantic visual review, Owner acceptance,
targeted revision, final approval, metadata, lineage, and private publication
preparation. Command Room remains available for diagnostics and recovery but is
not the normal path.

## Closed P0 blockers

1. **Content → production binding** — `Start production` creates one governed
   `produce` workflow under the stable key `content-production:<contentId>`,
   links it to the content item, and reuses it on repeated requests.
2. **Production brief** — topic, objective, platform, format, audience, content
   type, language, duration, project/brand, research requirement, character
   requirement, aspect ratio, and scene target are captured and validated.
3. **Final review and targeted revision** — the Owner can review canonical
   artifacts and request a lineage-preserving revision of SCRIPT, SCENE, IMAGE,
   VIDEO_CLIP, VOICE, CAPTIONS, FINAL_COMPOSITION, or METADATA.
4. **Morroway channel** — the canonical verified YouTube channel record exists
   once for `UCA5ECzcK_96akfUT5fQUT3A`. No credential was invented; the UI
   truthfully reports `BINDING_REQUIRED` until an opaque credential reference is
   configured.
5. **Owner publication action** — approved content can store editable canonical
   metadata and prepare an idempotent private YouTube publication request. The
   action creates a pending, scoped Owner authorization decision and never
   uploads.
6. **Visual quality gate** — every scene visual has separate technical QA,
   semantic visual QA, and Owner acceptance. Technical checks cover validity,
   9:16/aspect, resolution, prompt adherence, scene coverage, corruption, and
   deterministic brand/style fit. Semantic review remains human-required when
   no authorized multimodal model is available.
7. **Live-call budgets** — the pilot has hard operation-level limits totalling
   14 calls: research 1, text agents 5, images 3, videos 3, voice 1, private
   upload 1. Retries are 0 for Pilot 1. Only image unit cost is currently known;
   every other cost remains explicitly UNKNOWN.

## Routing and execution boundary

Pilot preflight resolves each required actor to provider, model, configuration
source, and availability before workflow creation. Both
`AGENT_ROUTER_DEFAULT_MODEL` and the historical `AGENTROUTER_DEFAULT_MODEL`
alias are recognized. Persisted agent/project configuration retains precedence.
Unresolved required routes or exhausted/missing hard budgets fail closed.

The initial `pilot-provider-authority-gate` is inserted before the production
definition's first executable step. Program implementation authority did not
approve that gate. This program therefore made zero provider calls while still
proving real workflow creation, linkage, idempotency, and pause behavior.

## Publication boundary

Publication preparation reconstructs a YouTube request with the canonical
channel, final artifact lineage, title (maximum 100 characters), description,
tags, stable idempotency key, and `privacyStatus=private`. Preparation is not
publication; content approval is not publication authority; provider
confirmation is not public visibility. Public and unlisted publication remain
outside this program.

## Explicitly deferred P1 capability

- Thumbnail lifecycle is scaffold-level and does not block Short-form Pilot 1.
- Strict recurring-human identity consistency remains unproven. Pilot 1 forbids
  identity-critical recurring people.
- Z-Image URL reference guidance remains supported; FLUX image transport is
  supported but its reference workflow is not claimed implemented.
- Generic secure reference transport/object storage is deferred.
- Long-form production is out of scope.
- Automated multimodal semantic QA is not claimed; Owner acceptance is required.

## Authority and isolation

`PRODUCTION_AUTHORITY = NOT_GRANTED`  
`GENERAL_PUBLICATION_AUTHORITY = NOT_GRANTED`  
`PUBLIC_STATUS = NOT_PUBLISHED`  
`MORROWAY_AUTOMATION = OFF / L0_MANUAL`

M4 remained independent. No M4 schedule, measurement, private publication, or
learning state changed, and `M4_CALLS_CONSUMED = 0`.

