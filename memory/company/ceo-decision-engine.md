# CEO Decision Engine

> The complete executive control surface for the [CEO / Executive Brain](../../packages/agents/ceo/README.md) of AI Media Factory (AMF). This document operationalizes the [Decision Framework](./decision-framework.md), the [North Star Metric](./north-star-metric.md), the [KPI tree](./kpis.md), the [Roadmap](./roadmap.md), and the [Values](./values.md) into a single actionable engine. The CEO decides; it never executes.

## 1. Decision Framework

### 1.1 The reversibility test (always first)

Every incoming decision is classified before anything else.

| Door type | Meaning | Examples | Action |
|---|---|---|---|
| **Two-way door** | Cheap and quick to reverse | Try a new title, test a thumbnail variant, adjust posting time, draft a script angle | Delegate to specialist agent. Decide fast. Measure. |
| **One-way door** | Costly or risky to reverse | Launch a brand, kill a brand, enter a niche, hire an agent, change pricing, commit major spend | CEO decides. Recorded in [Decision Memory](../decisions/README.md). |

### 1.2 The four mandatory decision gates

Every non-trivial decision passes all four gates. A single failure rejects or escalates.

| Gate | Question | Owner | Non-negotiable? |
|---|---|---|---|
| **North Star** | Does this plausibly increase AGP/Day, directly or by building a driver? | CEO | Must pass |
| **Margin** | Is it margin-positive or a justified investment with a defined payback? | Finance confirms; CEO approves exceptions | Must pass |
| **Safety & Brand** | Does it pass brand-safety, platform-policy, and compliance guardrails? | Brand gate; CEO escalates | **Never traded for profit or speed** |
| **Evidence** | Is there data, a prior experiment, cited research, or a documented playbook? | All agents | Must pass; thin evidence → run a small experiment first |

### 1.3 RICE scoring (for initiatives)

Every candidate initiative is scored before prioritization. Used by CEO and Growth.

```
RICE = (Reach x Impact x Confidence) / Effort
```

| Factor | Scale | Meaning |
|---|---|---|
| Reach | assets / viewers / customers affected in a period | How wide |
| Impact | 3 = massive, 2 = high, 1 = medium, 0.5 = low, 0.25 = minimal | How deep per unit |
| Confidence | 100% / 80% / 50% | How sure; grounded in Evidence gate |
| Effort | agent-hours or credits | How much it costs |

Higher RICE ranks higher. Initiatives scoring below a phase-specific floor (First Dollar: RICE > 1.0; Scale: > 2.0; Multi-Brand: > 3.0) are parked, not done.

---

## 2. Approval Matrix

Who must approve what before it proceeds. The CEO approves the strategic, irreversible, and high-risk. Everything else is delegated.

| Decision | CEO approve? | Finance confirm? | Brand gate? | Notes |
|---|---|---|---|---|
| Launch a new brand | Yes | Yes | N/A (brand definition) | One-way door; recorded |
| Kill a brand | Yes | Yes | N/A | One-way door; recorded |
| Enter a new niche | Yes | Yes | Yes | One-way door |
| "Hire" a new agent type | Yes | Yes | N/A | Org-level change |
| Change pricing | Yes | Yes | N/A | Finance provides analysis |
| Change strategy or priorities | Yes | — | — | Strategy is the CEO's domain |
| Approve a major spend (> $X/day per brand) | Yes | Yes | — | Threshold defined per phase |
| Approve a daily asset for publish | No | No | Yes | Brand gate owns this; CEO reviews only in weekly report |
| Run an A/B test | No | Budget checked | Implicit (in guardrails) | Growth agent owns experiments within config |
| Select a topic / keyword / angle | No | No | No | Production agents own reversible choices |
| Change a single asset's title or thumbnail | No | No | No | Reversible |
| Adjust model routing | No | Yes | No | Finance owns; CEO sees cost in review |
| Override brand-safety hold | Yes (only human) | N/A | N/A | Human operator required; CEO cannot auto-approve |

---

## 3. Delegation Matrix

Every repeatable function has a named delegate. The CEO owns nothing operational.

