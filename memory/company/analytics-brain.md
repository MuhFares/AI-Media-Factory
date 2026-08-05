# Analytics Brain

> Architecture specification for the measurement layer of AI Media Factory (AMF). No application code. This is the sensory system of the autonomous company: it measures everything that happens, turns raw signal into insight, predicts what will win and fail, and feeds decisions to every other brain and agent. It implements the runtime brain of the [Analytics agent](../../packages/agents/analytics/README.md) and closes the loop the [Orchestrator Brain](./orchestrator-brain.md) opens.

## 0. Core principle

You cannot improve what you do not measure, and an autonomous company that cannot see itself is flying blind. The Analytics Brain is AMF's eyes. It observes every workflow, agent, and asset; attributes outcomes to causes; and converts that into insight that raises the [North Star](./north-star-metric.md) — AGP/Day. It is the *measure* step of the flywheel (**produce → publish → measure → learn → improve**), and the primary supplier of evidence for the [Evidence gate](./decision-framework.md).

The Analytics Brain has one rule above all: **report the truth, even when it is unwelcome.** It never flatters a failing brand or inflates a metric. Evidence over Opinion ([Values](./values.md)) begins here.

```
   every event ─────►  ANALYTICS BRAIN  ─────► insights + predictions
   (the whole bus)          │                        │
                            ▼                        ▼
              measure · attribute · detect     feed CEO · Finance · Growth
              predict · recommend              + every production agent
```

---

## 1. Responsibilities map

The 20 required capabilities, grouped by function.

| Group | Capabilities |
|---|---|
| **Measure** | Measure Workflow · Measure Agent · Measure Quality · Measure Publishing · Measure Revenue · Measure Engagement · Measure Conversion |
| **Interpret** | Detect Anomalies · Generate Insights · Recommend Optimizations |
| **Predict** | Predict Winners · Predict Failures |
| **Report** | Generate Executive Dashboards |
| **Feed** | Feed CEO · Finance · Growth · Research · Writer · SEO · Thumbnail · Video |

---

## 2. The Analytics Brain's mental model

```
                     ┌──────────────────────────────────────────────┐
  all events ───────►│              ANALYTICS BRAIN                  │
  platform data ────►│                                              │
                     │  1. COLLECT    ingest events + platform data  │
                     │        │                                      │
                     │        ▼                                      │
                     │  2. ATTRIBUTE  outcome → asset → agent → cause│
                     │        │                                      │
                     │        ▼                                      │
                     │  3. MEASURE    workflow/agent/quality/rev/eng │
                     │        │                                      │
                     │        ▼                                      │
                     │  4. DETECT     anomalies vs. baselines        │
                     │        │                                      │
                     │        ▼                                      │
                     │  5. PREDICT    winners / failures             │
                     │        │                                      │
                     │        ▼                                      │
                     │  6. FEED       insights → each consumer        │
                     └──────────────────────────────────────────────┘
                              │                        │
                              ▼                        ▼
                    AnalyticsReported → Finance/Growth   lessons → Memory Intelligence
                              └──────────► CEO dashboard ◄──────────┘
```

---

## 3. MEASURE — the metric catalogue

### 3.1 Measure every workflow

For each `workflow_id` (via [Event Bus](../../docs/architecture/event-bus.md) events):

| Metric | Meaning |
|---|---|
| Cycle time (Idea→Publish) | Wall-clock from start to `PublishingFinished` |
| Stage latencies | Time in each state (find the bottleneck) |
| Rework loops | QA/Brand HOLD regressions |
| Success / failure / dead-letter | Terminal outcome |
| Cost per workflow | From `metadata.cost_usd` (shared with [Finance Brain](./finance-brain.md)) |
| Autonomy rate | Steps with no human touch |

### 3.2 Measure every agent

Per-agent performance against its owned [KPIs](./kpis.md):

