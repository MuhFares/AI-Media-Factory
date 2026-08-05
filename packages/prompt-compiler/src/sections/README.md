# Sections

> Contracts only — declarations, no logic. The 9 sections in enforced assembly order.

| Section | Order | Required | Source | Purpose |
|---|---|---|---|---|
| System | 1 | Yes | `prompts/system.md` | Agent's base identity and instructions |
| Company Brain | 2 | Yes | `memory/company/` | Vision, mission, values, north-star, decision framework |
| Agent Brain | 3 | Yes | `packages/agents/{agent}/brain.md` | Agent-specific role, KPIs, authority |
| Workflow Context | 4 | Yes | `WorkflowContext` | Brand, correlation, step outputs, working data |
| Memory | 5 | Yes | MemoryEngine.retrieve() | Relevant past observations (RAG) |
| Examples | 6 | No | `prompts/examples.md` | Few-shot demonstrations |
| Task | 7 | Yes | `RuntimeInput.event` | The current input event |
| Output Schema | 8 | Yes | `schemas/output.schema.json` | JSON Schema + example |
| Safety | 9 | Yes | Config + Brand Guidelines | Guardrails, voice rules, prohibitions |

**Order is immutable.** The compiler enforces this order at compile time via `SectionType` enum ordering. See `ordering.ts` for the default allocation percentages and priority levels.