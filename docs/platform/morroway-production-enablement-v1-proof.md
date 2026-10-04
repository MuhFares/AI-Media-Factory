# Morroway Production Enablement V1 — Proof

Date: 2026-09-24  
Verdict: **PASS**

## Provider-free E2E proof

`apps/api/test/morroway-production-enablement.test.js` executes the real API,
database, workflow submission, artifact persistence, and content-domain code on
the isolated TEST database:

Morroway → factual YouTube Short brief → idempotent production start → research
fixture → script fixture → three scene specs → three image artifacts → three
video clips → voice → final composition → final technical QA → targeted IMAGE
revision → replacement image → explicit visual acceptance → final approval →
metadata → private publication preparation → stop at publication authority.

Assertions prove 0 capability executions, 0 consumed call budget, no automation
policy enablement, `privacyStatus=private`, canonical channel selection,
credential-binding readiness, title-length enforcement, artifact lineage, and
idempotency.

## Actual served runtime proof

The canonical supervisor was stopped and restarted. The replacement supervisor
started Node API, persistent worker, and Python Owner UI with zero crash
restarts. `http://127.0.0.1:8000/` returned 200.

Live proof against the served platform:

- invalid Owner credential returned 401;
- configured Owner authentication established an HttpOnly session without
  exposing the secret, and sign-out returned to signed-out inspection mode;
- a new Content brief was created through the public facade;
- preflight resolved all 12 Pilot 1 actors and reported `ready: true` without
  calling them;
- `Start production` created workflow `wf-1790228899612-hyfzmb2k`, automatically
  linked it to content `content-muf41ju0-vuxvme`, and a repeated request returned
  the same workflow;
- the persistent worker stopped at `pilot-provider-authority-gate` with workflow
  state `AWAITING_APPROVAL`; every provider step remained pending;
- call budgets remained 0 used of 14;
- Morroway remained automation OFF / L0_MANUAL;
- channel `UCA5ECzcK_96akfUT5fQUT3A` was VERIFIED and truthfully showed
  `BINDING_REQUIRED` rather than an invented credential.

The in-app browser verified the actual rendered Owner application:

- Project Hub selected Morroway and rendered signed-out inspection state;
- Content rendered the complete brief, exact provider/model/config-source
  preflight, the linked workflow, budgets, production status, revision layers,
  visual QA separation, final review, editable metadata, and the private-only
  publication boundary;
- Automation rendered OFF/manual, no scheduled work, six budget classes, all
  projects, and honest empty history with no raw 404 body;
- Analytics, Decision Center, Project Settings, and Project Hub loaded without a
  `{"error":"not found"}` surface;
- the completed historical content workspace exposed artifacts, review,
  revision, metadata, canonical Morroway channel, and “Preparing never uploads.”

## Bundle proof

`node --check apps/api/src/ai_media_factory/static/app.js` passed through the
normal API suite. SHA-256 of the served `/static/app.js` and source file were
both:

`f11c40fe500bdf1a165190ccf3e569cd9cdc3460ff2a60716f53e0c85329a7f2`

## Regression results

- API/Owner UI/auth/automation/content/multi-project/analytics/Decision Center:
  **160/160 PASS**.
- Database/domain/governance/publication visibility/budgets: **222/222 PASS**.
- Python facade/auth/session/project routing: **23/23 PASS**.
- Workflow engine: **70/70 PASS**.
- Provider adapters: **234/234 PASS** using mocked transports only.
- Worker: all emitted cases passed after correcting a stale media fixture; the
  Node test runner retains an idle open handle after completion and required
  termination after two quiet intervals.
- Focused worker regressions for cold resume and the real media bridge: **3/3
  PASS**.
- Provider-free production enablement E2E: **1/1 PASS**.
- Owner UI content/bundle syntax focused path: **8/8 PASS**.

Harness debt resolved during this program:

- API configuration fixture now installs/restores an explicit test model rather
  than treating a deployment-defined empty string as absent.
- Worker media registration fixture now uses an in-memory data URL instead of a
  nonexistent `file:///undefined.mp4` path.

Open non-blocking repository debt, outside this bounded program:

- legacy Sprint 8 orchestrator integration fixtures: 75/141 pass; 66 fail from
  older cross-agent artifact-shape assumptions. The canonical production
  definition, new initial authority gate, workflow engine, current worker, and
  provider-free production E2E pass independently;
- tool-framework: 261/263 passed in the restricted sandbox; the two media
  process cases initially hit Windows `spawn EPERM`, then passed **14/14** in
  their focused file when the bundled FFmpeg/ffprobe binaries were permitted;
- root workspace build continues across workspaces but reports unrelated
  pre-existing TypeScript debt in `context-engine`, `evaluation-framework`,
  `prompt-compiler`, plus a tool-framework declaration-output configuration
  collision. All changed runtime packages build successfully;
- providers workspace's direct TypeScript smoke script imports nonexistent
  source `.js` paths; provider-adapters (the actual runtime boundary) is green.

None of this debt is on the new normal Owner production path, weakens an
authority boundary, or leaves a P0 blocker open.

## Side-effect ledger

REAL_PROVIDER_CALLS = 0  
YOUTUBE_CALLS = 0  
LIVE_ANALYTICS_CALLS = 0  
LLM_CALLS = 0  
IMAGE_GENERATIONS = 0  
VIDEO_GENERATIONS = 0  
VOICE_GENERATIONS = 0  
UPLOADS = 0  
PUBLICATION_SIDE_EFFECTS = 0  
M4_CALLS_CONSUMED = 0