| Agent | Measured on |
|---|---|
| Research | Topic acceptance rate, downstream asset performance, trend freshness |
| Writer | Script quality score, retention of its scripts |
| SEO | Impressions, ranking, click-through from search |
| Thumbnail | CTR |
| Video | Watch time, render cost/min, render success |
| Publisher | Publish success rate, time-to-publish |
| QA / Brand | Defect-escape rate, false-hold rate, brand-safety incidents |
| Finance | Cost/asset accuracy, budget adherence |
| Growth | Experiment win rate, lift delivered |
| Orchestrator | Autonomy rate, recovery rate, throughput |

### 3.3 Measure quality

| Signal | Source |
|---|---|
| Retention / watch-through | Platform data |
| QA defect-escape rate | QA gate events |
| Brand-safety incidents | Brand gate events (target: zero) |
| Voice-conformance score | Brand gate |
| Composite Quality Score | Weighted blend, guards against quality drift |

### 3.4 Measure publishing

Publish success rate, time-to-publish, per-platform reach, schedule adherence, partial-publish/failure rate — from `PublishingFinished` events.

### 3.5 Measure revenue

Per asset / brand / stream / platform, attributed over the asset's life; handed to the [Finance Brain](./finance-brain.md) for the P&L. Streams per the [Revenue Model](./revenue-model.md).

### 3.6 Measure engagement

Views, watch time, retention curve, likes, shares, comments, saves, follows/subscribes gained per asset — the leading indicators of revenue.

### 3.7 Measure conversion

Click-through (thumbnail/title), affiliate click→sale, subscribe rate, and (Phase 2+) trial→paid and free→upgrade — the bridge from engagement to money.

---

## 4. ATTRIBUTION — the hard part

Measurement without attribution is trivia. The Analytics Brain's value is connecting an **outcome** to its **cause**.

```
 Outcome (e.g. retention 58%, +12% over brand avg)
     │
     ├─ which asset?         ast-000123
     ├─ which agents' work?  writer(hook), thumbnail(CTR), video(pacing)
     ├─ which choices?       4s hook, question-title, fast-cut edit
     ├─ which topic/brand?   AI tools / brd-ai-tools
     └─ which experiment?    exp-233 (if part of one)
          │
          ▼
     write attributed result → feeds Memory Intelligence lesson engine
```

Attribution rules:
- **Coverage threshold:** if attribution confidence is low (data gaps), the result is reported *with a caveat*, never as fact.
- **No false precision:** correlation is labeled as such; causal claims require an experiment (Evidence gate).
- **Multi-touch:** credit is shared across contributing agents, not assigned to one.

---

## 5. DETECT — anomalies

The Analytics Brain compares live metrics to baselines and flags deviations.

```
Metric arrives
   │
   ├─ Within expected band vs. baseline? ──yes──► record, no alert
   │            │no
   ├─ Is it a known seasonal/trend pattern? ──yes──► annotate, no alert
   │            │no
   ├─ Positive anomaly (breakout winner)? ──yes──► flag opportunity → Growth/CEO
   │            │no
   └─ Negative anomaly (drop/spike) ──► severity? ──► alert the right consumer
                                          ├─ revenue/cost → Finance/CEO
                                          ├─ quality/safety → CEO/Brand
                                          └─ engagement → Growth
```

| Anomaly type | Example | Routed to |
|---|---|---|
| Breakout winner | An asset far outperforms | Growth (double down), CEO |
| Performance collapse | Retention or CTR craters | Growth, responsible agent |
| Quality drift | Quality Score trending down | CEO, all agents |
| Safety incident | Brand-safety flag | CEO/human (critical) |
| Revenue/cost anomaly | RPM drop, cost spike | Finance/CEO |
| Data-quality gap | Attribution coverage falls | Flag; report with caveat |

---

## 6. PREDICT — winners and failures

Prediction is what makes analytics proactive instead of a rear-view mirror.

### 6.1 Predict Winners

```
Early signals (first hours/days of an asset):
   ├─ early CTR vs. brand baseline
   ├─ early retention curve shape
   ├─ velocity of engagement
   └─ similarity to past winners (via Memory Intelligence graph)
        │
        ▼
   High win-probability → recommend: amplify, make variants, feed Growth
```

