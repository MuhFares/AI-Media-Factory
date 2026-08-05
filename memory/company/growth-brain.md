# Growth Brain

> Architecture specification for the growth engine of AI Media Factory (AMF). No application code. This is the expansion counterpart in the executive suite: where [Analytics](./analytics-brain.md) measures and [Finance](./finance-brain.md) controls the money, the Growth Brain **runs the experiments and expansions that make the North Star bigger**. It implements the runtime brain of the [Growth agent](../../packages/agents/growth/README.md) and turns Analytics insight into compounding lift.

## 0. Core principle

Measurement tells you where you are; growth is how you get somewhere better. The Growth Brain exists to raise [AGP/Day](./north-star-metric.md) by lifting its levers — revenue per asset, reach, retention — and by expanding the surfaces the company operates on (channels, brands, products, markets). It does this through **disciplined experiments**, not hunches: every growth bet is a hypothesis with a metric and a guardrail, and every win is codified into a [playbook](../../playbooks/README.md) so it compounds.

Growth is powerful within experimentation and powerless outside it. It proposes and tests; the CEO decides the one-way doors (a new brand, a new market, a pricing change). This keeps aggressive growth from ever crossing the [Safety](./values.md) or [Margin](./finance-brain.md) lines.

```
   Analytics insight ─────►  GROWTH BRAIN  ─────► experiments + expansion proposals
   (AnalyticsReported)           │                        │
                                 ▼                        ▼
                    run A/B tests within guardrails   GrowthProposed → CEO
                    promote winners → playbooks       (one-way doors escalated)
```

---

## 1. Responsibilities map

The 15 required capabilities, grouped by function.

| Group | Capabilities |
|---|---|
| **Loops** | Growth Loops · North Star Optimization |
| **Experimentation** | Experiment Engine · A/B Testing · Weekly Experiments |
| **Sensing** | Opportunity Detection · Competitor Monitoring · Trend Detection |
| **Expansion** | Channel Expansion · Revenue Expansion · Brand Expansion · Product Expansion · Market Expansion |
| **Govern** | Growth Prioritization · Monthly Reviews |

---

## 2. The Growth Brain's mental model

```
                     ┌──────────────────────────────────────────────┐
  Analytics feed ───►│               GROWTH BRAIN                    │
  competitor/trend ─►│                                              │
  signals            │  1. SENSE       opportunities, trends, comps  │
                     │        │                                      │
                     │        ▼                                      │
                     │  2. HYPOTHESIZE form testable growth bets      │
                     │        │                                      │
                     │        ▼                                      │
                     │  3. PRIORITIZE  RICE-rank bets                 │
                     │        │                                      │
                     │        ▼                                      │
                     │  4. EXPERIMENT  A/B test within guardrails     │
                     │        │                                      │
                     │        ▼                                      │
                     │  5. LEARN       promote wins → playbooks        │
                     │        │                                      │
                     │        ▼                                      │
                     │  6. PROPOSE     expansions → CEO (one-way)     │
                     └──────────────────────────────────────────────┘
                              │                        │
                              ▼                        ▼
                    GrowthProposed → CEO         winning tactics → agents/playbooks
```

---

## 3. LOOPS — the engine of compounding

### 3.1 Growth Loops

A growth loop is a self-reinforcing cycle where the output of one turn feeds the input of the next. Growth designs and tunes loops, not one-off campaigns.

| Loop | Mechanism | Reinvestment |
|---|---|---|
| **Content loop** | Publish → audience grows → more reach on next asset → more audience | Reach compounds per brand |
| **Learning loop** | Publish → Analytics measures → lesson → next asset performs better | Quality compounds ([Memory Intelligence](./memory-intelligence.md)) |
| **Monetization loop** | Revenue → reinvest in more/better assets → more revenue | AGP/Day compounds |
| **Portfolio loop** | Win in one brand → codified playbook → applied to all brands | The [data-flywheel moat](./competitive-advantages.md) |

```
        ┌───────────────────────────────────────────┐
        ▼                                             │
   publish asset ─► audience + data ─► better next asset
        │                                             ▲
        └──────── reinvest revenue ───────────────────┘
```

The Growth Brain's job is to find where a loop is leaking (a weak step) and fix it, and to find where a loop can spin faster (a high-leverage step) and push it.

### 3.2 North Star Optimization

Every growth activity must trace to AGP/Day and name which of its four drivers it moves:

```
 AGP/Day = (Profitable Assets/Week / 7) × (Revenue/Asset − Cost/Asset) × Autonomy Rate

 Growth owns the levers on:
   ├─ Revenue per Asset ...... hooks, titles, thumbnails, monetization mix, retention
   └─ Reach/audience ......... distribution, cadence, channel expansion
 (Cost/Asset is Finance's; Autonomy is the Orchestrator's — Growth never trades against them)
```

A growth bet that cannot name its AGP/Day driver is not a growth bet — it is a distraction, and it is rejected before it enters the experiment queue.

