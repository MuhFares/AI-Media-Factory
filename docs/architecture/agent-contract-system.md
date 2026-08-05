# Agent Contract System

> Enterprise architecture specification for AI Media Factory (AMF). Documentation only — no application code. This contract is derived from the live agent schemas in [`packages/agents/`](../../packages/agents/README.md) and the [Company Brain](../../memory/company/README.md).

## Purpose

This document defines the binding contract for every AI agent in AMF: what it consumes, what it emits, who owns it, who depends on it, and the exact rules that govern validation, success, failure, retries, and escalation. It closes with an interaction matrix showing how every agent communicates with every other agent.

The contract exists so agents can be developed, tested, replaced, and reasoned about independently while still composing into one reliable pipeline. Every field below is enforceable: schemas are JSON Schema draft-07 files that exist in the repo, and the routing is taken directly from those schemas.

---

## 1. The shared event envelope

Agents never call each other directly. They exchange **events** over the event bus, coordinated by [`apps/orchestrator`](../../apps/orchestrator/README.md). Every input and output shares one envelope; only `payload` differs per agent.

| Field | Type | Rule |
|---|---|---|
| `schema_version` | string | Const `1.0.0`; a mismatch is a hard reject |
| `event_id` | uuid | Unique per event |
| `workflow_id` | uuid | Correlates every event in one pipeline run |
| `correlation_id` | string \| null | Optional cross-workflow trace |
| `brand_id` | string \| null | Owning brand |
| `asset_id` | string \| null | The content asset once one exists |
| `timestamp` | date-time | UTC emission time |
| `type` | enum (const) | The event name (e.g. `ResearchFinished`) |
| `source_agent` | string (const) | Emitting agent id |
| `target_agent` | string (const) | Intended consumer |
| `payload` | object | Agent-specific body |
| `metadata` | object | `cost_usd`, `model`, `latency_ms`, trace |

**Envelope validation rule (applies to all agents):** `additionalProperties: false` at the top level; every required envelope field present; `type`, `source_agent`, `target_agent` match the consuming agent's schema constants; `schema_version == 1.0.0`. An event failing envelope validation is dead-lettered, never processed.

---

## 2. The canonical event flow

The chain below is verified against the `source_agent`/`target_agent` constants in each schema — every producer's output type is the next consumer's input type.

```
                 ┌───────────────── CEO Review loop ─────────────────┐
                 │                                                    │
CEO ─ExecutiveDirective→ Orchestrator ─TaskDispatched→ Research      │
   Research ─ResearchFinished→ Writer ─ScriptFinished→ SEO           │
   SEO ─SEOFinished→ Thumbnail ─ThumbnailFinished→ Video             │
   Video ─VideoFinished→ QA ─QAReviewed→ Brand ─PublishApproved→ Publisher
   Publisher ─PublishingFinished→ Analytics ─AnalyticsReported→ Finance ─FinanceReported→ CEO
                                              └─AnalyticsReported→ Growth ─GrowthProposed→ CEO
```

- **Executive layer:** CEO (decides), Orchestrator (executes).
- **Production line:** Research → Writer → SEO → Thumbnail → Video.
- **Gates:** QA (technical), Brand (voice/safety) — between Video and Publisher.
- **Distribution + feedback:** Publisher → Analytics → Finance and Growth → CEO.

---

## 3. Agent contracts

Each contract lists Inputs, Outputs, Owner, Consumers, Dependencies, Required Files, Validation Rules, Success Criteria, Failure Criteria, Retry Rules, and Escalation Rules. "Owner" is the agent accountable for the contract; "Consumers" are the agents that receive its output. Required Files are the standardized set that exists for every agent.

The **standard required-file set** (identical for all 13 agents, so listed once):

```
README.md
config/config.yaml
prompts/system.md · prompts/instructions.md · prompts/examples.md
memory/long_term.md · memory/short_term.md
schemas/input.schema.json · schemas/output.schema.json
workflows/workflow.md
tests/evaluation.md · tests/scenarios.md
```

Each contract below references this set as "Standard set" and names its two schema contracts explicitly.

---

### 3.1 CEO / Executive Brain

