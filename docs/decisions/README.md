# Decisions

This directory holds Architecture Decision Records (ADRs). An ADR captures a single significant architectural or technical decision, the context that motivated it, and its consequences.

## ADR Format

Each ADR follows a consistent structure:

- **Context** — The situation, constraints, and forces that motivate the decision.
- **Decision** — The choice that was made, stated clearly and unambiguously.
- **Status** — The current state of the decision: Proposed, Accepted, Deprecated, or Superseded.
- **Consequences** — The resulting outcomes, trade-offs, and follow-on implications, both positive and negative.

## Naming Convention

ADR files are named using a zero-padded sequential number followed by a short, hyphenated title:

```
NNNN-title.md
```

For example, `0001-adopt-monorepo.md` or `0002-select-vector-store.md`. Numbers are assigned sequentially and never reused. Superseded ADRs are retained and marked accordingly, with a reference to the ADR that replaces them.
