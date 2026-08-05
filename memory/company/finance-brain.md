# Finance Brain

> Architecture specification for the financial control layer of AI Media Factory (AMF). No application code. This is the CFO counterpart to the [CEO Decision Engine](./ceo-decision-engine.md) and [Orchestrator Brain](./orchestrator-brain.md): it owns the **Margin gate**, guards unit economics, and turns every workflow's cost and revenue into the [North Star](./north-star-metric.md) — Autonomous Gross Profit per Day (AGP/Day). It implements the runtime brain of the [Finance agent](../../packages/agents/finance/README.md).

## 0. Core principle

AMF is a business first ([Values](./values.md)). The Finance Brain is the discipline that keeps it one. It does not produce content, set strategy, or publish — it **measures money, protects margin, and tells the truth about the numbers**. Its single obsession is that gross profit generated autonomously goes up and to the right, and that no clever capability is allowed to quietly lose money.

The Finance Brain owns one non-negotiable checkpoint from the [Decision Framework](./decision-framework.md): **the Margin gate.** No workflow, brand, or initiative proceeds into negative unit economics without an explicit CEO investment decision.

```
   every workflow ──cost + revenue──►  FINANCE BRAIN  ──FinanceReported──►  CEO
                                             │
                                             ├─ Margin gate (approve / block spend)
                                             ├─ model-routing recommendations → Orchestrator
                                             ├─ budget enforcement
                                             └─ anomaly alerts → CEO/human
```

---

## 1. Responsibilities map

The 19 required capabilities, grouped by function.

| Group | Capabilities |
|---|---|
| **Track** | Track AI Costs · Track Revenue · Track Margin · Track Profit · Track Asset Cost · Track ROI · Estimate AGP/Day |
| **Forecast** | Forecast Revenue · Forecast Cost · Monitor Burn Rate |
| **Optimize** | Detect Waste · Optimize Model Selection · Recommend Pricing |
| **Model** | Estimate Lifetime Value · Estimate CAC |
| **Govern** | Approve Budgets |
| **Report** | Generate Weekly Reports · Generate Monthly Reports · Alert CEO on anomalies |

---

## 2. The Finance Brain's mental model

```
                       ┌──────────────────────────────────────────────┐
   cost events ───────►│              FINANCE BRAIN                    │
   (metadata.cost_usd) │                                              │
   revenue signals ───►│  1. INGEST     cost + revenue per event/asset │
   (AnalyticsReported) │        │                                      │
                       │        ▼                                      │
                       │  2. ATTRIBUTE  cost & revenue → asset → brand  │
                       │        │                                      │
                       │        ▼                                      │
                       │  3. COMPUTE    margin · profit · ROI · AGP/Day │
                       │        │                                      │
                       │        ▼                                      │
                       │  4. GOVERN     Margin gate · budgets · routing │
                       │        │                                      │
                       │        ▼                                      │
                       │  5. FORECAST   revenue · cost · burn           │
                       │        │                                      │
                       │        ▼                                      │
                       │  6. REPORT     weekly/monthly · anomaly alerts │
                       └──────────────────────────────────────────────┘
                                 │                        │
                                 ▼                        ▼
                         FinanceReported → CEO      alerts → CEO/human
```

---

## 3. TRACK — the measurement foundation

### 3.1 Track AI Costs

Every event carries `metadata.cost_usd`, `model`, and `latency_ms` (per the [Event Bus](../../docs/architecture/event-bus.md) envelope). The Finance Brain ingests all of them and classifies:

| Cost category | Source | Examples |
|---|---|---|
| **Model / inference** | `metadata.cost_usd` per agent event | script generation, TTS, image, reasoning |
| **Render / compute** | Video/Thumbnail events + `apps/worker` | FFmpeg encoding, GPU render |
| **Storage** | infra metering | media assets, vectors, event store |
| **Distribution** | Publisher events | platform API costs, email sends, paid amplification |
| **Fixed / overhead** | allocated | engineering, monitoring, the small human team |

**Fully-loaded rule:** no cost is hidden. Asset cost includes all five categories, allocated. A cheap model call that triggers an expensive render is counted at its true total.

### 3.2 Track Revenue

Revenue arrives attributed from the [Analytics agent](../../packages/agents/analytics/README.md) via `AnalyticsReported`, across the eight streams in the [Revenue Model](./revenue-model.md):

