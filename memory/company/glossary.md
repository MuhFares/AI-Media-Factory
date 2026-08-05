# Glossary

> Part of the [Company Brain](./company.md). A shared vocabulary for every agent and human working in AI Media Factory (AMF). When a term is capitalized elsewhere in the Company Brain, its definition lives here.

Terms are alphabetized. Where useful, each entry links to the document that covers it in depth.

---

### Agent
An autonomous, specialized AI worker with a defined role, [configuration](../../packages/agents/), memory, prompts, and KPIs. AMF's agents form a digital org chart. See [packages/agents](../../packages/agents/README.md).

### AGP/Day (Autonomous Gross Profit per Day)
AMF's [North Star Metric](./north-star-metric.md): gross profit generated per day that requires no human intervention. Drivers are profitable assets per day, revenue per asset, cost per asset, and autonomy rate.

### AMF (AI Media Factory)
The company and the product: an AI Operating System that runs an autonomous media company across YouTube, TikTok, Instagram, blog, and email. See [company.md](./company.md).

### AMF Core
The internal AI operating system — the [Orchestrator](../../packages/agents/orchestrator/README.md), the agent workforce, and the event bus — on which everything else is built. See [Products](./products.md).

### AMF Studio
The Phase 2 SaaS product: a dashboard ([apps/web](../../apps/web)) that lets external customers operate the AMF engine. See [Products](./products.md) and [Pricing](./pricing.md).

### Analytics Agent
The agent that collects and interprets performance data after publishing and feeds insights upward to the CEO. See [analytics agent](../../packages/agents/analytics/README.md).

### Autonomy Rate
The share of workflow steps completed with no human involvement (`0.0`-`1.0`). A core input to [AGP/Day](./north-star-metric.md).

### Brand Portfolio
AMF's set of owned-and-operated faceless media brands — the Phase 1 revenue engine. See [Products](./products.md) and [Business Model](./business-model.md).

### CAC (Customer Acquisition Cost)
The cost to acquire one paying SaaS customer (Phase 2+). Kept well below LTV. See [KPIs](./kpis.md).

### CEO / Executive Brain
The top-of-org agent that makes strategic decisions only — priorities, new brands/niches, hiring agents, competitor analysis, KPI review, weekly executive report — and never executes work. See [ceo agent](../../packages/agents/ceo/README.md).

### Checkpoint
A saved state of a workflow or agent that allows a long-running run to resume, replay, or recover after failure. See [memory/checkpoints](../checkpoints/README.md).

### Company Brain
The permanent source of truth in `memory/company/` that every agent must read before making decisions. This document is part of it. See [company.md](./company.md).

### Compounding Knowledge
The value (see [Values](./values.md)) that every asset, experiment, and decision should make the company smarter, via the [knowledge base](../../knowledge/README.md) and Company Brain. The basis of the self-learning flywheel.

### Content Pipeline
The end-to-end production flow: Idea -> Research -> Script -> SEO -> Thumbnail -> Video -> Publishing -> Analytics -> CEO Review -> Repeat. See [Mission](./mission.md).

### Credit
The metered unit of AMF Studio usage; roughly one standard AI action. Sold in packs on top of subscription tiers. See [Pricing](./pricing.md).

### Dead-letter
A record of an event or job that exhausted its retries and needs attention. Captured in [logs/errors](../../logs/errors/README.md).

### Decision Gate
One of the four mandatory checks — North Star, Margin, Safety, Evidence — every decision must pass. See [Decision Framework](./decision-framework.md).

### Event Bus
The messaging backbone that carries events between agents, enabling the [event-driven architecture](../../docs/architecture/README.md). See [ADR-004](../../docs/decisions/README.md).

### Event-Driven Architecture
The design in which agents react to events (e.g., `ResearchFinished` -> `WriterStarted`) rather than running in a fixed linear script, enabling parallelism, resilience, and scale. See [docs/architecture](../../docs/architecture/README.md).

### Finance Agent
The controller agent that tracks cost and revenue, enforces budgets, and guards unit economics (the Margin gate). See [finance agent](../../packages/agents/finance/README.md).

### Growth Agent
The agent that optimizes audience growth and distribution through experiments and A/B tests. See [growth agent](../../packages/agents/growth/README.md).

### Guardrail
A configured constraint (budget, tool allow-list, brand-safety rule) that bounds what an agent may do autonomously. Defined in each agent's [config](../../packages/agents/).

