# Playbooks

Playbooks are curated, versioned, step-by-step operating procedures that both the AI agents and human operators follow. Unlike `memory/`, `logs/`, and `storage/` — which hold runtime state and are git-ignored — playbooks are committed to version control. They are the codified operating wisdom of the company.

A playbook turns a repeatable situation into a reliable, reviewable procedure. When the `growth` agent discovers a tactic that works, or the team resolves an incident, the learning is promoted into a playbook so the whole company executes it consistently.

## What belongs here

- Repeatable operational procedures with clear triggers, steps, owners, and success criteria.
- Runbooks for recovering from failures and incidents.
- Rituals such as the weekly CEO executive review.

## Structure

Each playbook is a single markdown file named with a short, hyphenated title, for example:

```
launch-new-brand.md
recover-failed-render.md
respond-to-viral-spike.md
weekly-ceo-review.md
onboard-new-agent.md
```

## Playbook format

Every playbook should include:

- **Trigger** — the situation or event that invokes the playbook.
- **Owner** — the agent or role accountable (e.g., `ceo`, `orchestrator`, human operator).
- **Preconditions** — what must be true before starting.
- **Steps** — the ordered procedure.
- **Success criteria** — how you know it worked.
- **Rollback / escalation** — what to do if it fails.

## Example playbooks (planned)

- `launch-new-brand.md` — from CEO decision to a live, producing brand.
- `recover-failed-render.md` — diagnosing and recovering a failed `worker` render.
- `respond-to-viral-spike.md` — capitalizing on a breakout piece of content.
- `weekly-ceo-review.md` — the recurring executive review ritual and report generation.
