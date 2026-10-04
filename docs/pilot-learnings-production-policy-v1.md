# AI-Media-Factory Pilot Learnings & Production Policy V1

Status: hardening closure verified locally; no provider calls, publishing, commit, or push in this remediation session.

Scope: generic controls derived from the orange-density pilot. The policy is intentionally topic-, language-, location-, and provider-neutral.

## Audit mapping

| Pilot issue / recovery | Root cause | Durable rule | Implementation location | Test / evidence |
|---|---|---|---|---|
| Research claims were at risk of becoming visual assumptions | Research, script, and visual planning were not a single evidence contract | Every scientific claim needs source IDs, verified evidence, and scientific review; unknown evidence cannot advance | `packages/tool-framework/src/production-policy.ts`, research agent contracts | `production-policy.test.js`; research wiring tests |
| Semantic scene split was too coarse; final narration ideas were merged into one long visual | Scene boundaries followed generation convenience rather than narration semantics | Split on semantic action/purpose; preserve exact narration coverage; one scene contract per visual intent | `timeline/timeline-planner.ts`, `timeline/visual-brief.ts` | timeline planner capability tests |
| Scene 002 first source had a tall/narrow glass unlike Scene 001 | Source suitability and continuity were reviewed too late | First-frame suitability and reference continuity are pre-generation gates; preserve apparatus, framing, waterline, and subject scale | `timeline/visual-brief.ts`, visual capability/routing, pre-Wan governance | visual brief, pre-Wan, routing tests |
| Generated visual contained wrong subject/crop/extra objects | Prompt lacked required/forbidden subject and framing contract | Every image brief carries required subjects, states, relations, negative constraints, text-free rule, and output geometry | `image-generation/visual-direction.ts`, `timeline/visual-brief.ts` | visual brief and image capability tests |
| Regeneration risked overwriting accepted history | Versioning and lineage were implicit | Never overwrite rejected/superseded artifacts; create versioned artifact, SHA-256, parent lineage, provenance, and binding update | database artifact persistence; `media-chain/contracts.ts` | media-chain contract tests; live-validation durability tests |
| Automated semantic review was unavailable but could be mistaken for PASS | Structural QA was conflated with multimodal review | Structural checks may PASS; semantic/motion/continuity must be `HUMAN_REVIEW_REQUIRED` unless a capable reviewer is actually present | `timeline/pre-wan-governance.ts`, reviewer/QA agents | pre-Wan governance tests |
| TTS long-form generation was fragile and partial reruns duplicated work | One large request, weak chunk identity, and no durable chunk state | Deterministic sentence-aware chunks, text fingerprints, per-chunk execution/artifact persistence, validation, resumable assembly | `tts/chunking.ts`, `tts/chunk-execution-coordinator.ts` | long-form chunking and PostgreSQL coordinator tests |
| Timeline durations were estimated without measured narration | Visual duration was planned before audio truth existed | Measure narration, preserve exact duration, split scenes to clip limits, and fail on coverage mismatch | `timeline/timeline-planner.ts`, timeline executor | timeline plan/execution tests |
| Wan request duration/camera/motion did not always match scientific intent | Motion contract was underspecified and camera drift/crop was tolerated | Explicit physical action, locked camera, visible reference landmarks, forbidden morph/split/float behavior; human gate for semantic motion | `video-generation`, `pre-wan-governance`, Wan adapter boundary | Wan boundary tests; human visual gate evidence |
| RunPod acknowledgement timeout made submission ambiguous | POST timeout was treated like a safe retry | Persist intent before POST, persist job ID immediately, reconcile the same job, never auto-retry ambiguous POST | `provider-adapters/src/adapters/runpod-video.ts`, execution provenance | `wan-boundary.test.ts` |
| Duplicate paid calls were possible during recovery | No stable logical request identity / retry separation | Idempotency key is derived from workflow, scene, source SHA, prompt/config; polls may retry, submissions may not | capability identity + provider execution provenance | adapter and crash-restart tests |
| Selective regeneration was not first-class | Failure recovery operated at whole-pipeline level | Regenerate only the failed scene/unit; retain passing units and canonical clip set; record why and what stayed locked | live validation and media-chain modules | production media-chain tests |
| Composer `shortest` cut the narration | `shortest` was the default and output duration was not a speech-preservation invariant | Default to narration-preserving `pad`; `shortest` is legacy/explicit only; assert narration fit before compose and verify after | `media-compose-capability.ts`, `narration-fit.ts` | narration hardening tests; default policy change |
| Captions existed as safe-area SRT but were absent from the social MP4 | Sidecar timing QA was mistaken for pixel delivery | Social final requires burned-in captions; sidecar SRT is retained as supplementary evidence | media compose editing plan + final delivery policy | production policy tests; V4 burned-caption evidence |
| Final technical QA could pass while product semantics remained uncertain | Technical, product, and human gates were collapsed | Separate technical QA, product review, semantic review, and human approval; publish remains blocked until final approval | workflow engine gates, production policy | human-gate approval-pause tests |
| Provider/model/cost attribution was incomplete (`UNKNOWN`) | Unknown metadata was silently normalized or treated as zero | Preserve provider/model as unknown when unknown; cost kind `UNKNOWN` means cost `null`; never infer zero cost | execution provenance, cost accounting, production policy | typed provider error and visual cost tests |
| Restart/reload could lose stage or artifact context | Runtime state lived in memory or was saved too late | Persist workflow state, intent, job IDs, artifacts, gate decisions, and versioned bindings before/after side effects; verify fresh reload | workflow engine persistence/recovery + database stores | crash/restart and live-validation durability tests |
| Provider selection was based on preference rather than evidenced capability | Routing ignored task requirements and evidence confidence | Route by hard capability requirements, approved evidence, rights, and human fallback; no eligible route means fail closed | `visual-production-routing.ts`, provider router | visual routing tests |

