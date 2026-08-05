# North Star Metric

> Part of the [Company Brain](./company.md). This is the single metric AI Media Factory optimizes above all others.

## The metric

**Autonomous Gross Profit per Day (AGP/Day)** — the gross profit AI Media Factory (AMF) generates per day that requires **no human intervention**.

AGP/Day is deliberately chosen because it fuses the two things that define this company: **profit** (we are a business first — see [Values](./values.md)) and **autonomy** (the product is an autonomous company, not a human team with AI helpers). A metric that rewarded revenue alone would let costs run wild; a metric that rewarded autonomy alone would let us automate unprofitable work. AGP/Day only goes up when the machine makes money **and** does it by itself.

---

## The formula

```
AGP/Day = (Autonomous Gross Profit over period) / (days in period)

where, per published asset:
  Gross Profit per Asset = Revenue per Asset - Cost per Asset

and:
  Autonomous Gross Profit = sum of Gross Profit across assets,
                            weighted by Autonomy Rate
```

Expanded into its drivers:

```
AGP/Day ≈ (Profitable Assets per Day)
          x (Revenue per Asset - Cost per Asset)
          x (Autonomy Rate)
```

Where:

- **Profitable Assets per Day** — throughput of published assets that clear a positive margin. Driven mainly by the production pipeline and the [Orchestrator](../../packages/agents/orchestrator/README.md).
- **Revenue per Asset** — average monetized value of an asset across its lifetime (ads, sponsorship, affiliate, product pull-through). See [Revenue Model](./revenue-model.md).
- **Cost per Asset** — fully-loaded cost to produce and publish (model/API, render/compute, storage, distribution). Guarded by the [Finance agent](../../packages/agents/finance/README.md).
- **Autonomy Rate** — the share of workflow steps completed with **no human involvement**, from `0.0` to `1.0`. Measured across the [content pipeline](./mission.md) events.

---

## Why this metric (and not the obvious alternatives)

| Candidate | Why it is rejected as the North Star |
|---|---|
| Revenue | Ignores cost; can be "bought" with unprofitable spend |
| Views / reach | Vanity; does not pay the bills and can be gamed |
| Number of videos published | Rewards volume over quality and profit |
| Gross profit (only) | Does not reward removing humans from the loop — the core product thesis |
| Autonomy rate (only) | Rewards automating even worthless work |

AGP/Day is the smallest metric that cannot be gamed without actually building the company we intend to build.

---

## How each agent influences the North Star

Every agent's own [KPIs](./kpis.md) roll up into AGP/Day. This is how *Ownership & Accountability* becomes concrete.

| Agent | Primary lever on AGP/Day |
|---|---|
| [CEO / Executive Brain](../../packages/agents/ceo/README.md) | Chooses brands/niches with the best profit potential; kills losers |
| [Orchestrator](../../packages/agents/orchestrator/README.md) | Raises throughput and autonomy rate via reliable, retrying execution |
| [Research](../../packages/agents/research/README.md) | Picks high-demand topics -> higher revenue per asset |
| [Writer](../../packages/agents/writer/README.md) | Quality scripts -> retention -> revenue per asset |
| [SEO](../../packages/agents/seo/README.md) | Discoverability -> more views per asset -> revenue per asset |
| [Thumbnail](../../packages/agents/thumbnail/README.md) | Click-through rate -> revenue per asset |
| [Video](../../packages/agents/video/README.md) | Watch time and quality -> revenue per asset; render cost -> cost per asset |
| [Publisher](../../packages/agents/publisher/README.md) | Publish success + cadence -> profitable assets per day |
| [Analytics](../../packages/agents/analytics/README.md) | Measures every term above; feeds learning loop |
| [Finance](../../packages/agents/finance/README.md) | Drives cost per asset down; protects margin |
| [Growth](../../packages/agents/growth/README.md) | Lifts revenue per asset and reach through experiments |

---

## Healthy target ranges by phase

These are **illustrative targets**, not guarantees. They express the shape of progress, not a promise.

| Phase | Stage | Autonomy Rate | AGP/Day (illustrative) | Meaning |
|---|---|---|---|---|
| Pre-1 | Before first dollar | < 40% | ~ $0 (often negative) | Building the pipeline; cost > revenue |
| Phase 1 | [First Dollar](../../docs/sprints/) | 40-60% | First positive days | One brand clears positive daily gross profit |
| Phase 1->2 | [Scale](../../docs/sprints/) | 60-75% | Tens of dollars/day | Repeatable profit on a single brand |
| Phase 2 | [Multi-Brand](../../docs/sprints/) + SaaS | 75-90% | Hundreds/day | Portfolio + platform compounding |
| Phase 3 | [Full Autonomy](../../docs/sprints/) + marketplace | > 90% | Thousands/day and up | Self-running company at scale |

The trajectory of these ranges maps to the company [Roadmap](./roadmap.md) and [Goals](./goals.md).

---

## Anti-gaming guardrails

Optimizing a single number invites shortcuts. These guardrails are non-negotiable and enforced by the [Decision Framework](./decision-framework.md) Safety gate:

1. **Brand safety and compliance cannot be traded for profit.** An asset that fails the Safety gate does not count, no matter how profitable. See [Brand Guidelines](./brand-guidelines.md).
2. **Quality floor.** Assets below the quality bar are not counted as "profitable assets," even if they briefly earn revenue. Quality is monitored by [Analytics](../../packages/agents/analytics/README.md) and agent `tests/` evals.
3. **Autonomy must be real.** Steps that are nominally automated but routinely produce escalations or rework do not count toward Autonomy Rate.
4. **No cost hiding.** Cost per Asset must be fully loaded (model, render, storage, distribution). The [Finance agent](../../packages/agents/finance/README.md) owns this definition.
5. **Sustainable revenue only.** Revenue that damages long-term brand equity (spam, misleading content) is excluded.

---

## How it rolls up into the CEO weekly review

Each week the [CEO / Executive Brain](../../packages/agents/ceo/README.md) reviews AGP/Day and its drivers, produces the executive report (archived in [memory/reports](../reports/README.md)), and adjusts strategy: where to invest, which brands to grow or cut, whether to "hire" a new agent, and which risks to act on. AGP/Day is the number that opens that report.

---

## Related documents

- [KPIs](./kpis.md) — the full metric tree beneath the North Star
- [Decision Framework](./decision-framework.md) — how the North Star gates decisions
- [Goals](./goals.md) — targets expressed against this metric
- [Revenue Model](./revenue-model.md) — the revenue side of the equation
- [Roadmap](./roadmap.md) — how the targets evolve over time
