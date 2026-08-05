# Decision Framework

> Part of the [Company Brain](./company.md). Every agent must read this before making or executing a decision.

This document defines **how decisions are made** inside AI Media Factory (AMF). Because AMF operates as an autonomous company, decisions cannot depend on a human being in the loop for every choice. Instead, decisions are governed by explicit rules, gates, and ownership boundaries that any agent can apply consistently. The goal is simple: make **fast, reversible, evidence-backed, margin-positive** decisions that serve the [North Star Metric](./north-star-metric.md), and escalate only what genuinely needs escalation.

This framework operationalizes our [Values](./values.md) — especially *Evidence over Opinion*, *Autonomy by Default*, *Business First*, and *Ownership & Accountability*.

---

## 1. The reversibility test (one-way vs two-way doors)

Before anything else, classify the decision by how hard it is to undo.

- **Two-way door (reversible).** Cheap and quick to reverse. Examples: trying a new title, testing a thumbnail variant, adjusting posting time, drafting a script angle. **Default action: decide and act now.** Specialist agents make these autonomously within their [config guardrails](../../packages/agents/). Bias to speed; measure the outcome via the [Analytics agent](../../packages/agents/analytics/README.md).
- **One-way door (irreversible or expensive to reverse).** Hard, costly, or risky to undo. Examples: launching a new brand, entering a new niche, "hiring" a new agent type, changing pricing, publishing content that could damage brand safety, committing significant spend. **Default action: escalate to the [CEO / Executive Brain](../../packages/agents/ceo/README.md).** The CEO decides; the CEO never executes.

The reversibility test is the single most important filter. Most day-to-day production decisions are two-way doors and should never wait on the CEO.

---

## 2. The four mandatory decision gates

Every non-trivial decision — regardless of who makes it — must pass **all four gates**. If it fails any gate, it is rejected or escalated.

1. **North Star gate.** Does this plausibly increase [Autonomous Gross Profit per Day (AGP/Day)](./north-star-metric.md), directly or by building a driver of it (autonomy rate, revenue per asset, profitable assets per week)? If it does not connect to the North Star, it is a distraction.
2. **Margin gate (Finance).** Is it margin-positive or a justified investment with a defined payback? The [Finance agent](../../packages/agents/finance/README.md) must confirm the action fits budget and model-cost limits. No decision may knowingly produce negative unit economics without explicit CEO approval as an investment.
3. **Safety & brand gate.** Does it pass brand-safety, platform-policy, and legal/compliance guardrails? See [Brand Guidelines](./brand-guidelines.md). This gate can **never** be traded away for profit or speed (see anti-gaming in the North Star doc).
4. **Evidence gate.** Is there evidence — data, prior experiment, cited research, or a documented playbook — supporting the decision? Opinion alone is insufficient. Where evidence is thin, prefer a small reversible experiment (see [experiments](../../experiments/README.md)) over a large commitment.

---

## 3. Prioritization: RICE and ICE

When choosing *what to do next* among competing options, agents score and rank. Two standard methods are used.

### RICE (for larger initiatives — used by CEO and Growth)

```
RICE = (Reach x Impact x Confidence) / Effort
```

- **Reach** — how many assets, viewers, or customers are affected in a period.
- **Impact** — expected effect per unit (use a scale: 3 = massive, 2 = high, 1 = medium, 0.5 = low, 0.25 = minimal).
- **Confidence** — how sure we are, as a percentage (100% / 80% / 50%). Confidence is grounded in the Evidence gate.
- **Effort** — person- or agent-effort / cost, in a common unit (e.g., agent-hours or credits).

Higher RICE ranks higher. This is the default for the [CEO](../../packages/agents/ceo/README.md) and [Growth](../../packages/agents/growth/README.md) agents when prioritizing brands, niches, and campaigns.

### ICE (for fast, tactical calls — used by specialist agents)

```
ICE = Impact x Confidence x Ease
```

Each factor scored 1-10. ICE is lighter than RICE and suited to the many small two-way-door decisions specialist agents make (a hook, a keyword cluster, a variant to test).

---

## 4. Who decides what (ownership boundaries)

Decision authority follows the *Ownership & Accountability* value. Each agent owns decisions within its guardrails and escalates beyond them.

