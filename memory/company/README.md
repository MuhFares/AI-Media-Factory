# Company Brain

This folder is the **permanent source of truth** for AI Media Factory (AMF). It is the institutional brain of the company — the business knowledge that every AI agent must read and honor before making or executing a decision.

Unlike the rest of `memory/` (which holds runtime-generated, git-ignored state), the Company Brain is **version-controlled documentation**. It changes deliberately, through reviewed edits, not as a byproduct of a workflow run.

## The reading protocol

Every agent — and every future agent — follows this protocol before acting:

1. Read [company.md](./company.md) for who we are and how the Brain fits together.
2. Read the [Values](./values.md) and [Decision Framework](./decision-framework.md) — these govern *how* to decide.
3. Confirm the action serves the [North Star Metric](./north-star-metric.md).
4. Consult the documents relevant to the task (below).

## Document index

### Identity & direction
- [company.md](./company.md) — master overview of AMF and the Company Brain
- [vision.md](./vision.md) — the long-term future we are building
- [mission.md](./mission.md) — what we do day to day to get there
- [values.md](./values.md) — the eight core principles
- [goals.md](./goals.md) — long-, mid-, and short-term goals mapped to sprints

### Business & money
- [business-model.md](./business-model.md) — the three-phase model and business canvas
- [revenue-model.md](./revenue-model.md) — the eight revenue streams and path to $100M ARR
- [products.md](./products.md) — the six products and how they map to the repo
- [pricing.md](./pricing.md) — tiers, credits, and margin rationale

### Market & customers & brand
- [customer-personas.md](./customer-personas.md) — the five target personas
- [target-market.md](./target-market.md) — TAM/SAM/SOM and go-to-market
- [competitive-advantages.md](./competitive-advantages.md) — the six moats and the flywheel
- [brand-guidelines.md](./brand-guidelines.md) — voice, quality bar, and visual identity

### Governance & metrics
- [decision-framework.md](./decision-framework.md) — decision rules, gates, and risk management
- [north-star-metric.md](./north-star-metric.md) — Autonomous Gross Profit per Day (AGP/Day)
- [kpis.md](./kpis.md) — the full KPI tree and per-agent ownership
- [roadmap.md](./roadmap.md) — phases, sprints, and time horizons

### Reference
- [glossary.md](./glossary.md) — shared vocabulary for every term used above

## How the Company Brain connects to the rest of the repo

- **Agents** ([../../packages/agents/](../../packages/agents/README.md)) read this Brain and own the [KPIs](./kpis.md) defined here.
- **Sprints** ([../../docs/sprints/](../../docs/sprints/)) execute the [Roadmap](./roadmap.md) and [Goals](./goals.md).
- **Knowledge base** ([../../knowledge/](../../knowledge/README.md)) is the curated, retrievable corpus; the Company Brain is the business truth that frames it.
- **Playbooks** ([../../playbooks/](../../playbooks/README.md)) codify the repeatable procedures that carry out these decisions.

## Maintaining the Brain

The Company Brain is living but authoritative. Changes are made deliberately, reviewed, and — for strategic shifts — recorded per the [Decision Framework](./decision-framework.md). Keeping it accurate is how the company practices *Compounding Knowledge* (see [Values](./values.md)).
