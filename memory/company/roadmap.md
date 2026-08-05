# Roadmap

> Part of the [Company Brain](./company.md). This roadmap ties AI Media Factory's three business phases to its four execution sprints and to concrete time horizons. Read alongside [Goals](./goals.md) and the [North Star Metric](./north-star-metric.md).

AI Media Factory (AMF) grows in three business phases — **Owned & Operated -> Platform/SaaS -> Marketplace & Enterprise** (see [Business Model](./business-model.md)). Execution is organized into four sprints defined in [docs/sprints](../../docs/sprints/). This document connects them so every agent knows where the company is and what comes next.

All financial and metric figures below are **illustrative targets**, not guarantees. They describe the intended shape of progress.

---

## At a glance

| Horizon | Phase | Sprint | Objective | North Star posture |
|---|---|---|---|---|
| 0-3 months | Phase 1 begins | [Sprint-001 First Dollar](../../docs/sprints/) | Ship the pipeline; earn the first autonomous dollar | AGP/Day crosses $0 on one brand |
| 3-12 months | Phase 1 matures | [Sprint-002 Scale](../../docs/sprints/) | Make one brand reliably profitable and repeatable | AGP/Day tens of dollars/day |
| 12-24 months | Phase 1 -> Phase 2 | [Sprint-003 Multi-Brand](../../docs/sprints/) | Run a portfolio; launch AMF Studio SaaS | AGP/Day hundreds/day; MRR begins |
| 3-5 years | Phase 3 | [Sprint-004 Full Autonomy](../../docs/sprints/) | Self-running company + marketplace at scale | AGP/Day thousands+/day; $100M ARR path |

---

## Stage 1 — First Dollar (0-3 months)

**Business phase:** Phase 1 (Owned & Operated) — kickoff. See [Sprint-001](../../docs/sprints/).

- **Objective:** Prove the machine can produce and publish a real, profitable asset with minimal human input.
- **Key deliverables:**
  - End-to-end [content pipeline](./mission.md) running: Idea -> Research -> Script -> SEO -> Thumbnail -> Video -> Publishing -> Analytics -> CEO Review.
  - One owned faceless media brand live on at least one platform (YouTube or TikTok).
  - [Finance agent](../../packages/agents/finance/README.md) tracking cost per asset; [Analytics agent](../../packages/agents/analytics/README.md) tracking revenue per asset.
- **Agents online:** CEO, Orchestrator, Research, Writer, SEO, Thumbnail, Video, Publisher, Analytics, Finance.
- **Products:** [AMF Core](./products.md) (internal), first entry in the [AMF Brand Portfolio](./products.md).
- **Success criteria:** First monetized asset published; AGP/Day reaches its first positive day; autonomy rate 40-60%.
- **Primary risks:** pipeline reliability, brand-safety on first outputs. Mitigations in [Decision Framework](./decision-framework.md).

## Stage 2 — Scale (3-12 months)

**Business phase:** Phase 1 (Owned & Operated) — maturity. See [Sprint-002](../../docs/sprints/).

- **Objective:** Turn a one-off profitable asset into a repeatable, reliably profitable brand.
- **Key deliverables:**
  - Consistent publishing cadence on one brand across multiple platforms.
  - [Growth agent](../../packages/agents/growth/README.md) running [experiments](../../experiments/README.md) on hooks, titles, thumbnails.
  - Winning tactics promoted into [playbooks](../../playbooks/README.md); lessons captured in [knowledge/lessons](../../knowledge/lessons/README.md).
  - Model-cost discipline via [model routing](../../configs/models/README.md).
- **Agents online:** adds Growth as a first-class driver; all others deepen.
- **Success criteria:** Positive gross margin sustained; AGP/Day in tens of dollars/day; autonomy rate 60-75%; publish success rate high and stable.
- **Primary risks:** quality drift at higher volume, platform dependency. Diversify platforms.

## Stage 3 — Multi-Brand + Studio (12-24 months)

**Business phase:** Phase 1 -> Phase 2 (Platform/SaaS). See [Sprint-003](../../docs/sprints/).

- **Objective:** Operate a portfolio of profitable brands, and package the engine as a product.
- **Key deliverables:**
  - 10+ owned brands running in parallel across niches, governed by the CEO's portfolio decisions.
  - Multi-brand orchestration proven (parallel, isolated workflows).
  - **AMF Studio** SaaS launched ([apps/web](../../apps/web)) — external customers begin (see [Customer Personas](./customer-personas.md)).
  - [Pricing](./pricing.md) tiers live; MRR/ARR tracking begins in [KPIs](./kpis.md).
- **Products:** [AMF Studio](./products.md), [Template & Playbook Library](./products.md).
- **Success criteria:** AGP/Day in hundreds/day; first SaaS MRR; autonomy rate 75-90%; LTV:CAC trending toward 3:1.
- **Primary risks:** concentration risk across brands; supporting external customers while running owned brands. The [Finance agent](../../packages/agents/finance/README.md) guards blended unit economics.

## Stage 4 — Full Autonomy + Marketplace (3-5 years)

**Business phase:** Phase 3 (Marketplace & Enterprise). See [Sprint-004](../../docs/sprints/).

- **Objective:** A largely self-running company that also powers others.
- **Key deliverables:**
  - 100+ autonomous brands; the company launches, grows, and retires brands with minimal human input.
  - **Agent Marketplace** and **AMF API & MCP Tools** live (marketplace take rate + usage-based billing — see [Revenue Model](./revenue-model.md)).
  - Enterprise managed-brand licensing.
  - The [Company Brain](./company.md) and [knowledge base](../../knowledge/README.md) function as a mature self-learning flywheel.
- **Success criteria:** AGP/Day in thousands/day and rising; a credible path to $100M ARR and a billion-dollar valuation; autonomy rate > 90%.
- **Primary risks:** scaling governance and safety across a large autonomous fleet; managed via the [Decision Framework](./decision-framework.md) gates and [monitoring](../../infra/monitoring/README.md).

---

## How the roadmap is governed

The roadmap is not static. Each week the [CEO / Executive Brain](../../packages/agents/ceo/README.md) reviews the [North Star](./north-star-metric.md) and [KPIs](./kpis.md), and may re-sequence work, invest in a winning brand, cut a losing one, or "hire" a new agent type. Every such change is recorded per the [Decision Framework](./decision-framework.md) and reflected in the [sprints](../../docs/sprints/).

## Related documents

- [Goals](./goals.md) — the targets behind each stage
- [Business Model](./business-model.md) — the three phases in depth
- [Products](./products.md) — what comes online when
- [Vision](./vision.md) — the destination this roadmap heads toward
- [North Star Metric](./north-star-metric.md) — how progress is measured