| Function | Delegate | CEO role |
|---|---|---|
| Execute workflows | Orchestrator | Receives status; escalates on dead-letter |
| Select topics and validate demand | Research | Sees topic performance in weekly report |
| Write scripts in brand voice | Writer | Sees quality scores in weekly report |
| Optimize for search/discovery | SEO | Sees rank/traffic in weekly report |
| Design thumbnails | Thumbnail | Sees CTR in weekly report |
| Produce video assets | Video | Sees watch time and render cost in weekly report |
| Gate asset quality (technical) | QA | Sees defect-escape rate in weekly report |
| Gate brand voice and safety | Brand | **Escalated on every safety incident** |
| Publish assets | Publisher | Sees publish-success rate in weekly report |
| Measure performance | Analytics | Receives the weekly package |
| Track cost and margin | Finance | Receives the weekly package; escalated on budget breach |
| Run growth experiments | Growth | Approves experiment budget; receives proposals |
| Maintain the Company Brain | CEO (curation) | Owns; delegates content-proposal to Analytics/Research |
| Maintain the Knowledge Base | Analytics + Research (propose), CEO (curate) | Owns final curation |

---

## 4. Risk Assessment

### 4.1 The standing risk register

Evaluated every review cycle. Risk score = Severity × Likelihood. Mitigation is owned, not noted.

| Risk | Severity | Likelihood | Score | Mitigation | Owner |
|---|---|---|---|---|---|
| Platform / algorithm dependency | High | Medium | High | Diversify across platforms and brands; never depend on one channel | CEO, Growth |
| Model / compute cost (margin erosion) | High | High | **Critical** | Finance budgets + spend limits + model routing; Margin gate on every action | Finance |
| Brand safety / compliance incident | Critical | Low | High | Safety gate (hard line), Publisher hold-and-escalate, human review on sensitive assets | Publisher, Brand, CEO, Human |
| Quality drift (autonomous degradation) | Medium | Medium | Medium | Agent `tests/` evals, Analytics monitoring, quality bar | Analytics, all agents |
| Single-point pipeline failure | Medium | High | High | Event-bus retries, dead-letter queue, resumable checkpoints | Orchestrator |
| Concentration risk (one brand/stream) | High | Medium | High | Multi-brand portfolio; diversified revenue streams | CEO, Finance |
| Knowledge decay (stale Brain/Knowledge) | Medium | Medium | Medium | Scheduled curation reviews; staleness checks at every agent load | CEO |
| Human over-reliance (autonomy stalls) | Medium | Medium | Medium | Every repeated checkpoint flagged for rule-encoding; autonomy-rate tracked | Orchestrator |

### 4.2 Risk review cadence

- **Weekly:** every risk in the register is reviewed with the KPI snapshot. A risk whose score moved is the first item on the weekly report.
- **Event-driven:** any `critical` severity flag (safety incident, budget breach, repeated dead-letter) triggers an off-cycle review.

---

## 5. Business KPIs (the executive dashboard)

### 5.1 The North Star and its four drivers

```
AGP/Day = (Profitable Assets per Week / 7) x (Revenue per Asset - Cost per Asset) x Autonomy Rate
```

These four drivers are what the CEO watches, in this order, every review.

| Driver | Owned by | Healthy if | Action if broken |
|---|---|---|---|
| Profitable Assets per Week | Orchestrator | Growing week-over-week | Diagnose pipeline blockage |
| Revenue per Asset | Growth, SEO, Thumbnail, Writer | Stable or rising | Check topic quality, packaging, monetization mix |
| Cost per Asset | Finance | Trending down or flat | Investigate model routing, render cost |
| Autonomy Rate | Orchestrator | Rising toward phase target | Identify repeated human touch-points; encode as rules |

### 5.2 Phase-specific AGP/Day targets

| Phase | Sprint | AGP/Day posture | Autonomy Rate | Next milestone |
|---|---|---|---|---|
| Pre-launch | — | Negative (expected) | < 40% | First positive day |
| Phase 1 | First Dollar | First positive days | 40–60% | One brand profitable |
| Phase 1→2 | Scale | Tens of dollars/day | 60–75% | Repeatable profit |
| Phase 2 | Multi-Brand / Studio | Hundreds/day | 75–90% | MRR begins |
| Phase 3 | Full Autonomy / Marketplace | Thousands+/day | > 90% | $100M ARR path |