## Non-negotiable defaults

1. No publishing without an approved final human gate.
2. No provider retry after an ambiguous side-effecting submission.
3. No semantic PASS without a genuinely capable reviewer.
4. No final social deliverable with sidecar-only captions.
5. No narration truncation to fit a video; pad, bounded tempo, or fail.
6. No overwrite of historical artifacts.
7. Unknown cost and provenance remain explicitly unknown.
8. Recovery is idempotent and selective.
9. All external calls have durable provenance and a logical identity.
10. A zero-provider validation mode must be available for policy/regression tests.

## Closure matrix

| Known pilot class | Closure disposition | Proof |
|---|---|---|
| Evidence/source gaps | DETECTED_FAIL_CLOSED | `assertResearchEvidence` |
| Semantic over-merging | PREVENTED | deterministic timeline planner + coverage tests |
| Bad source framing/continuity | HUMAN_GATED | visual brief and pre-Wan approval |
| Prompt subject/crop drift | PREVENTED / HUMAN_GATED | required/forbidden visual contracts |
| False semantic automation | DETECTED_FAIL_CLOSED | pre-Wan governance |
| TTS truncation/partial rerun | PREVENTED | chunk coordinator + narration fit |
| Measured timeline mismatch | DETECTED_FAIL_CLOSED | timeline executor and coverage checks |
| Wan motion/camera scientific mismatch | HUMAN_GATED | motion/framing review required |
| Ambiguous RunPod submission | DETECTED_FAIL_CLOSED | reconciliation-required boundary |
| Duplicate paid calls | PREVENTED | logical identity + no POST retry |
| Selective regeneration/history loss | PREVENTED | versioned artifacts and lineage contracts |
| Composer `shortest` regression | PREVENTED | default `pad` + narration-fit guard |
| Sidecar-only captions | DETECTED_FAIL_CLOSED | final delivery contract requires `BURNED_IN` |
| Technical/product/human gate collapse | HUMAN_GATED | separate final gate states |
| Unknown attribution/cost | DETECTED_FAIL_CLOSED | provider accounting contract |
| Restart/reload loss | PREVENTED | durable persistence/recovery tests |
| Provider capability mismatch | DETECTED_FAIL_CLOSED | evidence-based route selection |