- **Inputs:** `CEOReviewRequested` (KPI snapshot, analytics summary, finance summary, risk flags). Also receives `FinanceReported` and `GrowthProposed` as review inputs, and human operator objectives.
- **Outputs:** `ExecutiveDirective` (priorities, decisions, budget allocations).
- **Owner:** CEO agent.
- **Consumers:** Orchestrator.
- **Dependencies:** Analytics, Finance, Growth (supply the package); Company Brain (values, decision-framework, KPIs).
- **Required Files:** Standard set; `schemas/input.schema.json` is a fan-in `oneOf` accepting `CEOReviewRequested` | `FinanceReported` | `GrowthProposed`; `schemas/output.schema.json` = `ExecutiveDirective`.
- **Validation Rules:** Envelope valid; KPI snapshot within freshness threshold (48h); no directive without a package.
- **Success Criteria:** Exactly one schema-valid `ExecutiveDirective` emitted; every decision passes all four gates (North Star, Margin, Safety, Evidence); one-way doors recorded.
- **Failure Criteria:** Directive on stale/missing package; a decision that overrides the safety gate; unlabeled reversibility.
- **Retry Rules:** No auto-retry of decisions. On stale/missing input, request a refreshed package (max 2 review cycles/day) rather than retrying.
- **Escalation Rules:** To human operator on budget-cap breach, legal/compliance exposure, or brand-safety incident.

### 3.2 Orchestrator

- **Inputs:** `ExecutiveDirective` from CEO.
- **Outputs:** `TaskDispatched` (task, stage, brand_id, retry policy) to a specialist agent.
- **Owner:** Orchestrator agent (runtime counterpart: `apps/orchestrator`).
- **Consumers:** All production agents (Research first), and any agent it routes to.
- **Dependencies:** Event bus, all agent schemas, `memory/checkpoints`.
- **Required Files:** Standard set; `schemas/input.schema.json` is a fan-in `oneOf` accepting `ExecutiveDirective` | `DeadLettered`; output = `TaskDispatched`.
- **Validation Rules:** Envelope valid; target agent exists and is available; retry policy attached.
- **Success Criteria:** Directive decomposed into correctly-routed tasks; workflow state tracked; hand-offs succeed.
- **Failure Criteria:** Misrouted task; lost workflow state; unbounded retries.
- **Retry Rules:** Owns the pipeline retry policy — exponential backoff, max 3 attempts per step, then dead-letter. Resumes from `memory/checkpoints`.
- **Escalation Rules:** To CEO / human when a workflow dead-letters or a step exhausts retries.

### 3.3 Research

- **Inputs:** `TaskDispatched` from Orchestrator.
- **Outputs:** `ResearchFinished` (validated topic, demand signals, sources, key points, angle, keyword seeds).
- **Owner:** Research agent.
- **Consumers:** Writer (primary); SEO reads keyword seeds.
- **Dependencies:** Orchestrator; external search/trend tools; `packages/database`; Company Brain (strategy).
- **Required Files:** Standard set; input = `TaskDispatched`, output = `ResearchFinished`.
- **Validation Rules:** Envelope valid; every claim carries a source (Evidence gate); demand signal present.
- **Success Criteria:** Schema-valid brief with cited sources and a ranked, in-strategy topic.
- **Failure Criteria:** Thin/uncited evidence; off-strategy topic; brand-unsafe subject.
- **Retry Rules:** Re-gather up to 2 times on thin evidence before returning a HOLD to Orchestrator.
- **Escalation Rules:** To CEO on brand-safety-risky or off-strategy topics; to Orchestrator when evidence cannot be sourced.

### 3.4 Writer

- **Inputs:** `ResearchFinished` from Research.
- **Outputs:** `ScriptFinished` (script, hook, sections, word count, citations, brand-voice applied).
- **Owner:** Writer agent.
- **Consumers:** SEO.
- **Dependencies:** Research; Brand Guidelines; `packages/prompts`.
- **Required Files:** Standard set; input = `ResearchFinished`, output = `ScriptFinished`.
- **Validation Rules:** Envelope valid; on-voice per Brand Guidelines; claims carry citations from the brief.
- **Success Criteria:** Schema-valid, on-voice script with supported claims.
- **Failure Criteria:** Off-voice draft; unsupported claim; missing hook/structure.
- **Retry Rules:** Self-revise up to 2 times against the voice rules before emitting.
- **Escalation Rules:** To Brand/QA on unverifiable claims; back to Research if the brief is insufficient.

### 3.5 SEO

