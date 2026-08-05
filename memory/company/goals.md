# Goals

> Long-term ambition, mid-term milestones, and short-term sprints — all tied to one number.

Goals are how the [vision](./vision.md) and [mission](./mission.md) become measurable. Every goal below is chosen because it moves, or is a leading indicator of, the North Star: **Autonomous Gross Profit per Day (AGP/Day)**. If a goal does not eventually raise that number, it does not belong here. See [north-star-metric.md](./north-star-metric.md) and the full KPI tree in [kpis.md](./kpis.md).

Goals are organized by horizon, from the concrete work happening now to the ambition that shapes everything.

## The measurement spine

Before the horizons, the spine that connects them. AGP/Day has four inputs:

- **Profitable published assets per week** — throughput that actually earns.
- **Revenue per asset** — how much each earning asset makes.
- **Cost per asset** — what it costs to produce and publish.
- **Autonomy rate** — share of workflow steps with no human intervention.

Every goal in this document maps to one or more of these inputs. That mapping is what keeps ambition honest: a goal is only real if you can name which input it moves and by how much.

---

## Short-term goals (0–12 months): the four sprints

Short-term goals follow the sprint plan in [`../../docs/sprints/`](../../docs/sprints/). Each sprint has a single dominant objective and measurable exit criteria. Sprints are sequential: we do not advance until the prior sprint's exit criteria are met, because each proves a precondition for the next. This sequencing is [Speed to First Dollar](./values.md) and [Evidence over Opinion](./values.md) applied to planning.

### Sprint-001 — First Dollar
See [`../../docs/sprints/`](../../docs/sprints/) (Sprint-001).

**Objective.** Produce and publish, through the autonomous pipeline, at least one asset that generates real revenue. Prove the thesis end to end.

**Why it comes first.** The first dollar of autonomous profit validates the entire company. Everything after is scaling something that works; nothing before it is proven.

**Measurable targets.**
- At least one revenue-generating published asset produced by the full pipeline (Idea → … → CEO Review).
- AGP/Day > $0 for at least one day — the North Star turns positive.
- The complete pipeline runs at least once end to end with the human checkpoints defined in [decision-framework.md](./decision-framework.md) and no undefined manual steps.

**North Star input moved.** Establishes *profitable published assets per week* ≥ 1 and *revenue per asset* > *cost per asset* for at least one asset.

### Sprint-002 — Scale
See [`../../docs/sprints/`](../../docs/sprints/) (Sprint-002).

**Objective.** Take the one working asset and turn it into repeatable weekly throughput within a single brand.

**Measurable targets.**
- Profitable published assets per week rising week over week toward a sustained cadence.
- Cost per asset trending down as the pipeline is tuned and reused.
- Autonomy rate rising as repeated manual checkpoints are encoded into rules and removed. See [Autonomy by Default](./values.md).
- AGP/Day positive and growing across the sprint.

**North Star input moved.** *Profitable published assets per week* up; *cost per asset* down; *autonomy rate* up.

### Sprint-003 — Multi-Brand
See [`../../docs/sprints/`](../../docs/sprints/) (Sprint-003).

**Objective.** Prove the machine is not brand-specific by standing up additional brands on the same operating system.

**Measurable targets.**
- More than one brand operating profitably on the same pipeline with minimal per-brand custom work.
- The [knowledge base](../../knowledge/) demonstrably transferring learnings across brands — newer brands ramp faster than the first did. See [Compounding Knowledge](./values.md).
- Blended AGP/Day across brands growing.

**North Star input moved.** *Profitable published assets per week* up via portfolio breadth; *cost per asset* down via cross-brand reuse.

### Sprint-004 — Full Autonomy
See [`../../docs/sprints/`](../../docs/sprints/) (Sprint-004).

**Objective.** Drive the autonomy rate as high as safely possible, so the portfolio runs with genuinely minimal human input.

**Measurable targets.**
- Autonomy rate at its target ceiling, with remaining human steps limited to safety, legality, and brand-integrity checkpoints per [decision-framework.md](./decision-framework.md).
- AGP/Day growing primarily through autonomy and efficiency rather than added human hours.
- No regression in [Quality at Scale](./values.md) or [Safety & Brand Integrity](./values.md) as autonomy rises.

**North Star input moved.** *Autonomy rate* up; *cost per asset* down — both directly compounding AGP/Day.

---

## Mid-term goals (12–24 months)

With the machine proven and multi-brand, the mid-term is about turning a working operation into a business with leverage beyond our own brands.

- **Launch AMF Studio (SaaS).** Package the operating system as a subscription product so external operators can run autonomous brands on our infrastructure. This is Phase 2 of the [business model](./business-model.md).
- **Operate 10+ profitable owned brands.** A portfolio broad enough to prove durability and to feed the knowledge flywheel at volume.
- **Achieve positive blended unit economics.** Across the owned portfolio, the machine reliably produces more gross profit than it costs to run — not on a single lucky asset, but on average, at scale. This is [Business First](./values.md) made quantitative.

**North Star at this stage.** AGP/Day is no longer a proof point; it is a sustained, growing line, driven by both owned brands and early platform revenue.

---

## Long-term goals (3–5 years)

The long-term goals are the vision made countable. See [vision.md](./vision.md).

- **100+ autonomous brands plus the platform.** A portfolio and an operating system underneath other operators' brands.
- **Path to $100M ARR.** Combined revenue from owned-and-operated profit and platform/marketplace subscriptions and fees, across Phases 2 and 3 of the [business model](./business-model.md).
- **Path to a billion-dollar valuation.** Earned by the combination of proven unit economics, a compounding knowledge advantage, and platform leverage.

These are not aspirations detached from the daily loop. Each traces back through the mid-term milestones to the sprints, and each is ultimately a large, sustained AGP/Day.

---

## How goals stay honest

Three rules keep this document from becoming a wish list:

1. **Every goal names its North Star input.** If we cannot say which of the four inputs a goal moves, the goal is not ready.
2. **Sprints gate on evidence, not calendar.** We advance when exit criteria are met, per [Evidence over Opinion](./values.md).
3. **Goals are reviewed at CEO Review.** The CEO agent checks progress against these targets each cycle and reallocates budget toward what is working — see the pipeline in [mission.md](./mission.md).

## Related documents

- [north-star-metric.md](./north-star-metric.md) — the definition and mechanics of AGP/Day
- [kpis.md](./kpis.md) — the KPI tree and per-agent ownership beneath these goals
- [roadmap.md](./roadmap.md) — the sequenced plan that carries these goals across horizons
- [business-model.md](./business-model.md) — how the phases turn these goals into revenue
- Sprints: [`../../docs/sprints/`](../../docs/sprints/)