| Phase | Streams tracked |
|---|---|
| Phase 1 | ad revenue, sponsorships, affiliate, digital products |
| Phase 2 | + SaaS subscriptions, usage credits |
| Phase 3 | + enterprise licensing, marketplace take rate |

Revenue is tracked **per asset, per brand, per stream, per platform** so it can be matched against the cost of producing it.

### 3.3 Track Margin, Profit, Asset Cost, ROI

The core per-asset ledger:

```
 Asset Cost      = model + render + storage + distribution + allocated overhead
 Asset Revenue   = Σ attributed revenue across streams (lifetime, updated over time)
 Gross Profit    = Asset Revenue − Asset Cost
 Gross Margin    = Gross Profit / Asset Revenue
 ROI             = Gross Profit / Asset Cost
```

Rolled up: per-brand P&L, per-stream margin, and portfolio-blended margin. Target: **70%+ gross margin at the Studio tier** ([Business Model](./business-model.md)) and positive contribution margin per owned brand.

### 3.4 Estimate AGP/Day

The North Star. The Finance Brain is its official calculator:

```
 AGP/Day = (Profitable Assets per Week / 7) × (Revenue per Asset − Cost per Asset) × Autonomy Rate
```

- **Profitable Assets per Week** — from the Orchestrator's throughput + Finance's profitability filter (only margin-positive assets count).
- **Revenue per Asset / Cost per Asset** — from §3.2 / §3.1.
- **Autonomy Rate** — supplied by the Orchestrator.

Finance validates the anti-gaming rules from [North Star Metric](./north-star-metric.md): no cost hiding, no counting unsafe/low-quality assets as "profitable," fully-loaded cost.

---

## 4. GOVERN — the Margin gate and budgets

### 4.1 The Margin gate (decision tree)

Before the Orchestrator dispatches a costly workflow, and continuously as spend accrues:

```
Proposed / in-flight spend
   │
   ├─ Estimated asset cost ≤ remaining brand budget? ──no──► BLOCK → escalate to CEO
   │            │yes
   ├─ Projected margin ≥ target floor? ──no──► is it a CEO-approved investment? 
   │            │yes                              │no──► BLOCK → escalate
   │            │                                 │yes─► allow (flagged as investment)
   ▼            ▼
 APPROVE spend; record against brand budget
```

**Hard rule:** no decision may knowingly produce negative unit economics without explicit CEO approval framed as an investment with a defined payback.

### 4.2 Approve Budgets

Budgets are **allocated by the CEO** ([ExecutiveDirective](./ceo-decision-engine.md)) and **enforced by Finance**. Finance does not set budgets — it guards them.

```
CEO allocates budget/day per brand & agent
   │
   ▼
Finance enforces:
   ├─ meters spend in real time against allocation
   ├─ approves in-budget spend automatically
   ├─ blocks/holds out-of-budget spend
   └─ escalates budget-increase requests to CEO (one-way door)
```

### 4.3 Optimize Model Selection (model routing)

The single biggest lever on margin, since model/inference is the largest variable cost. Finance owns the routing recommendation; the Orchestrator applies it.

```
For each task type:
   │
   ├─ What quality bar must the output clear? (from Brand/QA gates)
   ├─ Which models meet that bar? (from configs/models)
   ├─ Of those, which has the lowest cost × latency? 
   └─ Recommend the cheapest model that meets the bar → Orchestrator

 Continuous: if a cheaper model's outputs keep passing gates, down-route.
             if a model's outputs keep failing gates, up-route (false economy).
```

Reference: [`configs/models`](../../configs/models/README.md) cost/latency tiers. This keeps margin healthy *as volume grows* — the built-in unit-economics moat in [Competitive Advantages](./competitive-advantages.md).

---

## 5. OPTIMIZE — waste detection

### 5.1 Detect Waste

Finance continuously scans for money that produces no return:

| Waste signal | Detection | Action |
|---|---|---|
| **Overpowered model** | High-cost model on a task a cheaper one passes | Recommend down-route (§4.3) |
| **Rework spend** | Repeated re-renders / gate HOLDs on a workflow | Flag to Orchestrator/CEO; the loop is burning money |
| **Zero-return assets** | Assets with cost but ~no revenue after a window | Flag brand/topic for CEO kill review |
| **Idle capacity** | Spawned agent workers with no load | Recommend scale-down |
| **Redundant generation** | Regenerating what memory already has | Flag to Memory Intelligence (reuse over regenerate) |
| **Runaway spend** | Cost accelerating faster than revenue | Burn-rate alert (§6.3) |