- **Inputs:** `ScriptFinished` from Writer.
- **Outputs:** `SEOFinished` (title, description, tags, keywords, chapters, metadata).
- **Owner:** SEO agent.
- **Consumers:** Thumbnail.
- **Dependencies:** Writer; keyword tools; Research keyword seeds.
- **Required Files:** Standard set; input = `ScriptFinished`, output = `SEOFinished`.
- **Validation Rules:** Envelope valid; metadata complete for the target platform; optimization does not alter voice.
- **Success Criteria:** Schema-valid, discoverable metadata that preserves the script's voice.
- **Failure Criteria:** Missing/oversized metadata; optimization that pulls the writing off-voice.
- **Retry Rules:** Re-optimize up to 2 times if metadata fails platform limits.
- **Escalation Rules:** To Brand when discoverability and voice conflict.

### 3.6 Thumbnail

- **Inputs:** `SEOFinished` from SEO.
- **Outputs:** `ThumbnailFinished` (thumbnail asset ref, variants, concept, render cost).
- **Owner:** Thumbnail agent.
- **Consumers:** Video.
- **Dependencies:** SEO; `packages/media`; image-generation tools; Finance (cost).
- **Required Files:** Standard set; input = `SEOFinished`, output = `ThumbnailFinished`.
- **Validation Rules:** Envelope valid; thumbnail represents content honestly; render cost within budget.
- **Success Criteria:** Schema-valid, on-brand, honest thumbnail with variants for testing.
- **Failure Criteria:** Misleading/click-bait imagery; render-cost overrun.
- **Retry Rules:** Regenerate up to 2 variants on quality failure.
- **Escalation Rules:** To Finance on cost overrun; to Brand on honesty/click-bait concerns.

### 3.7 Video

- **Inputs:** `ThumbnailFinished` from Thumbnail.
- **Outputs:** `VideoFinished` (asset id, video ref, duration, render cost, resolution, captions ref) to QA.
- **Owner:** Video agent.
- **Consumers:** QA.
- **Dependencies:** Thumbnail, script, assets; `packages/media` (FFmpeg); `apps/worker` (heavy rendering); Finance.
- **Required Files:** Standard set; input = `ThumbnailFinished`, output = `VideoFinished`.
- **Validation Rules:** Envelope valid; render integrity; captions attached; duration within format bounds.
- **Success Criteria:** Schema-valid finished render with captions and in-bounds duration.
- **Failure Criteria:** Corrupt/truncated render; missing captions; render-cost overrun.
- **Retry Rules:** Re-render up to 2 times on render failure (delegated to `apps/worker`).
- **Escalation Rules:** To Finance on render-cost overrun; QA returns quality defects for rework.

### 3.8 QA (gate)

- **Inputs:** `VideoFinished` from Video.
- **Outputs:** `QAReviewed` (passed, checks, defects, severity) to Brand.
- **Owner:** QA agent.
- **Consumers:** Brand.
- **Dependencies:** Video; content quality bar (Brand Guidelines).
- **Required Files:** Standard set; input = `VideoFinished`, output = `QAReviewed`.
- **Validation Rules:** Envelope valid; runs schema-validity, render-integrity, duration, captions checks.
- **Success Criteria:** Schema-valid verdict; `passed: true` only when all objective checks pass.
- **Failure Criteria:** Passing an asset with a failing check (defect escape); false hold.
- **Retry Rules:** No self-retry — a defect is a HOLD returned to the producing agent.
- **Escalation Rules:** To producing agent (Video) for rework; to Orchestrator/human when a rework loop does not converge.

### 3.9 Brand (gate)

- **Inputs:** `QAReviewed` (must be `passed: true`) from QA.
- **Outputs:** `PublishApproved` (platforms, approvals {brand, qa}, brand_safety, voice score) to Publisher.
- **Owner:** Brand agent.
- **Consumers:** Publisher.
- **Dependencies:** QA; Brand Guidelines; Values; platform-policy references.
- **Required Files:** Standard set; input = `QAReviewed`, output = `PublishApproved`.
- **Validation Rules:** Envelope valid; QA passed; brand-safety, citation, voice-conformance, packaging-honesty checks.
- **Success Criteria:** `PublishApproved` emitted only when on-voice, safe, compliant, and cited.
- **Failure Criteria:** Approving unsafe/off-voice/uncited content — **brand-safety escape is a zero-tolerance failure**.
- **Retry Rules:** No self-retry — HOLD and route (rework or escalate). Safety holds are never auto-resolved.
- **Escalation Rules:** Safety/compliance → CEO/human (one-way door); off-voice/uncited → producing agent; ambiguous → hold and escalate.

### 3.10 Publisher

