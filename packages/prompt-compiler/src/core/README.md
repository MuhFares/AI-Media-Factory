# Core

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `common.ts` | `AgentId`, `Uuid`, `Timestamp`, `SectionType` (9 sections), `Json` |
| `context.ts` | `PromptContext`, `TokenBudget`, `SectionAllocation` — the full input to the compiler |
| `compiler.ts` | `PromptCompiler` — single entry point: `assemble(context) → FinalPrompt` |
| `builder.ts` | `PromptBuilder` — fluent API for constructing `FinalPrompt` |
| `template.ts` | `PromptTemplate`, `PromptVersion`, `VersionRegistry` (versioning) |

The **PromptCompiler** is the single entry point. It takes a `PromptContext` (assembled by the Runtime) and returns a `FinalPrompt` with all 9 sections assembled in order, validated, and budgeted.