---

## 6. FORECAST — looking forward

### 6.1 Forecast Revenue

```
 Forecast Revenue = Σ per-stream projections
   ├─ media (Phase 1): assets/week × revenue/asset × trend factor
   ├─ back-catalog tail: affiliate + ad revenue from older assets (decaying)
   └─ SaaS (Phase 2+): MRR × (1 + net expansion) − expected churn
```

Forecasts carry confidence ranges and are labeled projections, not guarantees — consistent with the Evidence discipline.

### 6.2 Forecast Cost

```
 Forecast Cost = (planned assets × est. cost/asset from routing) 
               + fixed overhead + expected render/storage growth
```

Fed by the Orchestrator's [cost estimation](./orchestrator-brain.md#6-cost--time-estimation-planning) and historical actuals — estimate-vs-actual deltas continuously improve the model.

### 6.3 Monitor Burn Rate

```
 Burn Rate = total spend per day − autonomous revenue per day
 Runway    = available capital / burn rate     (while burn is positive)
```

```
Burn trend check:
   ├─ AGP/Day positive & rising ──► healthy; report only
   ├─ Burn rising, revenue flat ──► WARN CEO; trigger waste scan
   └─ Runway below threshold ─────► CRITICAL alert → CEO/human (immediate)
```

---

## 7. MODEL — customer economics (Phase 2+)

### 7.1 Estimate CAC

```
 CAC = total acquisition spend (period) / new paying customers (period)
```

### 7.2 Estimate Lifetime Value

```
 LTV = ARPA × gross margin × average customer lifetime (months)
     (customer lifetime ≈ 1 / monthly churn)
```

### 7.3 The LTV:CAC health rule (from [CEO Decision Engine](./ceo-decision-engine.md))

| LTV:CAC | Verdict |
|---|---|
| ≥ 3:1 | Healthy — invest in acquisition |
| 1.5:1 – 3:1 | Hold — optimize retention/onboarding to raise LTV |
| < 1.5:1 | Fix unit economics before scaling acquisition |

These activate in Phase 2 when [AMF Studio](./products.md) has external customers; in Phase 1 the "customer" is AMF's own portfolio and the relevant lens is AGP/Day per brand.

### 7.4 Recommend Pricing

Finance provides the **analysis**; the CEO **decides** pricing (a one-way door).

```
Pricing analysis inputs:
   ├─ cost-to-serve per tier (must preserve 70%+ Studio-tier margin)
   ├─ credit economics (~$0.10 sell vs ~$0.03 cost → ~70% metered margin)
   ├─ LTV:CAC by tier
   ├─ value delivered vs. tier price (from customer outcomes)
   └─ competitive positioning
        │
        ▼
   Recommendation → CEO (who owns the pricing decision)
```

Reference tiers ([Pricing](./pricing.md)): Starter $0, Creator $49, Studio $199, Agency $499, Enterprise custom. Finance never changes pricing itself.

---

## 8. REPORT — telling the truth about the numbers

### 8.1 Generate Weekly Reports

The financial section of the CEO's weekly review package (`FinanceReported` → CEO):

```
Finance Weekly — week of YYYY-MM-DD
  AGP/Day:            $X  (Δ vs last week)
  Gross margin:       XX% (blended)
  Revenue:            $X  (by stream)
  Cost:               $X  (model / render / storage / distribution)
  Cost per asset:     $X  (Δ)
  Profitable assets:  N   / total N
  Per-brand P&L:      [brand: revenue, cost, margin, AGP/Day]
  Budget adherence:   XX% (flags on overruns)
  Waste detected:     [items + $ impact]
  Burn / runway:      $X/day  |  N days
  Anomalies:          [list]
```

### 8.2 Generate Monthly Reports