- **Inputs:** `PublishApproved` from Brand.
- **Outputs:** `PublishingFinished` (published refs, schedule, status) to Analytics.
- **Owner:** Publisher agent.
- **Consumers:** Analytics.
- **Dependencies:** Brand + QA approvals; platform APIs; scheduling.
- **Required Files:** Standard set; input = `PublishApproved`, output = `PublishingFinished`.
- **Validation Rules:** Envelope valid; **both `approvals.brand` and `approvals.qa` are true** — hard gate; platform targets valid.
- **Success Criteria:** Asset published to all target platforms; refs and status recorded.
- **Failure Criteria:** Publishing without both approvals; unrecorded/failed publish.
- **Retry Rules:** Retry a failed platform publish up to 3 times with backoff; partial success recorded per platform.
- **Escalation Rules:** To Brand on platform-policy rejection; to Orchestrator on repeated publish failure.

### 3.11 Analytics (feedback)

- **Inputs:** `PublishingFinished` from Publisher.
- **Outputs:** `AnalyticsReported` (metrics, attributed revenue, insights, lessons ref) to Finance **and** Growth.
- **Owner:** Analytics agent.
- **Consumers:** Finance, Growth (and, aggregated, CEO).
- **Dependencies:** Publisher; platform data; `packages/analytics`; `packages/database`; `knowledge/` (writes lessons).
- **Required Files:** Standard set; `schemas/input.schema.json` is a fan-in `oneOf` accepting `PublishingFinished` (primary trigger) | `ProductionStepFinished` (any measured step); output = `AnalyticsReported`.
- **Validation Rules:** Envelope valid; data freshness; attribution coverage threshold.
- **Success Criteria:** Schema-valid metrics + attributed revenue; lessons written to the knowledge base.
- **Failure Criteria:** Stale/incomplete data; attribution gaps beyond threshold.
- **Retry Rules:** Re-pull platform data up to 3 times on gaps before reporting with a coverage flag.
- **Escalation Rules:** To Orchestrator/human on persistent data-quality or attribution gaps.

### 3.12 Finance (feedback)

- **Inputs:** `AnalyticsReported` from Analytics.
- **Outputs:** `FinanceReported` (revenue, cost breakdown, gross margin, AGP contribution, budget status) to CEO.
- **Owner:** Finance agent.
- **Consumers:** CEO.
- **Dependencies:** Analytics; `configs/models` (cost tiers); budget config.
- **Required Files:** Standard set; input = `AnalyticsReported`, output = `FinanceReported`.
- **Validation Rules:** Envelope valid; fully-loaded cost (model, render, storage, distribution); margin computed.
- **Success Criteria:** Schema-valid P&L per asset/brand; budget status and AGP contribution reported.
- **Failure Criteria:** Cost hiding; unenforced budget; negative unit economics not flagged.
- **Retry Rules:** Recompute on cost-data gaps; no silent estimates.
- **Escalation Rules:** To CEO on budget overrun and negative unit economics (owns the Margin gate).

### 3.13 Growth (feedback)

- **Inputs:** `AnalyticsReported` from Analytics; reads `experiments/ab-tests`.
- **Outputs:** `GrowthProposed` (experiments, winning tactics, channel-expansion proposals) to CEO.
- **Owner:** Growth agent.
- **Consumers:** CEO (and Publisher applies winning packaging).
- **Dependencies:** Analytics; `experiments/ab-tests`; `playbooks/` (promotes wins).
- **Required Files:** Standard set; input = `AnalyticsReported`, output = `GrowthProposed`.
- **Validation Rules:** Envelope valid; each experiment has hypothesis, metric, and guardrails; only statistically valid wins promoted.
- **Success Criteria:** Schema-valid proposals; winning tactics codified into playbooks.
- **Failure Criteria:** Guardrail-less experiments; promoting invalid wins; channel bets made unilaterally.
- **Retry Rules:** Re-run inconclusive experiments once with adjusted power before proposing.
- **Escalation Rules:** Channel/niche expansion (one-way doors) → CEO; guardrail breach → hold.

---

## 4. Cross-cutting rules

### 4.1 Global validation
Every event is validated against the consuming agent's `input.schema.json` before processing. A validation failure is **never** silently dropped: it is logged to [`logs/errors`](../../logs/errors/README.md) and dead-lettered for inspection.

### 4.2 Global retry & dead-letter policy
The Orchestrator owns retries so individual agents stay stateless. Default: **exponential backoff, max 3 attempts**, then the event moves to the dead-letter queue and the Orchestrator escalates. Long-running work resumes from [`memory/checkpoints`](../../memory/checkpoints/README.md).