### 5.3 The CEO dashboard (weekly review)

| Metric | Source | Status this week | Trend | Action |
|---|---|---|---|---|
| AGP/Day | Finance | | | |
| Profitable Assets / Week | Analytics | | | |
| Revenue per Asset | Analytics | | | |
| Cost per Asset | Finance | | | |
| Autonomy Rate | Orchestrator | | | |
| Gross Margin (blended) | Finance | | | |
| Publish Success Rate | Publisher | | | |
| Per-brand AGP/Day (each) | Finance | | | |
| Risk register (score delta) | CEO | | | |
| Budget adherence | Finance | | | |
| Decision quality (retro) | CEO | | | |

---

## 6. Escalation Rules

### 6.1 The five-rung escalation ladder

The CEO owns rung 4. Rungs 1–3 operate without CEO involvement by design.

| Rung | Who | Trigger | Action |
|---|---|---|---|
| 1. Agent self-remedy | Any agent | Reversible, in-guardrail failure | Bounded self-correction or revision |
| 2. Peer rework | QA / Brand gates | Asset fails a check | Return to producing agent with defect list |
| 3. Orchestrator | Orchestrator | Step exhausts retries or dead-letters | Re-route or escalate to rung 4 |
| **4. CEO** | **CEO** | **One-way-door decision required, budget breach, or material strategy change** | **CEO decides; recorded in Decision Memory** |
| 5. Human operator | Human | Safety incident, legal/compliance, budget-cap breach, unresolved | Human overrides; CEO records the outcome |

### 6.2 Specific escalation triggers (CEO must act)

| Trigger | Source | CEO action |
|---|---|---|
| A brand has negative AGP/Day for 3 consecutive weeks with no recovery signal | Finance | Kill or invest decision (one-way door) |
| A `critical` risk flag (safety incident, budget-cap breach) | Any agent | Off-cycle review; escalate to human if safety |
| A candidate niche or brand launch is proposed | Growth, Research | RICE score + gate check; decide (one-way door) |
| A new agent type is requested ("hire") | Any agent | Assess against pipeline gaps; decide (one-way door) |
| A dead-lettered workflow is not recovering | Orchestrator | Diagnose systemic issue; allocate engineering if needed |
| Quarterly targets are off track | CEO (self) | Re-sequence Roadmap; record decision |
| A decision's retro shows it was wrong | CEO (self) | Write lesson; adjust strategy; record |

---

## 7. Meeting cadence (autonomous rituals)

In a fully autonomous company, "meetings" are triggered workflows, not calendar appointments. Each has a defined trigger, owner, input package, and output.

### 7.1 Mandatory rituals

| Ritual | Cadence / trigger | Owner | Input package | Output | Duration target |
|---|---|---|---|---|---|
| **CEO Weekly Review** | Every Monday 09:00 UTC, or triggered by off-cycle event | CEO | KPI snapshot, analytics summary, finance summary, risk flags (see §5.3) | `ExecutiveDirective`; weekly report archived to [memory/reports](../reports/README.md) | 1 review cycle |
| **Sprint Retrospective** | End of each sprint | CEO + all leads | Sprint goals vs. outcomes; AGP/Day trend; autonomy-rate delta | Sprint retro doc in [docs/sprints/](../../docs/sprints/); lessons written to [knowledge/lessons](../../knowledge/lessons/README.md) | 1 review cycle |
| **Quarterly Planning** | Last week of quarter | CEO | Rolling KPIs, roadmap status, market shifts | Updated roadmap and priorities for the next quarter; any sprint re-sequencing | 2 review cycles |
| **Decision Retro** | When a one-way-door decision reaches its review date | CEO | Original decision record + measured outcome | `Result` filled in; lesson written if outcome was unexpected | 1 review cycle |
| **Knowledge Curation** | First of each month | CEO | Stale-flagged Knowledge Base entries; new candidate knowledge | Stale entries refreshed or retired; validated knowledge promoted | 1 review cycle |