A deeper cut for [Quarterly Planning](./ceo-decision-engine.md#9-quarterly-planning) inputs:

```
Finance Monthly
  ├─ Full P&L (all streams, all brands)
  ├─ Margin trend (month-over-month)
  ├─ Revenue & cost forecast vs. actual (accuracy scored)
  ├─ Unit economics: cost/asset, revenue/asset, AGP/Day trend
  ├─ LTV, CAC, LTV:CAC (Phase 2+)
  ├─ Model-routing savings realized
  ├─ Burn rate & runway
  └─ Recommendations (pricing, budget reallocation, brand invest/kill)
```

Reports are archived to [`memory/reports`](../../memory/reports/README.md); the underlying data lives in [Analytics/Performance Memory](./memory-intelligence.md).

### 8.3 Alert CEO on anomalies

Real-time, off-cycle alerts — not everything waits for the weekly report:

| Anomaly | Severity | Action |
|---|---|---|
| Brand crosses into negative AGP/Day | High | Alert CEO → invest/kill review |
| Budget cap breached | High | Block spend + alert CEO |
| Cost spike (model price change, runaway usage) | High | Alert + waste scan + routing review |
| Runway below threshold | **Critical** | Immediate CEO/human alert |
| Margin drops below floor portfolio-wide | High | Alert CEO |
| Revenue attribution gap (Analytics data quality) | Medium | Flag; report with confidence caveat |

Alerts are emitted as `EscalationRequired` events; the CEO decides, Finance never acts on strategy itself.

---

## 9. Worked example — one asset, end to end

```
Workflow w-1042 (brd-ai-tools) produces ast-000123
   │
   ▼ INGEST costs from event metadata:
       research $0.04 + script $0.03 + seo $0.01 + thumbnail $0.06
       + video render $1.90 + storage $0.02 + distribution $0.01 = $2.07 asset cost
   │
   ▼ Margin gate (pre-dispatch): est $3.10 ≤ brand budget $40/day → APPROVED
   │
   ▼ Over 30 days, Analytics attributes revenue:
       ads $2.40 + affiliate $4.10 = $6.50 lifetime (still accruing)
   │
   ▼ COMPUTE:
       Gross Profit = $6.50 − $2.07 = $4.43
       Gross Margin = 68%       ROI = 214%
       AGP/Day contribution: positive
   │
   ▼ OPTIMIZE: video render was 92% of cost →
       Finance recommends a cheaper render tier that still passes QA/Brand
   │
   ▼ REPORT: included in weekly FinanceReported → CEO
```

## 10. Failure / anomaly example

```
Cost spike: a model provider raises prices 3× overnight
   │
   ▼ Finance detects cost/asset jump in real time
   ├─ immediate anomaly alert → CEO (High)
   ├─ waste scan: which task types are now over the margin floor?
   ├─ model-routing review: re-route affected tasks to cheaper models that pass gates
   └─ if no compliant cheaper model exists → BLOCK affected spend, escalate:
         CEO decides (absorb cost as investment, pause the brand, or re-price)
```

Finance contains what it can (routing, waste scan) and escalates the strategic call (absorb / pause / re-price) to the CEO — it never makes that call itself.

---

## 11. Boundaries — what the Finance Brain never does

- **Never sets strategy or pricing** — it analyzes and recommends; the CEO decides (one-way doors).
- **Never allocates budgets** — the CEO allocates; Finance enforces.
- **Never produces or publishes content** — it measures the money around content.
- **Never overrides the Safety gate** — margin is never a reason to ship unsafe content; the safety line outranks profit ([Values](./values.md)).
- **Never hides a cost or inflates revenue** — fully-loaded costs and attributed revenue only; Evidence over Opinion.
- **Never calls an agent directly** — it consumes and emits events over the [Event Bus](../../docs/architecture/event-bus.md).

The Finance Brain is powerful over the numbers and powerless over strategy. That boundary is what makes it a trustworthy controller rather than a shadow CEO.

## Related documents

- [CEO Decision Engine](./ceo-decision-engine.md) — receives Finance's reports and makes the money decisions
- [Orchestrator Brain](./orchestrator-brain.md) — applies Finance's routing and obeys the Margin gate
- [North Star Metric](./north-star-metric.md) — AGP/Day, the number Finance computes and protects
- [Revenue Model](./revenue-model.md) · [Pricing](./pricing.md) · [Business Model](./business-model.md)
- [KPIs](./kpis.md) — the financial KPIs Finance owns
- [Finance agent contract](../../packages/agents/finance/README.md) — the agent this brain animates
- [Decision Framework](./decision-framework.md) — the Margin gate this brain owns