### 4.3 Global escalation ladder
1. **Agent self-remedy** (bounded self-revision / re-render).
2. **Peer rework** (gate returns asset to producing agent).
3. **Orchestrator** (retries, dead-letter, reroute).
4. **CEO** (one-way-door decisions, strategy).
5. **Human operator** (safety, legal, budget-cap, unresolved).

### 4.4 The two hard lines
- **Publisher** must never publish without both QA and Brand approvals.
- **Brand** must never approve content that fails brand-safety — regardless of projected performance.

These are the only zero-tolerance rules; every other failure is recoverable through the ladder above.

---

## 5. Interaction matrix

How every agent communicates with every other agent. Read **row → column** as "row agent sends to column agent." Cell = the event `type` on that edge (from the verified schemas). `—` = no direct edge.

| From ↓ \ To → | CEO | Orch | Res | Wri | SEO | Thu | Vid | QA | Brand | Pub | Ana | Fin | Gro |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **CEO** | — | ExecutiveDirective | — | — | — | — | — | — | esc | — | — | — | — |
| **Orchestrator** | esc | — | TaskDispatched | Task | Task | Task | Task | Task | Task | Task | Task | Task | Task |
| **Research** | esc | HOLD | — | ResearchFinished | (seeds) | — | — | — | — | — | — | — | — |
| **Writer** | — | — | rework | — | ScriptFinished | — | — | esc | esc | — | — | — | — |
| **SEO** | — | — | — | — | — | SEOFinished | — | — | esc | — | — | — | — |
| **Thumbnail** | — | — | — | — | — | — | ThumbnailFinished | — | esc | — | — | esc(Fin) | — |
| **Video** | — | — | — | — | — | — | — | VideoFinished | — | — | — | esc(Fin) | — |
| **QA** | — | esc | — | — | — | — | rework | — | QAReviewed | — | — | — | — |
| **Brand** | esc | — | — | rework | rework | rework | — | — | — | PublishApproved | — | — | — |
| **Publisher** | — | esc | — | — | — | — | — | — | esc | — | PublishingFinished | — | — |
| **Analytics** | (agg) | esc | — | — | — | — | — | — | — | — | — | AnalyticsReported | AnalyticsReported |
| **Finance** | FinanceReported | — | — | — | — | — | — | — | — | — | — | — | — |
| **Growth** | GrowthProposed | — | — | — | — | — | — | — | — | (packaging) | — | — | — |

**Legend:**
- **Named event** = a primary schema-defined edge (e.g. `ResearchFinished`).
- **Task** = `TaskDispatched`; the Orchestrator can dispatch to any agent, so its row is dense by design.
- **esc** = escalation edge (control, not a production event); `esc(Fin)` = cost escalation to Finance.
- **rework** = a gate/consumer returning an asset to a producing agent.
- **(seeds)/(agg)/(packaging)** = a secondary data influence, not a distinct event on the main chain.

### Matrix observations
- **The production spine is a single path:** Research → Writer → SEO → Thumbnail → Video → QA → Brand → Publisher. Each cell on that diagonal is exactly one named event, which is why the pipeline is easy to trace and recover.
- **The Orchestrator is the only fan-out hub** (dense row) — deliberate, because centralizing dispatch keeps every other agent stateless and independently testable.
- **The CEO is a sink-and-source, never a spine node:** it receives `FinanceReported` and `GrowthProposed`, emits `ExecutiveDirective`, and otherwise only appears on escalation edges. This encodes "the CEO decides, it does not execute."
- **Feedback fans in to the CEO** via Finance and Growth, closing the loop that the roadmap calls "CEO Review → Repeat."

---

## 6. How this contract is enforced and evolved

- **Enforced** by the JSON Schemas in each agent's `schemas/` folder (26 files, all draft-07, all validated), the `config/config.yaml` guardrails, and the `tests/evaluation.md` thresholds.
- **Versioned** by `schema_version` in the envelope; a breaking change increments it, and mismatched events are rejected rather than misinterpreted.
- **Evolved** through the [Decision Framework](../../memory/company/decision-framework.md): a contract change is a recorded decision, so the reasoning is retrievable.

## Related documents

- [Agents package standard](../../packages/agents/README.md)
- [Company Brain — KPIs](../../memory/company/kpis.md) and [Decision Framework](../../memory/company/decision-framework.md)
- Event-driven architecture: [docs/architecture](./README.md)
