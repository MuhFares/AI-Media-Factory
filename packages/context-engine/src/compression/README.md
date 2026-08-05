# Compression

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `compressor.ts` | `ContextCompressor`, `CompressionResult` | #3 |
| `budget.ts` | `TokenBudget`, `SectionAllocation`, `MemoryPriority`, `BudgetAllocator` | #4, #5 |

## Compression Pipeline (in order)

1. **Deduplicate** — remove near-duplicate memories
2. **Summarize** — collapse similar memories into higher-level summaries
3. **Trim Examples** — reduce example count
4. **Trim Memory** — drop lowest-priority memories
5. **Truncate Workflow Context** — keep only relevant outputs
6. **Last Resort** — truncate Company/Agent Brain (never Safety)

## Token Budget

| Section | Default % | Priority | Flexible |
|---|---|---|---|
| Safety | 5% | 100 | No |
| System | 5% | 90 | No |
| Output Schema | 5% | 80 | No |
| Company Brain | 15% | 80 | Yes |
| Agent Brain | 10% | 80 | Yes |
| Workflow Context | 15% | 70 | Yes |
| Memory | 25% | 60 | Yes |
| Examples | 15% | 30 | Yes |

Total: 100% of maxPromptTokens. Safety/System/Schema never trimmed.