### 6.2 Predict Failures

```
Warning signals:
   ├─ early retention collapse / high bounce
   ├─ CTR far below baseline
   ├─ topic decay (Trend Memory says the wave has passed)
   └─ cost trajectory outrunning projected revenue
        │
        ▼
   High fail-probability → recommend: cut losses, stop amplifying, alert CEO/Finance
```

Predictions carry confidence scores and improve over time as outcomes validate them (the learning loop with [Memory Intelligence](./memory-intelligence.md)).

---

## 7. INTERPRET — insights and optimizations

### 7.1 Generate Insights

An insight is not a number; it is a **number with a "so what."**

```
 raw metric ("CTR 9%") 
   → contextualized ("CTR 9% is +50% vs brand avg, driven by question-titles")
   → actionable insight ("question-titles lift CTR on this brand; apply to next 5 assets")
```

Insights are written to [Memory Intelligence](./memory-intelligence.md) as candidate lessons and to [`knowledge/`](../../knowledge/README.md).

### 7.2 Recommend Optimizations

Each recommendation names the metric it moves, the agent that acts, and the expected lift — so the CEO can RICE-score it and the Orchestrator can route it.

| Recommendation | Target agent | Metric moved |
|---|---|---|
| Use shorter hooks | Writer | Retention |
| Test question-titles | SEO | CTR |
| Higher-contrast thumbnails | Thumbnail | CTR |
| Tighter pacing | Video | Watch time |
| Post at time X | Publisher | Reach |
| Shift topic mix toward niche Y | Research | Revenue/asset |

---

## 8. REPORT — the executive dashboard

### 8.1 Generate Executive Dashboards

The single pane the CEO reads each week — the same metrics as the [CEO Decision Engine dashboard](./ceo-decision-engine.md), sourced here:

```
AMF Executive Dashboard — week of YYYY-MM-DD
  NORTH STAR
    AGP/Day .................. $X  (Δ, trend)
  DRIVERS
    Profitable assets/week ... N   (Δ)
    Revenue per asset ........ $X  (Δ)
    Cost per asset ........... $X  (Δ)   [with Finance]
    Autonomy rate ............ XX% (Δ)   [with Orchestrator]
  QUALITY & SAFETY
    Quality Score ............ X   | Brand-safety incidents: 0
  FUNNEL
    Impressions → CTR → Watch → Conversion → Revenue
  PER-BRAND
    [brand: AGP/Day, engagement, top asset, trend]
  SIGNALS
    Predicted winners: [...]   Predicted failures: [...]
    Anomalies: [...]           Top insights: [...]
```

Dashboards are archived to [`memory/reports`](../../memory/reports/README.md); raw data lives in [Analytics/Performance Memory](./memory-intelligence.md) and [`data/analytics`](../../data/analytics/README.md).

---

## 9. FEED — the distribution model

The Analytics Brain is a hub: it feeds a **tailored** view to each consumer, not the same firehose to everyone. Everything flows as events over the [Event Bus](../../docs/architecture/event-bus.md) — no direct calls.

| Consumer | What Analytics feeds it | So it can |
|---|---|---|
| **CEO** | Executive dashboard, AGP/Day, anomalies, predictions | Decide, prioritize, allocate (via `AnalyticsReported`-informed review) |
| **Finance** | Attributed revenue per asset/brand/stream (`AnalyticsReported`) | Compute P&L, margin, ROI, AGP/Day |
| **Growth** | Experiment results, winners, engagement patterns (`AnalyticsReported`) | Design experiments, scale winners |
| **Research** | Topic performance, trend/demand signals | Pick higher-demand topics |
| **Writer** | Which hooks/structures retained audiences | Write higher-retention scripts |
| **SEO** | Which titles/keywords ranked and converted | Optimize discoverability |
| **Thumbnail** | Which thumbnails earned clicks (CTR) | Design higher-CTR thumbnails |
| **Video** | Which pacing/length held watch time | Edit for retention |

### 9.1 The feed diagram