### ICE
A lightweight prioritization score: `Impact x Confidence x Ease`, each 1-10. Used by specialist agents for fast tactical calls. See [Decision Framework](./decision-framework.md).

### Idea-to-Publish
The cycle time from an initial idea to a live, published asset — a key throughput KPI. See [KPIs](./kpis.md).

### Knowledge Base
The curated corpus in [knowledge/](../../knowledge/README.md) that agents retrieve from (RAG). Distinct from `data/` (raw/processed datasets) and from the Company Brain (business truth).

### LTV (Lifetime Value)
The total value a SaaS customer generates over their lifetime (Phase 2+). Target LTV:CAC >= 3:1. See [KPIs](./kpis.md).

### MCP (Model Context Protocol)
The protocol used to expose tools and context to agents in a standard way. See [packages/mcp](../../packages/mcp/README.md) and [ADR-002](../../docs/decisions/README.md).

### Model Routing
Choosing the most cost-effective capable model per task to protect margin. Configured in [configs/models](../../configs/models/README.md); governed by the Finance agent.

### MRR / ARR
Monthly / Annual Recurring Revenue from SaaS subscriptions (Phase 2+). See [Revenue Model](./revenue-model.md).

### North Star Metric
The single metric AMF optimizes above all others: [AGP/Day](./north-star-metric.md).

### O&O (Owned & Operated)
Phase 1 of the business model, in which AMF runs its own media brands rather than selling software. See [Business Model](./business-model.md).

### Orchestrator
The execution engine that receives objectives from the CEO, coordinates agents, manages retries, and drives the event bus. It executes; the CEO decides. See [orchestrator agent](../../packages/agents/orchestrator/README.md).

### Persona
A representative target customer (e.g., Chris the Creator, Ana the Agency Owner). See [Customer Personas](./customer-personas.md).

### Playbook
A curated, versioned, step-by-step operating procedure that agents and humans follow. Committed to version control. See [playbooks](../../playbooks/README.md).

### Publisher Agent
The agent that publishes finished assets to external platforms, handling scheduling, metadata, and platform-policy compliance. See [publisher agent](../../packages/agents/publisher/README.md).

### RICE
A prioritization score: `(Reach x Impact x Confidence) / Effort`. Used for larger initiatives by the CEO and Growth agents. See [Decision Framework](./decision-framework.md).

### RPM (Revenue per Mille)
Revenue per thousand views on a platform; an input to revenue per asset. See [Revenue Model](./revenue-model.md).

### SAM (Serviceable Addressable Market)
The portion of the total market AMF can realistically serve (~$60B illustrative). See [Target Market](./target-market.md).

### Self-Learning Flywheel
The compounding loop: produce -> publish -> measure -> learn -> improve -> produce better. Powered by the Company Brain and [knowledge base](../../knowledge/README.md). A core [competitive advantage](./competitive-advantages.md).

### SEO Agent
The agent that maximizes discoverability — keywords, metadata, on-page optimization. See [seo agent](../../packages/agents/seo/README.md).

### SOM (Serviceable Obtainable Market)
The share of the SAM AMF can capture in ~3 years (~$500M illustrative). See [Target Market](./target-market.md).

### Sprint
A time-boxed execution stage of the roadmap. AMF's four sprints: First Dollar, Scale, Multi-Brand, Full Autonomy. See [docs/sprints](../../docs/sprints/) and [Roadmap](./roadmap.md).

### TAM (Total Addressable Market)
The entire market for AMF's category (~$500B illustrative, global content production & marketing). See [Target Market](./target-market.md).

### Thumbnail Agent
The agent that produces click-optimized thumbnails, driving click-through rate. See [thumbnail agent](../../packages/agents/thumbnail/README.md).

### Two-way Door / One-way Door
A decision classification. Two-way doors are cheap to reverse (decide fast, autonomously); one-way doors are costly to reverse (escalate to the CEO). See [Decision Framework](./decision-framework.md).

### Video Agent
The agent that assembles and renders video assets, balancing quality against render cost. See [video agent](../../packages/agents/video/README.md).

### Writer Agent
The agent that turns research briefs into scripts and written content that retains audiences. See [writer agent](../../packages/agents/writer/README.md).

---

## Related documents

- [Company Overview](./company.md) — how these terms fit together
- [Decision Framework](./decision-framework.md) — RICE, ICE, gates, doors
- [KPIs](./kpis.md) — CAC, LTV, MRR/ARR, and the metric tree
- [North Star Metric](./north-star-metric.md) — AGP/Day in depth
