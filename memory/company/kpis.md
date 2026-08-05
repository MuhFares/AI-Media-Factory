# KPIs

> Part of the [Company Brain](./company.md). This document defines the full KPI tree for AI Media Factory (AMF) and maps every agent to the metrics it owns.

KPIs exist to make our [Values](./values.md) measurable and to connect every agent's daily work to the [North Star Metric](./north-star-metric.md). A KPI that does not, directly or indirectly, move Autonomous Gross Profit per Day (AGP/Day) is not a KPI we track.

---

## The KPI tree

```
                    NORTH STAR
              Autonomous Gross Profit / Day
                        |
        ┌───────────────┼────────────────┐
     PROFIT          THROUGHPUT        AUTONOMY
   (margin side)   (volume side)     (self-running)
        |               |                 |
  Revenue/Asset   Profitable         Autonomy Rate
  Cost/Asset      Assets/Week        Escalations/Run
  Gross Margin    Publish Success    Recovery Rate
        |
   BUSINESS (Phase 2+)
   MRR/ARR, CAC, LTV, LTV:CAC, Churn, NRR
```

Everything below the North Star is a **driver**. The three primary branches — Profit, Throughput, Autonomy — are exactly the three factors in the [AGP/Day formula](./north-star-metric.md).

---

## Company-level KPIs

### Profit & unit economics (owned by [Finance](../../packages/agents/finance/README.md))

| KPI | What it measures | Why it matters | How measured |
|---|---|---|---|
| **Revenue per Asset** | Lifetime monetized value of a published asset | The revenue side of the North Star | Total attributed revenue / assets, via [Analytics](../../packages/agents/analytics/README.md) |
| **Cost per Asset** | Fully-loaded production + publish cost | The cost side of the North Star | Model/API + render + storage + distribution spend / assets |
| **Gross Margin** | (Revenue - Cost) / Revenue | Are we actually profitable per unit | Finance ledger |
| **Contribution Margin** | Margin after variable costs per brand | Which brands deserve more investment | Per-brand P&L |

### Throughput & quality (owned by [Orchestrator](../../packages/agents/orchestrator/README.md) + production agents)

| KPI | What it measures | Why it matters | How measured |
|---|---|---|---|
| **Profitable Assets per Week** | Count of assets clearing positive margin | Core throughput driver | Analytics + Finance |
| **Publish Success Rate** | % of started workflows that publish successfully | Pipeline reliability | [Publisher](../../packages/agents/publisher/README.md) + workflow logs |
| **Cycle Time (Idea->Publish)** | Time from idea to live asset | Speed to value | Workflow event timestamps |
| **Quality Score** | Composite of retention, brand-safety, SEO, editorial bar | Guards against quality drift | Analytics + agent `tests/` evals |

### Autonomy & reliability (owned by [Orchestrator](../../packages/agents/orchestrator/README.md))

| KPI | What it measures | Why it matters | How measured |
|---|---|---|---|
| **Autonomy Rate** | % of workflow steps completed with no human | The autonomy side of the North Star | Human-touch flags on pipeline events |
| **Escalations per Run** | Number of human escalations per workflow | Lower = more autonomous | Orchestrator logs |
| **Recovery Rate** | % of transient failures auto-recovered | Resilience of the event bus | Retry/dead-letter stats ([logs/errors](../../logs/errors/README.md)) |

### Business KPIs (activate in Phase 2+ — SaaS; see [Business Model](./business-model.md))

| KPI | Definition | Target posture |
|---|---|---|
| **MRR / ARR** | Monthly / annual recurring revenue | Primary Phase 2 growth metric |
| **CAC** | Customer acquisition cost | Kept below 1/3 of LTV |
| **LTV** | Lifetime value of a customer | Grow via retention and expansion |
| **LTV:CAC** | Ratio of value to acquisition cost | Target >= 3:1 |
| **Gross Churn / NRR** | Logo churn / net revenue retention | NRR target > 100% (expansion) |
| **ARPA** | Average revenue per account | Rises as accounts adopt higher [tiers](./pricing.md) |

---

## Per-agent KPI ownership

Each agent owns a small set of KPIs. This table is the accountability contract; agent detail lives in each agent's README.

| Agent | Primary KPIs | Rolls up to |
|---|---|---|
| [CEO / Executive Brain](../../packages/agents/ceo/README.md) | Portfolio ROI, decision quality, strategy-to-execution alignment | AGP/Day (all branches) |
| [Orchestrator](../../packages/agents/orchestrator/README.md) | Autonomy Rate, Publish Success Rate, Recovery Rate, Cycle Time | Throughput + Autonomy |
| [Research](../../packages/agents/research/README.md) | Topic acceptance rate, downstream asset performance, trend freshness | Revenue per Asset |
| [Writer](../../packages/agents/writer/README.md) | Script quality score, audience retention | Revenue per Asset |
| [SEO](../../packages/agents/seo/README.md) | Impressions, ranking/discoverability, click-through from search | Revenue per Asset |
| [Thumbnail](../../packages/agents/thumbnail/README.md) | Click-through rate (CTR) | Revenue per Asset |
| [Video](../../packages/agents/video/README.md) | Watch time, render cost per minute, render success rate | Revenue + Cost per Asset |
| [Publisher](../../packages/agents/publisher/README.md) | Publish success rate, time-to-publish, platform reach | Throughput |
| [Analytics](../../packages/agents/analytics/README.md) | Data freshness, attribution coverage, insight accuracy | Measures all KPIs |
| [Finance](../../packages/agents/finance/README.md) | Cost per Asset, Gross Margin, budget adherence, revenue-per-video | Profit |
| [Growth](../../packages/agents/growth/README.md) | Follower/subscriber growth, retention, viral coefficient, experiment win rate | Revenue per Asset + reach |

---

## Reporting cadence

- **Real-time / per-run** — Autonomy, Publish Success, Recovery, cost per run (Orchestrator + Analytics dashboards; see [infra/monitoring](../../infra/monitoring/README.md)).
- **Weekly** — Full KPI tree in the CEO executive report, archived in [memory/reports](../reports/README.md). This is where the [Decision Framework](./decision-framework.md) is applied to reallocate effort.
- **Per phase / sprint** — KPI targets reviewed against the [Roadmap](./roadmap.md) and [Goals](./goals.md), tied to the [sprints](../../docs/sprints/).

## Guardrail KPIs (must never be sacrificed)

Per the North Star [anti-gaming rules](./north-star-metric.md), these have hard floors regardless of profit: **Brand-Safety Incident Rate** (target: zero), **Compliance Violations** (target: zero), and **Quality Score** (must stay above the [Brand Guidelines](./brand-guidelines.md) floor). A gain in any profit KPI that breaches these is treated as a loss.

---

## Related documents

- [North Star Metric](./north-star-metric.md) — the apex the tree rolls up to
- [Revenue Model](./revenue-model.md) — how revenue KPIs are generated
- [Decision Framework](./decision-framework.md) — how KPIs gate decisions
- [Roadmap](./roadmap.md) — how KPI targets change by phase
