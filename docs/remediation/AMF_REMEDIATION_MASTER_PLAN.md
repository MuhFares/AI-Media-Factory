# AMF Remediation Master Plan

Version: `AMF_REMEDIATION_MASTER_REGISTRY_BOOTSTRAP_V1` (2026-09-27)
Status companion: `AMF_REMEDIATION_STATUS.md`

## 1. Why remediation exists

AMF has proven substantial functionality — Research V2 pipeline, strategy
layer, control platform, benchmark-derived Balanced routing, one private
validation publication, analytics transport — but full canonical end-to-end
production has NOT yet been certified. Evidence is fragmented across
provider-free proofs, bounded live runs, and one-off recovery/fix paths.

Known structural problems (preserved in `AMF_KNOWN_RISKS.md`):

- Contract drift: Hooks stage has no canonical agent/runtime decision;
  Visual Director emits `visual_direction_plan` in one authority and
  `visual_direction_contract` in another; CEO artifact/output model
  (`ceo_report` vs `ceo_recommendation` vs Strategy Council V2 outputs)
  is unresolved; `KIND_BY_AGENT` / `KIND_BY_STEP` / execution modes /
  production vs governed provider registries are derived in multiple places.
- Routing fragmentation: Morroway Balanced routing is active, but legacy
  ControlPlane/environment routes, ambient model literals, and special-mode
  paths still exist; preflight (model existence, provider availability,
  protocol/endpoint compatibility, context-fit, structured-output support,
  retrieval constraints, publish token liveness, analytics route validity)
  is incomplete, so invalid requests can consume budget/transport.
- Recovery sprawl: each execution mode grew its own recovery path (normal,
  revision, review resume, media resume, targeted verification, targeted
  reevaluation, visual iteration, orphan). No generic framework with
  authorization, eligibility, preflight, fingerprint, rewind horizon, frozen
  lineage, enqueue, settle, and idempotency.
- Media/publication/analytics chain not closed on one real item through
  learning; legacy media chains (`tts-agent`, `timeline-executor`, legacy
  thumbnail/video kinds) still referenced.
- Owner cannot yet operate AMF normally without engineering agents, direct
  DB access, or one-off scripts.

Continuing `Live → error → patch → live` would keep burning provider budget,
mutating live state to diagnose, and adding mode-specific fixes. It is
therefore retired.

## 2. New operating model

```text
Audit → Program → Provider-Free Certification → Bounded Live Canary
  → Close Program → Next Program
```

- **Audit**: read-only finding with evidence; historical audits are immutable.
- **Program**: bounded scope (`SCOPE_IN` / `SCOPE_OUT`), owner, entry/exit
  criteria, hygiene linkage. Scope expansion requires explicit decision.
- **Provider-Free Certification**: exit scenarios (see `AMF_E2E_CERTIFICATION_MATRIX.md`)
  pass with zero provider calls, zero DB shortcuts, real worker/DB where
  declared. Implementation alone never closes a program.
- **Bounded Live Canary**: only after provider-free pass, under explicit
  Owner authorization (budget, spend, credential binding, publication
  authority). Fail-closed; terminal failures need re-authorization.
- **Close Program**: record evidence, update STATUS, risks, hygiene, E2E matrix.
- **Next Program**: strict sequence; do not start downstream live execution
  before upstream provider-free gates pass.

Normal operation must eventually NOT depend on coding agents. Every program
moves toward the owner-operated AMF Control Platform.

## 3. The five programs and dependencies

### Program 1 — Foundation Contracts (`programs/01-foundation-contracts.md`)

Eliminate contract drift and stage-definition ambiguity before further live
downstream execution. Decisions: Hooks stage (canonical agent/runtime OR
explicit removal/migration); Visual Director runtime + artifact contract;
canonical CEO artifact/output model; `AgentArtifactKind` schema authority;
single stage catalog; reconcile `KIND_BY_AGENT` / `KIND_BY_STEP` /
execution modes / registries; producer→consumer validators; gate
unsupported directives; legacy vs current media kinds.
Provider-free exit: **E2E-01, E2E-04**.
Depends on: Research Pilot close (pilot evidence is input, not a gate to
rewrite history). Blocks: all downstream live execution.

### Program 2 — Routing + Preflight (`programs/02-routing-preflight.md`)