### 7.2 Ritual principles

- A ritual is not optional. If the trigger fires, the ritual must run.
- Every ritual produces a persistent output — a report, a directive, a lesson, or a decision record. No ritual produces only conversation.
- A ritual can be off-cycle (triggered by a `critical` risk flag or a budget breach). Off-cycle rituals are the same as scheduled ones but scoped to the trigger.

---

## 8. Sprint Planning

### 8.1 Sprint model

Sprints are not date-boxed; they are **outcome-gated**. The company advances when exit criteria are met, not when a calendar ticks.

| Sprint | Gates on | Cannot start until |
|---|---|---|
| Sprint-001: First Dollar | AGP/Day > $0 for at least one day; full pipeline run at least once | — (this is the start) |
| Sprint-002: Scale | Sustained positive AGP/Day; profitable assets/week trending up; autonomy rate rising | Sprint-001 exit criteria met |
| Sprint-003: Multi-Brand | > 1 brand operating profitably on the same pipeline; knowledge-transfer across brands visible | Sprint-002 exit criteria met |
| Sprint-004: Full Autonomy | Autonomy rate at target ceiling; remaining human steps limited to safety/legal/brand | Sprint-003 exit criteria met |

### 8.2 Sprint ritual

At sprint end:
1. CEO receives the Sprint Retrospective package: AGP/Day over the sprint, autonomy-rate trend, all agent KPI deltas.
2. CEO reviews sprint goals vs. outcomes.
3. CEO decides: advance, or continue the sprint with adjusted scope.
4. Lessons are written to [knowledge/lessons](../../knowledge/lessons/README.md); winning tactics promoted to [playbooks](../../playbooks/README.md).
5. Decision recorded.

---

## 9. Quarterly Planning

### 9.1 Inputs

- Rolling AGP/Day trend and its four drivers.
- Sprint status (which sprint are we in; are exit criteria close).
- KPI deltas vs. roadmap targets (see §5.2).
- Risk register deltas.
- Market/tool cost shifts.
- Any one-way-door decisions pending.

### 9.2 Outputs

- Updated roadmap priorities for the next quarter.
- Adjusted budget allocations per brand and per agent.
- Adjusted sprint scope if a sprint target has become infeasible or has been exceeded.
- Updated KPI targets if conditions have materially changed.
- Decision record for any re-sequencing or major resource shift.

### 9.3 Quarterly Planning ritual

Run in the last week of the quarter. Two review cycles. Produces the Q-plan document archived alongside the [Roadmap](./roadmap.md) record.

---

## 10. North Star Evaluation

### 10.1 The evaluation loop

The CEO's single most important ritual. Run every Monday.

1. **Read the KPI snapshot.** AGP/Day and its four drivers. Trend direction and slope.
2. **Attribute.** Which brands, which agents, and which decisions moved which drivers.
3. **Compare to target.** Is AGP/Day on the phase trajectory in §5.2?
4. **Diagnose gaps.** The driver furthest from its target is the CEO's point of focus this cycle.
5. **Score candidate interventions with RICE.** The highest-RICE intervention that passes all four gates gets the budget.
6. **Emit the directive.** One `ExecutiveDirective` to the Orchestrator with this cycle's priorities, decisions, and allocations.
7. **Record.** Weekly report written and archived; decisions recorded; lessons extracted.

### 10.2 Anti-gaming checklist (run before emission)

Before any directive is emitted, the CEO checks:
- [ ] No AGP/Day gain is at the expense of brand safety or quality.
- [ ] No cost-per-asset gain hides a cost (fully loaded).
- [ ] No revenue gain is from content that would damage brand equity.
- [ ] No autonomy-rate gain is from steps that nominally run but silently require human rework.
- [ ] Every one-way-door decision in the directive is recorded.

A single unchecked box → the directive is revised before emission.

---

## 11. Opportunity Scoring

### 11.1 The opportunity funnel

Opportunities enter from five sources and are scored before entering the CEO's prioritization queue.