## Remaining gaps / backlog

- P2: Add a real multimodal reviewer adapter with explicit model/version provenance; until then semantic, motion, continuity, and product claims stay human-gated.
- P2: Add a canonical provider submission ledger with a unique constraint on logical idempotency key across processes.
- P2: Add automated pixel-level detection of burned captions and a visual continuity metric; retain human approval as authoritative.
- P2: Add provider capability expiry/refresh and rights-evidence expiry checks.

Historical V3/V4 media, superseded visuals, and pilot reports remain untouched.

## PRODUCTION POLICY ENFORCEMENT MODEL

The workflow engine now owns one governed transition boundary. For every
definition-backed step, the engine evaluates `ProductionPolicyV1` before the
step executor is called. `DENY` fails the workflow closed. `HUMAN_GATE_REQUIRED`
never falls through to execution: gate steps enter `AWAITING_APPROVAL`, while
non-gate transitions fail closed.

Each decision is persisted as a versioned `production_policy` decision through
the existing PersistencePort and PostgreSQL `decisions` table. The record contains policy/version,
rule, decision, reason, workflow/correlation identity, source/target stages,
required evidence, artifact lineage, and evaluation time. On reconstruction,
only an exact matching decision is reusable; a missing or mismatched record is
not a PASS. PostgreSQL artifact identity provides durable deduplication, while
the workflow checkpoint preserves the paused/failed frontier.

Resume, crash recovery, and direct production executor paths remain subject to
the same artifact and media-chain guards. Multimodal-unavailable review remains
`HUMAN_REVIEW_REQUIRED`; it is never rewritten as semantic PASS. Provider
submission reconciliation and cost/provenance rules remain unchanged.

Runtime enforcement status: PASS. The canonical engine boundary evaluates and
persists a policy decision before every definition-backed production step;
stage evidence fingerprints include artifact/hash/lineage identity, and
resume preserves durable gate state while rejecting a missing historical
decision with `MISSING_POLICY_DECISION`. Direct recovery/bootstrap writes are
fact restoration only; governed advancement is performed by the engine
boundary. No provider, paid, or publishing call was made in this session.

## Baseline cleanup status

- `TTS_FIXTURE_ISSUE = FIXED`: the stale `file:///fixture.wav` mock was replaced
  with a valid local WAV data URL and the assertion now uses the measured
  12,640ms duration.
- `PROMPT_BINDING_FIXTURE = FIXED`: domain-specific orange matching was removed
  from the generic gate; declared constraints remain strictly validated,
  including contradiction detection, and unrelated workflows are accepted.
- `HUMAN_GATE_TIMEOUT = FIXED`: approval waits preserve `AWAITING_APPROVAL`
  and the running gate across reload; the worker regression is deterministic.
- `POSTGRES_BASELINE_ISSUE = ENVIRONMENT_ONLY`: the available local run has no
  configured PostgreSQL service; in-memory zero-call durability tests remain
  usable, but PostgreSQL-specific tests were not relabeled as product passes.

## Closure declaration

`PILOT_LEARNINGS_HARDENING = CLOSED`

`REMAINING_P1_BLOCKERS = 0`

Mandatory runtime, evidence, scientific claim, durability, restart, alternate
path, paid-safety, narration, captions, visual governance, human-gate, and
worker regression criteria are PASS. `HUMAN_REVIEW_REQUIRED` remains an
explicit human gate where multimodal automation is unavailable; it is not an
automated semantic PASS. `NEXT_RECOMMENDED_MILESTONE = PUBLISHING_ENGINE_LIVE_VALIDATION`.