One authoritative model/provider routing system; fail invalid provider
requests before transport/budget consumption. DB production routing
authoritative for branded projects; remove Morroway-only enforcement;
remove/demote ambient literals; special modes through canonical resolver;
Strategy Council specialists canonically routed; route provenance persisted;
benchmark/worker route parity. Full preflight matrix (LLM existence,
provider availability, protocol/endpoint, context-fit, structured-output,
retrieval constraints, publish token liveness, analytics route validity).
Note: Targeted Verification reevaluation routing fix is ONE completed task,
not Program 2 completion.
Provider-free exit: **E2E-11, E2E-16** + reevaluation recovery routing
regression tests.

### Program 3 — Recovery + State + Lineage (`programs/03-recovery-state-lineage.md`)

One generic recovery/redispatch framework (mode plugins, authorization,
eligibility, preflight, fingerprint, rewind horizon, frozen lineage,
enqueue, settle, idempotency) unifying normal recovery, revision, review
resume, media resume, targeted verification, targeted reevaluation recovery,
visual iteration, orphan recovery. State invariants (PAUSED→owner
actionability, authorization-with-no-job detection, split-brain detection,
reconciliation sweeper, singleton worker). Lineage (ID ownership,
runtime- vs model- vs provider-generated IDs, lineage graph, revision
semantics, hash/reload validation, analytics join identity).
Provider-free exit: **E2E-03, E2E-06, E2E-07, E2E-12, E2E-18**.

### Program 4 — Media + Publication + Analytics (`programs/04-media-publication-analytics.md`)

Safely produce one real Morroway media item through publication and
learning. Media (signed reference assets, continuity, TTS reauth, fingerprint
changes, narration-fit, caption verification, Wan reconciliation, budget/claim
safety, canonical media chain only for new production). Legacy migration
(tests off legacy thumbnail/video chain; legacy outputs read-only; migrate
`tts-agent` / `timeline-executor` E2E deps before removal). Publication
(token preflight, private/public separation, binding, session
recovery/reconcile, duplicate protection, promotion rules). Analytics
(`final_media_artifact → published_report → performance observation →
learning`, join-key invariants, fixtures excluded from live metrics, durable
visible learning).
Provider-free exit: **E2E-05, E2E-06, E2E-08, E2E-09, E2E-10**.
Live exit: one bounded real Owner-approved item → produced → private/safe
publication → analytics captured → learning recorded. No public autonomous
publishing required.

### Program 5 — Owner Autonomy (`programs/05-owner-autonomy.md`)

Owner operates AMF through AMF Control without engineering agents or direct
DB/scripts during normal operation: onboarding, credential binding, routing
activation, budgets, escalation, repair/reconcile/reauth actions, media
resume, publish sessions, health, monitoring/alerts, scheduler, analytics,
learning, next-cycle proposal→directive flow, multi-project isolation,
Decision Center as sole attention queue, canonical Owner UI decision
(Python facade vs `apps/web`).
Provider-free exit: multi-project + owner-operation certification scenarios.
Live exit: Owner completes a normal content lifecycle with no direct DB,
coding agent, one-off script, or manual backend repair.

Dependency chain: **P1 → P2 → P3 → P4 → P5**. P2 needs P1 contracts;
P3 needs P1+P2 (recovery over stable contracts/routes); P4 needs P1–P3
(media over stable recovery/state); P5 needs P1–P4 (autonomy over a
certified factory). Hygiene actions attach to their owner program and follow
`NO LEGACY DELETE BEFORE REPLACEMENT CERTIFIED`.

## 4. Critical path

```text
Close Research Pilot
  → Program 1 Foundation
  → Program 2 Routing / Preflight
  → Program 3 Recovery / State / Lineage
  → Program 4 Media / Publication / Analytics
  → First real closed-loop Morroway content
  → Program 5 Owner Autonomy
```

Research Pilot close is tracked separately in STATUS and is NOT a
remediation program: worker refresh, exactly one additional text capacity
authorization, reevaluation-only recovery reusing existing evidence (no new
retrievals), artifact revision, Owner final Research decision.

## 5. What success looks like

- Provider-free E2E paths certified per program (matrix evidence, zero
  provider calls where declared).
- Bounded live canaries only after certification, under explicit authority.
- One real closed-loop Morroway item (produce → private/safe publish →
  analytics → learning) before Program 5.
- Owner operates normal lifecycle without engineering intervention.
- Hygiene registry drained in program order; no legacy deleted before its
  replacement is certified; audits/proofs untouched.