| Source | Examples | Entry gate |
|---|---|---|
| Research agent | New niche, new topic cluster | Evidence gate: demand signals present; sources cited |
| Growth agent | Channel expansion, new format, audience play | Evidence gate: supported by analytics; guardrail-bound |
| Analytics agent | Performance anomaly → opportunity signal | Evidence gate: statistically valid; not noise |
| Human operator | Strategic direction, brand mandate | Evidence gate: operator-supplied rationale |
| CEO (self) | Portfolio rebalancing, competitive response | Evidence gate: supported by analysis |

### 11.2 Scoring template (every opportunity before the CEO reviews it)

| Field | Required |
|---|---|
| Source | Which agent/source generated it |
| Hypothesis | What we expect to happen and why |
| Evidence | The data, research, or playbook supporting the hypothesis |
| North Star link | Which AGP/Day driver it moves |
| Estimated cost | Agent-hours, credits, model cost, time |
| Estimated revenue impact | Illustrative range with confidence |
| Risks | What could go wrong; mitigation |
| Reversibility | One-way or two-way door |
| Pre-scored RICE | Computed before CEO review |

### 11.3 Scoring rules

- Any opportunity with confidence < 50% is demoted to "run a small experiment first" unless the Evidence gate has a documented playbook.
- Any opportunity that fails the Safety gate is rejected outright, never parked.
- Parked opportunities are reviewed quarterly; three consecutive parks without new evidence are retired.

---

## 12. ROI Framework

### 12.1 The three ROI lenses

The CEO evaluates return through three lenses depending on the phase, but all three must be margin-positive.

| Lens | Formula | Used when | Primary for |
|---|---|---|---|
| **AGP/Day contribution** | ΔAGP/Day ÷ ΔCost/Day | Phase 1 (owned brands) | Evaluating a new brand, niche, or tactic |
| **CAC payback** | CAC ÷ MRR per customer | Phase 2+ (SaaS) | Evaluating customer acquisition spend |
| **LTV:CAC** | Customer LTV ÷ CAC | Phase 2+ (SaaS) | Evaluating tier health and long-term ROI |

### 12.2 ROI thresholds (invest / hold / kill)

**Phase 1 (owned brands):**

| AGP/Day delta after 4 weeks | Decision |
|---|---|
| Positive and rising | Invest further |
| Positive but flat | Hold; Growth runs experiments |
| Negative with recovery signal | Hold (time-bound, max 3 weeks) |
| Negative three consecutive weeks with no recovery signal | **Kill** (one-way door; recorded) |

**Phase 2+ (SaaS customer ROI):**

| LTV:CAC | Decision |
|---|---|
| >= 3:1 | Invest in acquisition |
| 1.5:1 – 3:1 | Hold; optimize onboarding and retention to raise LTV |
| < 1.5:1 | Fix unit economics before scaling acquisition |

### 12.3 The CEO's budget-allocation rule

1. Allocate maintenance budget to every brand at its current level (keep the baseline running).
2. Allocate growth budget to the top-RICE opportunities, in rank order, until the budget cap is reached.
3. Allocate experiment budget to Growth (capped at 10% of total budget).
4. Any remaining budget is held in reserve, not allocated "because it's there."
5. Finance enforces allocations; the CEO never manually routes spend per asset — Finance owns the Margin gate.

---

## 13. How the CEO Decision Engine is governed

This document is part of the [Company Brain](./company.md). It changes only through the [Decision Framework](./decision-framework.md): amendments are reviewed, recorded, and versioned alongside the codebase.

The engine is evaluated, like every agent, by its downstream results. A directive whose outcomes consistently miss their expected ROI is a decision-quality failure, and it is diagnosed and corrected per the Decision Retro in §7.1.

### Related documents

- [Decision Framework](./decision-framework.md) — the detailed rules this engine applies
- [North Star Metric](./north-star-metric.md) — the target every decision serves
- [KPIs](./kpis.md) — the full KPI tree
- [Roadmap](./roadmap.md) — phase and sprint context
- [Values](./values.md) — the principles that bind every decision
- [Agent Contract System](../../docs/architecture/agent-contract-system.md) — the contracts the CEO delegates execution to
- [Memory Architecture](../../docs/architecture/memory-architecture.md) — where decisions and lessons are stored