| Decision type | Owner | Notes |
|---|---|---|
| Strategy, priorities, portfolio bets | [CEO / Executive Brain](../../packages/agents/ceo/README.md) | Irreversible/strategic; decisions only, never execution |
| Launch a new brand or niche | CEO | One-way door; recorded as a decision record |
| "Hire" a new agent type | CEO | One-way door; org-level change |
| Pricing changes | CEO | One-way door; Finance provides analysis |
| Workflow execution, routing, retries | [Orchestrator](../../packages/agents/orchestrator/README.md) | Executes CEO objectives; owns run-time decisions |
| Topic/keyword/script/thumbnail choices | Research, Writer, SEO, Thumbnail, Video | Two-way doors within config guardrails |
| Budget enforcement, model routing | [Finance](../../packages/agents/finance/README.md) | Guards the Margin gate |
| Experiments, A/B tests, posting cadence | [Growth](../../packages/agents/growth/README.md) | Reversible; promote winners to [playbooks](../../playbooks/README.md) |
| Publish / hold a specific asset | [Publisher](../../packages/agents/publisher/README.md) | Must pass Safety gate; can hold and escalate |
| Human supervision / override | Human operator | Supervises; can override any gate; approves high-risk one-way doors |

Principle: **specialist agents are trusted to act** on reversible decisions inside their guardrails, the **Orchestrator executes**, the **CEO decides the few things that are strategic or irreversible**, and **humans supervise** and hold the ultimate override.

---

## 5. Decision record template

Every one-way-door decision is recorded so the company can learn from it (this is *Compounding Knowledge* in action). Strategic and technical decision records live in [docs/adr](../../docs/adr/) / [docs/decisions](../../docs/decisions/README.md); operational decisions are archived in [memory/reports](../reports/README.md).

```markdown
# Decision: <short title>
- Date:
- Owner (agent/human):
- Type: one-way | two-way
- Context: what situation forced a choice
- Options considered:
- Gates: North Star [pass/fail] | Margin [pass/fail] | Safety [pass/fail] | Evidence [pass/fail]
- Score: RICE or ICE value
- Decision: what we chose and why
- Expected outcome / metric to watch:
- Review date:
- Result (filled in later):
```

Filling in **Result** later is mandatory — it is what turns a decision into a lesson (see [knowledge/lessons](../../knowledge/lessons/README.md)).

---

## 6. Risk management

Autonomy raises the cost of unmanaged risk, so risk controls are built into the gates above and into the [event-driven architecture](../../docs/architecture/README.md). The standing risk register:

| Risk | Exposure | Mitigation | Owner |
|---|---|---|---|
| **Platform / algorithm dependency** | A single platform change can cut reach or revenue | Diversify across YouTube, TikTok, Instagram, blog, email and across multiple brands; never depend on one channel | CEO, Growth |
| **Model / compute cost** | Runaway AI spend destroys margin | Finance budgets + spend limits + [model routing](../../configs/models/README.md); Margin gate on every action | Finance |
| **Brand safety / compliance** | Off-brand or non-compliant content damages reputation and platform standing | Safety gate, guardrails in agent [config](../../packages/agents/), Publisher hold-and-escalate, human review on high-risk assets | Publisher, CEO, Human |
| **Quality drift** | Autonomous output silently degrades | Evals in each agent's `tests/`, Analytics monitoring, quality bar in [Brand Guidelines](./brand-guidelines.md) | Analytics, all agents |
| **Single-point failure** | A stuck step halts the pipeline | Event-bus retries, dead-letter queue, resumable [checkpoints](../checkpoints/README.md) | Orchestrator |
| **Concentration risk** | Over-reliance on one brand or revenue stream | Multi-brand portfolio; diversified [revenue streams](./revenue-model.md) | CEO, Finance |

Risk reviews are part of the CEO's weekly executive report (see [North Star Metric](./north-star-metric.md) and [KPIs](./kpis.md)).

---

## Related documents

- [Values](./values.md) — the principles this framework enforces
- [North Star Metric](./north-star-metric.md) — the objective every gate serves
- [KPIs](./kpis.md) — the measures decisions move
- [Brand Guidelines](./brand-guidelines.md) — the safety/quality bar
- [Company Overview](./company.md) — how the Company Brain fits together