```
                              ┌───────────────┐
                              │ ANALYTICS BRAIN│
                              └──────┬────────┘
        ┌──────────┬──────────┬──────┼──────┬──────────┬──────────┬─────────┐
        ▼          ▼          ▼      ▼      ▼          ▼          ▼         ▼
      CEO       Finance    Growth  Research Writer    SEO      Thumbnail  Video
   (dashboard)  (revenue)  (exp.)  (topics) (hooks)  (titles)  (CTR)    (pacing)
        │          │          │                                            
        └── decide ┴─ money ──┴─ scale winners      └──── production agents improve ────┘
```

Each production agent retrieves its Analytics feed **before it acts** (via [Memory Intelligence](./memory-intelligence.md) retrieval), so measurement from the last cycle shapes the next — the flywheel closing.

---

## 10. Worked example — one asset, measured end to end

```
ast-000123 (brd-ai-tools) publishes
   │
   ▼ COLLECT: PublishingFinished + platform data streaming in
   │
   ▼ MEASURE: CTR 9%, retention 58%, watch 6m, 40 affiliate clicks, $6.50 revenue
   │
   ▼ ATTRIBUTE: retention lift → 4s hook (writer) + fast pacing (video)
   │            CTR lift → question-title (seo) + high-contrast thumb (thumbnail)
   │
   ▼ DETECT: retention +12% over baseline = positive anomaly
   │
   ▼ PREDICT: early signals → high win-probability → recommend variants
   │
   ▼ INSIGHT: "short hooks + question-titles lift this brand" → candidate lesson
   │
   ▼ FEED:
       CEO ← dashboard entry (a winner)
       Finance ← $6.50 attributed revenue
       Growth ← make 3 variants; scale
       Writer ← keep 4s hooks
       SEO ← keep question-titles
       Thumbnail ← keep high-contrast
       Video ← keep fast pacing
   │
   ▼ Memory Intelligence: lesson stored, confidence rises → next asset opens smarter
```

## 11. Anomaly example

```
RPM on brd-finance-explainers drops 40% overnight
   │
   ▼ DETECT: negative revenue anomaly, not seasonal
   ├─ attribute: platform-wide ad-rate change (affects all, not just us)
   ├─ FEED Finance + CEO immediately (High severity anomaly)
   ├─ INSIGHT: "diversify beyond ad revenue on this brand" (platform-dependency risk)
   └─ RECOMMEND: shift monetization mix toward affiliate/sponsorship → Growth/CEO
```

Analytics reports the truth (revenue dropped, here's why) and recommends — the CEO decides the response. Analytics never makes the strategic call.

---

## 12. Boundaries — what the Analytics Brain never does

- **Never sets strategy or makes decisions** — it measures, interprets, predicts, and recommends; the CEO decides.
- **Never produces or publishes content** — it measures what others produce.
- **Never inflates a metric or flatters a failing brand** — truth over comfort; a failing number is reported plainly.
- **Never claims causation without evidence** — correlation is labeled; causal claims need an experiment (Evidence gate).
- **Never overrides gates or budgets** — it informs QA/Brand/Finance, it does not act for them.
- **Never calls an agent directly** — all feeds are events over the [Event Bus](../../docs/architecture/event-bus.md).

The Analytics Brain is the most-listened-to voice in the company and the one with no executive power — by design. It tells everyone the truth; others decide what to do about it.

## Related documents

- [CEO Decision Engine](./ceo-decision-engine.md) — the primary consumer of Analytics dashboards
- [Finance Brain](./finance-brain.md) — receives attributed revenue; shares cost data
- [Orchestrator Brain](./orchestrator-brain.md) — supplies workflow/autonomy telemetry Analytics measures
- [Memory Intelligence](./memory-intelligence.md) — turns Analytics insights into durable lessons
- [North Star Metric](./north-star-metric.md) · [KPIs](./kpis.md) — the metrics Analytics computes
- [Analytics agent contract](../../packages/agents/analytics/README.md) — the agent this brain animates
- [Event Bus](../../docs/architecture/event-bus.md) — how Analytics ingests and feeds
