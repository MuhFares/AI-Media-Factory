# Decision Memory

Decision Memory is the permanent record of material decisions the company makes: one-way-door business decisions (launching or killing a brand, entering a niche, hiring a new agent type, changing pricing) and their outcomes. It is a committed, tracked memory type in the [Memory Architecture](../../docs/architecture/memory-architecture.md).

Unlike the runtime memory folders, Decision Memory is version-controlled. It is a governance asset and an audit trail.

## Relationship to docs/decisions

- **`memory/decisions/`** (here) — operational and business decision records made by the [CEO / Executive Brain](../../packages/agents/ceo/README.md) during company operation.
- **[`docs/decisions/`](../../docs/decisions/README.md)** — Architecture Decision Records (ADRs): significant technical/architectural decisions.

Both use a Context / Decision / Status / Consequences structure and are never rewritten to change history.

## Owner

The CEO owns business decision records; the proposing architect or agent authors ADRs. All are curated centrally and recorded per the [Decision Framework](../../memory/company/decision-framework.md).

## What belongs here

A decision record per the template in the [Decision Framework](../../memory/company/decision-framework.md): context, options considered, the four gate results (North Star, Margin, Safety, Evidence), the RICE/ICE score, the decision, the expected outcome, a review date, and — filled in later — the `Result`.

## Lifecycle

A record is written at the moment a one-way-door decision is made. Its `Result` is filled in once the outcome is known — which is what turns a decision into a [lesson](../../knowledge/lessons/README.md).

## Update rules

Append-only. A record is never edited to alter history; it is superseded by a new record that references it. Filling in `Result` is mandatory.

## Archival rules

Never deleted. Superseded decisions are marked and linked to their successor, preserving a complete audit trail.