---

## 4. EXPERIMENTATION — the core discipline

### 4.1 Experiment Engine

The engine turns a hypothesis into a valid, measured result.

```
 1. HYPOTHESIS   "Shorter hooks (<5s) lift retention on brd-ai-tools"
        │        (must name: driver, metric, expected lift, scope)
        ▼
 2. DESIGN       control vs. variant; sample size for significance; guardrails
        │
        ▼
 3. GUARDRAILS   brand-safety, margin, and quality floors that CANNOT be breached
        │
        ▼
 4. RUN          via Orchestrator; assets flow through normal gates (QA/Brand)
        │
        ▼
 5. MEASURE      Analytics attributes the outcome; check significance
        │
        ├─ inconclusive → re-run once with more power, or drop
        ├─ loss → record lesson (what didn't work), stop
        └─ win → PROMOTE
        ▼
 6. PROMOTE      winning tactic → playbooks/ + feed the owning agent
```

### 4.2 A/B Testing rules

| Rule | Detail |
|---|---|
| **One variable at a time** | Isolate cause; multi-variable needs a proper multivariate design |
| **Pre-registered metric** | The success metric and expected lift are declared before the test runs (no post-hoc cherry-picking — Evidence gate) |
| **Statistical significance** | A win must clear the significance threshold, not just "looks better" |
| **Guardrail metrics** | A variant that lifts CTR but tanks retention or breaches safety is a loss, not a win |
| **Bounded blast radius** | Tests run on a slice, not the whole portfolio, until proven |
| **Reversible by design** | A/B tests are two-way doors ([Decision Framework](./decision-framework.md)) — Growth owns them without CEO approval, within guardrails |

### 4.3 Weekly Experiments

A standing cadence: every week Growth ships a batch of experiments.

```
Weekly experiment ritual:
  ├─ review last week's results (win/loss/inconclusive)
  ├─ promote wins to playbooks; feed agents
  ├─ retire losers; record the lesson
  ├─ pull top-RICE hypotheses from the backlog
  └─ launch the new week's batch (within budget cap: ≤10% of spend — Finance §)
```

---

## 5. SENSE — finding where to grow

### 5.1 Opportunity Detection

Growth continuously scans for openings, sourced mainly from the [Analytics Brain](./analytics-brain.md):

| Signal | Source | Opportunity |
|---|---|---|
| Breakout asset | Analytics positive anomaly | Make variants, amplify |
| Under-monetized winner | Analytics + Finance | Add monetization stream |
| High-retention format | Analytics | Apply format across brand/portfolio |
| Rising topic | Trend Detection | Enter early while demand is high |
| Under-served niche | Competitor gap | Propose a new brand (→ CEO) |

### 5.2 Competitor Monitoring

```
Track competitor channels/brands in AMF's niches:
  ├─ what topics/formats are working for them
  ├─ where they are weak (gaps AMF can fill)
  ├─ posting cadence and packaging patterns
  └─ pricing/positioning (Phase 2+)
       │
       ▼
  feed into Opportunity Detection + Knowledge Base (knowledge/competitors)
```

Competitor data is **input to hypotheses**, never blind copying — a competitor tactic becomes an AMF experiment, tested against our own guardrails.

### 5.3 Trend Detection

```
Detect rising/decaying demand (from Research + Trend Memory):
  ├─ rising trend + fits a brand → fast-track an experiment/asset
  ├─ decaying trend → stop investing; the wave has passed
  └─ durable evergreen → prioritize for back-catalog value
```

Trend Memory decays fast (per [Memory Intelligence](./memory-intelligence.md)) — a stale trend signal is low-confidence by design.

---

## 6. EXPAND — the five expansion vectors

Expansion is how growth breaks through the ceiling of a single brand on a single channel. Each vector has an owner-of-decision: **reversible tuning is Growth's; the one-way door is the CEO's.**

| Vector | What it means | Growth does | CEO decides |
|---|---|---|---|
| **Channel Expansion** | Same brand, more platforms (YT→TikTok→IG→blog→email) | Test a brand on a new channel; measure fit | Commit a brand to a new primary channel |
| **Revenue Expansion** | More streams per asset/brand | Test adding affiliate/sponsorship/product to a proven brand | Approve a new revenue stream at scale |
| **Brand Expansion** | Launch new owned brands | Validate a niche with a pilot; RICE it | **Launch a new brand** (one-way door) |
| **Product Expansion** | New product surfaces (Phase 2+: Studio, templates, marketplace) | Test demand signals; propose | Launch a product (one-way door) |
| **Market Expansion** | New segments/geographies/languages | Test a beachhead; measure | Enter a new market (one-way door) |

### 6.1 The expansion decision flow

```
Expansion idea
   │
   ├─ Reversible test possible within guardrails? ──yes──► Growth runs the pilot
   │            │                                              │
   │            │                                              ▼
   │            │                                    measure → win?
   │            │                                       │yes        │no
   │            │                                       ▼           ▼
   │            │                              PROPOSE to CEO    record lesson, stop
   │            │                              (one-way door)
   └─ Irreversible / large commitment ──────────────► escalate to CEO with evidence
```

Growth never launches a brand, market, or product on its own — it earns the proposal with a pilot, then the CEO decides.

---

## 7. GOVERN — prioritization and review

### 7.1 Growth Prioritization

The backlog of hypotheses and expansion bets is RICE-ranked ([Decision Framework](./decision-framework.md)):

```
RICE = (Reach × Impact × Confidence) / Effort
```

- Only bets that pass the four gates (North Star, Margin, Safety, Evidence) enter the ranked backlog.
- Weekly experiments pull from the top of the ranked backlog.
- Expansion proposals to the CEO carry their RICE score so the CEO can compare across the portfolio.

### 7.2 Monthly Reviews

```
Growth Monthly Review:
  ├─ experiment scorecard: run / win / loss / inconclusive; win rate
  ├─ cumulative lift shipped (Δ AGP/Day driver metrics attributable to growth)
  ├─ loops: which are compounding, which are leaking
  ├─ expansion status: pilots run, proposals made, CEO decisions
  ├─ competitor + trend landscape update
  └─ next month's growth priorities (RICE-ranked)
        │
        ▼
  archived to memory/reports; feeds CEO Quarterly Planning
```

---

## 8. Worked example — a hook experiment compounds

```
SENSE: Analytics flags ast-000123 (brd-ai-tools) retention +12% — a 4s hook
   │
   ▼ HYPOTHESIZE: "hooks <5s lift retention on brd-ai-tools" (driver: revenue/asset via retention)
   │
   ▼ PRIORITIZE: RICE high (broad reach, cheap effort, medium-high confidence)
   │
   ▼ EXPERIMENT: A/B — 4s hook (variant) vs. 12s hook (control), pre-registered metric = retention
   │            guardrails: brand-safety, quality floor, no drop in watch time
   │
   ▼ MEASURE: variant +11% retention, significant, guardrails intact → WIN
   │
   ▼ PROMOTE: "short hooks" tactic → playbooks/; feed the Writer agent
   │
   ▼ COMPOUND: applied across brd-ai-tools assets; portfolio loop carries it to sibling brands
   │
   ▼ North Star: revenue/asset up → AGP/Day up
```

## 9. Expansion example — earning a new brand

```
SENSE: competitor gap + rising trend in a niche AMF doesn't cover
   │
   ▼ Growth runs a REVERSIBLE pilot: a few assets under an existing brand testing the niche
   │
   ▼ MEASURE: strong early retention + affiliate conversion → demand validated
   │
   ▼ PROPOSE: GrowthProposed → CEO — "launch a dedicated brand for niche X", with RICE + evidence
   │
   ▼ CEO decides (one-way door): approve → Orchestrator spins up the brand
   │   (Growth did NOT launch it; it earned the proposal and the CEO decided)
```

## 10. Anti-pattern example (rejected)

```
Idea: "post 10x more to grow faster"
   │
   ▼ Gate check: fails Quality (volume for its own sake) + Margin (cost balloons)
   └─ REJECTED before entering the backlog. Growth scales what works, not noise.
```

---

## 11. Boundaries — what the Growth Brain never does

- **Never launches a brand, market, or product on its own** — it pilots and proposes; the CEO decides one-way doors.
- **Never breaches a guardrail for a metric** — a win that harms brand-safety, margin, or quality is a loss.
- **Never runs unbounded experiments** — every test has a pre-registered metric, a guardrail, and a bounded blast radius.
- **Never chases volume or virality for its own sake** — growth must trace to AGP/Day (Business First).
- **Never copies a competitor blindly** — competitor signals become tested hypotheses, not imitation.
- **Never produces or publishes content directly, and never calls an agent directly** — it proposes tactics and runs experiments through the Orchestrator, over the [Event Bus](../../docs/architecture/event-bus.md).

The Growth Brain is the company's ambition, kept honest by experiments and bounded by the CEO's authority over irreversible bets. It is how AMF gets bigger without getting reckless.

## Related documents

- [CEO Decision Engine](./ceo-decision-engine.md) — decides the one-way-door expansions Growth proposes
- [Analytics Brain](./analytics-brain.md) — the sensing feed that sources Growth's opportunities
- [Finance Brain](./finance-brain.md) — enforces the experiment budget and margin guardrails
- [Memory Intelligence](./memory-intelligence.md) — turns winning experiments into durable lessons
- [Orchestrator Brain](./orchestrator-brain.md) — runs the experiments and spins up approved expansions
- [Experiments](../../experiments/README.md) · [Playbooks](../../playbooks/README.md) · [knowledge/competitors](../../knowledge/competitors/README.md)
- [North Star Metric](./north-star-metric.md) · [Decision Framework](./decision-framework.md) · [Growth agent contract](../../packages/agents/growth/README.md)
